// ---------------------------------------------------------------------------
// Prompt version history (PRD §22: prompt versioning).
// Versions are scoped to BOTH project and section, because section ids such as
// "summary" repeat across projects.
// ---------------------------------------------------------------------------

export interface PromptVersion {
  id: string;
  projectId: string;
  sectionId: string;
  versionNumber: number;
  promptText: string;
  createdAt: string;
}

const VERSION_KEY = "grantpilot_prompt_versions";
const MAX_VERSIONS_PER_SECTION = 20;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isValidVersion(value: unknown): value is PromptVersion {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PromptVersion>;
  return (
    typeof v.id === "string" &&
    typeof v.projectId === "string" &&
    typeof v.sectionId === "string" &&
    typeof v.versionNumber === "number" &&
    typeof v.promptText === "string" &&
    typeof v.createdAt === "string"
  );
}

function readAll(): PromptVersion[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(VERSION_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidVersion) : [];
  } catch (err) {
    console.error("GrantPilot: could not read prompt versions.", err);
    return [];
  }
}

function writeAll(versions: PromptVersion[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(VERSION_KEY, JSON.stringify(versions));
}

export const promptVersionStore = {
  /** Versions of one section, newest first. */
  getVersions: (projectId: string, sectionId: string): PromptVersion[] =>
    readAll()
      .filter((v) => v.projectId === projectId && v.sectionId === sectionId)
      .sort((a, b) => b.versionNumber - a.versionNumber),

  /**
   * Save a new version. If the text is identical to the latest saved version,
   * that version is returned and nothing new is created.
   */
  saveVersion: (
    projectId: string,
    sectionId: string,
    promptText: string,
  ): PromptVersion => {
    if (!isBrowser()) {
      throw new Error("Prompt versions can only be saved in the browser.");
    }

    const all = readAll();
    const mine = all
      .filter((v) => v.projectId === projectId && v.sectionId === sectionId)
      .sort((a, b) => b.versionNumber - a.versionNumber);

    if (mine.length > 0 && mine[0].promptText === promptText) {
      return mine[0];
    }

    const newVersion: PromptVersion = {
      id: `ver-${crypto.randomUUID()}`,
      projectId,
      sectionId,
      versionNumber: (mine[0]?.versionNumber ?? 0) + 1,
      promptText,
      createdAt: new Date().toISOString(),
    };

    // Keep only the newest versions per section so storage never grows unbounded.
    const keepIds = new Set(
      [newVersion, ...mine].slice(0, MAX_VERSIONS_PER_SECTION).map((v) => v.id),
    );
    const others = all.filter(
      (v) => !(v.projectId === projectId && v.sectionId === sectionId),
    );
    const kept = mine.filter((v) => keepIds.has(v.id));

    writeAll([...others, ...kept, newVersion]);
    return newVersion;
  },

  /** Remove all versions of a project (call when the project is deleted). */
  deleteProjectVersions: (projectId: string): void => {
    writeAll(readAll().filter((v) => v.projectId !== projectId));
  },
};
