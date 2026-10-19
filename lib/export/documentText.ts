// ---------------------------------------------------------------------------
// Shared helpers for the DOCX and PDF exports.
// The exported document follows the language of the grant guideline: labels,
// fonts and file names are chosen for that language (English by default).
// Safe to import from both server and browser code.
// ---------------------------------------------------------------------------

export interface DocumentLabels {
  grant: string;
  submittedTo: string;
  applicant: string;
  institution: string;
  deadline: string;
  notGenerated: string;
  pageBefore: string;
  pageAfter: string;
  defaultTitle: string;
}

const ENGLISH: DocumentLabels = {
  grant: "Grant",
  submittedTo: "Submitted to",
  applicant: "Applicant",
  institution: "Institution",
  deadline: "Deadline",
  notGenerated: "[This section has not been generated yet.]",
  pageBefore: "Page ",
  pageAfter: "",
  defaultTitle: "Grant Proposal",
};

const LABELS: { match: RegExp; labels: DocumentLabels }[] = [
  {
    match: /chinese|中文|汉语|漢語/i,
    labels: {
      grant: "基金项目",
      submittedTo: "提交至",
      applicant: "申请人",
      institution: "所在单位",
      deadline: "截止日期",
      notGenerated: "[本章节尚未生成。]",
      pageBefore: "第 ",
      pageAfter: " 页",
      defaultTitle: "项目申请书",
    },
  },
  {
    match: /japanese|日本語/i,
    labels: {
      grant: "助成金",
      submittedTo: "提出先",
      applicant: "申請者",
      institution: "所属機関",
      deadline: "締切日",
      notGenerated: "[このセクションはまだ生成されていません。]",
      pageBefore: "",
      pageAfter: " ページ",
      defaultTitle: "助成金申請書",
    },
  },
  {
    match: /korean|한국어/i,
    labels: {
      grant: "지원금",
      submittedTo: "제출처",
      applicant: "신청자",
      institution: "소속 기관",
      deadline: "마감일",
      notGenerated: "[이 섹션은 아직 생성되지 않았습니다.]",
      pageBefore: "",
      pageAfter: " 페이지",
      defaultTitle: "지원금 신청서",
    },
  },
  {
    match: /spanish|español/i,
    labels: {
      grant: "Convocatoria",
      submittedTo: "Presentado a",
      applicant: "Solicitante",
      institution: "Institución",
      deadline: "Fecha límite",
      notGenerated: "[Esta sección aún no se ha generado.]",
      pageBefore: "Página ",
      pageAfter: "",
      defaultTitle: "Propuesta de subvención",
    },
  },
  {
    match: /french|français/i,
    labels: {
      grant: "Subvention",
      submittedTo: "Soumis à",
      applicant: "Candidat",
      institution: "Établissement",
      deadline: "Date limite",
      notGenerated: "[Cette section n'a pas encore été générée.]",
      pageBefore: "Page ",
      pageAfter: "",
      defaultTitle: "Proposition de subvention",
    },
  },
  {
    match: /german|deutsch/i,
    labels: {
      grant: "Förderprogramm",
      submittedTo: "Eingereicht bei",
      applicant: "Antragsteller",
      institution: "Einrichtung",
      deadline: "Frist",
      notGenerated: "[Dieser Abschnitt wurde noch nicht erstellt.]",
      pageBefore: "Seite ",
      pageAfter: "",
      defaultTitle: "Förderantrag",
    },
  },
];

export function labelsFor(language: string | undefined): DocumentLabels {
  if (!language) return ENGLISH;
  return LABELS.find((entry) => entry.match.test(language))?.labels ?? ENGLISH;
}

/** Word needs a separate font for East Asian characters. */
export function eastAsiaFont(language: string | undefined): string {
  if (language && /traditional|繁體|繁体|taiwan|hong kong/i.test(language)) {
    return "PMingLiU";
  }
  if (language && /japanese|日本語/i.test(language)) return "MS Mincho";
  if (language && /korean|한국어/i.test(language)) return "Batang";
  return "SimSun";
}

export const PLACEHOLDER_PATTERN = /(\[Information needed:[^\]]*\])/gi;
export const BULLET_PATTERN = /^\s*(?:[-*•])\s+/;

/**
 * Removes Markdown the model sometimes adds despite the instructions
 * (**bold**, ## headings, `code`), so it never shows up in the document.
 * Bullet markers ("- ", "* ") are kept: the exporters turn them into lists.
 */
export function cleanContentLines(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/__(.+?)__/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * File name (without extension) that keeps the title's own script
 * (e.g. Chinese) and only removes characters not allowed in file names.
 */
export function safeFileBase(title: string | undefined): string {
  const base = (title ?? "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return base || "Grant_Proposal";
}
