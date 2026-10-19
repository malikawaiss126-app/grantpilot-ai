"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  FileText,
  ArrowRight,
  Loader2,
  Target,
  AlertCircle,
  CalendarClock,
  Wallet,
  X,
} from "lucide-react";
import { projectStore } from "@/lib/storage/projectStore";
import { useT } from "@/components/providers/app-provider";
import type { Dict } from "@/lib/i18n";
import type { GrantProject } from "@/types/project";
import type { GrantGuideline } from "@/types/guideline";
import type { GrantSection } from "@/types/prompt";

// Chinese text for this page. The English sentence is the key.
const zh: Dict = {
  "Create New Project": "创建新项目",
  "Upload grant guidelines and provide your project context.":
    "上传基金申请指南，并填写您的项目背景信息。",
  "1. Analyze Guidelines": "1. 分析申请指南",
  "2. Project Brief Context": "2. 项目简介",
  "Upload Grant Guideline (PDF, DOCX or TXT)":
    "上传基金申请指南（PDF、DOCX 或 TXT）",
  "Upload grant guideline": "上传基金申请指南",
  "Drag and drop or click to browse. Max size 10MB.":
    "将文件拖到此处，或点击选择文件。最大 10MB。",
  "Privacy note: with the free Gemini tier, uploaded content may be used by Google to improve its products. Avoid uploading highly confidential documents.":
    "隐私提示：使用 Gemini 免费版时，上传的内容可能会被 Google 用于改进其产品。请勿上传高度机密的文件。",
  "Extract Requirements": "提取要求",
  "Analyzing guideline... {n}s": "正在分析指南... {n} 秒",
  "Long documents can take up to a minute. You can cancel and try again at any time.":
    "较长的文档最多可能需要一分钟。您可以随时取消并重试。",
  "Extracted: {name}": "已提取：{name}",
  "Found {n} application sections.": "共找到 {n} 个申请章节。",
  "Deadline: {date}": "截止日期：{date}",
  "Funding: {amount}": "资助金额：{amount}",
  "Proposal language: {lang}": "申请书语言：{lang}",
  "Chinese (Simplified)": "简体中文",
  "Chinese (Traditional)": "繁体中文",
  English: "英文",
  Japanese: "日文",
  Korean: "韩文",
  "Sections to generate": "要生成的章节",
  "{n} words": "{n} 字",
  "no limit": "不限字数",
  "Project Title *": "项目名称 *",
  "e.g., AI-Based Early Flood Risk Prediction Platform":
    "例如：基于人工智能的洪水早期风险预测平台",
  "Applicant Name": "申请人姓名",
  Institution: "所属机构",
  "Problem Statement *": "问题陈述 *",
  "Describe the core problem your project solves...":
    "请描述您的项目要解决的核心问题...",
  "Proposed Solution *": "解决方案 *",
  "Briefly describe your proposed solution...": "请简要描述您的解决方案...",
  "Objectives (one per line)": "项目目标（每行一条）",
  "Build a prediction model\nValidate it with regional data":
    "构建预测模型\n用区域数据验证模型",
  Methodology: "研究方法",
  "How will you carry out the work?": "您将如何开展这项工作？",
  "Target Beneficiaries": "目标受益群体",
  "Initialize Project Sandbox": "创建项目",

  // Messages
  "Please choose a guideline file first.": "请先选择指南文件。",
  "The file is larger than 10 MB. Please upload a smaller document.":
    "文件超过 10 MB，请上传更小的文档。",
  "No application sections were detected in this document. Please check that it is the grant guideline and try again.":
    "未在该文档中检测到申请章节。请确认它是基金申请指南后重试。",
  "Failed to analyze the guideline.": "分析指南失败。",
  "Please fill in the project title, problem statement and proposed solution.":
    "请填写项目名称、问题陈述和解决方案。",
  "Enable at least one section to continue.": "请至少启用一个章节后再继续。",
  "The project could not be saved in your browser (storage may be full). Delete old projects and try again.":
    "无法将项目保存到浏览器中（存储空间可能已满）。请删除旧项目后重试。",
  "The analysis took too long and was stopped. Please try again, or upload a shorter guideline.":
    "分析耗时过长，已停止。请重试，或上传篇幅较短的指南。",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
const CLIENT_TIMEOUT_MS = 130_000; // a little longer than the server's own limit

// These are instructions for the AI, so they stay in English on purpose.
const DEFAULT_GLOBAL_PROMPT =
  "Maintain a professional, evidence-backed academic tone. Ensure strict adherence to the provided guideline constraints. Do not invent facts, statistics or citations.";

const DEFAULT_SECTION_PROMPT =
  'Write the "{{section_name}}" section of the grant proposal for the project "{{project_title}}".\n\nProblem: {{problem_statement}}\n\nProposed solution: {{proposed_solution}}\n\nObjectives:\n{{objectives}}\n\nMethodology: {{methodology}}\n\nRespect the word limit ({{word_limit}}) and satisfy these requirements:\n{{section_requirements}}';

interface AnalyzeResponse {
  success?: boolean;
  data?: GrantGuideline;
  error?: string;
}

function toLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export default function NewProjectPage() {
  const t = useT(zh);
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // Stored in English and translated when shown, so switching language updates it.
  const [error, setError] = useState<string | null>(null);

  const [guideline, setGuideline] = useState<GrantGuideline | null>(null);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());

  // Project brief
  const [projectTitle, setProjectTitle] = useState("");
  const [problem, setProblem] = useState("");
  const [solution, setSolution] = useState("");
  const [objectives, setObjectives] = useState("");
  const [methodology, setMethodology] = useState("");
  const [beneficiaries, setBeneficiaries] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [institution, setInstitution] = useState("");

  // Seconds counter shown while the guideline is being analyzed
  useEffect(() => {
    if (!isAnalyzing) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isAnalyzing]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const selected = e.target.files?.[0];
    if (!selected) return;

    const lowerName = selected.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      setFile(null);
      setError("Unsupported file type. Please upload a PDF, DOCX or TXT file.");
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setFile(null);
      setError(
        "The file is larger than 10 MB. Please upload a smaller document.",
      );
      return;
    }
    setFile(selected);
  };

  const cancelAnalysis = () => {
    abortRef.current?.abort();
  };

  const analyzeGuideline = async () => {
    if (!file) {
      setError("Please choose a guideline file first.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CLIENT_TIMEOUT_MS);

    setElapsed(0);
    setIsAnalyzing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/guidelines/analyze", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      let result: AnalyzeResponse = {};
      try {
        result = (await response.json()) as AnalyzeResponse;
      } catch {
        // non-JSON response, handled below
      }

      if (!response.ok || !result.success || !result.data) {
        throw new Error(
          result.error ??
            "The guideline could not be analyzed. Please try again.",
        );
      }

      if (result.data.sections.length === 0) {
        throw new Error(
          "No application sections were detected in this document. Please check that it is the grant guideline and try again.",
        );
      }

      setGuideline(result.data);
      setEnabledIds(new Set(result.data.sections.map((s) => s.id)));
      setStep(2);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Cancelled by the user: say nothing. Stopped by the timer: explain.
        if (timedOut) {
          setError(
            "The analysis took too long and was stopped. Please try again, or upload a shorter guideline.",
          );
        }
      } else {
        console.error("Analysis failed:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to analyze the guideline.",
        );
      }
    } finally {
      clearTimeout(timeoutId);
      abortRef.current = null;
      setIsAnalyzing(false);
    }
  };

  const toggleSection = (id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateProject = () => {
    if (!guideline) return;
    setError(null);

    if (!projectTitle.trim() || !problem.trim() || !solution.trim()) {
      setError(
        "Please fill in the project title, problem statement and proposed solution.",
      );
      return;
    }
    if (enabledIds.size === 0) {
      setError("Enable at least one section to continue.");
      return;
    }

    // Requirements are shown in reports, so they follow the guideline language.
    const mustInclude = /chinese|中文|汉语|漢語/i.test(guideline.language ?? "")
      ? "必须包含："
      : "Must include: ";
    const sections: GrantSection[] = guideline.sections.map((sec) => ({
      id: sec.id,
      title: sec.title,
      order: sec.order,
      required: sec.required,
      wordLimit: sec.wordLimit,
      characterLimit: sec.characterLimit,
      requirements: [
        ...sec.requirements,
        ...sec.requiredElements.map((el) => `${mustInclude}${el}`),
      ],
      evaluationCriteria: sec.evaluationCriteria,
      prompt: DEFAULT_SECTION_PROMPT,
      tone: "academic",
      creativity: "low",
      enabled: enabledIds.has(sec.id),
      status: "draft",
    }));

    const newProject: GrantProject = {
      id: `proj-${crypto.randomUUID()}`,
      title: projectTitle.trim(),
      grantName: guideline.grantName,
      organization: guideline.organization,
      deadline: guideline.deadline,
      fundingLimit: guideline.fundingLimit,
      duration: guideline.duration,
      applicant: {
        name: applicantName.trim() || undefined,
        institution: institution.trim() || undefined,
      },
      projectBrief: {
        problem: problem.trim(),
        proposedSolution: solution.trim(),
        objectives: toLines(objectives),
        methodology: methodology.trim(),
        beneficiaries: beneficiaries.trim() || undefined,
      },
      guideline,
      sections,
      globalPrompt: DEFAULT_GLOBAL_PROMPT,
    };

    try {
      projectStore.saveProject(newProject);
    } catch (err) {
      console.error("Saving project failed:", err);
      setError(
        "The project could not be saved in your browser (storage may be full). Delete old projects and try again.",
      );
      return;
    }

    router.push(`/prompt-studio?project=${encodeURIComponent(newProject.id)}`);
  };

  const inputClass =
    "w-full p-2.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:outline-none";
  const labelClass = "block text-sm font-semibold text-slate-700 mb-1";

  const tabClass = (active: boolean) =>
    `flex-1 p-4 text-sm font-semibold text-center border-b-2 ${
      active
        ? "text-indigo-600 bg-white border-indigo-600"
        : "text-slate-500 bg-slate-100 border-transparent"
    }`;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="border-b-2 border-indigo-600 pb-4">
        <h1 className="text-2xl font-bold text-indigo-600">
          {t("Create New Project")}
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          {t("Upload grant guidelines and provide your project context.")}
        </p>
      </div>

      <div className="bg-white border border-slate-200 overflow-hidden">
        {/* Step indicator */}
        <div className="flex border-b border-slate-200">
          <div className={tabClass(step === 1)}>
            {t("1. Analyze Guidelines")}
          </div>
          <div className={tabClass(step === 2)}>
            {t("2. Project Brief Context")}
          </div>
        </div>

        <div className="p-8 space-y-6">
          {error && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2 text-sm text-red-700"
            >
              <AlertCircle
                className="w-4 h-4 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>{t(error)}</span>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <div className="border-2 border-dashed border-slate-300 rounded-md p-10 text-center hover:bg-indigo-50 hover:border-indigo-500 transition cursor-pointer relative">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileChange}
                  disabled={isAnalyzing}
                  aria-label={t("Upload grant guideline")}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <UploadCloud
                  className="w-10 h-10 text-indigo-500 mx-auto mb-3"
                  aria-hidden="true"
                />
                <h3 className="text-sm font-semibold text-slate-800">
                  {file
                    ? file.name
                    : t("Upload Grant Guideline (PDF, DOCX or TXT)")}
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  {t("Drag and drop or click to browse. Max size 10MB.")}
                </p>
              </div>

              <p className="text-xs text-slate-600">
                {t(
                  "Privacy note: with the free Gemini tier, uploaded content may be used by Google to improve its products. Avoid uploading highly confidential documents.",
                )}
              </p>

              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-3">
                  {isAnalyzing && (
                    <button
                      type="button"
                      onClick={cancelAnalysis}
                      className="flex items-center gap-1.5 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-md text-sm font-medium hover:bg-slate-100 transition"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                      {t("Cancel")}
                    </button>
                  )}
                  <button
                    onClick={analyzeGuideline}
                    disabled={!file || isAnalyzing}
                    className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2
                          className="w-4 h-4 animate-spin"
                          aria-hidden="true"
                        />
                        {t("Analyzing guideline... {n}s", { n: elapsed })}
                      </>
                    ) : (
                      <>
                        {t("Extract Requirements")}
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </div>
                {isAnalyzing && (
                  <p className="text-xs text-slate-600" role="status">
                    {t(
                      "Long documents can take up to a minute. You can cancel and try again at any time.",
                    )}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && guideline && (
            <div className="space-y-6">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-md space-y-3">
                <div className="flex items-start gap-3">
                  <FileText
                    className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div>
                    <h4 className="text-sm font-semibold text-emerald-900">
                      {t("Extracted: {name}", { name: guideline.grantName })}
                    </h4>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      {guideline.organization
                        ? `${guideline.organization} · `
                        : ""}
                      {t("Found {n} application sections.", {
                        n: guideline.sections.length,
                      })}
                    </p>
                  </div>
                </div>
                {guideline.language && (
                  <p className="text-xs text-emerald-800 pl-8">
                    {t("Proposal language: {lang}", {
                      lang: t(guideline.language),
                    })}
                  </p>
                )}
                {(guideline.deadline || guideline.fundingLimit) && (
                  <div className="flex flex-wrap gap-4 text-xs text-emerald-800 pl-8">
                    {guideline.deadline && (
                      <span className="flex items-center gap-1">
                        <CalendarClock
                          className="w-3.5 h-3.5"
                          aria-hidden="true"
                        />
                        {t("Deadline: {date}", { date: guideline.deadline })}
                      </span>
                    )}
                    {guideline.fundingLimit && (
                      <span className="flex items-center gap-1">
                        <Wallet className="w-3.5 h-3.5" aria-hidden="true" />
                        {t("Funding: {amount}", {
                          amount: guideline.fundingLimit,
                        })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2">
                  {t("Sections to generate")}
                </h4>
                <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
                  {guideline.sections.map((sec) => (
                    <label
                      key={sec.id}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={enabledIds.has(sec.id)}
                        onChange={() => toggleSection(sec.id)}
                        className="accent-indigo-600"
                      />
                      <span className="flex-1 text-slate-800">{sec.title}</span>
                      <span className="text-xs text-slate-500">
                        {sec.wordLimit
                          ? t("{n} words", { n: sec.wordLimit })
                          : t("no limit")}
                        {sec.required ? "" : ` · ${t("Optional")}`}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className={labelClass}>{t("Project Title *")}</label>
                  <input
                    type="text"
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                    placeholder={t(
                      "e.g., AI-Based Early Flood Risk Prediction Platform",
                    )}
                    className={inputClass}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>{t("Applicant Name")}</label>
                    <input
                      type="text"
                      value={applicantName}
                      onChange={(e) => setApplicantName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>{t("Institution")}</label>
                    <input
                      type="text"
                      value={institution}
                      onChange={(e) => setInstitution(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>
                    {t("Problem Statement *")}
                  </label>
                  <textarea
                    value={problem}
                    onChange={(e) => setProblem(e.target.value)}
                    rows={3}
                    placeholder={t(
                      "Describe the core problem your project solves...",
                    )}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>
                    {t("Proposed Solution *")}
                  </label>
                  <textarea
                    value={solution}
                    onChange={(e) => setSolution(e.target.value)}
                    rows={3}
                    placeholder={t(
                      "Briefly describe your proposed solution...",
                    )}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>
                    {t("Objectives (one per line)")}
                  </label>
                  <textarea
                    value={objectives}
                    onChange={(e) => setObjectives(e.target.value)}
                    rows={3}
                    placeholder={t(
                      "Build a prediction model\nValidate it with regional data",
                    )}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>{t("Methodology")}</label>
                  <textarea
                    value={methodology}
                    onChange={(e) => setMethodology(e.target.value)}
                    rows={3}
                    placeholder={t("How will you carry out the work?")}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>
                    {t("Target Beneficiaries")}
                  </label>
                  <input
                    type="text"
                    value={beneficiaries}
                    onChange={(e) => setBeneficiaries(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-slate-200">
                <button
                  onClick={() => {
                    setError(null);
                    setStep(1);
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-md transition"
                >
                  {t("Back")}
                </button>
                <button
                  onClick={handleCreateProject}
                  className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 transition"
                >
                  <Target className="w-4 h-4" aria-hidden="true" />
                  {t("Initialize Project Sandbox")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
