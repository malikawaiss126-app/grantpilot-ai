import type { GrantProject } from "@/types/project";
import type { GrantSection } from "@/types/prompt";

// ---------------------------------------------------------------------------
// Browser (localStorage) persistence for projects (PRD §10: no backend/database).
// All reads are defensive: corrupted or outdated data never crashes the UI.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "grantpilot_projects";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function isValidProject(value: unknown): value is GrantProject {
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

function readAll(): GrantProject[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidProject);
  } catch (err) {
    console.error("GrantPilot: could not read saved projects.", err);
    return [];
  }
}

/** Throws if the browser refuses the write (e.g. storage quota exceeded). */
function writeAll(projects: GrantProject[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export const projectStore = {
  /** All projects, most recently created last (insertion order). */
  getAllProjects: (): GrantProject[] => readAll(),

  getProject: (id: string): GrantProject | undefined =>
    readAll().find((p) => p.id === id),

  /** The most recently saved project, or undefined when none exist. */
  getLatestProject: (): GrantProject | undefined => {
    const all = readAll();
    return all[all.length - 1];
  },

  /** Create or replace a project. Throws if the browser storage is full. */
  saveProject: (project: GrantProject): void => {
    const projects = readAll();
    const index = projects.findIndex((p) => p.id === project.id);
    if (index >= 0) {
      projects[index] = project;
    } else {
      projects.push(project);
    }
    writeAll(projects);
  },

  /**
   * Read-modify-write a single project. Returns the updated project,
   * or undefined if the project does not exist.
   */
  updateProject: (
    id: string,
    updater: (project: GrantProject) => GrantProject,
  ): GrantProject | undefined => {
    const projects = readAll();
    const index = projects.findIndex((p) => p.id === id);
    if (index < 0) return undefined;
    const updated = updater(projects[index]);
    projects[index] = updated;
    writeAll(projects);
    return updated;
  },

  /** Patch one section of one project (prompt text, generated content, status...). */
  updateSection: (
    projectId: string,
    sectionId: string,
    patch: Partial<GrantSection>,
  ): GrantProject | undefined =>
    projectStore.updateProject(projectId, (project) => ({
      ...project,
      sections: project.sections.map((s) =>
        s.id === sectionId ? { ...s, ...patch } : s,
      ),
    })),

  deleteProject: (id: string): void => {
    writeAll(readAll().filter((p) => p.id !== id));
  },
};
