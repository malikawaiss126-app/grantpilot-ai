import { SchemaType, type ResponseSchema } from "@google/generative-ai";
import {
  getGenAI,
  parseJsonOutput,
  toGeminiError,
  withModelFallback,
} from "@/lib/gemini/config";
import type { GrantProject } from "@/types/project";
import {
  CONSISTENCY_CHECKS,
  type ConsistencyCheck,
  type ConsistencyReport,
  type ConsistencyStatus,
  type Contradiction,
} from "@/types/compliance";

// ---------------------------------------------------------------------------
// Cross-Section Consistency Agent (PRD §28).
// The model judges each consistency dimension; the overall score is then
// computed by application code so it is explainable and reproducible.
// ---------------------------------------------------------------------------

const VALID_STATUSES: ConsistencyStatus[] = [
  "consistent",
  "minor_issue",
  "inconsistent",
  "not_applicable",
];

const STATUS_POINTS: Record<
  Exclude<ConsistencyStatus, "not_applicable">,
  number
> = {
  consistent: 100,
  minor_issue: 70,
  inconsistent: 20,
};

const stringArray = {
  type: SchemaType.ARRAY,
  items: { type: SchemaType.STRING },
} as const;

const responseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    checks: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING },
          status: { type: SchemaType.STRING },
          explanation: { type: SchemaType.STRING },
          sections: stringArray,
        },
        required: ["id", "status", "explanation"],
      },
    },
    contradictions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          description: { type: SchemaType.STRING },
          sections: stringArray,
          suggestedFix: { type: SchemaType.STRING },
        },
        required: ["description"],
      },
    },
    recommendations: stringArray,
  },
  required: ["checks", "contradictions", "recommendations"],
};

interface RawCheck {
  id?: unknown;
  status?: unknown;
  explanation?: unknown;
  sections?: unknown;
}
interface RawContradiction {
  description?: unknown;
  sections?: unknown;
  suggestedFix?: unknown;
}
interface RawReport {
  checks?: RawCheck[];
  contradictions?: RawContradiction[];
  recommendations?: unknown;
}

const toStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

function buildPrompt(project: GrantProject): string {
  const language = project.guideline?.language?.trim() || undefined;
  const sections = project.sections
    .filter((s) => s.enabled && s.generatedContent?.trim())
    .sort((a, b) => a.order - b.order);

  const sectionsText = sections
    .map((s) => `=== SECTION: ${s.title} ===\n${s.generatedContent!.trim()}`)
    .join("\n\n");

  const objectives =
    project.projectBrief.objectives.length > 0
      ? project.projectBrief.objectives
          .map((o, i) => `${i + 1}. ${o}`)
          .join("\n")
      : "Not provided";

  const checkList = CONSISTENCY_CHECKS.map((c) => `- ${c.id}: ${c.label}`).join(
    "\n",
  );

  return `You are a meticulous grant auditor. Evaluate the INTERNAL consistency of the proposal sections below. Judge only what is written; do not judge quality or guideline compliance.

PROJECT METADATA (applicant input)
- Title: ${project.title}
- Declared duration: ${project.duration || "Not specified"}
- Funding limit: ${project.fundingLimit || "Not specified"}
- Declared objectives:
${objectives}

SECTIONS PRESENT: ${sections.map((s) => s.title).join(", ")}

${sectionsText}

TASK
Return one entry in "checks" for EACH of these ids:
${checkList}

For each check give:
- status: "consistent" (no problem found), "minor_issue" (small wording/detail mismatch), "inconsistent" (a clear contradiction or misalignment), or "not_applicable" (the sections needed to judge this are not present or the topic is not discussed).
- explanation: 1-2 sentences naming the concrete evidence (what the sections actually say).
- sections: the exact titles of the sections involved (from SECTIONS PRESENT).

Also return:
- contradictions: every concrete contradiction you found (description, the sections involved, and a suggestedFix). Empty array if none.
- recommendations: up to 5 prioritized, actionable fixes. Empty array if everything is consistent.

RULES
- Never invent problems. Only report what is supported by the text above.
- Use "not_applicable" rather than guessing when information is missing.
- Check the numbers: durations, dates, totals and counts must agree across sections.
- LANGUAGE: write every "explanation", "description", "suggestedFix" and recommendation in ${language ?? "the same language as the proposal sections"}, the language of the proposal. Section titles stay exactly as listed in SECTIONS PRESENT.`;
}

function normalizeReport(raw: RawReport, model: string): ConsistencyReport {
  const rawChecks = Array.isArray(raw.checks) ? raw.checks : [];

  const contradictions: Contradiction[] = (
    Array.isArray(raw.contradictions) ? raw.contradictions : []
  )
    .filter(
      (c): c is RawContradiction & { description: string } =>
        typeof c?.description === "string" && c.description.trim().length > 0,
    )
    .map((c) => ({
      description: c.description.trim(),
      sections: toStrings(c.sections),
      suggestedFix:
        typeof c.suggestedFix === "string" && c.suggestedFix.trim()
          ? c.suggestedFix.trim()
          : undefined,
    }));

  const checks: ConsistencyCheck[] = CONSISTENCY_CHECKS.map(({ id, label }) => {
    const found = rawChecks.find((c) => c?.id === id);
    let status: ConsistencyStatus =
      found && VALID_STATUSES.includes(found.status as ConsistencyStatus)
        ? (found.status as ConsistencyStatus)
        : "not_applicable";

    // A reported contradiction can never coexist with a clean "claims" check.
    if (
      id === "claims" &&
      contradictions.length > 0 &&
      status === "consistent"
    ) {
      status = "minor_issue";
    }

    return {
      id,
      label,
      status,
      explanation:
        typeof found?.explanation === "string" && found.explanation.trim()
          ? found.explanation.trim()
          : "The model did not evaluate this check.",
      sections: toStrings(found?.sections),
    };
  });

  const scored = checks.filter(
    (c): c is ConsistencyCheck & { status: keyof typeof STATUS_POINTS } =>
      c.status !== "not_applicable",
  );
  const overallScore =
    scored.length === 0
      ? 0
      : Math.round(
          scored.reduce((sum, c) => sum + STATUS_POINTS[c.status], 0) /
            scored.length,
        );

  return {
    overallScore,
    checks,
    contradictions,
    recommendations: toStrings(raw.recommendations).slice(0, 5),
    generatedAt: new Date().toISOString(),
    model,
  };
}

export async function checkCrossSectionConsistency(
  project: GrantProject,
): Promise<ConsistencyReport> {
  try {
    const prompt = buildPrompt(project);
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
    const raw = parseJsonOutput<RawReport>(result.response.text());
    return normalizeReport(raw, modelName);
  } catch (err) {
    throw toGeminiError(err);
  }
}
