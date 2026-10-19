"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Settings as SettingsIcon,
  Cpu,
  ShieldCheck,
  Database,
  Download,
  Upload,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
} from "lucide-react";
import { projectStore } from "@/lib/storage/projectStore";
import { useT } from "@/components/providers/app-provider";
import type { Dict, Params } from "@/lib/i18n";
import type { GrantProject } from "@/types/project";

// Chinese text for this page. The English sentence is the key.
// In a sentence, **text** is shown bold and `text` as code.
const zh: Dict = {
  Settings: "设置",
  "AI configuration, privacy information and your saved data.":
    "AI 配置、隐私信息和您保存的数据。",
  "Dismiss message": "关闭消息",

  // AI model
  "AI Model": "AI 模型",
  "Loading server settings...": "正在加载服务器设置...",
  "Could not load the server settings.": "无法加载服务器设置。",
  Provider: "服务提供方",
  Model: "模型",
  "Set by GEMINI_MODEL in .env.local": "由 .env.local 中的 GEMINI_MODEL 设置",
  "Default. Set GEMINI_MODEL in .env.local to change it.":
    "默认值。如需更改，请在 .env.local 中设置 GEMINI_MODEL。",
  "API key": "API 密钥",
  "Configured (hidden for security)": "已配置（出于安全考虑已隐藏）",
  "Not configured": "未配置",
  "Add GEMINI_API_KEY to .env.local and restart the server.":
    "请在 .env.local 中添加 GEMINI_API_KEY，并重启服务器。",
  "Retry attempts": "重试次数",
  "Creativity per section": "各章节创造性",
  "Low {low} · Medium {medium} · High {high}":
    "低 {low} · 中 {medium} · 高 {high}",
  "Chosen for each section in Prompt Studio":
    "在提示词工作室中为每个章节单独选择",
  "These values are read-only here because the API key and model live on the server. Edit `.env.local` and restart `npm run dev` to change them.":
    "这些值在此处为只读，因为 API 密钥和模型保存在服务器上。如需更改，请编辑 `.env.local` 并重启 `npm run dev`。",

  // Privacy
  "Privacy & Security": "隐私与安全",
  "Your **API key stays on the server**. It is never sent to your browser.":
    "您的 **API 密钥保存在服务器上**，不会发送到您的浏览器。",
  "Projects, generated text, prompts and reports are stored **only in this browser** (no account, no database). Clearing your browser data removes them, so keep backups.":
    "项目、生成的文本、提示词和报告**仅保存在此浏览器中**（没有账号，也没有数据库）。清除浏览器数据会将它们删除，因此请做好备份。",
  "Guideline text and proposal sections are sent to Google's Gemini API to be analyzed and written. With the free tier, Google may use that content to improve its products, so **do not upload highly confidential material**.":
    "指南文本和申请书章节会发送到 Google 的 Gemini API 进行分析和撰写。使用免费版时，Google 可能会将这些内容用于改进其产品，因此**请勿上传高度机密的材料**。",
  "The server does not keep your documents after a request finishes.":
    "请求结束后，服务器不会保留您的文档。",

  // Data
  "Your Data": "您的数据",
  project: "个项目",
  projects: "个项目",
  "saved prompt version": "个已保存的提示词版本",
  "saved prompt versions": "个已保存的提示词版本",
  "Storage used:": "已使用存储：",
  "Browsers allow roughly 5 MB per site. {n}% used.":
    "浏览器通常为每个网站提供约 5 MB 的空间。已使用 {n}%。",
  "Download Backup (JSON)": "下载备份（JSON）",
  "Restore from Backup": "从备份恢复",
  "Restore from backup file": "从备份文件恢复",
  "Delete All Data": "删除所有数据",
  "Delete ALL GrantPilot data in this browser (projects, generated text, prompt history and reports)? This cannot be undone. Download a backup first if you may need it.":
    "要删除此浏览器中的所有 GrantPilot 数据（项目、生成的文本、提示词历史和报告）吗？此操作无法撤销。如果以后可能需要，请先下载备份。",

  // Messages
  "Backup downloaded (1 project).": "备份已下载（1 个项目）。",
  "Backup downloaded ({n} projects).": "备份已下载（{n} 个项目）。",
  "Could not create the backup.": "无法创建备份。",
  "This is not a GrantPilot AI backup file.":
    "这不是 GrantPilot AI 的备份文件。",
  "That file is not valid JSON.": "该文件不是有效的 JSON。",
  "Could not restore the backup.": "无法恢复备份。",
  "Restored 1 project.": "已恢复 1 个项目。",
  "Restored {n} projects.": "已恢复 {n} 个项目。",
  " {n} replaced an existing project with the same id.":
    "其中 {n} 个替换了 ID 相同的现有项目。",
  " 1 invalid entry was skipped.": "已跳过 1 个无效条目。",
  " {n} invalid entries were skipped.": "已跳过 {n} 个无效条目。",
  "All GrantPilot data was deleted from this browser.":
    "已从此浏览器中删除所有 GrantPilot 数据。",
  "Could not delete the data.": "无法删除数据。",
  "Loading settings...": "正在加载设置...",
};

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface ServerSettings {
  provider: string;
  model: string;
  modelFromEnv: boolean;
  defaultModel: string;
  retryAttempts: number;
  apiKeyConfigured: boolean;
  temperatures: { low: number; medium: number; high: number };
}

interface BackupFile {
  app: "grantpilot-ai";
  formatVersion: 1;
  exportedAt: string;
  projects: GrantProject[];
  promptVersions: unknown[];
}

/** A message stored as English keys, so it can be re-translated when the language changes. */
type Part = [key: string, params?: Params];
interface Notice {
  kind: "ok" | "error";
  parts: Part[];
}

const STORAGE_PREFIX = "grantpilot_";
const VERSIONS_KEY = "grantpilot_prompt_versions";
const APPROX_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

const emptySubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

function readVersions(): unknown[] {
  try {
    const raw = window.localStorage.getItem(VERSIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getLocalStats() {
  let chars = 0;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) {
        chars += key.length + (window.localStorage.getItem(key)?.length ?? 0);
      }
    }
  } catch {
    // ignore
  }
  const bytes = chars * 2; // UTF-16 in browser storage
  return {
    projects: projectStore.getAllProjects().length,
    versions: readVersions().length,
    kilobytes: Math.round(bytes / 1024),
    percent: Math.min(
      100,
      Math.round((bytes / APPROX_STORAGE_LIMIT_BYTES) * 100),
    ),
  };
}

function looksLikeProject(value: unknown): value is GrantProject {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<GrantProject>;
  return (
    typeof p.id === "string" &&
    typeof p.title === "string" &&
    Array.isArray(p.sections) &&
    !!p.projectBrief &&
    typeof p.projectBrief === "object"
  );
}

function looksLikeVersion(value: unknown): value is { id: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.projectId === "string" &&
    typeof v.sectionId === "string" &&
    typeof v.versionNumber === "number" &&
    typeof v.promptText === "string"
  );
}

/** Shows **bold** and `code` parts of a translated sentence. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((piece, i) => {
        if (piece.startsWith("**"))
          return <strong key={i}>{piece.slice(2, -2)}</strong>;
        if (piece.startsWith("`"))
          return <code key={i}>{piece.slice(1, -1)}</code>;
        return piece;
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function SettingsContent() {
  const t = useT(zh);
  const [server, setServer] = useState<ServerSettings | null>(null);
  const [serverError, setServerError] = useState(false);
  const [stats, setStats] = useState(() => getLocalStats());
  const [message, setMessage] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then(async (res) => {
        if (!res.ok) throw new Error("Server returned " + res.status);
        return (await res.json()) as ServerSettings;
      })
      .then((data) => {
        if (!cancelled) setServer(data);
      })
      .catch(() => {
        if (!cancelled) setServerError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const exportBackup = () => {
    setMessage(null);
    try {
      const backup: BackupFile = {
        app: "grantpilot-ai",
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        projects: projectStore.getAllProjects(),
        promptVersions: readVersions(),
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `grantpilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      setMessage({
        kind: "ok",
        parts: [
          backup.projects.length === 1
            ? ["Backup downloaded (1 project)."]
            : [
                "Backup downloaded ({n} projects).",
                { n: backup.projects.length },
              ],
        ],
      });
    } catch (err) {
      console.error("Backup failed:", err);
      setMessage({ kind: "error", parts: [["Could not create the backup."]] });
    }
  };

  const importBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setMessage(null);

    try {
      const parsed: unknown = JSON.parse(await file.text());
      const data = parsed as Partial<BackupFile>;
      if (
        !data ||
        data.app !== "grantpilot-ai" ||
        !Array.isArray(data.projects)
      ) {
        throw new Error("This is not a GrantPilot AI backup file.");
      }

      const projects = data.projects.filter(looksLikeProject);
      const existingIds = new Set(
        projectStore.getAllProjects().map((p) => p.id),
      );
      let replaced = 0;
      for (const project of projects) {
        if (existingIds.has(project.id)) replaced++;
        projectStore.saveProject(project);
      }

      // Merge prompt versions by id.
      const incoming = (
        Array.isArray(data.promptVersions) ? data.promptVersions : []
      ).filter(looksLikeVersion);
      if (incoming.length > 0) {
        const merged = new Map<string, unknown>();
        for (const v of readVersions()) {
          if (looksLikeVersion(v)) merged.set(v.id, v);
        }
        for (const v of incoming) merged.set(v.id, v);
        window.localStorage.setItem(
          VERSIONS_KEY,
          JSON.stringify([...merged.values()]),
        );
      }

      const skipped = data.projects.length - projects.length;
      setStats(getLocalStats());

      const parts: Part[] = [
        projects.length === 1
          ? ["Restored 1 project."]
          : ["Restored {n} projects.", { n: projects.length }],
      ];
      if (replaced > 0) {
        parts.push([
          " {n} replaced an existing project with the same id.",
          { n: replaced },
        ]);
      }
      if (skipped > 0) {
        parts.push(
          skipped === 1
            ? [" 1 invalid entry was skipped."]
            : [" {n} invalid entries were skipped.", { n: skipped }],
        );
      }
      setMessage({ kind: "ok", parts });
    } catch (err) {
      console.error("Restore failed:", err);
      setMessage({
        kind: "error",
        parts: [
          [
            err instanceof SyntaxError
              ? "That file is not valid JSON."
              : err instanceof Error
                ? err.message
                : "Could not restore the backup.",
          ],
        ],
      });
    }
  };

  const deleteAllData = () => {
    if (
      !window.confirm(
        t(
          "Delete ALL GrantPilot data in this browser (projects, generated text, prompt history and reports)? This cannot be undone. Download a backup first if you may need it.",
        ),
      )
    ) {
      return;
    }
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(STORAGE_PREFIX)) window.localStorage.removeItem(key);
      }
      setStats(getLocalStats());
      setMessage({
        kind: "ok",
        parts: [["All GrantPilot data was deleted from this browser."]],
      });
    } catch {
      setMessage({ kind: "error", parts: [["Could not delete the data."]] });
    }
  };

  const card = "bg-white p-6 border border-slate-200 space-y-4";
  const cardTitle =
    "text-base font-bold text-indigo-600 border-l-4 border-indigo-600 pl-2 flex items-center gap-2";
  const row =
    "flex items-start justify-between gap-4 py-2.5 border-b border-slate-200 last:border-0 text-sm";

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="border-b-2 border-indigo-600 pb-4">
        <h1 className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6" aria-hidden="true" />
          {t("Settings")}
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          {t("AI configuration, privacy information and your saved data.")}
        </p>
      </div>

      {message && (
        <div
          role={message.kind === "error" ? "alert" : "status"}
          className={`p-3 rounded-md flex items-start gap-2 text-sm border ${
            message.kind === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {message.kind === "ok" ? (
            <CheckCircle2
              className="w-4 h-4 shrink-0 mt-0.5"
              aria-hidden="true"
            />
          ) : (
            <AlertCircle
              className="w-4 h-4 shrink-0 mt-0.5"
              aria-hidden="true"
            />
          )}
          <span className="flex-1">
            {message.parts.map(([key, params]) => t(key, params)).join("")}
          </span>
          <button
            onClick={() => setMessage(null)}
            aria-label={t("Dismiss message")}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* AI model */}
      <section className={card}>
        <h2 className={cardTitle}>
          <Cpu className="w-5 h-5" aria-hidden="true" />
          {t("AI Model")}
        </h2>

        {serverError && (
          <p className="text-sm text-red-600">
            {t("Could not load the server settings.")}
          </p>
        )}
        {!server && !serverError && (
          <p className="text-sm text-slate-600">
            {t("Loading server settings...")}
          </p>
        )}

        {server && (
          <div>
            <div className={row}>
              <span className="text-slate-600">{t("Provider")}</span>
              <span className="font-medium text-slate-900">
                {server.provider}
              </span>
            </div>
            <div className={row}>
              <span className="text-slate-600">{t("Model")}</span>
              <span className="text-right">
                <span className="font-medium text-slate-900">
                  {server.model}
                </span>
                <span className="block text-xs text-slate-600">
                  {server.modelFromEnv
                    ? t("Set by GEMINI_MODEL in .env.local")
                    : t(
                        "Default. Set GEMINI_MODEL in .env.local to change it.",
                      )}
                </span>
              </span>
            </div>
            <div className={row}>
              <span className="text-slate-600">{t("API key")}</span>
              {server.apiKeyConfigured ? (
                <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  {t("Configured (hidden for security)")}
                </span>
              ) : (
                <span className="text-right">
                  <span className="flex items-center justify-end gap-1.5 font-medium text-red-700">
                    <XCircle className="w-4 h-4" aria-hidden="true" />
                    {t("Not configured")}
                  </span>
                  <span className="block text-xs text-slate-600">
                    {t(
                      "Add GEMINI_API_KEY to .env.local and restart the server.",
                    )}
                  </span>
                </span>
              )}
            </div>
            <div className={row}>
              <span className="text-slate-600">{t("Retry attempts")}</span>
              <span className="text-right font-medium text-slate-900">
                {server.retryAttempts}
                <span className="block text-xs font-normal text-slate-600">
                  GEMINI_RETRY_ATTEMPTS
                </span>
              </span>
            </div>
            <div className={row}>
              <span className="text-slate-600">
                {t("Creativity per section")}
              </span>
              <span className="text-right text-slate-900">
                {t("Low {low} · Medium {medium} · High {high}", {
                  low: server.temperatures.low,
                  medium: server.temperatures.medium,
                  high: server.temperatures.high,
                })}
                <span className="block text-xs text-slate-600">
                  {t("Chosen for each section in Prompt Studio")}
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-600 pt-3">
              <Rich
                text={t(
                  "These values are read-only here because the API key and model live on the server. Edit `.env.local` and restart `npm run dev` to change them.",
                )}
              />
            </p>
          </div>
        )}
      </section>

      {/* Privacy */}
      <section className={card}>
        <h2 className={cardTitle}>
          <ShieldCheck className="w-5 h-5" aria-hidden="true" />
          {t("Privacy & Security")}
        </h2>
        <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5">
          <li>
            <Rich
              text={t(
                "Your **API key stays on the server**. It is never sent to your browser.",
              )}
            />
          </li>
          <li>
            <Rich
              text={t(
                "Projects, generated text, prompts and reports are stored **only in this browser** (no account, no database). Clearing your browser data removes them, so keep backups.",
              )}
            />
          </li>
          <li>
            <Rich
              text={t(
                "Guideline text and proposal sections are sent to Google's Gemini API to be analyzed and written. With the free tier, Google may use that content to improve its products, so **do not upload highly confidential material**.",
              )}
            />
          </li>
          <li>
            {t(
              "The server does not keep your documents after a request finishes.",
            )}
          </li>
        </ul>
      </section>

      {/* Data */}
      <section className={card}>
        <h2 className={cardTitle}>
          <Database className="w-5 h-5" aria-hidden="true" />
          {t("Your Data")}
        </h2>

        <div className="text-sm text-slate-700 space-y-2">
          <p>
            <strong>{stats.projects}</strong>{" "}
            {t(stats.projects === 1 ? "project" : "projects")} ·{" "}
            <strong>{stats.versions}</strong>{" "}
            {t(
              stats.versions === 1
                ? "saved prompt version"
                : "saved prompt versions",
            )}{" "}
            · {t("Storage used:")} <strong>{stats.kilobytes} KB</strong>
          </p>
          <div className="h-1.5 bg-slate-200 rounded-sm overflow-hidden">
            <div
              className={`h-full ${stats.percent >= 80 ? "bg-red-500" : "bg-indigo-500"}`}
              style={{ width: `${stats.percent}%` }}
            />
          </div>
          <p className="text-xs text-slate-600">
            {t("Browsers allow roughly 5 MB per site. {n}% used.", {
              n: stats.percent,
            })}
          </p>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            onClick={exportBackup}
            disabled={stats.projects === 0}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            {t("Download Backup (JSON)")}
          </button>

          <label className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition cursor-pointer">
            <Upload className="w-4 h-4" aria-hidden="true" />
            {t("Restore from Backup")}
            <input
              type="file"
              accept="application/json,.json"
              onChange={importBackup}
              className="hidden"
              aria-label={t("Restore from backup file")}
            />
          </label>

          <button
            onClick={deleteAllData}
            disabled={stats.projects === 0 && stats.versions === 0}
            className="flex items-center gap-2 px-4 py-2 border border-red-200 text-red-700 bg-red-50 rounded-md text-sm font-medium hover:bg-red-100 transition disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            {t("Delete All Data")}
          </button>
        </div>
      </section>
    </div>
  );
}

function LoadingText() {
  const t = useT(zh);
  return <p className="text-sm text-slate-600">{t("Loading settings...")}</p>;
}

export default function SettingsPage() {
  const isClient = useIsClient();
  if (!isClient) {
    return <LoadingText />;
  }
  return <SettingsContent />;
}
