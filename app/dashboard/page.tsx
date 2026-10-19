"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  PlusCircle,
  Folder,
  FileCheck,
  Clock,
  ShieldCheck,
  ArrowRight,
  Trash2,
  Sparkles,
  CalendarClock,
} from "lucide-react";
import { projectStore } from "@/lib/storage/projectStore";
import { promptVersionStore } from "@/lib/storage/promptVersionStore";
import { useT } from "@/components/providers/app-provider";
import type { Dict, Params } from "@/lib/i18n";
import type { GrantProject } from "@/types/project";

// Chinese text for this page. The English sentence is the key.
const zh: Dict = {
  "Overview of your grant application proposals and where each one stands.":
    "查看您的基金申请书总览，以及每个项目当前的进度。",
  "New Grant Project": "新建基金项目",
  "Total Projects": "项目总数",
  "In Progress": "进行中",
  "All Sections Approved": "全部章节已批准",
  "Avg. Requirement Coverage": "平均要求覆盖率",
  "Appears after you run an AI compliance check.": "运行 AI 合规检查后显示。",
  "Your Projects": "我的项目",
  "Stored in this browser only": "仅保存在此浏览器中",
  "No grant projects found": "暂无基金项目",
  "Get started by uploading a grant guideline and building your first section-by-section proposal.":
    "上传基金申请指南，开始逐章节撰写您的第一份申请书。",
  "Create Project": "创建项目",
  "Grant Project": "基金项目",
  "Delete project": "删除项目",
  "Delete {title}": "删除 {title}",
  "No problem statement specified.": "未填写问题陈述。",
  "Deadline: {date}": "截止日期：{date}",
  "{n} day left": "还剩 {n} 天",
  "{n} days left": "还剩 {n} 天",
  "passed": "已截止",
  "{approved}/{total} approved": "{approved}/{total} 已批准",
  Prompts: "提示词",
  "No sections enabled": "未启用任何章节",
  "Ready to generate": "可以开始生成",
  "Generating ({generated}/{total} written)": "生成中（已写 {generated}/{total}）",
  "Review and approve ({approved}/{total})": "审阅并批准（{approved}/{total}）",
  "Ready for compliance check": "可进行合规检查",
  'Delete "{title}"? Its generated text and prompt history will be removed. This cannot be undone.':
    "确定删除“{title}”吗？其已生成的文本和提示词历史将被一并删除，且无法恢复。",
  "Loading projects...": "正在加载项目...",
};

type Translate = (key: string, params?: Params) => string;

const emptySubscribe = () => () => {};

function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/** Progress is measured on enabled sections only (disabled ones are never written). */
function getProgress(project: GrantProject) {
  const enabled = project.sections.filter((s) => s.enabled);
  const generated = enabled.filter((s) => s.generatedContent?.trim()).length;
  const approved = enabled.filter((s) => s.status === "approved").length;
  return { total: enabled.length, generated, approved };
}

function getStage(
  project: GrantProject,
  t: Translate,
): { label: string; href: string } {
  const { total, generated, approved } = getProgress(project);
  const q = `?project=${encodeURIComponent(project.id)}`;

  if (total === 0) return { label: t("No sections enabled"), href: `/prompt-studio${q}` };
  if (generated === 0) return { label: t("Ready to generate"), href: `/generation${q}` };
  if (generated < total)
    return {
      label: t("Generating ({generated}/{total} written)", { generated, total }),
      href: `/generation${q}`,
    };
  if (approved < total)
    return {
      label: t("Review and approve ({approved}/{total})", { approved, total }),
      href: `/generation${q}`,
    };
  return { label: t("Ready for compliance check"), href: `/compliance${q}` };
}

function daysUntil(deadline: string | undefined): number | null {
  if (!deadline) return null;
  const parsed = Date.parse(deadline);
  if (Number.isNaN(parsed)) return null;
  return Math.ceil((parsed - Date.now()) / 86_400_000);
}

function removeProjectData(project: GrantProject) {
  projectStore.deleteProject(project.id);
  promptVersionStore.deleteProjectVersions(project.id);
  try {
    // Out-of-date markers written by the Compliance page
    window.localStorage.removeItem(`grantpilot_report_sig_${project.id}_compliance`);
    window.localStorage.removeItem(`grantpilot_report_sig_${project.id}_consistency`);
  } catch {
    // non-fatal
  }
}

function DashboardContent() {
  const t = useT(zh);
  const [projects, setProjects] = useState<GrantProject[]>(() =>
    [...projectStore.getAllProjects()].reverse(), // newest first
  );

  const handleDeleteProject = (project: GrantProject, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      window.confirm(
        t(
          'Delete "{title}"? Its generated text and prompt history will be removed. This cannot be undone.',
          { title: project.title },
        ),
      )
    ) {
      removeProjectData(project);
      setProjects([...projectStore.getAllProjects()].reverse());
    }
  };

  // Summary metrics (all computed from real data)
  const totalProjects = projects.length;
  const completedProjects = projects.filter((p) => {
    const { total, approved } = getProgress(p);
    return total > 0 && approved === total;
  }).length;
  const activeProjects = totalProjects - completedProjects;

  const coverageScores = projects
    .map((p) => p.reports?.compliance?.overallScore)
    .filter((s): s is number => Number.isFinite(s));
  const avgCoverage =
    coverageScores.length > 0
      ? Math.round(coverageScores.reduce((a, b) => a + b, 0) / coverageScores.length)
      : null;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Page title */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b-2 border-indigo-600 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-indigo-600">{t("Dashboard")}</h1>
          <p className="text-sm text-slate-600 mt-1">
            {t("Overview of your grant application proposals and where each one stands.")}
          </p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition w-fit"
        >
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          {t("New Grant Project")}
        </Link>
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 border border-slate-200 border-l-4 border-l-indigo-600 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500">{t("Total Projects")}</span>
            <Folder className="w-4 h-4 text-indigo-500" aria-hidden="true" />
          </div>
          <p className="text-3xl font-bold text-slate-900">{totalProjects}</p>
        </div>

        <div className="bg-white p-5 border border-slate-200 border-l-4 border-l-amber-500 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500">{t("In Progress")}</span>
            <Clock className="w-4 h-4 text-amber-500" aria-hidden="true" />
          </div>
          <p className="text-3xl font-bold text-slate-900">{activeProjects}</p>
        </div>

        <div className="bg-white p-5 border border-slate-200 border-l-4 border-l-emerald-500 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500">{t("All Sections Approved")}</span>
            <FileCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          </div>
          <p className="text-3xl font-bold text-slate-900">{completedProjects}</p>
        </div>

        <div className="bg-white p-5 border border-slate-200 border-l-4 border-l-indigo-700 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-slate-500">{t("Avg. Requirement Coverage")}</span>
            <ShieldCheck className="w-4 h-4 text-indigo-600" aria-hidden="true" />
          </div>
          <p className="text-3xl font-bold text-slate-900">
            {avgCoverage !== null ? `${avgCoverage}%` : "—"}
          </p>
          {avgCoverage === null && (
            <p className="text-xs text-slate-500">
              {t("Appears after you run an AI compliance check.")}
            </p>
          )}
        </div>
      </div>

      {/* Projects */}
      <div className="space-y-4">
        <div className="flex items-baseline justify-between border-l-4 border-indigo-600 pl-3">
          <h2 className="text-xl font-semibold text-indigo-600">{t("Your Projects")}</h2>
          <span className="text-xs text-slate-500">{t("Stored in this browser only")}</span>
        </div>

        {projects.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 p-12 text-center space-y-3">
            <Sparkles className="w-10 h-10 text-indigo-500 mx-auto" aria-hidden="true" />
            <h3 className="text-base font-semibold text-slate-800">{t("No grant projects found")}</h3>
            <p className="text-sm text-slate-600 max-w-sm mx-auto">
              {t(
                "Get started by uploading a grant guideline and building your first section-by-section proposal.",
              )}
            </p>
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition mt-2"
            >
              <PlusCircle className="w-4 h-4" aria-hidden="true" />
              {t("Create Project")}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((proj) => {
              const progress = getProgress(proj);
              const stage = getStage(proj, t);
              const days = daysUntil(proj.deadline);
              const q = `?project=${encodeURIComponent(proj.id)}`;
              const percent =
                progress.total === 0
                  ? 0
                  : Math.round((progress.approved / progress.total) * 100);

              return (
                <div
                  key={proj.id}
                  className="bg-white p-5 border border-slate-200 hover:border-indigo-500 transition flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-xs font-semibold text-indigo-600 truncate">
                        {proj.grantName || t("Grant Project")}
                      </span>
                      <button
                        onClick={(e) => handleDeleteProject(proj, e)}
                        className="text-slate-400 hover:text-red-600 transition p-1"
                        title={t("Delete project")}
                        aria-label={t("Delete {title}", { title: proj.title })}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                    <h3 className="font-bold text-slate-900 text-base leading-snug">
                      {proj.title}
                    </h3>
                    <p className="text-sm text-slate-600 line-clamp-2">
                      {proj.projectBrief.problem || t("No problem statement specified.")}
                    </p>
                    {proj.deadline && (
                      <p
                        className={`text-xs flex items-center gap-1 ${
                          days !== null && days <= 7 ? "text-amber-700 font-medium" : "text-slate-600"
                        }`}
                      >
                        <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
                        {t("Deadline: {date}", { date: proj.deadline })}
                        {days !== null && days >= 0
                          ? ` (${t(days === 1 ? "{n} day left" : "{n} days left", { n: days })})`
                          : ""}
                        {days !== null && days < 0 ? ` (${t("passed")})` : ""}
                      </p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs gap-2">
                        <span className="text-slate-700 font-medium">{stage.label}</span>
                        <span className="text-slate-500 shrink-0">
                          {t("{approved}/{total} approved", {
                            approved: progress.approved,
                            total: progress.total,
                          })}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-200">
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs gap-2">
                      <div className="flex gap-4 text-slate-600">
                        <Link href={`/prompt-studio${q}`} className="hover:text-indigo-600 hover:underline">
                          {t("Prompts")}
                        </Link>
                        <Link href={`/compliance${q}`} className="hover:text-indigo-600 hover:underline">
                          {t("Compliance")}
                        </Link>
                      </div>
                      <Link
                        href={stage.href}
                        className="inline-flex items-center gap-1 font-semibold text-indigo-600 hover:text-indigo-800"
                      >
                        {t("Continue")}
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const t = useT(zh);
  const isClient = useIsClient();
  if (!isClient) {
    return <p className="text-sm text-slate-500">{t("Loading projects...")}</p>;
  }
  return <DashboardContent />;
}