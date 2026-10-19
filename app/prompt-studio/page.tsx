"use client";

import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sliders,
  Eye,
  Save,
  Sparkles,
  CheckCircle,
  FileText,
  AlertCircle,
  History,
  ArrowRight,
  FolderPlus,
} from "lucide-react";
import type { GrantSection } from "@/types/prompt";
import type { GrantProject } from "@/types/project";
import { buildSectionPrompt } from "@/lib/prompts/promptsBuilder";
import { projectStore } from "@/lib/storage/projectStore";
import { promptVersionStore } from "@/lib/storage/promptVersionStore";
import { useApp, useT } from "@/components/providers/app-provider";
import type { Dict } from "@/lib/i18n";

// Chinese text for this page. The English sentence is the key.
const zh: Dict = {
  "Prompt Studio": "提示词工作室",
  "No project to configure yet": "还没有可配置的项目",
  "Create a project by uploading a grant guideline, then come back to tune the prompt for each section.":
    "请先上传基金申请指南创建项目，然后回到这里调整每个章节的提示词。",
  "Create a project": "创建项目",
  "Switch project": "切换项目",
  "Unsaved changes": "有未保存的更改",
  "Hide Assembled Prompt": "隐藏完整提示词",
  "Preview Prompt": "预览提示词",
  "Save Configuration": "保存配置",
  "Go to Generation": "前往内容生成",
  "Configuration saved.": "配置已保存。",
  "Proposal Sections": "申请章节",
  "{n} w": "{n} 字",
  "Global Instructions": "全局指令",
  "Configure the prompt template and section constraints.":
    "配置提示词模板和章节限制。",
  "Include in generation": "参与生成",
  "Section-Specific Prompt Template": "章节提示词模板",
  "Unknown variable: {vars} — these will be sent to the AI as plain text.":
    "未知变量：{vars} — 它们将作为普通文本发送给 AI。",
  "Unknown variables: {vars} — these will be sent to the AI as plain text.":
    "未知变量：{vars} — 它们将作为普通文本发送给 AI。",
  "Click a variable to insert it at the cursor:":
    "点击变量，将其插入到光标处：",
  Tone: "语气",
  Academic: "学术",
  Technical: "技术",
  Professional: "专业",
  General: "通用",
  Creativity: "创造性",
  "Low (Strict)": "低（严谨）",
  Medium: "中",
  High: "高",
  "Word Limit": "字数上限",
  "Character Limit": "字符数上限",
  Unlimited: "不限",
  "Guideline Requirements": "指南要求",
  "Evaluation Criteria": "评审标准",
  "None extracted.": "未提取到内容。",
  "Prompt Version History": "提示词版本历史",
  "No saved versions yet. A version is recorded each time you save a changed prompt.":
    "暂无已保存的版本。每次保存修改后的提示词，都会记录一个版本。",
  Restore: "恢复",
  "Assembled prompt sent to Gemini": "发送给 Gemini 的完整提示词",
  "Live preview": "实时预览",
  "SYSTEM INSTRUCTIONS": "系统指令",
  "ASSEMBLED USER CONTEXT & PROMPT": "用户上下文与完整提示词",
  "Could not save to your browser (storage may be full). Delete old projects and try again.":
    "无法保存到浏览器（存储空间可能已满）。请删除旧项目后重试。",
  "You have unsaved changes. Switch project anyway?":
    "您有未保存的更改。仍要切换项目吗？",
  "Loading project...": "正在加载项目...",
};

const inputClass =
  "w-full text-xs p-2 border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500";

const emptySubscribe = () => () => {};

/** True only in the browser (so localStorage can be read without hydration mismatches). */
function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

function loadInitialState(requestedId: string | null) {
  const all = projectStore.getAllProjects();
  const found =
    (requestedId ? all.find((p) => p.id === requestedId) : undefined) ??
    all[all.length - 1] ??
    null;
  return {
    project: found,
    projectList: all.map((p) => ({ id: p.id, title: p.title })),
  };
}

function PromptStudioContent({ requestedId }: { requestedId: string | null }) {
  const t = useT(zh);
  const { locale } = useApp();
  const router = useRouter();

  // Load the real saved project (from ?project=<id>, otherwise the latest one).
  const [initial] = useState(() => loadInitialState(requestedId));
  const [project, setProject] = useState<GrantProject | null>(initial.project);
  const [savedJson, setSavedJson] = useState(
    initial.project ? JSON.stringify(initial.project) : "",
  );
  const projectList = initial.projectList;
  const [selectedSectionId, setSelectedSectionId] = useState(
    initial.project?.sections[0]?.id ?? "",
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versionTick, setVersionTick] = useState(0);

  const isDirty = project !== null && JSON.stringify(project) !== savedJson;

  const selectedSection: GrantSection | undefined = project
    ? (project.sections.find((s) => s.id === selectedSectionId) ??
      project.sections[0])
    : undefined;

  const assembled = useMemo(() => {
    if (!project || !selectedSection) return null;
    try {
      return buildSectionPrompt(project, selectedSection.id);
    } catch {
      return null;
    }
  }, [project, selectedSection]);

  const unknownVariables = useMemo(() => {
    if (!selectedSection || !assembled) return [];
    const known = new Set(Object.keys(assembled.variableMap));
    const found = new Set<string>();
    for (const match of selectedSection.prompt.matchAll(/{{\s*([\w]+)\s*}}/g)) {
      if (!known.has(match[1])) found.add(match[1]);
    }
    return [...found];
  }, [selectedSection, assembled]);

  const versions = useMemo(() => {
    void versionTick; // re-read after saving
    if (!project || !selectedSection) return [];
    return promptVersionStore.getVersions(project.id, selectedSection.id);
  }, [project, selectedSection, versionTick]);

  const updateSection = (patch: Partial<GrantSection>) => {
    if (!selectedSection) return;
    setProject((prev) =>
      prev
        ? {
            ...prev,
            sections: prev.sections.map((s) =>
              s.id === selectedSection.id ? { ...s, ...patch } : s,
            ),
          }
        : prev,
    );
  };

  const insertVariable = (name: string) => {
    if (!selectedSection) return;
    const token = `{{${name}}}`;
    const el = document.getElementById(
      "section-prompt-template",
    ) as HTMLTextAreaElement | null;
    if (!el) {
      updateSection({ prompt: selectedSection.prompt + token });
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next =
      selectedSection.prompt.slice(0, start) +
      token +
      selectedSection.prompt.slice(end);
    updateSection({ prompt: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleSave = () => {
    if (!project) return;
    setError(null);
    try {
      // Record a prompt version for every section whose prompt changed.
      const previous: GrantProject | null = savedJson
        ? JSON.parse(savedJson)
        : null;
      for (const sec of project.sections) {
        const before = previous?.sections.find((s) => s.id === sec.id)?.prompt;
        if (before !== sec.prompt) {
          promptVersionStore.saveVersion(project.id, sec.id, sec.prompt);
        }
      }
      projectStore.saveProject(project);
      setSavedJson(JSON.stringify(project));
      setVersionTick((t) => t + 1);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error("Saving prompt configuration failed:", err);
      setError(
        "Could not save to your browser (storage may be full). Delete old projects and try again.",
      );
    }
  };

  const handleSwitchProject = (id: string) => {
    if (
      isDirty &&
      !window.confirm(t("You have unsaved changes. Switch project anyway?"))
    ) {
      return;
    }
    router.replace(`/prompt-studio?project=${encodeURIComponent(id)}`);
  };

  // ---- States -------------------------------------------------------------
  if (!project || !selectedSection) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <FolderPlus
          className="w-10 h-10 text-indigo-500 mx-auto"
          aria-hidden="true"
        />
        <h1 className="text-xl font-bold text-slate-900">
          {t("No project to configure yet")}
        </h1>
        <p className="text-sm text-slate-600">
          {t(
            "Create a project by uploading a grant guideline, then come back to tune the prompt for each section.",
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b-2 border-indigo-600 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
            <Sliders className="w-6 h-6" aria-hidden="true" />
            {t("Prompt Studio")}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {project.title}
            {project.grantName ? ` · ${project.grantName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {projectList.length > 1 && (
            <select
              value={project.id}
              onChange={(e) => handleSwitchProject(e.target.value)}
              aria-label={t("Switch project")}
              className="text-sm p-2 border border-slate-300 rounded-md bg-white max-w-56"
            >
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          {isDirty && (
            <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-sm">
              {t("Unsaved changes")}
            </span>
          )}
          <button
            onClick={() => setPreviewOpen((o) => !o)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition"
          >
            <Eye className="w-4 h-4 text-slate-500" aria-hidden="true" />
            {previewOpen ? t("Hide Assembled Prompt") : t("Preview Prompt")}
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" aria-hidden="true" />
            {t("Save Configuration")}
          </button>
          <Link
            href={`/generation?project=${encodeURIComponent(project.id)}`}
            className="flex items-center gap-2 px-4 py-2 border border-indigo-300 text-indigo-700 bg-indigo-50 rounded-md text-sm font-medium hover:bg-indigo-100 transition"
          >
            {t("Go to Generation")}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {saveSuccess && (
        <div
          role="status"
          className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-md flex items-center gap-2"
        >
          <CheckCircle
            className="w-4 h-4 text-emerald-600"
            aria-hidden="true"
          />
          {t("Configuration saved.")}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          {t(error)}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* Left Column: Sections List */}
        <div className="col-span-12 md:col-span-4 bg-white p-4 border border-slate-200 space-y-3 self-start">
          <h2 className="text-sm font-semibold text-indigo-600 border-l-4 border-indigo-600 pl-2">
            {t("Proposal Sections")}
          </h2>
          <div className="space-y-1">
            {project.sections.map((sec) => {
              const isSelected = sec.id === selectedSection.id;
              return (
                <button
                  key={sec.id}
                  onClick={() => setSelectedSectionId(sec.id)}
                  aria-current={isSelected ? "true" : undefined}
                  className={`w-full text-left px-3 py-3 border-l-4 flex items-center justify-between gap-2 text-sm transition ${
                    isSelected
                      ? "bg-indigo-50 border-indigo-600 text-indigo-900 font-semibold"
                      : "border-transparent hover:bg-slate-50 text-slate-700"
                  } ${sec.enabled ? "" : "opacity-60"}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText
                      className={`w-4 h-4 shrink-0 ${isSelected ? "text-indigo-600" : "text-slate-500"}`}
                      aria-hidden="true"
                    />
                    <span>{sec.title}</span>
                  </div>
                  {sec.wordLimit ? (
                    <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-sm shrink-0">
                      {t("{n} w", { n: sec.wordLimit })}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-200">
            <h3 className="text-xs font-semibold text-slate-600 mb-2">
              {t("Global Instructions")}
            </h3>
            <textarea
              value={project.globalPrompt}
              onChange={(e) =>
                setProject((prev) =>
                  prev ? { ...prev, globalPrompt: e.target.value } : prev,
                )
              }
              rows={4}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-md focus:ring-1 focus:ring-indigo-500 focus:outline-none text-slate-700 bg-slate-50"
            />
          </div>
        </div>

        {/* Right Column: Prompt Configuration Panel */}
        <div className="col-span-12 md:col-span-8 bg-white p-6 border border-slate-200 space-y-6">
          <div className="flex justify-between items-center gap-3 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {selectedSection.title}
              </h2>
              <p className="text-xs text-slate-600">
                {t("Configure the prompt template and section constraints.")}
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={selectedSection.enabled}
                onChange={(e) => updateSection({ enabled: e.target.checked })}
                className="accent-indigo-600"
              />
              {t("Include in generation")}
            </label>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700">
              {t("Section-Specific Prompt Template")}
            </label>
            <textarea
              id="section-prompt-template"
              value={selectedSection.prompt}
              onChange={(e) => updateSection({ prompt: e.target.value })}
              rows={8}
              className="w-full p-3 text-sm font-mono border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800 bg-slate-50"
            />
            {unknownVariables.length > 0 && (
              <p className="text-xs text-amber-700 flex items-center gap-1">
                <AlertCircle
                  className="w-3.5 h-3.5 shrink-0"
                  aria-hidden="true"
                />
                {t(
                  unknownVariables.length > 1
                    ? "Unknown variables: {vars} — these will be sent to the AI as plain text."
                    : "Unknown variable: {vars} — these will be sent to the AI as plain text.",
                  { vars: unknownVariables.map((v) => `{{${v}}}`).join(", ") },
                )}
              </p>
            )}
            <div className="text-xs text-slate-600">
              <span className="flex items-center gap-1 mb-1.5">
                <Sparkles
                  className="w-3.5 h-3.5 text-indigo-500"
                  aria-hidden="true"
                />
                {t("Click a variable to insert it at the cursor:")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {assembled &&
                  Object.keys(assembled.variableMap).map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => insertVariable(name)}
                      className="bg-slate-100 text-slate-700 hover:bg-indigo-100 hover:text-indigo-800 px-1.5 py-0.5 rounded-sm font-mono transition"
                    >
                      {`{{${name}}}`}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 bg-slate-50 p-4 border border-slate-200">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t("Tone")}
              </label>
              <select
                value={selectedSection.tone}
                onChange={(e) =>
                  updateSection({
                    tone: e.target.value as GrantSection["tone"],
                  })
                }
                className={inputClass}
              >
                <option value="academic">{t("Academic")}</option>
                <option value="technical">{t("Technical")}</option>
                <option value="professional">{t("Professional")}</option>
                <option value="general">{t("General")}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t("Creativity")}
              </label>
              <select
                value={selectedSection.creativity}
                onChange={(e) =>
                  updateSection({
                    creativity: e.target.value as GrantSection["creativity"],
                  })
                }
                className={inputClass}
              >
                <option value="low">{t("Low (Strict)")}</option>
                <option value="medium">{t("Medium")}</option>
                <option value="high">{t("High")}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t("Word Limit")}
              </label>
              <input
                type="number"
                min={0}
                value={selectedSection.wordLimit ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  updateSection({ wordLimit: n > 0 ? n : undefined });
                }}
                placeholder={t("Unlimited")}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t("Character Limit")}
              </label>
              <input
                type="number"
                min={0}
                value={selectedSection.characterLimit ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  updateSection({ characterLimit: n > 0 ? n : undefined });
                }}
                placeholder={t("Unlimited")}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700">
                {t("Guideline Requirements")}
              </h3>
              <ul className="text-xs text-slate-700 bg-slate-50 p-3 border border-slate-200 space-y-1.5">
                {selectedSection.requirements.length === 0 && (
                  <li className="text-slate-500">{t("None extracted.")}</li>
                )}
                {selectedSection.requirements.map((req, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 mt-1.5 shrink-0 bg-indigo-500" />
                    {req}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700">
                {t("Evaluation Criteria")}
              </h3>
              <ul className="text-xs text-slate-700 bg-slate-50 p-3 border border-slate-200 space-y-1.5">
                {selectedSection.evaluationCriteria.length === 0 && (
                  <li className="text-slate-500">{t("None extracted.")}</li>
                )}
                {selectedSection.evaluationCriteria.map((c, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 mt-1.5 shrink-0 bg-emerald-500" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Version history */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              {t("Prompt Version History")}
            </h3>
            {versions.length === 0 ? (
              <p className="text-xs text-slate-600">
                {t(
                  "No saved versions yet. A version is recorded each time you save a changed prompt.",
                )}
              </p>
            ) : (
              <ul className="border border-slate-200 divide-y divide-slate-200 max-h-48 overflow-y-auto">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-700">
                        v{v.versionNumber}
                      </span>
                      <span className="text-slate-500 ml-2">
                        {new Date(v.createdAt).toLocaleString(locale)}
                      </span>
                      <p className="text-slate-600 truncate">{v.promptText}</p>
                    </div>
                    <button
                      onClick={() => updateSection({ prompt: v.promptText })}
                      className="shrink-0 px-2.5 py-1 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-100"
                    >
                      {t("Restore")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Assembled Prompt Preview */}
      {previewOpen && assembled && (
        <div className="bg-[#101a26] text-[#e3eaf1] p-6 border border-[#243447] space-y-4">
          <div className="flex justify-between items-center border-b border-[#243447] pb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#8ab5f0]">
              <Eye className="w-4 h-4" aria-hidden="true" />
              {t("Assembled prompt sent to Gemini")}
            </h3>
            <span className="text-xs text-[#9db0c4]">{t("Live preview")}</span>
          </div>
          <div className="space-y-3 font-mono text-xs text-[#cdd8e3] overflow-x-auto">
            <div className="p-3 bg-[#0a1018] border border-[#243447]">
              <span className="text-[#9db0c4] block mb-1">
                {t("SYSTEM INSTRUCTIONS")}
              </span>
              <pre className="whitespace-pre-wrap">
                {assembled.systemInstructions}
              </pre>
            </div>
            <div className="p-3 bg-[#0a1018] border border-[#243447]">
              <span className="text-[#9db0c4] block mb-1">
                {t("ASSEMBLED USER CONTEXT & PROMPT")}
              </span>
              <pre className="whitespace-pre-wrap">
                {assembled.assembledText}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PromptStudioGate() {
  const t = useT(zh);
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("project");
  const isClient = useIsClient();

  if (!isClient) {
    return <p className="text-sm text-slate-500">{t("Loading project...")}</p>;
  }
  // key: switching project remounts the editor with fresh state
  return (
    <PromptStudioContent
      key={requestedId ?? "latest"}
      requestedId={requestedId}
    />
  );
}

function LoadingText() {
  const t = useT(zh);
  return <p className="text-sm text-slate-500">{t("Loading...")}</p>;
}

export default function PromptStudioPage() {
  return (
    <Suspense fallback={<LoadingText />}>
      <PromptStudioGate />
    </Suspense>
  );
}
