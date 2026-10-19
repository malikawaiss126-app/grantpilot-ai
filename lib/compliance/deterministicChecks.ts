import type { GrantProject } from "@/types/project";
import type { RuleCheck } from "@/types/compliance";

// ---------------------------------------------------------------------------
// Deterministic compliance rules (PRD §60).
// Everything here is plain application code: no LLM, no network, no quota.
// It is safe to run on every render in the browser or on the server.
// ---------------------------------------------------------------------------

/**
 * Chinese, Japanese and Korean characters (no CJK punctuation).
 * These languages are written without spaces between words, so each
 * character counts as one "word", the same rule Microsoft Word uses and the
 * way "不超过500字" limits are written.
 */
const CJK_CHARS =
  /[\u2E80-\u2FDF\u3040-\u30FF\u3100-\u312F\u3190-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF66-\uFF9F\u{20000}-\u{2FA1F}]/gu;

/** True when a language name such as "Chinese (Simplified)" is Chinese, Japanese or Korean. */
export function isCjkLanguage(language: string | undefined): boolean {
  return (
    !!language &&
    /chinese|japanese|korean|中文|汉语|漢語|日本語|한국어/i.test(language)
  );
}

/**
 * Deterministic word count (the LLM must never be used to count words).
 * Works for spaced languages (English, Spanish...) and for Chinese, Japanese
 * and Korean text, and for mixtures of both.
 */
export function countWords(text: string): number {
  const clean = text.replace(/<[^>]*>/g, " ").replace(/[#*_`>]/g, " ");
  const cjkCount = clean.match(CJK_CHARS)?.length ?? 0;
  const spacedWords = clean
    .replace(CJK_CHARS, " ")
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  return cjkCount + spacedWords;
}

/** "[Information needed: ...]" markers the writing agent leaves for missing facts. */
export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[Information needed:[^\]]*\]/gi) ?? [])];
}

export interface RuleSummary {
  total: number;
  passed: number;
  warnings: number;
  failed: number;
  /** True when no check failed. Warnings do not block export. */
  readyForExport: boolean;
}

export function summarizeChecks(checks: RuleCheck[]): RuleSummary {
  const passed = checks.filter((c) => c.status === "pass").length;
  const warnings = checks.filter((c) => c.status === "warning").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  return {
    total: checks.length,
    passed,
    warnings,
    failed,
    readyForExport: failed === 0,
  };
}

export function runDeterministicChecks(
  project: GrantProject,
  now: Date = new Date(),
): RuleCheck[] {
  const checks: RuleCheck[] = [];
  const sections = [...project.sections].sort((a, b) => a.order - b.order);

  // --- Project-wide checks ---------------------------------------------------

  const requiredButOff = sections.filter((s) => s.required && !s.enabled);
  if (requiredButOff.length > 0) {
    checks.push({
      id: "project:required-sections-enabled",
      label: "Required sections included",
      status: "warning",
      detail: `The guideline marks these sections as required, but they are turned off: ${requiredButOff
        .map((s) => s.title)
        .join(", ")}.`,
    });
  } else {
    checks.push({
      id: "project:required-sections-enabled",
      label: "Required sections included",
      status: "pass",
      detail: "Every required section from the guideline is included.",
    });
  }

  if (project.deadline) {
    const parsed = Date.parse(project.deadline);
    if (!Number.isNaN(parsed)) {
      const daysLeft = Math.ceil((parsed - now.getTime()) / 86_400_000);
      if (daysLeft < 0) {
        checks.push({
          id: "project:deadline",
          label: "Submission deadline",
          status: "warning",
          detail: `The deadline (${project.deadline}) appears to have passed. Check whether it was extended.`,
        });
      } else if (daysLeft <= 7) {
        checks.push({
          id: "project:deadline",
          label: "Submission deadline",
          status: "warning",
          detail: `The deadline (${project.deadline}) is in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
        });
      }
    }
  }

  const attachments = project.guideline?.attachments ?? [];
  if (attachments.length > 0) {
    checks.push({
      id: "project:attachments",
      label: "Supporting documents",
      status: "warning",
      detail: `GrantPilot does not create attachments. Prepare these separately: ${attachments.join("; ")}.`,
    });
  }

  // --- Per-section checks ------------------------------------------------------

  for (const section of sections.filter((s) => s.enabled)) {
    const content = section.generatedContent?.trim() ?? "";
    const base = { sectionId: section.id };

    if (!content) {
      checks.push({
        ...base,
        id: `${section.id}:generated`,
        label: `${section.title}: content written`,
        status: section.required ? "fail" : "warning",
        detail: section.required
          ? "This required section has not been generated yet."
          : "This optional section has not been generated yet.",
      });
      continue; // nothing else to measure
    }

    checks.push({
      ...base,
      id: `${section.id}:generated`,
      label: `${section.title}: content written`,
      status: "pass",
      detail: "Content is present.",
    });

    if (section.wordLimit) {
      const words = countWords(content);
      const over = words > section.wordLimit;
      checks.push({
        ...base,
        id: `${section.id}:words`,
        label: `${section.title}: word limit`,
        status: over ? "fail" : "pass",
        detail: over
          ? `${words} words, which is ${words - section.wordLimit} over the ${section.wordLimit}-word limit.`
          : `${words} of ${section.wordLimit} words.`,
      });
    }

    if (section.characterLimit) {
      const chars = content.length;
      const over = chars > section.characterLimit;
      checks.push({
        ...base,
        id: `${section.id}:chars`,
        label: `${section.title}: character limit`,
        status: over ? "fail" : "pass",
        detail: over
          ? `${chars} characters, which is ${chars - section.characterLimit} over the ${section.characterLimit}-character limit.`
          : `${chars} of ${section.characterLimit} characters.`,
      });
    }

    const placeholders = findPlaceholders(content);
    checks.push({
      ...base,
      id: `${section.id}:placeholders`,
      label: `${section.title}: no missing information`,
      status: placeholders.length > 0 ? "fail" : "pass",
      detail:
        placeholders.length > 0
          ? `${placeholders.length} placeholder(s) still need your input: ${placeholders.join(" ")}`
          : "No unresolved placeholders.",
    });

    checks.push({
      ...base,
      id: `${section.id}:approved`,
      label: `${section.title}: reviewed and approved`,
      status: section.status === "approved" ? "pass" : "warning",
      detail:
        section.status === "approved"
          ? "Approved by you."
          : "Not approved yet. Review the text and approve it in the Generation workspace.",
    });
  }

  return checks;
}
