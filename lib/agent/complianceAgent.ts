import { SchemaType, type ResponseSchema } from "@google/generative-ai";
import {
  getGenAI,
  getModelName,
  parseJsonOutput,
  toGeminiError,
  withModelFallback,
} from "@/lib/gemini/config";
import type { GrantProject } from "@/types/project";
import type {
  ComplianceReport,
  RequirementResult,
  RequirementStatus,
  SectionComplianceResult,
} from "@/types/compliance";

// ---------------------------------------------------------------------------
// Compliance Checker Agent (PRD §26).
// Semantic matching only: "does this text actually satisfy this requirement?"
// Counting words, required sections, placeholders etc. is done in plain code
// (lib/compliance/deterministicChecks.ts), never here. Scores are computed
// from the statuses by application code.
// ---------------------------------------------------------------------------

export const GENERAL_GROUP_ID = "__general__";
const MAX_REQUIREMENTS_PER_GROUP = 15;

const STATUS_POINTS: Record<RequirementStatus, number> = {
  satisfied: 100,
  partial: 50,
  missing: 0,
};

const VALID_STATUSES: RequirementStatus[] = ["satisfied", "partial", "missing"];

const responseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    results: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING },
          status: { type: SchemaType.STRING },
          evidence: { type: SchemaType.STRING },
          recommendation: { type: SchemaType.STRING },
        },
        required: ["id", "status"],
      },
    },
  },
  required: ["results"],
};

interface RawResult {
  id?: unknown;
  status?: unknown;
  evidence?: unknown;
  recommendation?: unknown;
}

interface RequirementGroup {
  groupId: string;
  title: string;
  /** Present for normal sections; absent for the proposal-wide group. */
  content?: string;
  requirements: { key: string; text: string }[];
}

const clean = (items: string[] | undefined): string[] =>
  (items ?? []).map((i) => i.trim()).filter(Boolean);

/** Builds the list of things to check, each with a stable id the model must echo. */
function buildGroups(project: GrantProject): RequirementGroup[] {
  const groups: RequirementGroup[] = [];

  const sections = project.sections
    .filter((s) => s.enabled && s.generatedContent?.trim())
    .sort((a, b) => a.order - b.order);

  sections.forEach((section, si) => {
    const texts = [
      ...clean(section.requirements),
      ...clean(section.evaluationCriteria).map(
        (c) => `Evaluation criterion: ${c}`,
      ),
    ].slice(0, MAX_REQUIREMENTS_PER_GROUP);

    if (texts.length === 0) return;
    groups.push({
      groupId: section.id,
      title: section.title,
      content: section.generatedContent!.trim(),
      requirements: texts.map((text, ri) => ({
        key: `S${si + 1}R${ri + 1}`,
        text,
      })),
    });
  });

  // Proposal-wide requirements are judged against the whole proposal.
  const generalTexts = [
    ...clean(project.guideline?.generalRequirements),
    ...clean(project.guideline?.budgetRequirements).map(
      (b) => `Budget rule: ${b}`,
    ),
  ].slice(0, MAX_REQUIREMENTS_PER_GROUP);

  if (generalTexts.length > 0 && sections.length > 0) {
    groups.push({
      groupId: GENERAL_GROUP_ID,
      // Shown in the report, so it follows the proposal language.
      title: /chinese|中文|汉语|漢語/i.test(project.guideline?.language ?? "")
        ? "通用申请要求"
        : "General application requirements",
      requirements: generalTexts.map((text, ri) => ({
        key: `GR${ri + 1}`,
        text,
      })),
    });
  }

  return groups;
}

function buildPrompt(
  project: GrantProject,
  groups: RequirementGroup[],
): string {
  const language = project.guideline?.language?.trim() || undefined;
  const proposalText = project.sections
    .filter((s) => s.enabled && s.generatedContent?.trim())
    .sort((a, b) => a.order - b.order)
    .map((s) => `=== SECTION: ${s.title} ===\n${s.generatedContent!.trim()}`)
    .join("\n\n");

  const checklist = groups
    .map((g) => {
      const scope =
        g.groupId === GENERAL_GROUP_ID
          ? "judge against the WHOLE proposal"
          : `judge against the section "${g.title}" only`;
      return `## ${g.title} (${scope})\n${g.requirements
        .map((r) => `- [${r.key}] ${r.text}`)
        .join("\n")}`;
    })
    .join("\n\n");

  return `You are a strict grant compliance reviewer. For every requirement in the checklist, decide whether the proposal text satisfies it.

STATUS DEFINITIONS
- "satisfied": the text explicitly and adequately addresses the requirement.
- "partial": the text touches on it but is vague, incomplete or missing a needed element.
- "missing": the text does not address it at all.

RULES
1. Judge ONLY what is written. Do not assume the applicant "probably" does something.
2. A requirement whose answer is an "[Information needed: ...]" placeholder is NOT satisfied (use "partial" or "missing").
3. Be strict, not generous. When unsure between two statuses, choose the lower one.
4. For every item return the id exactly as shown in brackets, for example "S1R2".
5. evidence: a SHORT quote (maximum 25 words) from the text or a one-sentence explanation of why you chose the status.
6. recommendation: for "partial" or "missing" only, one concrete sentence saying what to add or change. Omit it for "satisfied".
7. LANGUAGE: write "evidence" and "recommendation" in ${language ?? "the same language as the proposal text"}, the language of the proposal. Quotes stay exactly as written in the text.

CHECKLIST
${checklist}

PROPOSAL TEXT
${proposalText}`;
}

function scoreOf(requirements: RequirementResult[]): number {
  if (requirements.length === 0) return 0;
  const total = requirements.reduce(
    (sum, r) => sum + STATUS_POINTS[r.status],
    0,
  );
  return Math.round(total / requirements.length);
}

function normalizeReport(
  groups: RequirementGroup[],
  rawResults: RawResult[],
  model: string,
): ComplianceReport {
  const byKey = new Map<string, RawResult>();
  for (const r of rawResults) {
    if (typeof r?.id === "string") byKey.set(r.id.trim().toUpperCase(), r);
  }

  const sections: SectionComplianceResult[] = groups.map((group) => {
    const requirements: RequirementResult[] = group.requirements.map((req) => {
      const raw = byKey.get(req.key);
      const valid =
        raw && VALID_STATUSES.includes(raw.status as RequirementStatus);

      if (!raw || !valid) {
        // Never silently drop a requirement the model failed to evaluate.
        return {
          requirement: req.text,
          status: "partial",
          evidence: "The AI did not return a verdict for this requirement.",
          recommendation: "Re-run the compliance check to evaluate it.",
        };
      }

      const status = raw.status as RequirementStatus;
      return {
        requirement: req.text,
        status,
        evidence:
          typeof raw.evidence === "string" && raw.evidence.trim()
            ? raw.evidence.trim()
            : undefined,
        recommendation:
          status !== "satisfied" &&
          typeof raw.recommendation === "string" &&
          raw.recommendation.trim()
            ? raw.recommendation.trim()
            : undefined,
      };
    });

    return {
      sectionId: group.groupId,
      sectionTitle: group.title,
      score: scoreOf(requirements),
      requirements,
    };
  });

  const overallScore =
    sections.length === 0
      ? 0
      : Math.round(
          sections.reduce((sum, s) => sum + s.score, 0) / sections.length,
        );

  return {
    overallScore,
    sections,
    generatedAt: new Date().toISOString(),
    model,
  };
}

/**
 * Returns a report with `sections: []` when there is nothing to check
 * (no generated text, or the guideline lists no requirements).
 */
export async function checkCompliance(
  project: GrantProject,
): Promise<ComplianceReport> {
  const groups = buildGroups(project);
  if (groups.length === 0) {
    return {
      overallScore: 0,
      sections: [],
      generatedAt: new Date().toISOString(),
      model: getModelName(),
    };
  }

  try {
    const prompt = buildPrompt(project, groups);
    const { result, modelName } = await withModelFallback((name) =>
      getGenAI()
        .getGenerativeModel({
          model: name,
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema,
          },
        })
        .generateContent(prompt),
    );
    const parsed = parseJsonOutput<{ results?: RawResult[] }>(
      result.response.text(),
    );
    return normalizeReport(
      groups,
      Array.isArray(parsed.results) ? parsed.results : [],
      modelName,
    );
  } catch (err) {
    throw toGeminiError(err);
  }
}
