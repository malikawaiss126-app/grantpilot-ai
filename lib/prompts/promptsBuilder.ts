import type { GrantProject } from "@/types/project";
import type { GrantSection } from "@/types/prompt";
import { isCjkLanguage } from "@/lib/compliance/deterministicChecks";

// ---------------------------------------------------------------------------
// Prompt Builder (PRD §20-§23).
// Assembles the final text sent to Gemini from: the guideline, the project
// brief, the section prompt template, the global prompt and (optionally) the
// previously approved sections. The same function feeds the Prompt Studio
// preview and the real generation call, so what you preview is what is sent.
// ---------------------------------------------------------------------------

export interface AssembledPrompt {
  systemInstructions: string;
  assembledText: string;
  variableMap: Record<string, string>;
}

const NOT_PROVIDED = "Not provided";

const TONE_DESCRIPTIONS: Record<GrantSection["tone"], string> = {
  academic: "formal, scholarly and evidence-oriented",
  professional: "polished, clear and business-like",
  technical: "precise, technical and detail-oriented",
  general: "clear and accessible to a non-specialist reviewer",
};

/** Maps the Prompt Studio "creativity" setting to a Gemini temperature. */
export function getTemperature(creativity: GrantSection["creativity"]): number {
  switch (creativity) {
    case "high":
      return 0.8;
    case "medium":
      return 0.5;
    default:
      return 0.2;
  }
}

const bullets = (items: string[] | undefined, fallback: string): string =>
  items && items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : fallback;

const orFallback = (value: string | undefined, fallback = NOT_PROVIDED) =>
  value && value.trim() ? value.trim() : fallback;

const BUDGET_SECTION_PATTERN = /budget|cost|financ|fund|expens/i;

export function buildSectionPrompt(
  project: GrantProject,
  sectionId: string,
  previousSectionsContent: Record<string, string> = {},
): AssembledPrompt {
  const section = project.sections.find((s) => s.id === sectionId);
  if (!section) {
    throw new Error(`Section with ID "${sectionId}" not found in project.`);
  }

  const brief = project.projectBrief;
  const guideline = project.guideline;
  const isBudgetSection = BUDGET_SECTION_PATTERN.test(section.title);

  // The proposal is written in the language of the grant guideline.
  const language = guideline?.language?.trim() || undefined;
  const isCjk = isCjkLanguage(language);

  // 1. Variables available to section prompt templates ({{variable_name}})
  const variableMap: Record<string, string> = {
    project_title: orFallback(project.title, "Untitled Project"),
    grant_name: orFallback(
      project.grantName ?? guideline?.grantName,
      "Grant Opportunity",
    ),
    organization: orFallback(
      project.organization ?? guideline?.organization,
      "Not specified",
    ),
    applicant_name: orFallback(project.applicant?.name),
    institution: orFallback(project.applicant?.institution),
    problem_statement: orFallback(brief.problem),
    proposed_solution: orFallback(brief.proposedSolution),
    objectives:
      brief.objectives.length > 0
        ? brief.objectives.map((o, idx) => `${idx + 1}. ${o}`).join("\n")
        : NOT_PROVIDED,
    methodology: orFallback(brief.methodology),
    target_beneficiaries: orFallback(brief.beneficiaries, "Not specified"),
    innovation: orFallback(brief.innovation),
    expected_results: orFallback(brief.expectedResults),
    technologies:
      brief.technologies && brief.technologies.length > 0
        ? brief.technologies.join(", ")
        : NOT_PROVIDED,
    project_duration: orFallback(project.duration, "Not specified"),
    requested_budget: orFallback(project.fundingLimit, "Not specified"),
    deadline: orFallback(project.deadline, "Not specified"),
    output_language: language ?? "the same language as the guideline",
    section_name: section.title,
    word_limit: section.wordLimit
      ? isCjk
        ? `${section.wordLimit} characters (字)`
        : `${section.wordLimit} words`
      : "No strict limit specified",
    character_limit: section.characterLimit
      ? `${section.characterLimit} characters`
      : "No strict limit specified",
    section_requirements: bullets(
      section.requirements,
      "Follow general grant guidance",
    ),
    evaluation_criteria: bullets(
      section.evaluationCriteria,
      "Standard academic evaluation criteria apply",
    ),
    general_requirements: bullets(
      guideline?.generalRequirements,
      "None specified",
    ),
    formatting_requirements: bullets(
      guideline?.formattingRequirements,
      "None specified",
    ),
    budget_requirements: bullets(
      guideline?.budgetRequirements,
      "None specified",
    ),
  };

  // 2. Interpolate the user's section prompt template.
  //    A replacer FUNCTION is used so values containing "$&" or "$1" stay literal.
  let processedSectionPrompt = section.prompt;
  for (const [key, value] of Object.entries(variableMap)) {
    processedSectionPrompt = processedSectionPrompt.replace(
      new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g"),
      () => value,
    );
  }

  // 3. System instructions (role, tone, anti-hallucination rules)
  const lengthRules: string[] = [];
  if (section.wordLimit) {
    lengthRules.push(
      isCjk
        ? `The section MUST NOT exceed ${section.wordLimit} characters (字). Every Chinese, Japanese or Korean character counts as one word; punctuation and spaces are not counted. Aim for roughly 85-100% of the limit.`
        : `The section MUST NOT exceed ${section.wordLimit} words. Aim for roughly 85-100% of the limit.`,
    );
  }
  if (section.characterLimit) {
    lengthRules.push(
      `The section MUST NOT exceed ${section.characterLimit} characters (including spaces).`,
    );
  }

  const languageRule = language
    ? `LANGUAGE: Write the ENTIRE section in ${language}, the language of the grant guideline. If the applicant's project context is in a different language, translate it faithfully into ${language}. Do not mix languages (proper nouns, acronyms and technical terms may stay in their original form).`
    : "LANGUAGE: Write in the same language as the Grant Guideline Constraints below.";

  const rules = [
    "Do NOT invent facts, statistics, citations, partners, results or budget figures.",
    "Use ONLY information found in the Grant Guideline Constraints, the Project Context and the Section Instructions provided.",
    `If information needed for this section is missing, write a clearly marked placeholder such as "[Information needed: target population size]" instead of guessing. Always keep the literal prefix "[Information needed:" in English exactly as shown, so it can be detected${language ? `, and write the rest of the placeholder in ${language}` : ""}.`,
    "Address every requirement and evaluation criterion listed for this section.",
    "Stay consistent with the previously approved sections, if any are provided.",
    languageRule,
    ...lengthRules,
    `Maintain a ${section.tone.toUpperCase()} tone: ${TONE_DESCRIPTIONS[section.tone]}.`,
    "Output ONLY the proposal text for this section: no preamble, no commentary, no markdown headings.",
  ];

  const systemInstructions = [
    "You are an expert academic grant writer and proposal specialist.",
    "",
    "GLOBAL INSTRUCTIONS:",
    project.globalPrompt?.trim() || "Write clearly and professionally.",
    "",
    "STRICT COMPLIANCE & ANTI-HALLUCINATION RULES:",
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
  ].join("\n");

  // 4. Previously approved sections (for cross-section consistency)
  const previousContextText = Object.entries(previousSectionsContent)
    .filter(([, content]) => content && content.trim())
    .map(
      ([title, content]) =>
        `--- Previously approved section: ${title} ---\n${content.trim()}`,
    )
    .join("\n\n");

  // 5. Assemble the user-side prompt
  const guidelineBlock = [
    "=== GRANT GUIDELINE CONSTRAINTS ===",
    `Grant Name: ${variableMap.grant_name}`,
    `Funding Agency: ${variableMap.organization}`,
    `Deadline: ${variableMap.deadline}`,
    `Funding Limit: ${variableMap.requested_budget}`,
    `Project Duration: ${variableMap.project_duration}`,
    `Output Language: ${variableMap.output_language}`,
    "",
    `Section Title: ${section.title}`,
    `Word Limit: ${variableMap.word_limit}`,
    `Character Limit: ${variableMap.character_limit}`,
    "",
    "Section Requirements:",
    variableMap.section_requirements,
    "",
    "Evaluation Criteria:",
    variableMap.evaluation_criteria,
    "",
    "General Application Requirements:",
    variableMap.general_requirements,
    "",
    "Formatting Requirements:",
    variableMap.formatting_requirements,
    ...(isBudgetSection
      ? ["", "Budget Requirements:", variableMap.budget_requirements]
      : []),
  ].join("\n");

  const projectBlock = [
    "=== PROJECT CONTEXT ===",
    `Project Title: ${variableMap.project_title}`,
    `Applicant: ${variableMap.applicant_name}`,
    `Institution: ${variableMap.institution}`,
    "",
    `Problem Statement:\n${variableMap.problem_statement}`,
    "",
    `Proposed Solution:\n${variableMap.proposed_solution}`,
    "",
    `Objectives:\n${variableMap.objectives}`,
    "",
    `Methodology:\n${variableMap.methodology}`,
    "",
    `Target Beneficiaries: ${variableMap.target_beneficiaries}`,
    `Innovation: ${variableMap.innovation}`,
    `Expected Results: ${variableMap.expected_results}`,
    `Technologies: ${variableMap.technologies}`,
  ].join("\n");

  const assembledText = [
    guidelineBlock,
    projectBlock,
    ...(previousContextText
      ? ["=== PREVIOUSLY APPROVED SECTIONS ===\n" + previousContextText]
      : []),
    "=== SECTION INSTRUCTIONS ===\n" + processedSectionPrompt,
    `Now write the formal proposal text for the section "${section.title}"${language ? ` in ${language}` : ""}.`,
  ].join("\n\n");

  return {
    systemInstructions,
    assembledText,
    variableMap,
  };
}
