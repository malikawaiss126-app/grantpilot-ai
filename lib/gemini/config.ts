import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
} from "@google/generative-ai";

// ---------------------------------------------------------------------------
// Central Gemini configuration (PRD §9, §44, §46).
// The model name, API key and retry count live here ONLY. Every agent imports
// from this file, so switching models = changing .env.local, nothing else.
// This file must only be imported from server code (API routes / lib/agent).
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "gemini-3.8-flash";

export function getModelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export function getRetryAttempts(): number {
  const parsed = parseInt(process.env.GEMINI_RETRY_ATTEMPTS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
}

export type GeminiErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_API_KEY"
  | "RATE_LIMIT"
  | "MODEL_NOT_FOUND"
  | "MODEL_FAILURE"
  | "INVALID_OUTPUT";

export class GeminiError extends Error {
  code: GeminiErrorCode;
  status: number;

  constructor(code: GeminiErrorCode, message: string, status: number) {
    super(message);
    this.name = "GeminiError";
    this.code = code;
    this.status = status;
  }
}

export function getGenAI(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiError(
      "MISSING_API_KEY",
      "Unable to connect to Gemini. Please set GEMINI_API_KEY in .env.local and restart the server.",
      500,
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

/** Convert any thrown value into a GeminiError with a user-friendly message (PRD §44). */
export function toGeminiError(err: unknown): GeminiError {
  if (err instanceof GeminiError) return err;

  const rawMessage = err instanceof Error ? err.message : String(err);
  const status =
    err instanceof GoogleGenerativeAIFetchError ? err.status : undefined;

  if (
    status === 429 ||
    /quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(rawMessage)
  ) {
    return new GeminiError(
      "RATE_LIMIT",
      "Gemini API quota has been reached. Please wait a moment and retry, or switch to another model in GEMINI_MODEL.",
      429,
    );
  }

  if (
    status === 401 ||
    status === 403 ||
    /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(rawMessage)
  ) {
    return new GeminiError(
      "INVALID_API_KEY",
      "Unable to connect to Gemini. Please verify GEMINI_API_KEY.",
      401,
    );
  }

  if (
    status === 404 ||
    /is not found for API version|not supported/i.test(rawMessage)
  ) {
    return new GeminiError(
      "MODEL_NOT_FOUND",
      `Model "${getModelName()}" was not found. Check GEMINI_MODEL in .env.local.`,
      400,
    );
  }

  return new GeminiError(
    "MODEL_FAILURE",
    "The AI model failed to respond. You can retry, regenerate, or edit the prompt. Details: " +
      rawMessage,
    status && status >= 400 && status < 600 ? status : 502,
  );
}

/**
 * Run a Gemini call with a limited number of retries (PRD §45).
 * Only transient failures are retried; quota and key errors fail immediately
 * so the free-tier quota is not wasted.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const retries = getRetryAttempts();
  let lastError: GeminiError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = toGeminiError(err);
      const retryable = lastError.code === "MODEL_FAILURE";
      if (!retryable || attempt === retries) break;
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }

  throw lastError!;
}

/**
 * Models are tried in order: GEMINI_MODEL first, then every model listed in
 * GEMINI_FALLBACK_MODELS (comma-separated, optional). Only list models that
 * your API key can really use.
 */
export function getModelChain(): string[] {
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return Array.from(new Set([getModelName(), ...fallbacks]));
}

/**
 * Run a Gemini call on GEMINI_MODEL and, when that model is out of quota,
 * unavailable or keeps failing, on each fallback model in turn.
 * Returns the result together with the model that produced it.
 */
export async function withModelFallback<T>(
  fn: (modelName: string) => Promise<T>,
): Promise<{ result: T; modelName: string }> {
  const models = getModelChain();
  let lastError: GeminiError | undefined;

  for (const modelName of models) {
    try {
      return { result: await withRetry(() => fn(modelName)), modelName };
    } catch (err) {
      lastError = toGeminiError(err);
      // A bad API key or a bad response will not improve on another model.
      if (
        lastError.code === "INVALID_API_KEY" ||
        lastError.code === "MISSING_API_KEY" ||
        lastError.code === "INVALID_OUTPUT"
      ) {
        throw lastError;
      }
      if (modelName !== models[models.length - 1]) {
        console.warn(
          `Gemini model "${modelName}" failed (${lastError.code}), trying the next fallback model.`,
        );
      }
    }
  }

  throw lastError!;
}

/** Parse a JSON model response safely, with a clear error if the output is malformed. */
export function parseJsonOutput<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new GeminiError(
      "INVALID_OUTPUT",
      "The model returned an invalid structured response. Please retry.",
      502,
    );
  }
}
