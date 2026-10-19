// Structured representation of an analyzed grant guideline (PRD §11 & §38).
// This is the "source of truth" the whole agent workflow is built on.

export interface GuidelineSourceReference {
  page?: number;
  text?: string;
}

export interface GuidelineSection {
  id: string;
  title: string;
  order: number;
  required: boolean;
  wordLimit?: number;
  characterLimit?: number;
  requirements: string[];
  evaluationCriteria: string[];
  requiredElements: string[];
  sourceReferences: GuidelineSourceReference[];
}

export interface GrantGuideline {
  // Grant metadata
  grantName: string;
  /**
   * Language the guideline is written in, named in English
   * (e.g. "English", "Chinese (Simplified)", "Japanese").
   * The proposal is written in this same language.
   */
  language?: string;
  organization?: string;
  grantType?: string;
  deadline?: string;
  fundingLimit?: string;
  duration?: string;

  summary: string;

  // Eligibility
  eligibility: string[];
  restrictions?: string[];

  // Application structure
  sections: GuidelineSection[];

  // Other requirements
  generalRequirements: string[];
  formattingRequirements: string[];
  budgetRequirements: string[];
  attachments: string[];
}
