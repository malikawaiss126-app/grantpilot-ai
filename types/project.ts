import type { GrantGuideline } from "./guideline";
import type { GrantSection } from "./prompt";
import type { ComplianceReport, ConsistencyReport } from "./compliance";

export interface GrantProject {
  id: string;
  title: string;
  grantName?: string;
  organization?: string;
  deadline?: string;
  fundingLimit?: string;
  duration?: string;
  applicant: {
    name?: string;
    institution?: string;
    department?: string;
    email?: string;
  };
  projectBrief: {
    problem: string;
    proposedSolution: string;
    objectives: string[];
    methodology: string;
    beneficiaries?: string;
    innovation?: string;
    expectedResults?: string;
    technologies?: string[];
  };
  guideline: GrantGuideline;
  sections: GrantSection[];
  globalPrompt: string;
  generatedAt?: string;
  /** Latest AI reports, saved with the project so they survive a refresh. */
  reports?: {
    compliance?: ComplianceReport;
    consistency?: ConsistencyReport;
  };
}