import { SchemaType, type ResponseSchema } from "@google/generative-ai";
import {
  getGenAI,
  getModelChain,
  parseJsonOutput,
  toGeminiError,
} from "./config";
import type { GrantGuideline, GuidelineSection } from "@/types/guideline";

// ---------------------------------------------------------------------------
// Guideline Analysis Agent (PRD §11, §16, §38).
// Turns raw guideline text into a structured GrantGuideline.
//
// Reliability design (so a busy Gemini server does not break the upload):
//   1. Thinking is switched off (much faster for pure extraction).
//   2. Each attempt has its own timeout, and the whole analysis has a deadline.
//   3. Temporary errors (503 "high demand", 500, 502, 504, network) are retried
//      with a short back-off.
//   4. If the main model stays busy or out of quota, the next model in
//      GEMINI_FALLBACK_MODELS is tried automatically.
// ---------------------------------------------------------------------------

const stringArray = {
  type: SchemaType.ARRAY,
  items: { type: SchemaType.STRING },
} as const;

const guidelineSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    grantName: { type: SchemaType.STRING },
    language: { type: SchemaType.STRING },
    organization: { type: SchemaType.STRING },
    grantType: { type: SchemaType.STRING },
    deadline: { type: SchemaType.STRING },
    fundingLimit: { type: SchemaType.STRING },
    duration: { type: SchemaType.STRING },
    summary: { type: SchemaType.STRING },
    eligibility: stringArray,
    restrictions: stringArray,
    sections: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.STRING },
          title: { type: SchemaType.STRING },
          order: { type: SchemaType.NUMBER },
          required: { type: SchemaType.BOOLEAN },
          wordLimit: { type: SchemaType.NUMBER },
          characterLimit: { type: SchemaType.NUMBER },
          requirements: stringArray,
          evaluationCriteria: stringArray,
          requiredElements: stringArray,
          sourceReferences: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                page: { type: SchemaType.NUMBER },
                text: { type: SchemaType.STRING },
              },
            },
          },
        },
        // Required so that lighter models do not skip the section details.
        required: [
          "id",
          "title",
          "order",
          "required",
          "requirements",
          "evaluationCriteria",
          "requiredElements",
        ],
      },
    },
    generalRequirements: stringArray,
    formattingRequirements: stringArray,
    budgetRequirements: stringArray,
    attachments: stringArray,
  },
  required: ["grantName", "language", "summary", "sections"],
};

function buildPrompt(guidelineText: string): string {
  return `You are an expert grant-guideline analyst. Read the grant guideline below and extract a structured, faithful representation of it.

STRICT RULES
1. Extract ONLY what the guideline states. Never invent requirements, limits, dates or amounts. If something is not stated, leave the field empty or omit it.
2. "sections" must list every part of the application the applicant is asked to write or submit (for example Summary, Problem Statement, Objectives, Methodology, Innovation, Timeline, Budget, Team, Expected Impact), in the order the guideline presents them. Do NOT list general rules, eligibility, formatting or attachments as sections.
3. For each section:
   - id: a short lowercase ENGLISH slug using only a-z, 0-9 and hyphens (e.g. "problem-statement"), even when the guideline is not in English.
   - order: 1, 2, 3 ... following the guideline.
   - required: true unless the guideline explicitly says the section is optional.
   - wordLimit / characterLimit: ONLY if the guideline states an explicit limit for that section. Otherwise omit them. A limit counted in words or in "字" (for example "不超过500字") goes in wordLimit (each Chinese, Japanese or Korean character counts as one word in this app). A limit counted in "字符" / characters including spaces goes in characterLimit.
   - requirements: concrete instructions for what that section must do or describe (short phrases, at most 5). ALWAYS fill this from the guideline's description of the section (for example "简要说明研究目的、研究内容和预期成果" gives three requirements). Leave it empty only if the guideline names the section without saying anything about it.
   - evaluationCriteria: how reviewers score or judge that section (short phrases, at most 5). If the guideline gives review criteria for the whole application, add the criteria that concern this section.
   - requiredElements: specific items that must appear inside the section (short phrases, at most 5).
   - sourceReferences: ONE entry per section. The text contains markers like "[Page 8]". Use the page number from the nearest preceding marker and a SHORT excerpt in the guideline's own wording (maximum 10 words, or 20 characters for Chinese, Japanese or Korean). If there are no page markers, omit "page".
4. Put overall metadata in: grantName, organization, grantType, deadline, fundingLimit, duration.
5. "eligibility" lists who may apply; "restrictions" lists what is not allowed or not funded.
6. Put document-wide rules in generalRequirements, formatting rules (font, margins, page limits, file format) in formattingRequirements, budget rules (allowed or disallowed costs, caps) in budgetRequirements, and required attachments or supporting documents in attachments.
7. "summary" is a neutral 2-4 sentence overview of the grant call.
8. LANGUAGE. First identify the language the guideline is written in and put its name, in English, in "language" (for example "English", "Chinese (Simplified)", "Chinese (Traditional)", "Japanese", "Korean", "Spanish"). Then write EVERY other text field (grantName, organization, grantType, summary, section titles, requirements, evaluation criteria, required elements, eligibility, restrictions, general, formatting and budget requirements, attachments) in THAT SAME language, worded as the guideline words them. Never translate anything into English. Only the section "id" values are always English slugs.
9. Be concise. Do not repeat the same requirement in several fields. Output JSON only.

GUIDELINE TEXT
"""
${guidelineText}
"""`;
}

// --- Normalization ---------------------------------------------------------
// The model output is untrusted: make sure the shape always matches GrantGuideline.

type RawSection = Partial<GuidelineSection>;
type RawGuideline = Partial<Omit<GrantGuideline, "sections">> & {
  sections?: RawSection[];
};

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;

/** English-style slug; empty when the text has no a-z / 0-9 characters (e.g. Chinese titles). */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function normalizeGuideline(raw: RawGuideline): GrantGuideline {
  const usedIds = new Set<string>();

  const sections: GuidelineSection[] = (raw.sections ?? [])
    .filter((s) => typeof s?.title === "string" && s.title.trim())
    .map((s, index) => ({ s, index }))
    .sort(
      (a, b) =>
        (typeof a.s.order === "number" ? a.s.order : a.index + 1) -
        (typeof b.s.order === "number" ? b.s.order : b.index + 1),
    )
    .map(({ s }, position) => {
      const title = s.title!.trim();
      // Non-English titles have no usable slug, so fall back to a numbered id.
      const baseId =
        slugify(optionalString(s.id) ?? "") ||
        slugify(title) ||
        `section-${position + 1}`;
      let id = baseId;
      let n = 2;
      while (usedIds.has(id)) id = `${baseId}-${n++}`;
      usedIds.add(id);

      return {
        id,
        title,
        order: position + 1,
        required: s.required !== false,
        wordLimit: positiveNumber(s.wordLimit),
        characterLimit: positiveNumber(s.characterLimit),
        requirements: strings(s.requirements),
        evaluationCriteria: strings(s.evaluationCriteria),
        requiredElements: strings(s.requiredElements),
        sourceReferences: (Array.isArray(s.sourceReferences)
          ? s.sourceReferences
          : []
        )
          .map((ref) => ({
            page: positiveNumber(ref?.page),
            text: optionalString(ref?.text),
          }))
          .filter((ref) => ref.page !== undefined || ref.text !== undefined),
      };
    });

  return {
    grantName: optionalString(raw.grantName) ?? "Untitled Grant",
    language: optionalString(raw.language),
    organization: optionalString(raw.organization),
    grantType: optionalString(raw.grantType),
    deadline: optionalString(raw.deadline),
    fundingLimit: optionalString(raw.fundingLimit),
    duration: optionalString(raw.duration),
    summary: optionalString(raw.summary) ?? "",
    eligibility: strings(raw.eligibility),
    restrictions: strings(raw.restrictions),
    sections,
    generalRequirements: strings(raw.generalRequirements),
    formattingRequirements: strings(raw.formattingRequirements),
    budgetRequirements: strings(raw.budgetRequirements),
    attachments: strings(raw.attachments),
  };
}

// --- Reliability settings ----------------------------------------------------

/** Longest a single Gemini call may take. */
const ATTEMPT_TIMEOUT_MS = 60_000;
/** Total time budget for the whole analysis, across retries and fallbacks. */
const TOTAL_BUDGET_MS = 120_000;
/** Do not start a new attempt if less than this is left. */
const MIN_TIME_FOR_ATTEMPT_MS = 10_000;
/** Tries per model before moving on to the next model. */
const ATTEMPTS_PER_MODEL = 2;

/**
 * Different Gemini models want different "thinking" settings, and a wrong one
 * gives "400 invalid argument". So we try them in order and remember which one
 * each model accepts (until the server restarts).
 */
function getThinkingLadder(): { label: string; config: object | null }[] {
  const parsed = parseInt(process.env.GEMINI_THINKING_BUDGET ?? "", 10);
  const budget = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  return [
    { label: `thinkingBudget=${budget}`, config: { thinkingBudget: budget } },
    { label: "thinkingLevel=low", config: { thinkingLevel: "low" } },
    { label: "model default", config: null },
  ];
}

const workingThinkingRung = new Map<string, number>();

type FailureKind =
  | "busy" // 500/502/503/504, network, overloaded: retry, then next model
  | "timeout" // took too long: go straight to the next model
  | "quota" // 429: this model is out of quota, go to the next model
  | "no-model" // 404: model not available for this key, go to the next model
  | "bad-arg" // 400: try the next thinking setting, then the next model
  | "bad-output" // empty/invalid JSON: retry
  | "fatal"; // bad API key: stop immediately

function messageOf(err: unknown): string {
  return err instanceof Error ? `${err.name} ${err.message}` : String(err);
}

function classify(err: unknown): FailureKind {
  const msg = messageOf(err);
  const statusMatch = msg.match(/\[(\d{3})[ \]]/);
  const status =
    typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : statusMatch
        ? parseInt(statusMatch[1], 10)
        : undefined;

  if (/abort|timed? ?out|timeout|ETIMEDOUT/i.test(msg)) return "timeout";
  if (
    status === 401 ||
    status === 403 ||
    /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)
  )
    return "fatal";
  if (status === 429 || /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(msg))
    return "quota";
  if (
    status === 404 ||
    /is not found for API version|not supported for generateContent|no longer available/i.test(
      msg,
    )
  )
    return "no-model";
  if (status === 400) return "bad-arg";
  if (
    (status !== undefined && status >= 500) ||
    /high demand|overloaded|unavailable|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|network/i.test(
      msg,
    )
  )
    return "busy";
  if (/invalid structured response|JSON|empty/i.test(msg)) return "bad-output";
  return "busy";
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function callGemini(
  modelName: string,
  prompt: string,
  thinkingConfig: object | null,
  timeoutMs: number,
): Promise<RawGuideline> {
  const generationConfig = {
    temperature: 0.1,
    maxOutputTokens: 16384,
    responseMimeType: "application/json",
    responseSchema: guidelineSchema,
    // The SDK types may not list thinkingConfig, but the API accepts it.
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };

  const model = getGenAI().getGenerativeModel(
    { model: modelName, generationConfig: generationConfig as never },
    { timeout: timeoutMs },
  );

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  if (!text.trim()) throw new Error("The model returned an empty response.");
  return parseJsonOutput<RawGuideline>(text);
}

// --- Public API --------------------------------------------------------------

export async function analyzeGuideline(
  guidelineText: string,
): Promise<GrantGuideline> {
  const prompt = buildPrompt(guidelineText);
  const models = getModelChain();
  const ladder = getThinkingLadder();
  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  let lastError: unknown;
  let lastKind: FailureKind = "busy";
  let attemptsMade = 0;

  for (const modelName of models) {
    let rung = workingThinkingRung.get(modelName) ?? 0;

    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      if (remaining() < MIN_TIME_FOR_ATTEMPT_MS) break;

      try {
        attemptsMade++;
        const raw = await callGemini(
          modelName,
          prompt,
          ladder[rung].config,
          Math.min(ATTEMPT_TIMEOUT_MS, remaining()),
        );
        const guideline = normalizeGuideline(raw);
        workingThinkingRung.set(modelName, rung);

        if (guideline.sections.length === 0) {
          console.warn("Guideline analysis returned no sections.");
        }
        if (modelName !== models[0]) {
          console.info(
            `Guideline analyzed with fallback model "${modelName}".`,
          );
        }
        return guideline;
      } catch (err) {
        lastError = err;
        lastKind = classify(err);
        // Full message on purpose: it is what is needed to diagnose problems.
        console.warn(
          `Guideline analysis attempt failed (model ${modelName}, ${ladder[rung].label}, try ${attempt}, ${lastKind}):`,
          messageOf(err),
        );

        if (lastKind === "fatal") throw toGeminiError(err);

        if (lastKind === "bad-arg") {
          if (rung < ladder.length - 1) {
            rung++; // try the next thinking setting on the same model
            attempt--;
            continue;
          }
          break; // nothing works on this model: next model
        }

        // These will not get better on the same model: move on to the next one.
        if (
          lastKind === "timeout" ||
          lastKind === "quota" ||
          lastKind === "no-model"
        )
          break;

        // "busy" or "bad-output": short back-off with jitter, then try again.
        if (attempt < ATTEMPTS_PER_MODEL) {
          await sleep(1200 * attempt + Math.random() * 600);
        }
      }
    }
  }

  // Every model failed. Give the user one clear, honest message.
  const error = toGeminiError(lastError);
  const tried = models.join(", ");
  const detail = messageOf(lastError).slice(0, 300);

  if (lastKind === "busy") {
    error.message = `Google's Gemini servers are overloaded right now (tried ${attemptsMade} times across: ${tried}). Your file is fine. Please wait a minute and click Extract Requirements again.`;
    error.status = 503;
  } else if (lastKind === "timeout") {
    error.message = `Gemini did not answer in time (models tried: ${tried}). The server may be busy. Please try again in a minute.`;
    error.status = 504;
  } else if (lastKind === "quota") {
    error.message = `The Gemini quota is used up for every configured model (${tried}). Wait a few minutes, or set another model in GEMINI_MODEL / GEMINI_FALLBACK_MODELS.`;
    error.status = 429;
  } else if (lastKind === "no-model") {
    error.message = `None of the configured models are available for your API key (${tried}). Check GEMINI_MODEL and GEMINI_FALLBACK_MODELS in .env.local.`;
    error.status = 400;
  } else if (lastKind === "bad-arg") {
    error.message = `Gemini rejected the request for every configured model (${tried}). Details: ${detail}`;
    error.status = 400;
  }
  throw error;
}
