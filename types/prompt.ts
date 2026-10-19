export interface GrantSection {
  id: string;
  title: string;
  order: number;
  required: boolean;
  description?: string;
  wordLimit?: number;
  characterLimit?: number;
  requirements: string[];
  evaluationCriteria: string[];
  prompt: string;
  tone: "academic" | "professional" | "technical" | "general";
  creativity: "low" | "medium" | "high";
  enabled: boolean;
  generatedContent?: string;
  status: "draft" | "generating" | "generated" | "needs_review" | "approved";
}
