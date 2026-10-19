import { NextResponse } from "next/server";
import { checkCrossSectionConsistency } from "@/lib/agent/consistencyAgent";
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

    const generatedSections = project.sections.filter(
      (s) => s.enabled && s.generatedContent?.trim(),
    );
    if (generatedSections.length < 2) {
      return NextResponse.json(
        {
          error:
            "Generate at least two sections before running a consistency check.",
        },
        { status: 400 },
      );
    }

    const report = await checkCrossSectionConsistency(project);
    return NextResponse.json({ success: true, data: report });
  } catch (error: unknown) {
    console.error("Consistency Check Error:", error);
    const geminiError =
      error instanceof GeminiError ? error : toGeminiError(error);
    return NextResponse.json(
      { error: geminiError.message, code: geminiError.code },
      { status: geminiError.status },
    );
  }
}
