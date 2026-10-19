import { NextResponse } from "next/server";
import { SchemaType, type ResponseSchema } from "@google/generative-ai";
import {
  buildSectionPrompt,
  getTemperature,
} from "@/lib/prompts/promptsBuilder";
import {
  GeminiError,
  getGenAI,
  parseJsonOutput,
  toGeminiError,
  withModelFallback,
  withRetry,
} from "@/lib/gemini/config";
import {
  countWords,
  findPlaceholders,
  isCjkLanguage,
} from "@/lib/compliance/deterministicChecks";
import type { GrantProject } from "@/types/project";

// How many times we automatically ask the model to shorten an over-limit draft.
const MAX_CONDENSE_ATTEMPTS = 1;
const MAX_PREVIOUS_SECTION_CHARS = 20_000;

const responseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    content: { type: SchemaType.STRING },
    requirementsCovered: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    missingRequirements: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    criticScore: { type: SchemaType.NUMBER },
    criticFeedback: { type: SchemaType.STRING },
    warnings: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
  },
  required: [
    "content",
    "requirementsCovered",
    "missingRequirements",
    "criticScore",
    "criticFeedback",
  ],
};

const OUTPUT_FORMAT_INSTRUCTIONS = `
=== OUTPUT FORMAT ===
Return a JSON object with these fields:
- content: the proposal text for this section ONLY (plain text, no headings, no commentary).
- requirementsCovered: the items from "Section Requirements" that the content satisfies.
- missingRequirements: items from "Section Requirements" that are NOT satisfied, including any that need information the applicant has not provided.
- criticScore: an honest integer from 0 to 100 rating how well the content satisfies the Section Requirements and Evaluation Criteria.
- criticFeedback: 1-3 sentences on the main strength and the most important improvement.
- warnings: any concerns (for example claims that could not be supported by the provided context). Use an empty array if none.`;

interface RawGeneration {
  content?: unknown;
  requirementsCovered?: unknown;
  missingRequirements?: unknown;
  criticScore?: unknown;
  criticFeedback?: unknown;
  warnings?: unknown;
}

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

function sanitizePreviousSections(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, string> = {};
  for (const [title, content] of Object.entries(input)) {
    if (typeof content === "string" && content.trim()) {
      result[title] = content.slice(0, MAX_PREVIOUS_SECTION_CHARS);
    }
  }
  return result;
}

export async function POST(req: Request) {
  try {
    let body: {
      project?: GrantProject;
      sectionId?: string;
      previousSections?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    const { project, sectionId } = body;

    if (!project || !Array.isArray(project.sections) || !sectionId) {
      return NextResponse.json(
        { error: "Missing required payload parameters: project or sectionId." },
        { status: 400 },
      );
    }

    const section = project.sections.find((s) => s.id === sectionId);
    if (!section) {
      return NextResponse.json(
        { error: `Section with ID "${sectionId}" not found.` },
        { status: 404 },
      );
    }

    // Prompt Builder is the single source of truth for what gets sent to Gemini.
    const assembled = buildSectionPrompt(
      project,
      sectionId,
      sanitizePreviousSections(body.previousSections),
    );
    const temperature = getTemperature(section.creativity);
    const genAI = getGenAI();

    // --- Pass 1: structured generation (falls back to other models) ---------
    const { result, modelName } = await withModelFallback((name) =>
      genAI
        .getGenerativeModel({
          model: name,
          systemInstruction: assembled.systemInstructions,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema,
            temperature,
          },
        })
        .generateContent(
          assembled.assembledText + "\n" + OUTPUT_FORMAT_INSTRUCTIONS,
        ),
    );
    const raw = parseJsonOutput<RawGeneration>(result.response.text());

    let content = typeof raw.content === "string" ? raw.content.trim() : "";
    if (!content) {
      throw new GeminiError(
        "INVALID_OUTPUT",
        "The model returned an empty section. Please retry or edit the prompt.",
        502,
      );
    }

    const warnings = toStringArray(raw.warnings);

    // --- Pass 2 (optional): enforce the word limit --------------------------
    let condensed = false;
    if (section.wordLimit) {
      const limit = section.wordLimit;
      const plainModel = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: assembled.systemInstructions,
        generationConfig: { temperature: 0.2 },
      });

      for (
        let attempt = 0;
        attempt < MAX_CONDENSE_ATTEMPTS && countWords(content) > limit;
        attempt++
      ) {
        const current = content;
        const currentWords = countWords(current);
        // Chinese/Japanese/Korean limits are counted in characters (字).
        const unit = isCjkLanguage(project.guideline?.language)
          ? "characters (字)"
          : "words";
        const shortened = await withRetry(() =>
          plainModel.generateContent(
            `The following grant proposal section is ${currentWords} ${unit}, but the hard limit is ${limit} ${unit}.\n` +
              `Rewrite it so it is at most ${Math.floor(limit * 0.95)} ${unit}. Keep every key point and requirement, ` +
              `keep any "[Information needed: ...]" placeholders, and do not add new facts. ` +
              `Write in the SAME language as the original text; do not translate it. ` +
              `Output ONLY the rewritten text.\n\n=== SECTION TEXT ===\n${current}`,
          ),
        );
        const shortText = shortened.response.text().trim();
        if (shortText) {
          content = shortText;
          condensed = true;
        } else {
          break;
        }
      }
    }

    // --- Deterministic checks -------------------------------------------------
    const wordCount = countWords(content);
    const characterCount = content.length;
    const isOverWordLimit = section.wordLimit
      ? wordCount > section.wordLimit
      : false;
    const isOverCharacterLimit = section.characterLimit
      ? characterCount > section.characterLimit
      : false;

    if (isOverWordLimit) {
      warnings.push(
        `Word count (${wordCount}) still exceeds the limit of ${section.wordLimit} words. Edit manually or regenerate.`,
      );
    }
    if (isOverCharacterLimit) {
      warnings.push(
        `Character count (${characterCount}) exceeds the limit of ${section.characterLimit} characters.`,
      );
    }

    const missingInformation = findPlaceholders(content);
    if (missingInformation.length > 0) {
      warnings.push(
        `${missingInformation.length} placeholder(s) need your input before this section is final.`,
      );
    }

    const score =
      typeof raw.criticScore === "number" && Number.isFinite(raw.criticScore)
        ? Math.max(0, Math.min(100, Math.round(raw.criticScore)))
        : null;

    return NextResponse.json({
      success: true,
      data: {
        sectionId: section.id,
        title: section.title,
        content,
        requirementsCovered: toStringArray(raw.requirementsCovered),
        missingRequirements: toStringArray(raw.missingRequirements),
        missingInformation,
        criticScore: score,
        criticFeedback:
          typeof raw.criticFeedback === "string"
            ? raw.criticFeedback.trim()
            : "",
        warnings,
        wordCount,
        characterCount,
        isOverWordLimit,
        isOverCharacterLimit,
        condensed,
        model: modelName,
        assembledPromptPreview: assembled.assembledText,
      },
    });
  } catch (error: unknown) {
    console.error("Section Generation API Error:", error);
    const geminiError =
      error instanceof GeminiError ? error : toGeminiError(error);
    return NextResponse.json(
      { error: geminiError.message, code: geminiError.code },
      { status: geminiError.status },
    );
  }
}
