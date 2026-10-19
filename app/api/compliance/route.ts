import { NextResponse } from "next/server";
import { checkCompliance } from "@/lib/agent/complianceAgent";
import { GeminiError, toGeminiError } from "@/lib/gemini/config";
import type { GrantProject } from "@/types/project";

export async function POST(req: Request) {
  try {
    let project: GrantProject | undefined;
    try {
      ({ project } = (await req.json()) as { project?: GrantProject });
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    if (!project || !Array.isArray(project.sections)) {
      return NextResponse.json(
        { error: "Invalid project payload." },
        { status: 400 },
      );
    }

    const hasContent = project.sections.some(
      (s) => s.enabled && s.generatedContent?.trim(),
    );
    if (!hasContent) {
      return NextResponse.json(
        {
          error:
            "Generate at least one section before running the compliance check.",
        },
        { status: 400 },
      );
    }

    const report = await checkCompliance(project);
    return NextResponse.json({ success: true, data: report });
  } catch (error: unknown) {
    console.error("Compliance Check Error:", error);
    const geminiError =
      error instanceof GeminiError ? error : toGeminiError(error);
    return NextResponse.json(
      { error: geminiError.message, code: geminiError.code },
      { status: geminiError.status },
    );
  }
}
