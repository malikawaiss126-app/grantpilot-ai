import { NextResponse } from "next/server";
import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { isCjkLanguage } from "@/lib/compliance/deterministicChecks";
import {
  BULLET_PATTERN,
  PLACEHOLDER_PATTERN,
  cleanContentLines,
  eastAsiaFont,
  labelsFor,
  safeFileBase,
} from "@/lib/export/documentText";
import type { GrantProject } from "@/types/project";

// ---------------------------------------------------------------------------
// DOCX export (PRD §30). Produces a Word document with a title page and one
// heading per enabled section. Placeholders left by the AI are highlighted so
// they are impossible to miss before submitting.
//
// The document follows the language of the grant guideline: labels, page
// numbers and fonts are chosen for that language (English by default),
// see lib/export/documentText.ts.
// ---------------------------------------------------------------------------

const BODY_SIZE = 24; // half-points => 12pt

// --- Text helpers --------------------------------------------------------------

/** Turns a line of text into runs, highlighting "[Information needed: ...]" markers. */
function toRuns(text: string): TextRun[] {
  return text
    .split(PLACEHOLDER_PATTERN)
    .filter((part) => part.length > 0)
    .map((part) =>
      /^\[Information needed:/i.test(part)
        ? new TextRun({ text: part, highlight: "yellow", bold: true })
        : new TextRun(part),
    );
}

function contentToParagraphs(content: string, cjk: boolean): Paragraph[] {
  return cleanContentLines(content).map((line) => {
    if (BULLET_PATTERN.test(line)) {
      return new Paragraph({
        children: toRuns(line.replace(BULLET_PATTERN, "")),
        bullet: { level: 0 },
        spacing: { after: 80 },
      });
    }
    // Numbered items ("1. ...") keep their own numbering as plain text.
    return new Paragraph({
      children: toRuns(line),
      spacing: { after: 160, line: 276 },
      alignment: AlignmentType.JUSTIFIED,
      // Chinese/Japanese/Korean paragraphs conventionally indent two characters.
      ...(cjk ? { indent: { firstLine: 480 } } : {}),
    });
  });
}

/** HTTP headers may only contain plain ASCII, so non-ASCII names need a fallback. */
function asciiFileName(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return /[A-Za-z0-9]/.test(ascii.replace(/\.docx$/i, ""))
    ? ascii
    : "Grant_Proposal.docx";
}

function contentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${asciiFileName(fileName)}"; filename*=UTF-8''${encoded}`;
}

function labelValue(
  label: string,
  value: string | undefined,
  separator: string,
): Paragraph | null {
  if (!value || !value.trim()) return null;
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}${separator}`, bold: true }),
      new TextRun(value.trim()),
    ],
    spacing: { after: 160 },
  });
}

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
        { error: "Invalid project data provided." },
        { status: 400 },
      );
    }

    const sections = [...project.sections]
      .filter((s) => s.enabled)
      .sort((a, b) => a.order - b.order);

    if (sections.length === 0) {
      return NextResponse.json(
        { error: "There are no enabled sections to export." },
        { status: 400 },
      );
    }

    // The document follows the language of the guideline.
    const language = project.guideline?.language;
    const labels = labelsFor(language);
    const cjk = isCjkLanguage(language);
    const separator = cjk ? "：" : ": "; // full-width colon for CJK
    const FONT = {
      ascii: "Times New Roman",
      hAnsi: "Times New Roman",
      cs: "Times New Roman",
      eastAsia: eastAsiaFont(language),
    };

    // 1. Title page
    const titlePage: Paragraph[] = [
      new Paragraph({
        text: project.title || labels.defaultTitle,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: 2400, after: 600 },
      }),
      ...[
        labelValue(
          labels.grant,
          project.grantName ?? project.guideline?.grantName,
          separator,
        ),
        labelValue(
          labels.submittedTo,
          project.organization ?? project.guideline?.organization,
          separator,
        ),
        labelValue(labels.applicant, project.applicant?.name, separator),
        labelValue(
          labels.institution,
          project.applicant?.institution,
          separator,
        ),
        labelValue(labels.deadline, project.deadline, separator),
      ].filter((p): p is Paragraph => p !== null),
      new Paragraph({ children: [new PageBreak()] }),
    ];

    // 2. Sections
    const body: Paragraph[] = [];
    for (const section of sections) {
      body.push(
        new Paragraph({
          text: section.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 360, after: 200 },
        }),
      );

      const content = section.generatedContent?.trim();
      if (content) {
        body.push(...contentToParagraphs(content, cjk));
      } else {
        body.push(
          new Paragraph({
            children: [
              new TextRun({
                text: labels.notGenerated,
                italics: true,
                highlight: "yellow",
              }),
            ],
            spacing: { after: 160 },
          }),
        );
      }
    }

    // 3. Document
    const doc = new Document({
      title: project.title || labels.defaultTitle,
      creator: project.applicant?.name || "GrantPilot AI",
      styles: {
        default: {
          document: {
            run: { font: FONT, size: BODY_SIZE },
          },
        },
        paragraphStyles: [
          {
            id: "Title",
            name: "Title",
            basedOn: "Normal",
            run: { font: FONT, size: 44, bold: true },
          },
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { font: FONT, size: 28, bold: true },
          },
        ],
      },
      sections: [
        {
          properties: {},
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: [
                        labels.pageBefore,
                        PageNumber.CURRENT,
                        labels.pageAfter,
                      ].filter((part) => part !== ""),
                      size: 20,
                    }),
                  ],
                }),
              ],
            }),
          },
          children: [...titlePage, ...body],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const fileName = `${safeFileBase(project.title)}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": contentDisposition(fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    console.error("DOCX Export Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to generate document: " + message },
      { status: 500 },
    );
  }
}
