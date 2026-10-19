import { NextResponse, connection } from "next/server";
import {
  DEFAULT_MODEL,
  getModelName,
  getRetryAttempts,
} from "@/lib/gemini/config";
import { getTemperature } from "@/lib/prompts/promptsBuilder";

// Read-only view of the server-side AI configuration (PRD §46-§47).
// The API key itself is NEVER returned: only whether one is configured.
export async function GET() {
  // Read the environment on every request instead of freezing it at build time.
  await connection();

  return NextResponse.json({
    provider: "Google Gemini",
    model: getModelName(),
    modelFromEnv: Boolean(process.env.GEMINI_MODEL?.trim()),
    defaultModel: DEFAULT_MODEL,
    retryAttempts: getRetryAttempts(),
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    temperatures: {
      low: getTemperature("low"),
      medium: getTemperature("medium"),
      high: getTemperature("high"),
    },
  });
}
