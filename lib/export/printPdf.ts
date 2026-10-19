import type { GrantProject } from "@/types/project";
import { isCjkLanguage } from "@/lib/compliance/deterministicChecks";
import {
  BULLET_PATTERN,
  PLACEHOLDER_PATTERN,
  cleanContentLines,
  labelsFor,
  safeFileBase,
} from "./documentText";

// ---------------------------------------------------------------------------
// PDF export (browser only).
// The proposal is laid out as a print-ready HTML page inside a hidden iframe
// and handed to the browser's print engine ("Save as PDF"). The browser uses
// the system's own fonts, so Chinese, Japanese and Korean text renders
// correctly and stays selectable, with no font files to bundle.
// The document follows the language of the grant guideline, like the DOCX.
// ---------------------------------------------------------------------------

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Escapes a line and highlights "[Information needed: ...]" markers. */
function lineToHtml(line: string): string {
  return line
    .split(PLACEHOLDER_PATTERN)
    .filter((part) => part.length > 0)
    .map((part) =>
      /^\[Information needed:/i.test(part)
        ? `<mark>${escapeHtml(part)}</mark>`
        : escapeHtml(part),
    )
    .join("");
}

function contentToHtml(content: string): string {
  const html: string[] = [];
  let listOpen = false;
  for (const line of cleanContentLines(content)) {
    if (BULLET_PATTERN.test(line)) {
      if (!listOpen) html.push("<ul>");
      listOpen = true;
      html.push(`<li>${lineToHtml(line.replace(BULLET_PATTERN, ""))}</li>`);
    } else {
      if (listOpen) html.push("</ul>");
      listOpen = false;
      html.push(`<p>${lineToHtml(line)}</p>`);
    }
  }
  if (listOpen) html.push("</ul>");
  return html.join("\n");
}

function htmlLang(language: string | undefined): string {
  if (!language) return "en";
  if (/traditional|繁體|繁体|taiwan|hong kong/i.test(language)) return "zh-TW";
  if (/chinese|中文|汉语|漢語/i.test(language)) return "zh-CN";
  if (/japanese|日本語/i.test(language)) return "ja";
  if (/korean|한국어/i.test(language)) return "ko";
  if (/spanish|español/i.test(language)) return "es";
  if (/french|français/i.test(language)) return "fr";
  if (/german|deutsch/i.test(language)) return "de";
  return "en";
}

export function buildProposalHtml(project: GrantProject): string {
  const language = project.guideline?.language;
  const labels = labelsFor(language);
  const cjk = isCjkLanguage(language);
  const separator = cjk ? "：" : ": ";
  const title = project.title || labels.defaultTitle;

  const meta = [
    [labels.grant, project.grantName ?? project.guideline?.grantName],
    [
      labels.submittedTo,
      project.organization ?? project.guideline?.organization,
    ],
    [labels.applicant, project.applicant?.name],
    [labels.institution, project.applicant?.institution],
    [labels.deadline, project.deadline],
  ]
    .filter(([, value]) => value && value.trim())
    .map(
      ([label, value]) =>
        `<p class="meta"><strong>${escapeHtml(label!)}${separator}</strong>${escapeHtml(value!.trim())}</p>`,
    )
    .join("\n");

  const sections = [...project.sections]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const content = section.generatedContent?.trim();
      const body = content
        ? contentToHtml(content)
        : `<p><mark><em>${escapeHtml(labels.notGenerated)}</em></mark></p>`;
      return `<section><h2>${escapeHtml(section.title)}</h2>\n${body}</section>`;
    })
    .join("\n");

  const pageLabel = `"${labels.pageBefore}" counter(page) "${labels.pageAfter}"`;
  const fonts = cjk
    ? `"Times New Roman", "SimSun", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "MS Mincho", "Batang", serif`
    : `"Times New Roman", Times, serif`;

  return `<!DOCTYPE html>
<html lang="${htmlLang(language)}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(safeFileBase(project.title))}</title>
<style>
  @page { size: A4; margin: 25mm 22mm; @bottom-center { content: ${pageLabel}; font-size: 10pt; } }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: ${fonts}; font-size: 12pt; line-height: 1.6; }
  .title-page { page-break-after: always; break-after: page; text-align: left; }
  h1 { font-size: 22pt; text-align: center; margin: 60mm 0 18mm; }
  .meta { margin: 0 0 8pt; }
  h2 { font-size: 14pt; margin: 18pt 0 10pt; page-break-after: avoid; break-after: avoid; }
  p { margin: 0 0 8pt; text-align: justify; ${cjk ? "text-indent: 2em;" : ""} }
  .meta { text-indent: 0; }
  ul { margin: 0 0 8pt 1.5em; padding: 0; }
  li { margin: 0 0 4pt; }
  mark { background: #ffeb3b; font-weight: bold; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>
<div class="title-page">
<h1>${escapeHtml(title)}</h1>
${meta}
</div>
${sections}
</body>
</html>`;
}

/**
 * Opens the browser's print dialog for the proposal. The user picks
 * "Save as PDF"; the suggested file name is the project title.
 */
export function printProposalAsPdf(project: GrantProject): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";

    // Some browsers name the PDF after the top page's title, so set it too.
    const previousTitle = document.title;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.title = previousTitle;
      setTimeout(() => iframe.remove(), 1000);
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error("PDF export is not supported in this browser."));
        return;
      }
      win.addEventListener("afterprint", cleanup, { once: true });
      // Wait for the fonts so Chinese text is laid out before printing.
      const fontsReady = win.document.fonts?.ready ?? Promise.resolve();
      fontsReady.then(() => {
        try {
          document.title = safeFileBase(project.title);
          win.focus();
          win.print(); // blocks until the dialog closes in most browsers
          resolve();
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          // Fallback for browsers that never fire "afterprint".
          setTimeout(cleanup, 60_000);
        }
      });
    };

    iframe.srcdoc = buildProposalHtml(project);
    document.body.appendChild(iframe);
  });
}
