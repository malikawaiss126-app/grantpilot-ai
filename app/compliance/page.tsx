"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  Download,
  RefreshCw,
  GitCompare,
  ListChecks,
  FolderPlus,
  ArrowRight,
  AlertCircle,
  X,
  Info,
  FileDown,
} from "lucide-react";
import type { GrantProject } from "@/types/project";
import type {
  ComplianceReport,
  ConsistencyReport,
  ConsistencyStatus,
  RequirementStatus,
  RuleCheck,
} from "@/types/compliance";
import { projectStore } from "@/lib/storage/projectStore";
import {
  runDeterministicChecks,
  summarizeChecks,
} from "@/lib/compliance/deterministicChecks";
import { safeFileBase } from "@/lib/export/documentText";
import { printProposalAsPdf } from "@/lib/export/printPdf";
import { useApp, useT } from "@/components/providers/app-provider";
import type { Dict } from "@/lib/i18n";

// Chinese text for this page. The English sentence is the key.
const zh: Dict = {
  "Compliance & Final Review": "合规检查与最终审核",
  Generation: "内容生成",
  "Run AI Compliance Check": "运行 AI 合规检查",
  "Run Consistency Check": "运行一致性检查",
  "Generate at least two sections first": "请先至少生成两个章节",
  "Export anyway (DOCX)": "仍然导出（DOCX）",
  "Export to DOCX": "导出为 DOCX",
  "Export anyway (PDF)": "仍然导出（PDF）",
  "Export to PDF": "导出为 PDF",
  "In the print window, choose “Save as PDF” as the destination.":
    "在打印窗口中，请将“目标打印机”选择为“另存为 PDF”。",
  "PDF export is not supported in this browser.": "此浏览器不支持导出 PDF。",
  "Dismiss error": "关闭错误提示",
  "No sections have been generated yet, so there is nothing to review.":
    "尚未生成任何章节，因此没有可审核的内容。",
  "Go to Generation": "前往内容生成",

  // Verdict
  "Not ready for export": "尚不能导出",
  "{n} rule check failed. Fix them in the Generation workspace first.":
    "有 {n} 项规则检查未通过。请先在内容生成工作台中修复。",
  "{n} rule checks failed. Fix them in the Generation workspace first.":
    "有 {n} 项规则检查未通过。请先在内容生成工作台中修复。",
  "Rule checks passed. AI review not complete":
    "规则检查已通过，但 AI 审核尚未完成",
  "Run the AI compliance and consistency checks for a full review before exporting.":
    "导出前，请运行 AI 合规检查和一致性检查，完成完整审核。",
  "Review recommended before export": "建议在导出前再审核一次",
  "The proposal changed after an AI check. Run the checks again.":
    "申请书在 AI 检查之后发生了变化。请重新运行检查。",
  "The AI review found requirements that are only partly met or inconsistencies you may want to fix.":
    "AI 审核发现有部分满足的要求，或存在您可能想要修复的不一致之处。",
  "Ready for export": "可以导出",
  "All checks passed. These checks cannot guarantee funding, so read the final text yourself before submitting.":
    "所有检查均已通过。这些检查无法保证获得资助，因此提交前请您亲自通读最终文本。",
  "Rule checks: {passed} passed, {warnings} warning, {failed} failed":
    "规则检查：{passed} 项通过，{warnings} 项警告，{failed} 项未通过",
  "Rule checks: {passed} passed, {warnings} warnings, {failed} failed":
    "规则检查：{passed} 项通过，{warnings} 项警告，{failed} 项未通过",
  "Sections approved: {done} of {total}": "已批准章节：{done} / {total}",
  "Guideline requirements: ": "指南要求：",
  "{a} satisfied, {b} partial, {c} missing":
    "{a} 项满足，{b} 项部分满足，{c} 项缺失",
  "not checked yet": "尚未检查",
  "Consistency: ": "一致性：",
  "{score}% ({n} inconsistent)": "{score}%（{n} 项不一致）",

  // Score cards
  "Rule Checks": "规则检查",
  "{passed} of {total} automatic checks passed (word limits, required sections, missing information). Calculated by code, not AI.":
    "{total} 项自动检查中有 {passed} 项通过（字数上限、必填章节、缺失信息）。由程序计算，非 AI 判断。",
  "Requirement Coverage": "要求覆盖率",
  "Not run": "未运行",
  "AI judgement of whether the text meets each guideline requirement (satisfied = 100, partial = 50, missing = 0).":
    "AI 判断文本是否满足每一项指南要求（满足 = 100，部分满足 = 50，缺失 = 0）。",
  "Run the AI Compliance Check to compare your text with the guideline requirements.":
    "运行 AI 合规检查，将您的文本与指南要求进行对照。",
  Consistency: "一致性",
  "Whether sections agree on title, objectives, timeline, budget and duration (consistent = 100, minor issue = 70, inconsistent = 20).":
    "各章节在标题、目标、时间表、预算和周期上是否一致（一致 = 100，轻微问题 = 70，不一致 = 20）。",
  "Run the Consistency Check to compare sections against each other.":
    "运行一致性检查，对各章节进行相互对照。",
  "Out of date: sections changed since this check. Run it again.":
    "已过期：自上次检查后章节发生了变化。请重新运行。",

  // Rule checks
  "Automatic Rule Checks": "自动规则检查",
  "Whole proposal": "整份申请书",
  "Required sections included": "已包含必填章节",
  "Submission deadline": "提交截止日期",
  "Supporting documents": "辅助文件",
  "content written": "内容已撰写",
  "word limit": "字数上限",
  "character limit": "字符数上限",
  "no missing information": "无缺失信息",
  "reviewed and approved": "已审阅并批准",

  // AI requirement matrix
  "Guideline Requirement Matrix": "指南要求对照表",
  "Not checked yet. Run the AI Compliance Check to see which guideline requirements are satisfied, partial or missing.":
    "尚未检查。运行 AI 合规检查，查看哪些指南要求已满足、部分满足或缺失。",
  "The guideline lists no requirements for the generated sections, so there was nothing to compare.":
    "指南没有列出已生成章节的要求，因此没有可对照的内容。",
  "{n} satisfied": "{n} 项满足",
  "{n} partial": "{n} 项部分满足",
  "{n} missing": "{n} 项缺失",
  "Evidence: ": "依据：",
  "Recommended action: ": "建议措施：",

  // Consistency
  "Cross-Section Consistency": "跨章节一致性",
  "Not checked yet. Generate at least two sections, then run the Consistency Check.":
    "尚未检查。请先生成至少两个章节，再运行一致性检查。",
  "Project title consistency": "项目名称一致性",
  "Objectives consistency": "目标一致性",
  "Methodology ↔ objectives alignment": "研究方法与目标的契合度",
  "Timeline ↔ methodology alignment": "时间表与研究方法的契合度",
  "Budget ↔ deliverables alignment": "预算与成果的契合度",
  "Terminology consistency": "术语一致性",
  "Project duration consistency": "项目周期一致性",
  "Contradictory claims": "相互矛盾的表述",
  Consistent: "一致",
  "Minor issue": "轻微问题",
  Inconsistent: "不一致",
  "Not applicable": "不适用",
  "Sections: {list}": "相关章节：{list}",
  "Contradictions found": "发现的矛盾",
  "Suggested fix: ": "建议修复：",
  Recommendations: "建议",

  // Messages
  "The request failed. Please try again.": "请求失败，请重试。",
  "Compliance check failed.": "合规检查失败。",
  "Consistency check failed.": "一致性检查失败。",
  "Export failed. Please try again.": "导出失败，请重试。",
  "Export failed.": "导出失败。",
  "No project to review yet": "还没有可审核的项目",
  "Create a project and generate its sections first, then come back to verify them against the guideline.":
    "请先创建项目并生成各章节，然后回到这里对照指南进行核查。",
  "Create a project": "创建项目",
  "Loading project...": "正在加载项目...",
};

// Texts of the automatic rule checks are produced by code (English). For
// Chinese they are matched by pattern and shown through the dictionary below.
const zhRules: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /^The guideline marks these sections as required, but they are turned off: (.*)\.$/,
    (m) => `指南要求以下章节必填，但它们已被关闭：${m[1]}。`,
  ],
  [
    /^Every required section from the guideline is included\.$/,
    () => "指南中的所有必填章节均已包含。",
  ],
  [
    /^The deadline \((.*)\) appears to have passed\. Check whether it was extended\.$/,
    (m) => `截止日期（${m[1]}）似乎已过。请确认是否已延期。`,
  ],
  [
    /^The deadline \((.*)\) is in (\d+) days?\.$/,
    (m) => `距离截止日期（${m[1]}）还有 ${m[2]} 天。`,
  ],
  [
    /^GrantPilot does not create attachments\. Prepare these separately: (.*)\.$/,
    (m) => `GrantPilot 不会生成附件。请另行准备：${m[1]}。`,
  ],
  [
    /^This required section has not been generated yet\.$/,
    () => "这个必填章节尚未生成。",
  ],
  [
    /^This optional section has not been generated yet\.$/,
    () => "这个可选章节尚未生成。",
  ],
  [/^Content is present\.$/, () => "已有内容。"],
  [
    /^(\d+) words, which is (\d+) over the (\d+)-word limit\.$/,
    (m) => `共 ${m[1]} 个单词，超出 ${m[3]} 个单词的上限 ${m[2]} 个。`,
  ],
  [/^(\d+) of (\d+) words\.$/, (m) => `${m[1]} / ${m[2]} 个单词。`],
  [
    /^(\d+) characters, which is (\d+) over the (\d+)-character limit\.$/,
    (m) => `共 ${m[1]} 个字符，超出 ${m[3]} 个字符的上限 ${m[2]} 个。`,
  ],
  [/^(\d+) of (\d+) characters\.$/, (m) => `${m[1]} / ${m[2]} 个字符。`],
  [
    /^(\d+) placeholder\(s\) still need your input: (.*)$/,
    (m) => `仍有 ${m[1]} 个占位符需要您补充信息：${m[2]}`,
  ],
  [/^No unresolved placeholders\.$/, () => "没有未处理的占位符。"],
  [/^Approved by you\.$/, () => "已由您批准。"],
  [
    /^Not approved yet\. Review the text and approve it in the Generation workspace\.$/,
    () => "尚未批准。请审阅文本，并在内容生成工作台中批准。",
  ],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return (
    (requestedId ? all.find((p) => p.id === requestedId) : undefined) ??
    all[all.length - 1] ??
    null
  );
}

/** Fingerprint of the proposal text, used to detect out-of-date AI reports. */
function signatureOf(project: GrantProject): string {
  const text = project.sections
    .filter((s) => s.enabled)
    .map((s) => `${s.id}\u0001${s.generatedContent ?? ""}`)
    .join("\u0002");
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return String(hash);
}

type ReportKind = "compliance" | "consistency";
const sigKey = (projectId: string, kind: ReportKind) =>
  `grantpilot_report_sig_${projectId}_${kind}`;

function readSignature(projectId: string, kind: ReportKind): string | null {
  try {
    return window.localStorage.getItem(sigKey(projectId, kind));
  } catch {
    return null;
  }
}

function writeSignature(projectId: string, kind: ReportKind, sig: string) {
  try {
    window.localStorage.setItem(sigKey(projectId, kind), sig);
  } catch {
    // non-fatal: the report will simply be shown as possibly out of date
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: { success?: boolean; data?: T; error?: string } = {};
  try {
    json = await response.json();
  } catch {
    // handled below
  }
  if (!response.ok || !json.success || !json.data) {
    throw new Error(json.error ?? "The request failed. Please try again.");
  }
  return json.data;
}

const scoreColor = (score: number) =>
  score >= 85
    ? "text-emerald-600"
    : score >= 60
      ? "text-amber-600"
      : "text-red-600";
const barColor = (score: number) =>
  score >= 85 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";

function RuleIcon({ status }: { status: RuleCheck["status"] }) {
  if (status === "pass")
    return (
      <CheckCircle2
        className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"
        aria-hidden="true"
      />
    );
  if (status === "warning")
    return (
      <AlertTriangle
        className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
        aria-hidden="true"
      />
    );
  return (
    <XCircle
      className="w-4 h-4 text-red-600 shrink-0 mt-0.5"
      aria-hidden="true"
    />
  );
}

function RequirementIcon({ status }: { status: RequirementStatus }) {
  if (status === "satisfied")
    return (
      <CheckCircle2
        className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"
        aria-hidden="true"
      />
    );
  if (status === "partial")
    return (
      <AlertTriangle
        className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
        aria-hidden="true"
      />
    );
  return (
    <XCircle
      className="w-4 h-4 text-red-600 shrink-0 mt-0.5"
      aria-hidden="true"
    />
  );
}

const CONSISTENCY_LABELS: Record<
  ConsistencyStatus,
  { text: string; cls: string }
> = {
  consistent: { text: "Consistent", cls: "bg-emerald-100 text-emerald-800" },
  minor_issue: { text: "Minor issue", cls: "bg-amber-100 text-amber-800" },
  inconsistent: { text: "Inconsistent", cls: "bg-red-100 text-red-800" },
  not_applicable: {
    text: "Not applicable",
    cls: "bg-slate-100 text-slate-600",
  },
};

function ScoreCard(props: {
  title: string;
  value: string;
  score?: number;
  explanation: string;
  stale?: boolean;
}) {
  const t = useT(zh);
  return (
    <div className="bg-white p-5 border border-slate-200 border-t-4 border-t-indigo-600 space-y-2">
      <p className="text-sm font-semibold text-slate-700">{props.title}</p>
      <p
        className={`text-3xl font-bold ${props.score === undefined ? "text-slate-500" : scoreColor(props.score)}`}
      >
        {props.value}
      </p>
      {props.score !== undefined && (
        <div className="h-1.5 bg-slate-200 rounded-sm overflow-hidden">
          <div
            className={`h-full ${barColor(props.score)}`}
            style={{ width: `${props.score}%` }}
          />
        </div>
      )}
      <p className="text-xs text-slate-600">{props.explanation}</p>
      {props.stale && (
        <p className="text-xs text-amber-700 font-medium">
          {t("Out of date: sections changed since this check. Run it again.")}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

function ComplianceWorkspace({ requestedId }: { requestedId: string | null }) {
  const t = useT(zh);
  const { lang, locale } = useApp();
  const [project, setProject] = useState<GrantProject | null>(() =>
    loadInitialProject(requestedId),
  );
  const [signatures, setSignatures] = useState<
    Record<ReportKind, string | null>
  >(() => {
    const p = loadInitialProject(requestedId);
    return {
      compliance: p ? readSignature(p.id, "compliance") : null,
      consistency: p ? readSignature(p.id, "consistency") : null,
    };
  });
  const [busy, setBusy] = useState<ReportKind | "export" | "pdf" | null>(
    null,
  );
  // Stored in English and translated when shown, so switching language updates it.
  const [error, setError] = useState<string | null>(null);

  // Persist reports (and anything else changed here) with the project.
  useEffect(() => {
    if (!project) return;
    try {
      projectStore.saveProject(project);
    } catch (err) {
      console.error("Autosave failed:", err);
    }
  }, [project]);

  const checks = useMemo(
    () => (project ? runDeterministicChecks(project) : []),
    [project],
  );
  const summary = useMemo(() => summarizeChecks(checks), [checks]);

  /** Text of an automatic rule check in the current language. */
  const ruleDetail = (detail: string): string => {
    if (lang !== "zh") return detail;
    for (const [pattern, build] of zhRules) {
      const m = detail.match(pattern);
      if (m) return build(m);
    }
    return detail;
  };

  if (!project) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center space-y-4">
        <FolderPlus
          className="w-10 h-10 text-indigo-500 mx-auto"
          aria-hidden="true"
        />
        <h1 className="text-xl font-bold text-slate-900">
          {t("No project to review yet")}
        </h1>
        <p className="text-sm text-slate-600">
          {t(
            "Create a project and generate its sections first, then come back to verify them against the guideline.",
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

  const currentSig = signatureOf(project);
  const compliance = project.reports?.compliance;
  const consistency = project.reports?.consistency;
  const complianceStale = !!compliance && signatures.compliance !== currentSig;
  const consistencyStale =
    !!consistency && signatures.consistency !== currentSig;

  const generatedCount = project.sections.filter(
    (s) => s.enabled && s.generatedContent?.trim(),
  ).length;
  const canRunCompliance = generatedCount >= 1;
  const canRunConsistency = generatedCount >= 2;
  const projectQuery = `?project=${encodeURIComponent(project.id)}`;

  // --- Actions ---------------------------------------------------------------

  const projectForApi = { ...project, reports: undefined };

  const runCompliance = async () => {
    setBusy("compliance");
    setError(null);
    try {
      const report = await postJson<ComplianceReport>("/api/compliance", {
        project: projectForApi,
      });
      writeSignature(project.id, "compliance", currentSig);
      setSignatures((s) => ({ ...s, compliance: currentSig }));
      setProject((p) =>
        p ? { ...p, reports: { ...p.reports, compliance: report } } : p,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compliance check failed.");
    } finally {
      setBusy(null);
    }
  };

  const runConsistency = async () => {
    setBusy("consistency");
    setError(null);
    try {
      const report = await postJson<ConsistencyReport>(
        "/api/projects/consistency",
        { project: projectForApi },
      );
      writeSignature(project.id, "consistency", currentSig);
      setSignatures((s) => ({ ...s, consistency: currentSig }));
      setProject((p) =>
        p ? { ...p, reports: { ...p.reports, consistency: report } } : p,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Consistency check failed.",
      );
    } finally {
      setBusy(null);
    }
  };

  const exportDocx = async () => {
    setBusy("export");
    setError(null);
    try {
      const response = await fetch("/api/export/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectForApi }),
      });
      if (!response.ok) {
        let message = "Export failed. Please try again.";
        try {
          const json = (await response.json()) as { error?: string };
          if (json.error) message = json.error;
        } catch {
          // keep default message
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Keeps letters of any script (e.g. Chinese titles).
      a.download = `${safeFileBase(project.title)}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = async () => {
    setBusy("pdf");
    setError(null);
    try {
      await printProposalAsPdf(projectForApi);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  // --- Derived numbers -----------------------------------------------------------

  const allRequirements =
    compliance?.sections.flatMap((s) => s.requirements) ?? [];
  const reqCounts = {
    satisfied: allRequirements.filter((r) => r.status === "satisfied").length,
    partial: allRequirements.filter((r) => r.status === "partial").length,
    missing: allRequirements.filter((r) => r.status === "missing").length,
  };
  const inconsistentCount =
    consistency?.checks.filter((c) => c.status === "inconsistent").length ?? 0;

  const approvedCount = project.sections.filter(
    (s) => s.enabled && s.status === "approved",
  ).length;
  const enabledCount = project.sections.filter((s) => s.enabled).length;

  const rulePercent =
    summary.total === 0
      ? 0
      : Math.round((summary.passed / summary.total) * 100);

  // Final verdict: never claims more than what was actually verified.
  type Verdict = {
    tone: "red" | "amber" | "blue" | "green";
    title: string;
    text: string;
  };
  let verdict: Verdict;
  if (summary.failed > 0) {
    verdict = {
      tone: "red",
      title: t("Not ready for export"),
      text: t(
        summary.failed === 1
          ? "{n} rule check failed. Fix them in the Generation workspace first."
          : "{n} rule checks failed. Fix them in the Generation workspace first.",
        { n: summary.failed },
      ),
    };
  } else if (!compliance || !consistency) {
    verdict = {
      tone: "blue",
      title: t("Rule checks passed. AI review not complete"),
      text: t(
        "Run the AI compliance and consistency checks for a full review before exporting.",
      ),
    };
  } else if (
    reqCounts.missing > 0 ||
    reqCounts.partial > 0 ||
    inconsistentCount > 0 ||
    complianceStale ||
    consistencyStale
  ) {
    verdict = {
      tone: "amber",
      title: t("Review recommended before export"),
      text:
        complianceStale || consistencyStale
          ? t("The proposal changed after an AI check. Run the checks again.")
          : t(
              "The AI review found requirements that are only partly met or inconsistencies you may want to fix.",
            ),
    };
  } else {
    verdict = {
      tone: "green",
      title: t("Ready for export"),
      text: t(
        "All checks passed. These checks cannot guarantee funding, so read the final text yourself before submitting.",
      ),
    };
  }

  const verdictStyles: Record<Verdict["tone"], string> = {
    red: "bg-red-50 border-red-200 border-l-red-600 text-red-900",
    amber: "bg-amber-50 border-amber-200 border-l-amber-600 text-amber-900",
    blue: "bg-indigo-50 border-indigo-200 border-l-indigo-600 text-indigo-900",
    green:
      "bg-emerald-50 border-emerald-200 border-l-emerald-600 text-emerald-900",
  };

  const sectionTitle = (id: string) =>
    project.sections.find((s) => s.id === id)?.title ?? id;

  const projectChecks = checks.filter((c) => !c.sectionId);
  const sectionIdsWithChecks = [
    ...new Set(checks.filter((c) => c.sectionId).map((c) => c.sectionId!)),
  ];

  const secondaryButton =
    "flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 transition disabled:opacity-50";
  const panel = "bg-white p-6 border border-slate-200 space-y-4";
  const panelTitle =
    "text-base font-bold text-indigo-600 border-l-4 border-indigo-600 pl-2";

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b-2 border-indigo-600 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-indigo-600 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6" aria-hidden="true" />
            {t("Compliance & Final Review")}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {project.title}
            {project.grantName ? ` · ${project.grantName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`/generation${projectQuery}`} className={secondaryButton}>
            {t("Generation")}
          </Link>
          <button
            onClick={runCompliance}
            disabled={busy !== null || !canRunCompliance}
            className={secondaryButton}
          >
            {busy === "compliance" ? (
              <RefreshCw
                className="w-4 h-4 animate-spin text-indigo-600"
                aria-hidden="true"
              />
            ) : (
              <ListChecks
                className="w-4 h-4 text-indigo-600"
                aria-hidden="true"
              />
            )}
            {t("Run AI Compliance Check")}
          </button>
          <button
            onClick={runConsistency}
            disabled={busy !== null || !canRunConsistency}
            title={
              canRunConsistency
                ? undefined
                : t("Generate at least two sections first")
            }
            className={secondaryButton}
          >
            {busy === "consistency" ? (
              <RefreshCw
                className="w-4 h-4 animate-spin text-indigo-600"
                aria-hidden="true"
              />
            ) : (
              <GitCompare
                className="w-4 h-4 text-indigo-600"
                aria-hidden="true"
              />
            )}
            {t("Run Consistency Check")}
          </button>
          <button
            onClick={exportDocx}
            disabled={busy !== null || generatedCount === 0}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {busy === "export" ? (
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-4 h-4" aria-hidden="true" />
            )}
            {summary.failed > 0
              ? t("Export anyway (DOCX)")
              : t("Export to DOCX")}
          </button>
          <button
            onClick={exportPdf}
            disabled={busy !== null || generatedCount === 0}
            title={t(
              "In the print window, choose “Save as PDF” as the destination.",
            )}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {busy === "pdf" ? (
              <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileDown className="w-4 h-4" aria-hidden="true" />
            )}
            {summary.failed > 0
              ? t("Export anyway (PDF)")
              : t("Export to PDF")}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-sm text-red-700"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1">{t(error)}</span>
          <button
            onClick={() => setError(null)}
            aria-label={t("Dismiss error")}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {generatedCount === 0 && (
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-700 flex items-center justify-between gap-3">
          <span>
            {t(
              "No sections have been generated yet, so there is nothing to review.",
            )}
          </span>
          <Link
            href={`/generation${projectQuery}`}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-medium hover:bg-indigo-700"
          >
            {t("Go to Generation")}
          </Link>
        </div>
      )}

      {/* Final verdict */}
      <div className={`p-5 border border-l-4 ${verdictStyles[verdict.tone]}`}>
        <h2 className="text-lg font-bold">{verdict.title}</h2>
        <p className="text-sm mt-1">{verdict.text}</p>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <li>
            {t(
              summary.warnings === 1
                ? "Rule checks: {passed} passed, {warnings} warning, {failed} failed"
                : "Rule checks: {passed} passed, {warnings} warnings, {failed} failed",
              {
                passed: summary.passed,
                warnings: summary.warnings,
                failed: summary.failed,
              },
            )}
          </li>
          <li>
            {t("Sections approved: {done} of {total}", {
              done: approvedCount,
              total: enabledCount,
            })}
          </li>
          <li>
            {t("Guideline requirements: ")}
            {compliance
              ? t("{a} satisfied, {b} partial, {c} missing", {
                  a: reqCounts.satisfied,
                  b: reqCounts.partial,
                  c: reqCounts.missing,
                })
              : t("not checked yet")}
          </li>
          <li>
            {t("Consistency: ")}
            {consistency
              ? t("{score}% ({n} inconsistent)", {
                  score: consistency.overallScore,
                  n: inconsistentCount,
                })
              : t("not checked yet")}
          </li>
        </ul>
      </div>

      {/* Score cards, each with its explanation (PRD §61) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ScoreCard
          title={t("Rule Checks")}
          value={summary.total === 0 ? "—" : `${rulePercent}%`}
          score={summary.total === 0 ? undefined : rulePercent}
          explanation={t(
            "{passed} of {total} automatic checks passed (word limits, required sections, missing information). Calculated by code, not AI.",
            { passed: summary.passed, total: summary.total },
          )}
        />
        <ScoreCard
          title={t("Requirement Coverage")}
          value={compliance ? `${compliance.overallScore}%` : t("Not run")}
          score={compliance?.overallScore}
          explanation={
            compliance
              ? t(
                  "AI judgement of whether the text meets each guideline requirement (satisfied = 100, partial = 50, missing = 0).",
                )
              : t(
                  "Run the AI Compliance Check to compare your text with the guideline requirements.",
                )
          }
          stale={complianceStale}
        />
        <ScoreCard
          title={t("Consistency")}
          value={consistency ? `${consistency.overallScore}%` : t("Not run")}
          score={consistency?.overallScore}
          explanation={
            consistency
              ? t(
                  "Whether sections agree on title, objectives, timeline, budget and duration (consistent = 100, minor issue = 70, inconsistent = 20).",
                )
              : t(
                  "Run the Consistency Check to compare sections against each other.",
                )
          }
          stale={consistencyStale}
        />
      </div>

      {/* Rule checks */}
      <div className={panel}>
        <h2 className={panelTitle}>{t("Automatic Rule Checks")}</h2>

        {projectChecks.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold text-slate-700">
              {t("Whole proposal")}
            </h3>
            {projectChecks.map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-sm">
                <RuleIcon status={c.status} />
                <div>
                  <span className="font-medium text-slate-900">
                    {t(c.label)}.{" "}
                  </span>
                  <span className="text-slate-700">{ruleDetail(c.detail)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {sectionIdsWithChecks.map((sid) => {
          const sectionChecks = checks.filter((c) => c.sectionId === sid);
          const worst = sectionChecks.some((c) => c.status === "fail")
            ? "fail"
            : sectionChecks.some((c) => c.status === "warning")
              ? "warning"
              : "pass";
          return (
            <div key={sid} className="space-y-1.5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <RuleIcon status={worst} />
                {sectionTitle(sid)}
              </h3>
              <div className="pl-6 space-y-1">
                {sectionChecks.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 text-xs">
                    <RuleIcon status={c.status} />
                    <div>
                      <span className="font-medium text-slate-900">
                        {t(c.label.replace(`${sectionTitle(sid)}: `, ""))}.{" "}
                      </span>
                      <span className="text-slate-700">
                        {ruleDetail(c.detail)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* AI requirement matrix */}
      <div className={panel}>
        <div className="flex items-center justify-between gap-3">
          <h2 className={panelTitle}>{t("Guideline Requirement Matrix")}</h2>
          {compliance && (
            <span className="text-xs text-slate-600">
              {compliance.model} ·{" "}
              {new Date(compliance.generatedAt).toLocaleString(locale)}
            </span>
          )}
        </div>

        {!compliance ? (
          <p className="text-sm text-slate-700 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            {t(
              "Not checked yet. Run the AI Compliance Check to see which guideline requirements are satisfied, partial or missing.",
            )}
          </p>
        ) : compliance.sections.length === 0 ? (
          <p className="text-sm text-slate-700 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            {t(
              "The guideline lists no requirements for the generated sections, so there was nothing to compare.",
            )}
          </p>
        ) : (
          <div className={`space-y-5 ${complianceStale ? "opacity-60" : ""}`}>
            <div className="flex gap-4 text-xs font-semibold">
              <span className="text-emerald-700">
                {t("{n} satisfied", { n: reqCounts.satisfied })}
              </span>
              <span className="text-amber-700">
                {t("{n} partial", { n: reqCounts.partial })}
              </span>
              <span className="text-red-700">
                {t("{n} missing", { n: reqCounts.missing })}
              </span>
            </div>
            {compliance.sections.map((sec) => (
              <div key={sec.sectionId} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    {sec.sectionTitle}
                  </h3>
                  <div className="flex items-center gap-2 w-40">
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-sm overflow-hidden">
                      <div
                        className={`h-full ${barColor(sec.score)}`}
                        style={{ width: `${sec.score}%` }}
                      />
                    </div>
                    <span
                      className={`text-xs font-semibold ${scoreColor(sec.score)}`}
                    >
                      {sec.score}%
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  {sec.requirements.map((req, i) => (
                    <details
                      key={i}
                      className="group border border-slate-200 rounded-md px-3 py-2 text-sm"
                      open={req.status !== "satisfied"}
                    >
                      <summary className="flex items-start gap-2 cursor-pointer list-none">
                        <RequirementIcon status={req.status} />
                        <span className="text-slate-900">
                          {req.requirement}
                        </span>
                      </summary>
                      <div className="mt-2 pl-6 space-y-1 text-xs">
                        {req.evidence && (
                          <p className="text-slate-700">
                            <span className="font-semibold">
                              {t("Evidence: ")}
                            </span>
                            {req.evidence}
                          </p>
                        )}
                        {req.recommendation && (
                          <p className="text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-sm p-2">
                            <span className="font-semibold">
                              {t("Recommended action: ")}
                            </span>
                            {req.recommendation}
                          </p>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Consistency report */}
      <div className={panel}>
        <div className="flex items-center justify-between gap-3">
          <h2 className={panelTitle}>{t("Cross-Section Consistency")}</h2>
          {consistency && (
            <span className="text-xs text-slate-600">
              {consistency.model} ·{" "}
              {new Date(consistency.generatedAt).toLocaleString(locale)}
            </span>
          )}
        </div>

        {!consistency ? (
          <p className="text-sm text-slate-700 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            {t(
              "Not checked yet. Generate at least two sections, then run the Consistency Check.",
            )}
          </p>
        ) : (
          <div className={`space-y-5 ${consistencyStale ? "opacity-60" : ""}`}>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
              {consistency.checks.map((c) => {
                const label = CONSISTENCY_LABELS[c.status];
                return (
                  <div
                    key={c.id}
                    className="p-3 flex items-start gap-3 text-sm"
                  >
                    {c.status === "not_applicable" ? (
                      <MinusCircle
                        className="w-4 h-4 text-slate-500 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    ) : c.status === "consistent" ? (
                      <CheckCircle2
                        className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    ) : c.status === "minor_issue" ? (
                      <AlertTriangle
                        className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle
                        className="w-4 h-4 text-red-600 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-900">
                          {t(c.label)}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-sm font-semibold ${label.cls}`}
                        >
                          {t(label.text)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 mt-0.5">
                        {c.explanation}
                      </p>
                      {c.sections.length > 0 && (
                        <p className="text-xs text-slate-600 mt-0.5">
                          {t("Sections: {list}", {
                            list: c.sections.join(", "),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {consistency.contradictions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t("Contradictions found")}
                </h3>
                {consistency.contradictions.map((c, i) => (
                  <div
                    key={i}
                    className="p-3 border border-red-200 bg-red-50 rounded-md text-xs space-y-1"
                  >
                    <p className="text-red-900 font-medium">{c.description}</p>
                    {c.sections.length > 0 && (
                      <p className="text-red-700">
                        {t("Sections: {list}", { list: c.sections.join(", ") })}
                      </p>
                    )}
                    {c.suggestedFix && (
                      <p className="text-slate-800">
                        <span className="font-semibold">
                          {t("Suggested fix: ")}
                        </span>
                        {c.suggestedFix}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {consistency.recommendations.length > 0 && (
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-slate-900">
                  {t("Recommendations")}
                </h3>
                <ul className="list-disc pl-5 text-xs text-slate-700 space-y-0.5">
                  {consistency.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LoadingText({ text }: { text: "Loading project..." | "Loading..." }) {
  const t = useT(zh);
  return <p className="text-sm text-slate-600">{t(text)}</p>;
}

function ComplianceGate() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("project");
  const isClient = useIsClient();

  if (!isClient) {
    return <LoadingText text="Loading project..." />;
  }
  return (
    <ComplianceWorkspace
      key={requestedId ?? "latest"}
      requestedId={requestedId}
    />
  );
}

export default function CompliancePage() {
  return (
    <Suspense fallback={<LoadingText text="Loading..." />}>
      <ComplianceGate />
    </Suspense>
  );
}
