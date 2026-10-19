// ---------------------------------------------------------------------------
// Deterministic checks (computed by application code, never by the LLM)
// ---------------------------------------------------------------------------

export type RuleStatus = "pass" | "warning" | "fail";

export interface RuleCheck {
  id: string;
  /** Section this check belongs to; undefined for project-wide checks. */
  sectionId?: string;
  label: string;
  status: RuleStatus;
  detail: string;
}

// ---------------------------------------------------------------------------
// AI requirement matching (guideline requirement vs generated text)
// ---------------------------------------------------------------------------

export type RequirementStatus = "satisfied" | "partial" | "missing";

export interface RequirementResult {
  requirement: string;
  status: RequirementStatus;
  /** Short excerpt or explanation showing where/how it is addressed. */
  evidence?: string;
  /** What the applicant should add or change (for partial / missing). */
  recommendation?: string;
}

export interface SectionComplianceResult {
  sectionId: string;
  sectionTitle: string;
  /** 0-100, computed from the requirement statuses by application code. */
  score: number;
  requirements: RequirementResult[];
}

export interface ComplianceReport {
  /** 0-100, average of section scores (computed by application code). */
  overallScore: number;
  sections: SectionComplianceResult[];
  generatedAt: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Cross-section consistency
// ---------------------------------------------------------------------------

export type ConsistencyCheckId =
  | "title"
  | "objectives"
  | "methodology"
  | "timeline"
  | "budget"
  | "terminology"
  | "duration"
  | "claims";

export type ConsistencyStatus =
  | "consistent"
  | "minor_issue"
  | "inconsistent"
  | "not_applicable";

export interface ConsistencyCheck {
  id: ConsistencyCheckId;
  label: string;
  status: ConsistencyStatus;
  explanation: string;
  /** Titles of the sections involved. */
  sections: string[];
}

export interface Contradiction {
  description: string;
  sections: string[];
  suggestedFix?: string;
}

export interface ConsistencyReport {
  /** 0-100, computed from the check statuses by application code. */
  overallScore: number;
  checks: ConsistencyCheck[];
  contradictions: Contradiction[];
  recommendations: string[];
  generatedAt: string;
  model: string;
}

export const CONSISTENCY_CHECKS: { id: ConsistencyCheckId; label: string }[] = [
  { id: "title", label: "Project title consistency" },
  { id: "objectives", label: "Objectives consistency" },
  { id: "methodology", label: "Methodology ↔ objectives alignment" },
  { id: "timeline", label: "Timeline ↔ methodology alignment" },
  { id: "budget", label: "Budget ↔ deliverables alignment" },
  { id: "terminology", label: "Terminology consistency" },
  { id: "duration", label: "Project duration consistency" },
  { id: "claims", label: "Contradictory claims" },
];
