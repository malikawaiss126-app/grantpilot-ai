"use client";

import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Sparkles,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Edit3,
  Bot,
  Clock,
  AlertCircle,
  ArrowRight,
  FolderPlus,
  Copy,
  Square,
  Undo2,
  Save,
  X,
} from "lucide-react";
import type { GrantProject } from "@/types/project";
import type { GrantSection } from "@/types/prompt";
import { projectStore } from "@/lib/storage/projectStore";
import {
  countWords,
  findPlaceholders,
} from "@/lib/compliance/deterministicChecks";
import { useT } from "@/components/providers/app-provider";
import type { Dict } from "@/lib/i18n";

// Chinese text for this page. The English sentence is the key.
const zh: Dict = {
  "Generation Workspace": "内容生成工作台",
  "Prompt Studio": "提示词工作室",
  "Stop after this section ({done}/{total})":
    "完成当前章节后停止（{done}/{total}）",
  "Generate all remaining ({n})": "生成全部剩余章节（{n}）",
  "Regenerate Section": "重新生成本章节",
  "Generate Section": "生成本章节",
  "Dismiss error": "关闭错误提示",
  "All sections are approved. Run the compliance check next.":
    "所有章节均已批准。接下来请运行合规检查。",
  "Go to Compliance": "前往合规检查",
  "Proposal Structure": "申请书结构",
  "{done} of {total} sections approved. Sections can be turned off in Prompt Studio.":
    "已批准 {done} / {total} 个章节。可在提示词工作室中关闭不需要的章节。",
  "Word limit: {n}": "字数上限：{n}",
  none: "无",
  "Character limit: {n}": "字符数上限：{n}",
  "Save Edits": "保存修改",
  "Edit Content": "编辑内容",
  "Approve Section": "批准本章节",
  Reopen: "重新打开",
  "Word Count": "字数",
  "no limit": "不限",
  "AI Critic Score": "AI 评审分数",
  "Open Placeholders": "未填写的占位符",
  "Generating “{title}” with Gemini...": "正在使用 Gemini 生成“{title}”...",
  "This can take up to a minute. Word limits are checked automatically.":
    "最多可能需要一分钟。系统会自动检查字数上限。",
  "No content generated for this section yet.": "本章节尚未生成内容。",
  "Click Generate Section to run the writing agent.":
    "点击“生成本章节”运行写作智能体。",
  "This section is turned off in Prompt Studio.":
    "本章节已在提示词工作室中关闭。",
  "The text has {count} words, over the {limit}-word limit.":
    "文本共 {count} 个单词，超过了 {limit} 个单词的上限。",
  "The text has {count} characters, over the {limit}-character limit.":
    "文本共 {count} 个字符，超过了 {limit} 个字符的上限。",
  "Edit it or regenerate.": "请编辑文本或重新生成。",
  "The AI needs more information from you:": "AI 需要您提供更多信息：",
  "AI warnings": "AI 警告",
  "AI critic: ": "AI 评审意见：",
  "Requirements covered": "已满足的要求",
  "Missing or unclear": "缺失或不明确",
  "None reported.": "未报告。",
  "Generated with {model}": "由 {model} 生成",
  "automatically shortened to fit the word limit": "已自动缩短以符合字数上限",
  "The AI score is the model's own estimate, not a guarantee.":
    "AI 分数是模型自己的估计，并非保证。",
  "View the exact prompt sent to Gemini": "查看发送给 Gemini 的完整提示词",

  // Statuses
  "NOT GENERATED": "未生成",
  GENERATING: "生成中",
  "READY FOR REVIEW": "待审阅",
  "NEEDS ATTENTION": "需要处理",
  APPROVED: "已批准",

  // Empty / loading states
  "No project to generate yet": "还没有可生成的项目",
  "Create a project from a grant guideline first, then generate each section here.":
    "请先根据基金申请指南创建项目，然后在这里逐个生成章节。",
  "Create a project": "创建项目",
  "Loading project...": "正在加载项目...",

  // Messages
  "Generation failed. Please try again.": "生成失败，请重试。",
  "Generation failed.": "生成失败。",
  "Remaining sections were not generated.": "其余章节未生成。",
  "Could not copy to the clipboard in this browser.":
    "此浏览器无法复制到剪贴板。",
};

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface GenerationResult {
  content: string;
  requirementsCovered: string[];
  missingRequirements: string[];
  missingInformation: string[];
  criticScore: number | null;
  criticFeedback: string;
  warnings: string[];
  wordCount: number;
  condensed: boolean;
  model: string;
  assembledPromptPreview: string;
}

interface GenerationResponse {
  success?: boolean;
  data?: GenerationResult;
  error?: string;
}

const emptySubscribe = () => () => {};

function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

function loadInitialProject(requestedId: string | null): GrantProject | null {
  const all = projectStore.getAllProjects();
  const found =
    (requestedId ? all.find((p) => p.id === requestedId) : undefined) ??
    all[all.length - 1] ??
    null;
  if (!found) return null;
  // A section stuck in "generating" (page closed mid-run) is reset.
  return {
    ...found,
    sections: found.sections.map((s) =>
      s.status === "generating"
        ? { ...s, status: s.generatedContent?.trim() ? "generated" : "draft" }
        : s,
    ),
  };
}

async function requestGeneration(
  base: GrantProject,
  sectionId: string,
): Promise<GenerationResult> {
  // Context for consistency: every OTHER section that already has content.
  const previousSections: Record<string, string> = {};
  for (const s of base.sections) {
    if (s.id !== sectionId && s.generatedContent?.trim()) {
      previousSections[s.title] = s.generatedContent;
    }
  }
  // Keep the payload small: generated text is sent only via previousSections.
  const slimProject: GrantProject = {
    ...base,
    sections: base.sections.map((s) => ({ ...s, generatedContent: undefined })),
  };

  const response = await fetch("/api/generation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: slimProject, sectionId, previousSections }),
  });

  let result: GenerationResponse = {};
  try {
    result = (await response.json()) as GenerationResponse;
  } catch {
    // non-JSON response, handled below
  }
  if (!response.ok || !result.success || !result.data) {
    throw new Error(result.error ?? "Generation failed. Please try again.");
  }
  return result.data;
}

const STATUS_STYLES: Record<GrantSection["status"], string> = {
  draft: "bg-slate-100 text-slate-600",
  generating: "bg-indigo-100 text-indigo-800",
  generated: "bg-amber-100 text-amber-800",
  needs_review: "bg-orange-100 text-orange-800",
  approved: "bg-emerald-100 text-emerald-800",
};

const STATUS_LABELS: Record<GrantSection["status"], string> = {
  draft: "NOT GENERATED",
  generating: "GENERATING",
  generated: "READY FOR REVIEW",
  needs_review: "NEEDS ATTENTION",
  approved: "APPROVED",
};

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

function GenerationWorkspace({ requestedId }: { requestedId: string | null }) {
  const t = useT(zh);
  const [project, setProject] = useState<GrantProject | null>(() =>
    loadInitialProject(requestedId),
  );
  const [activeSectionId, setActiveSectionId] = useState<string>(() => {
    const p = loadInitialProject(requestedId);
    if (!p) return "";
    return (
      p.sections.find((s) => s.enabled && !s.generatedContent?.trim())?.id ??
      p.sections[0]?.id ??
      ""
    );
  });
  const [busySectionId, setBusySectionId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // Stored in English and translated when shown, so switching language updates it.
  const [error, setError] = useState<string | null>(null);
  const [batchHalted, setBatchHalted] = useState(false);
  const [results, setResults] = useState<Record<string, GenerationResult>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const stopRequested = useRef(false);

  const isBusy = busySectionId !== null;

  // Autosave every change to the project (generated text, status, edits).
  useEffect(() => {
    if (!project) return;
    try {
      projectStore.saveProject(project);
    } catch (err) {
      console.error("Autosave failed:", err);
    }
  }, [project]);

  const activeSection: GrantSection | undefined = project
    ? (project.sections.find((s) => s.id === activeSectionId) ??
      project.sections[0])
    : undefined;

  // --- Generation -----------------------------------------------------------

  /** Generates one section and returns the updated project (also stored in state). */
  const generateSection = async (
    base: GrantProject,
    sectionId: string,
  ): Promise<GrantProject> => {
    setBusySectionId(sectionId);
    setError(null);
    setBatchHalted(false);

    const markGenerating: GrantProject = {
      ...base,
      sections: base.sections.map((s) =>
        s.id === sectionId ? { ...s, status: "generating" } : s,
      ),
    };
    setProject(markGenerating);

    try {
      const data = await requestGeneration(base, sectionId);
      const needsAttention =
        data.warnings.length > 0 ||
        data.missingInformation.length > 0 ||
        findPlaceholders(data.content).length > 0 ||
        (data.criticScore !== null && data.criticScore < 70);

      const updated: GrantProject = {
        ...base,
        sections: base.sections.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                generatedContent: data.content,
                status: needsAttention ? "needs_review" : "generated",
              }
            : s,
        ),
      };
      setResults((prev) => ({ ...prev, [sectionId]: data }));
      setProject(updated);
      return updated;
    } catch (err) {
      // Restore the section's previous state.
      setProject(base);
      throw err;
    } finally {
      setBusySectionId(null);
    }
  };

  const handleGenerateActive = async () => {
    if (!project || !activeSection) return;
    setIsEditing(false);
    try {
      await generateSection(project, activeSection.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    }
  };

  const pendingSections = project
    ? project.sections.filter((s) => s.enabled && !s.generatedContent?.trim())
    : [];

  const handleGenerateAll = async () => {
    if (!project || pendingSections.length === 0) return;
    setIsEditing(false);
    stopRequested.current = false;
    let working = project;
    const queue = pendingSections.map((s) => s.id);
    setBatchProgress({ done: 0, total: queue.length });

    try {
      for (let i = 0; i < queue.length; i++) {
        if (stopRequested.current) break;
        setActiveSectionId(queue[i]);
        working = await generateSection(working, queue[i]);
        setBatchProgress({ done: i + 1, total: queue.length });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setBatchHalted(true);
    } finally {
      setBatchProgress(null);
    }
  };

  // --- Review actions ---------------------------------------------------------

  const patchActiveSection = (patch: Partial<GrantSection>) => {
    if (!activeSection) return;
    setProject((prev) =>
      prev
        ? {
            ...prev,
            sections: prev.sections.map((s) =>
              s.id === activeSection.id ? { ...s, ...patch } : s,
            ),
          }
        : prev,
    );
  };

  const startEditing = () => {
    if (!activeSection) return;
    setDraft(activeSection.generatedContent ?? "");
    setIsEditing(true);
  };

  const saveEdits = () => {
    if (!activeSection) return;
    patchActiveSection({
      generatedContent: draft,
      // An edited section must be re-approved.
      status:
        activeSection.status === "approved"
          ? "generated"
          : activeSection.status,
    });
    setIsEditing(false);
  };

  const copyContent = async () => {
    if (!activeSection?.generatedContent) return;
    try {
      await navigator.clipboard.writeText(activeSection.generatedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy to the clipboard in this browser.");
    }
  };

  // --- Empty state ---------------------------------------------------------------

  if (!project || !activeSection) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <FolderPlus
          className="w-10 h-10 text-indigo-500 mx-auto"
          aria-hidden="true"
        />
        <h1 className="text-xl font-bold text-slate-900">
          {t("No project to generate yet")}
        </h1>
        <p className="text-sm text-slate-600">
          {t(
            "Create a project from a grant guideline first, then generate each section here.",
          )}
        </p>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition"
        >
          {t("Create a project")}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  // --- Derived, always-accurate stats (recomputed from the saved text) -----------

  const content = activeSection.generatedContent ?? "";
  const hasContent = content.trim().length > 0;
  const wordCount = countWords(content);
  const charCount = content.length;
  const overWords =
    !!activeSection.wordLimit && wordCount > activeSection.wordLimit;
  const overChars =
    !!activeSection.characterLimit && charCount > activeSection.characterLimit;
  const placeholders = findPlaceholders(content);
  const result = results[activeSection.id];

  const enabledSections = project.sections.filter((s) => s.enabled);
  const approvedCount = enabledSections.filter(
    (s) => s.status === "approved",
  ).length;
  const allApproved =
    enabledSections.length > 0 && approvedCount === enabledSections.length;

  const projectQuery = `?project=${encodeURIComponent(project.id)}`;

  const visibleWarnings = result
    ? result.warnings.filter(
        (w) => !/word count|character count|placeholder/i.test(w),
      )
    : [];

  const secondaryButton =
    "flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-md text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 transition";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b-2 border-indigo-600 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
            <Sparkles className="w-6 h-6" aria-hidden="true" />
            {t("Generation Workspace")}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {project.title}
            {project.grantName ? ` · ${project.grantName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/prompt-studio${projectQuery}`}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition"
          >
            {t("Prompt Studio")}
          </Link>
          {batchProgress ? (
            <button
              onClick={() => {
                stopRequested.current = true;
              }}
              className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-700 bg-red-50 rounded-md text-sm font-medium hover:bg-red-100 transition"
            >
              <Square className="w-4 h-4" aria-hidden="true" />
              {t("Stop after this section ({done}/{total})", {
                done: batchProgress.done,
                total: batchProgress.total,
              })}
            </button>
          ) : (
            <button
              onClick={handleGenerateAll}
              disabled={isBusy || pendingSections.length === 0}
              className="flex items-center gap-2 px-4 py-2 border border-indigo-300 text-indigo-700 bg-indigo-50 rounded-md text-sm font-medium hover:bg-indigo-100 transition disabled:opacity-50"
            >
              <Play className="w-4 h-4" aria-hidden="true" />
              {t("Generate all remaining ({n})", { n: pendingSections.length })}
            </button>
          )}
          <button
            onClick={handleGenerateActive}
            disabled={isBusy || !activeSection.enabled}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {busySectionId === activeSection.id ? (
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4" aria-hidden="true" />
            )}
            {hasContent ? t("Regenerate Section") : t("Generate Section")}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-sm text-red-700"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1">
            {t(error)}
            {batchHalted
              ? ` ${t("Remaining sections were not generated.")}`
              : ""}
          </span>
          <button
            onClick={() => {
              setError(null);
              setBatchHalted(false);
            }}
            aria-label={t("Dismiss error")}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {allApproved && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md flex items-center justify-between gap-3 text-sm text-emerald-800">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            {t("All sections are approved. Run the compliance check next.")}
          </span>
          <Link
            href={`/compliance${projectQuery}`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-md text-xs font-medium hover:bg-emerald-700 transition"
          >
            {t("Go to Compliance")}
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-12 gap-6">
        {/* Left: section navigation */}
        <div className="col-span-12 md:col-span-3 bg-white p-4 border border-slate-200 space-y-3 self-start">
          <h2 className="text-sm font-semibold text-indigo-600 border-l-4 border-indigo-600 pl-2">
            {t("Proposal Structure")}
          </h2>
          <div className="space-y-1">
            {project.sections.map((sec) => {
              const isSelected = sec.id === activeSection.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => {
                    setIsEditing(false);
                    setActiveSectionId(sec.id);
                  }}
                  aria-current={isSelected ? "true" : undefined}
                  className={`w-full text-left px-3 py-3 border-l-4 flex items-center justify-between gap-2 text-sm transition ${
                    isSelected
                      ? "bg-indigo-50 border-indigo-600 text-indigo-900 font-semibold"
                      : "border-transparent hover:bg-slate-50 text-slate-700"
                  } ${sec.enabled ? "" : "opacity-60"}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText
                      className={`w-4 h-4 shrink-0 ${isSelected ? "text-indigo-600" : "text-slate-500"}`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{sec.title}</span>
                  </div>
                  {sec.status === "approved" && (
                    <CheckCircle2
                      className="w-4 h-4 text-emerald-500 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {sec.status === "generated" && (
                    <Clock
                      className="w-4 h-4 text-amber-500 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {sec.status === "needs_review" && (
                    <AlertTriangle
                      className="w-4 h-4 text-orange-500 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {sec.status === "generating" && (
                    <RefreshCw
                      className="w-4 h-4 text-indigo-600 animate-spin shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {sec.status === "draft" && (
                    <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                  )}
                  <span className="sr-only">
                    {t(STATUS_LABELS[sec.status])}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-600 px-2">
            {t(
              "{done} of {total} sections approved. Sections can be turned off in Prompt Studio.",
              { done: approvedCount, total: enabledSections.length },
            )}
          </p>
        </div>

        {/* Right: editor */}
        <div className="col-span-12 md:col-span-9 bg-white p-6 border border-slate-200 space-y-5">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-b border-slate-200 pb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-slate-900">
                  {activeSection.title}
                </h2>
                <span
                  className={`text-xs px-2 py-0.5 rounded-sm font-semibold ${STATUS_STYLES[activeSection.status]}`}
                >
                  {t(STATUS_LABELS[activeSection.status])}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                {t("Word limit: {n}", {
                  n: activeSection.wordLimit ?? t("none"),
                })}
                {activeSection.characterLimit
                  ? ` · ${t("Character limit: {n}", { n: activeSection.characterLimit })}`
                  : ""}
              </p>
            </div>

            {hasContent && (
              <div className="flex flex-wrap gap-2">
                <button onClick={copyContent} className={secondaryButton}>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  {copied ? t("Copied") : t("Copy")}
                </button>
                {isEditing ? (
                  <>
                    <button
                      onClick={saveEdits}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-medium hover:bg-indigo-700 transition"
                    >
                      <Save className="w-3.5 h-3.5" aria-hidden="true" />
                      {t("Save Edits")}
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className={secondaryButton}
                    >
                      {t("Cancel")}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={startEditing}
                    disabled={isBusy}
                    className={`${secondaryButton} disabled:opacity-50`}
                  >
                    <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                    {t("Edit Content")}
                  </button>
                )}
                {!isEditing && activeSection.status !== "approved" && (
                  <button
                    onClick={() => patchActiveSection({ status: "approved" })}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-md text-xs font-medium hover:bg-emerald-700 transition"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {t("Approve Section")}
                  </button>
                )}
                {!isEditing && activeSection.status === "approved" && (
                  <button
                    onClick={() => patchActiveSection({ status: "generated" })}
                    className={secondaryButton}
                  >
                    <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {t("Reopen")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Real metrics (computed from the text itself) */}
          {hasContent && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-slate-50 p-3 border border-slate-200 text-xs">
              <div>
                <span className="text-slate-600 block">{t("Word Count")}</span>
                <span
                  className={`font-bold text-sm ${overWords ? "text-red-600" : "text-slate-900"}`}
                >
                  {wordCount} / {activeSection.wordLimit ?? t("no limit")}
                </span>
              </div>
              <div>
                <span className="text-slate-600 block">{t("Characters")}</span>
                <span
                  className={`font-bold text-sm ${overChars ? "text-red-600" : "text-slate-900"}`}
                >
                  {charCount}
                  {activeSection.characterLimit
                    ? ` / ${activeSection.characterLimit}`
                    : ""}
                </span>
              </div>
              <div>
                <span className="text-slate-600 block">
                  {t("AI Critic Score")}
                </span>
                <span className="font-bold text-indigo-600 text-sm">
                  {result?.criticScore != null
                    ? `${result.criticScore}/100`
                    : "—"}
                </span>
              </div>
              <div>
                <span className="text-slate-600 block">
                  {t("Open Placeholders")}
                </span>
                <span
                  className={`font-bold text-sm ${placeholders.length > 0 ? "text-orange-600" : "text-slate-900"}`}
                >
                  {placeholders.length}
                </span>
              </div>
            </div>
          )}

          {/* Content area */}
          {busySectionId === activeSection.id ? (
            <div
              role="status"
              className="min-h-[300px] flex flex-col items-center justify-center text-slate-700 gap-3"
            >
              <RefreshCw
                className="w-8 h-8 animate-spin text-indigo-500"
                aria-hidden="true"
              />
              <p className="text-sm">
                {t("Generating “{title}” with Gemini...", {
                  title: activeSection.title,
                })}
              </p>
              <p className="text-xs text-slate-600">
                {t(
                  "This can take up to a minute. Word limits are checked automatically.",
                )}
              </p>
            </div>
          ) : isEditing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              className="w-full p-4 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 bg-white leading-relaxed"
            />
          ) : hasContent ? (
            <div className="min-h-[300px] p-5 bg-slate-50 border border-slate-200 text-sm leading-relaxed text-slate-900 whitespace-pre-wrap">
              {content}
            </div>
          ) : (
            <div className="min-h-[300px] flex flex-col items-center justify-center text-slate-600 py-16 bg-slate-50 border border-dashed border-slate-300">
              <Bot
                className="w-10 h-10 mb-2 text-indigo-500"
                aria-hidden="true"
              />
              <p>{t("No content generated for this section yet.")}</p>
              <p className="text-xs mt-1">
                {activeSection.enabled
                  ? t("Click Generate Section to run the writing agent.")
                  : t("This section is turned off in Prompt Studio.")}
              </p>
            </div>
          )}

          {/* Review notes */}
          {hasContent && !isEditing && (
            <div className="space-y-3">
              {(overWords || overChars) && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700 flex items-start gap-2">
                  <AlertTriangle
                    className="w-4 h-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {overWords &&
                      `${t("The text has {count} words, over the {limit}-word limit.", { count: wordCount, limit: activeSection.wordLimit ?? 0 })} `}
                    {overChars &&
                      `${t("The text has {count} characters, over the {limit}-character limit.", { count: charCount, limit: activeSection.characterLimit ?? 0 })} `}
                    {t("Edit it or regenerate.")}
                  </span>
                </div>
              )}

              {placeholders.length > 0 && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-md text-xs text-orange-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                    {t("The AI needs more information from you:")}
                  </p>
                  <ul className="list-disc pl-6 space-y-0.5">
                    {placeholders.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result && (
                <div className="space-y-3">
                  {visibleWarnings.length > 0 && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800 space-y-1">
                      <p className="font-semibold">{t("AI warnings")}</p>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {visibleWarnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {result.criticFeedback && (
                    <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-md text-xs text-indigo-900">
                      <span className="font-semibold">{t("AI critic: ")}</span>
                      {result.criticFeedback}
                    </div>
                  )}

                  {(result.requirementsCovered.length > 0 ||
                    result.missingRequirements.length > 0) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 border border-emerald-200 bg-emerald-50 rounded-md">
                        <p className="font-semibold text-emerald-800 mb-1">
                          {t("Requirements covered")}
                        </p>
                        <ul className="list-disc pl-5 text-emerald-900 space-y-0.5">
                          {result.requirementsCovered.length === 0 && (
                            <li className="list-none -ml-5 text-emerald-700">
                              {t("None reported.")}
                            </li>
                          )}
                          {result.requirementsCovered.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="p-3 border border-orange-200 bg-orange-50 rounded-md">
                        <p className="font-semibold text-orange-800 mb-1">
                          {t("Missing or unclear")}
                        </p>
                        <ul className="list-disc pl-5 text-orange-900 space-y-0.5">
                          {result.missingRequirements.length === 0 && (
                            <li className="list-none -ml-5 text-orange-700">
                              {t("None reported.")}
                            </li>
                          )}
                          {result.missingRequirements.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-slate-600">
                    {t("Generated with {model}", { model: result.model })}
                    {result.condensed
                      ? ` · ${t("automatically shortened to fit the word limit")}`
                      : ""}
                    {". "}
                    {t(
                      "The AI score is the model's own estimate, not a guarantee.",
                    )}
                  </p>

                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-600 hover:text-slate-900">
                      {t("View the exact prompt sent to Gemini")}
                    </summary>
                    {/* Fixed dark colours: readable in both light and dark theme */}
                    <pre className="mt-2 p-3 bg-[#101a26] text-[#cdd8e3] border border-[#243447] whitespace-pre-wrap overflow-x-auto">
                      {result.assembledPromptPreview}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingText({ text }: { text: "Loading project..." | "Loading..." }) {
  const t = useT(zh);
  return <p className="text-sm text-slate-600">{t(text)}</p>;
}

function GenerationGate() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("project");
  const isClient = useIsClient();

  if (!isClient) {
    return <LoadingText text="Loading project..." />;
  }
  return (
    <GenerationWorkspace
      key={requestedId ?? "latest"}
      requestedId={requestedId}
    />
  );
}

export default function GenerationWorkspacePage() {
  return (
    <Suspense fallback={<LoadingText text="Loading..." />}>
      <GenerationGate />
    </Suspense>
  );
}
