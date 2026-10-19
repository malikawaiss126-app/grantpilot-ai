// ---------------------------------------------------------------------------
// Tiny translation engine for GrantPilot (Chinese by default, English optional).
//
// How it works
//  - In the code, the English sentence IS the key:  t("Save")
//  - English  -> the key is shown as written.
//  - Chinese  -> the matching entry below (or in a page's own dictionary) is shown.
//  - A missing Chinese entry falls back to English, so nothing ever breaks.
//  - Values can contain {name} placeholders:  t("{n} sections", { n: 5 })
// ---------------------------------------------------------------------------

export type Lang = "zh" | "en";
export type Dict = Record<string, string>;
export type Params = Record<string, string | number>;

export const DEFAULT_LANG: Lang = "zh";
export const LANG_STORAGE_KEY = "grantpilot.lang";

export function isLang(value: unknown): value is Lang {
  return value === "zh" || value === "en";
}

/** Locale code for dates and numbers (toLocaleDateString etc.). */
export function localeOf(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en-US";
}

/** Words used on more than one page. Page-specific text lives inside each page. */
export const commonZh: Dict = {
  // Navigation + app name
  Dashboard: "仪表盘",
  "New Project": "新建项目",
  "Prompt Studio": "提示词工作室",
  Generation: "内容生成",
  Compliance: "合规检查",
  Settings: "设置",
  "Intelligent Grant Writing": "智能基金申请写作",
  "Active Model": "当前模型",
  "API key missing": "缺少 API 密钥",
  "Loading...": "加载中...",
  Unavailable: "不可用",

  // Top bar
  "Dark mode": "深色模式",
  "Light mode": "浅色模式",
  "Switch to dark mode": "切换到深色模式",
  "Switch to light mode": "切换到浅色模式",
  "Switch language to English": "切换为英文",
  "Switch language to Chinese": "切换为中文",
  Language: "语言",

  // Common actions
  Save: "保存",
  Cancel: "取消",
  Delete: "删除",
  Edit: "编辑",
  Back: "返回",
  Next: "下一步",
  Continue: "继续",
  Close: "关闭",
  Done: "完成",
  Open: "打开",
  Copy: "复制",
  Copied: "已复制",
  Download: "下载",
  Export: "导出",
  Retry: "重试",
  Generate: "生成",
  Regenerate: "重新生成",
  Approve: "批准",
  Approved: "已批准",

  // Common labels
  Required: "必填",
  Optional: "可选",
  Status: "状态",
  Project: "项目",
  Section: "章节",
  Sections: "章节",
  Error: "错误",
  Words: "字数",
  Characters: "字符数",
  Yes: "是",
  No: "否",
};

/** Messages that come back from the server (API routes and Gemini). */
const serverZh: Dict = {
  // Gemini connection / model
  "Unable to connect to Gemini. Please set GEMINI_API_KEY in .env.local and restart the server.":
    "无法连接 Gemini。请在 .env.local 中设置 GEMINI_API_KEY，并重启服务器。",
  "Gemini API quota has been reached. Please wait a moment and retry, or switch to another model in GEMINI_MODEL.":
    "已达到 Gemini API 配额上限。请稍候片刻后重试，或在 GEMINI_MODEL 中切换其他模型。",
  "Unable to connect to Gemini. Please verify GEMINI_API_KEY.":
    "无法连接 Gemini。请检查 GEMINI_API_KEY 是否正确。",
  "The model returned an invalid structured response. Please retry.":
    "模型返回了无效的结构化结果，请重试。",
  "The model returned an empty section. Please retry or edit the prompt.":
    "模型返回了空白章节，请重试或修改提示词。",
  "The guideline could not be analyzed. Please try again.":
    "无法分析该指南，请重试。",
  "Gemini took too long to analyze this document (over 90 seconds). Please try again, or upload a shorter version of the guideline.":
    "Gemini 分析此文档耗时过长（超过 90 秒）。请重试，或上传篇幅较短的指南。",

  // Guideline upload
  "Please upload a guideline file (PDF, DOCX or TXT).":
    "请上传指南文件（PDF、DOCX 或 TXT）。",
  "Unsupported file type. Please upload a PDF, DOCX or TXT file.":
    "不支持的文件类型。请上传 PDF、DOCX 或 TXT 文件。",
  "The uploaded document is too large (max 10 MB). Please upload a smaller document.":
    "上传的文档过大（最大 10 MB），请上传更小的文档。",
  "The document could not be read. It may be corrupted or password-protected.":
    "无法读取该文档，它可能已损坏或受密码保护。",
  "No readable text was found. If this is a scanned PDF, please upload a text-based version.":
    "未找到可读取的文字。如果是扫描版 PDF，请上传文字版。",

  // Other API routes
  "Invalid request body.": "请求内容无效。",
  "Invalid project payload.": "项目数据无效。",
  "Invalid project data provided.": "提供的项目数据无效。",
  "Missing required payload parameters: project or sectionId.":
    "缺少必要参数：项目或章节 ID。",
  "Generate at least one section before running the compliance check.":
    "请先至少生成一个章节，再运行合规检查。",
  "Generate at least two sections before running a consistency check.":
    "请先至少生成两个章节，再运行一致性检查。",
  "There are no enabled sections to export.": "没有可导出的已启用章节。",
};

const MODEL_NOT_FOUND =
  /^Model "(.+)" was not found\. Check GEMINI_MODEL in \.env\.local\.$/;
const SECTION_NOT_FOUND = /^Section with ID "(.+)" not found\.$/;
const MODEL_FAILURE_PREFIX =
  "The AI model failed to respond. You can retry, regenerate, or edit the prompt. Details: ";
const EXPORT_FAILURE_PREFIX = "Failed to generate document: ";

const GEMINI_BUSY =
  /^Google's Gemini servers are overloaded right now \(tried (\d+) times across: (.+)\)\. Your file is fine\. Please wait a minute and click Extract Requirements again\.$/;
const GEMINI_TIMEOUT =
  /^Gemini did not answer in time \(models tried: (.+)\)\. The server may be busy\. Please try again in a minute\.$/;
const GEMINI_QUOTA_ALL =
  /^The Gemini quota is used up for every configured model \((.+)\)\. Wait a few minutes, or set another model in GEMINI_MODEL \/ GEMINI_FALLBACK_MODELS\.$/;
const GEMINI_NO_MODELS =
  /^None of the configured models are available for your API key \((.+)\)\. Check GEMINI_MODEL and GEMINI_FALLBACK_MODELS in \.env\.local\.$/;
const GEMINI_REJECTED =
  /^Gemini rejected the request for every configured model \((.+)\)\. Details: ([\s\S]*)$/;

/** Chinese version of a server message, or undefined when there is none. */
function translateServerMessage(text: string): string | undefined {
  if (serverZh[text]) return serverZh[text];

  const model = MODEL_NOT_FOUND.exec(text);
  if (model)
    return `未找到模型“${model[1]}”。请检查 .env.local 中的 GEMINI_MODEL。`;

  const section = SECTION_NOT_FOUND.exec(text);
  if (section) return `未找到 ID 为“${section[1]}”的章节。`;

  if (text.startsWith(MODEL_FAILURE_PREFIX))
    return `AI 模型未能响应。您可以重试、重新生成或修改提示词。详情：${text.slice(MODEL_FAILURE_PREFIX.length)}`;

    if (text.startsWith(EXPORT_FAILURE_PREFIX))
    return `生成文档失败：${text.slice(EXPORT_FAILURE_PREFIX.length)}`;

  const busy = GEMINI_BUSY.exec(text);
  if (busy)
    return `Google 的 Gemini 服务器目前负载过高（已在 ${busy[2]} 中尝试 ${busy[1]} 次）。您的文件没有问题。请等待一分钟后，再次点击“提取要求”。`;

  const timeout = GEMINI_TIMEOUT.exec(text);
  if (timeout)
    return `Gemini 未能及时响应（已尝试的模型：${timeout[1]}）。服务器可能正忙，请一分钟后重试。`;

  const quota = GEMINI_QUOTA_ALL.exec(text);
  if (quota)
    return `所有已配置模型（${quota[1]}）的 Gemini 配额均已用完。请等待几分钟，或在 GEMINI_MODEL / GEMINI_FALLBACK_MODELS 中设置其他模型。`;

  const noModels = GEMINI_NO_MODELS.exec(text);
  if (noModels)
    return `您的 API 密钥无法使用任何已配置的模型（${noModels[1]}）。请检查 .env.local 中的 GEMINI_MODEL 和 GEMINI_FALLBACK_MODELS。`;

  const rejected = GEMINI_REJECTED.exec(text);
  if (rejected)
    return `所有已配置的模型（${rejected[1]}）都拒绝了该请求。详情：${rejected[2]}`;

  return undefined;
}

/**
 * Translate a key.
 * `pageDict` is the page's own Chinese dictionary (optional).
 */
export function translate(
  lang: Lang,
  key: string,
  params?: Params,
  pageDict?: Dict,
): string {
  let text = key;
  if (lang === "zh") {
    text =
      pageDict?.[key] ?? commonZh[key] ?? translateServerMessage(key) ?? key;
  }
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }
  return text;
}
