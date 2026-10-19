import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { analyzeGuideline } from "@/lib/gemini/guidelineAgent";
import { GeminiError, toGeminiError } from "@/lib/gemini/config";
import { isCjkLanguage } from "@/lib/compliance/deterministicChecks";

// Allow up to 2 minutes for this route (matters when deployed; harmless locally).
export const maxDuration = 120;

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_CHARS = 400_000; // safety cap for the prompt
const MIN_TEXT_CHARS = 200; // below this the file is almost certainly unreadable

type SupportedKind = "pdf" | "docx" | "txt";

function detectKind(file: File): SupportedKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (
    name.endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    file.type === "text/plain"
  )
    return "txt";
  return null;
}

async function extractText(
  kind: SupportedKind,
  buffer: Buffer,
): Promise<{ text: string; pages?: number }> {
  if (kind === "pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      // Keep page markers so the AI can cite "Guideline PDF - Page N" (PRD §16).
      const text = result.pages
        .map((p) => `[Page ${p.num}]\n${p.text.trim()}`)
        .join("\n\n");
      return { text, pages: result.pages.length };
    } finally {
      await parser.destroy();
    }
  }

  if (kind === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value };
  }

  return { text: buffer.toString("utf-8") };
}

/**
 * Shrink the text before sending it to the AI. Fewer characters = faster reply.
 * Removes repeated headers/footers, lone page numbers and extra blank space,
 * but never touches the [Page N] markers or any real content.
 */
function compactText(text: string): string {
  const lines = text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());

  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.length >= 8 && line.length <= 100 && !line.startsWith("[Page ")) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  const kept = lines.filter((line) => {
    if (line.startsWith("[Page ")) return true;
    if (/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(line)) return false;
    // A short line repeated 3+ times is almost always a running header/footer.
    if ((counts.get(line) ?? 0) >= 3) return false;
    return true;
  });

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type ScriptFamily = "chinese" | "japanese" | "korean" | "latin";

/** Which writing system dominates the text (counted by code, not by the AI). */
function detectScript(text: string): ScriptFamily | null {
  const body = text.replace(/\[Page \d+\]/g, "");
  const han = body.match(/[㐀-䶿一-鿿豈-﫿]/g)?.length ?? 0;
  const kana = body.match(/[぀-ヿ]/g)?.length ?? 0;
  const hangul = body.match(/[가-힯ᄀ-ᇿ]/g)?.length ?? 0;
  const latin = body.match(/[A-Za-zÀ-ɏ]/g)?.length ?? 0;
  const cjk = han + kana + hangul;
  if (cjk + latin === 0) return null;

  // One CJK character is roughly one word; a Latin word is ~5 letters.
  if (cjk < latin / 5) return "latin";
  if (hangul > (han + kana) / 2) return "korean";
  if (kana > cjk * 0.05) return "japanese";
  return "chinese";
}

const FAMILY_PATTERNS: Record<Exclude<ScriptFamily, "latin">, RegExp> = {
  chinese: /chinese|中文|汉语|漢語/i,
  japanese: /japanese|日本語/i,
  korean: /korean|한국어/i,
};

const FAMILY_DEFAULT_NAMES: Record<Exclude<ScriptFamily, "latin">, string> = {
  chinese: "Chinese (Simplified)",
  japanese: "Japanese",
  korean: "Korean",
};

/**
 * The proposal is written in the guideline's language, so that language must
 * be right. The AI's answer is kept when it agrees with the script actually
 * used in the document; otherwise the detected language wins.
 */
function resolveLanguage(
  aiLanguage: string | undefined,
  text: string,
): string | undefined {
  const script = detectScript(text);
  if (!script) return aiLanguage;

  if (script === "latin") {
    // Keep Spanish, French... but never a CJK language for a Latin-script file.
    return aiLanguage && !isCjkLanguage(aiLanguage) ? aiLanguage : "English";
  }

  if (aiLanguage && FAMILY_PATTERNS[script].test(aiLanguage)) {
    return aiLanguage; // keeps e.g. "Chinese (Traditional)"
  }
  if (script === "chinese" && /[這為與們個會說時從對]/.test(text)) {
    return "Chinese (Traditional)";
  }
  return FAMILY_DEFAULT_NAMES[script];
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Please upload a guideline file (PDF, DOCX or TXT)." },
        { status: 400 },
      );
    }

    const kind = detectKind(file);
    if (!kind) {
      return NextResponse.json(
        {
          error:
            "Unsupported file type. Please upload a PDF, DOCX or TXT file.",
        },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error:
            "The uploaded document is too large (max 10 MB). Please upload a smaller document.",
        },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let extracted: { text: string; pages?: number };
    try {
      extracted = await extractText(kind, buffer);
    } catch (err) {
      console.error("Guideline text extraction failed:", err);
      return NextResponse.json(
        {
          error:
            "The document could not be read. It may be corrupted or password-protected.",
        },
        { status: 422 },
      );
    }

    const cleanText = compactText(extracted.text.replace(/\r\n/g, "\n"));
    if (cleanText.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
      return NextResponse.json(
        {
          error:
            "No readable text was found. If this is a scanned PDF, please upload a text-based version.",
        },
        { status: 422 },
      );
    }

    const truncated = cleanText.length > MAX_TEXT_CHARS;
    const textForModel = truncated
      ? cleanText.slice(0, MAX_TEXT_CHARS)
      : cleanText;

    const structuredGuideline = await analyzeGuideline(textForModel);
    structuredGuideline.language = resolveLanguage(
      structuredGuideline.language,
      textForModel,
    );

    return NextResponse.json({
      success: true,
      data: structuredGuideline,
      meta: {
        fileName: file.name,
        pages: extracted.pages ?? null,
        characters: cleanText.length,
        truncated,
      },
    });
  } catch (error: unknown) {
    console.error("Guideline Processing Error:", error);
    const geminiError =
      error instanceof GeminiError ? error : toGeminiError(error);
    return NextResponse.json(
      { error: geminiError.message, code: geminiError.code },
      { status: geminiError.status },
    );
  }
}
