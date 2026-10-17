import { Events, TFile, TFolder, debounce, getAllTags, type App } from "obsidian";
import { discoverProjects, projectForPath, type NoteEntry } from "./discovery";
import { orderedStatuses, readProject, sameStatus, type ProjectInfo } from "./fields";
import type ProjectsPlugin from "./main";

/**
 * Keeps the list of projects current. Events:
 *   "changed"                         the list or any project's fields changed
 *   "status", project, from, to       a project's status changed (after the first build)
 */
export class ProjectIndex extends Events {
  projects: ProjectInfo[] = [];
  private byId = new Map<string, ProjectInfo>();
  private ready = false;
  /** Snapshot of the last build, so saves that change nothing project-related do not re-render views. */
  private signature = "";
  private readonly app: App;

  constructor(private readonly plugin: ProjectsPlugin) {
    super();
    this.app = plugin.app;
  }

  /** Starts watching; call once the workspace layout is ready (metadata is cached by then). */
  start(): void {
    const later = debounce(() => this.rebuild(), 300, true);
    const { vault, metadataCache } = this.app;
    this.plugin.registerEvent(metadataCache.on("changed", (file) => this.isUnderRoot(file.path) && later()));
    this.plugin.registerEvent(vault.on("create", (file) => this.isUnderRoot(file.path) && later()));
    this.plugin.registerEvent(vault.on("delete", (file) => this.isUnderRoot(file.path) && later()));
    this.plugin.registerEvent(
      vault.on("rename", (file, oldPath) => (this.isUnderRoot(file.path) || this.isUnderRoot(oldPath)) && later()),
    );
    this.rebuild();
  }

  isUnderRoot(path: string): boolean {
    const root = this.plugin.settings.root;
    return root === "" || path === root || path.startsWith(root + "/");
  }

  rebuild(): void {
    const { settings } = this.plugin;
    const notes: NoteEntry[] = [];
    const folders: string[] = [];
    for (const f of this.app.vault.getAllLoadedFiles()) {
      if (!this.isUnderRoot(f.path)) continue;
      if (f instanceof TFolder) folders.push(f.path);
      else if (f instanceof TFile && f.extension === "md") {
        const cache = this.app.metadataCache.getFileCache(f);
        notes.push({ path: f.path, tags: cache ? (getAllTags(cache) ?? []) : [] });
      }
    }
    const defs = discoverProjects(notes, folders, {
      root: settings.root,
      categoryDepth: settings.categoryDepth,
      projectTag: settings.projectTag,
      ignore: settings.ignore,
    });
    const next = defs.map((def) => {
      const file = def.mainPath ? this.app.vault.getFileByPath(def.mainPath) : null;
      const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
      return readProject(def, fm as Record<string, unknown> | undefined, settings.fields);
    });

    const prev = this.byId;
    this.projects = next;
    this.byId = new Map(next.map((p) => [p.id, p]));
    if (this.ready) {
      for (const p of next) {
        const old = prev.get(p.id);
        if (old && !sameStatus(old.status, p.status)) this.trigger("status", p, old.status, p.status);
      }
    }
    this.ready = true;
    const signature = JSON.stringify(next.map((p) => [p.id, p.mainPath, p.fm]));
    if (signature === this.signature) return;
    this.signature = signature;
    this.trigger("changed");
  }

  /** Forces views to redraw (settings that change how projects show, not which exist). */
  refresh(): void {
    this.trigger("changed");
  }

  get(id: string): ProjectInfo | undefined {
    return this.byId.get(id);
  }

  projectFor(path: string): ProjectInfo | undefined {
    if (!this.isUnderRoot(path)) return undefined;
    return projectForPath(path, this.projects) as ProjectInfo | undefined;
  }

  /** Every distinct status value written in project notes. */
  foundStatuses(): string[] {
    const seen = new Map<string, string>();
    for (const p of this.projects) if (p.status && !seen.has(p.status.toLowerCase())) seen.set(p.status.toLowerCase(), p.status);
    return [...seen.values()];
  }

  /** Statuses in display order: configured first, then any others in use. */
  statuses(): string[] {
    return orderedStatuses(this.foundStatuses(), this.plugin.settings.statusOrder);
  }

  /** Distinct values of a frontmatter key across projects (for filter menus). */
  valuesOf(key: string): string[] {
    const set = new Set<string>();
    for (const p of this.projects) {
      const v = p.fm[key];
      for (const s of Array.isArray(v) ? v : [v]) if (s !== undefined && s !== null && s !== "") set.add(String(s));
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /** Writes a new status to the project's main note (only that key changes). */
  async setStatus(p: ProjectInfo, status: string): Promise<void> {
    let file = p.mainPath ? this.app.vault.getFileByPath(p.mainPath) : null;
    if (!file) {
      if (p.kind !== "folder") return;
      // A folder project without its folder note: create one so there is somewhere to store status.
      file = await this.app.vault.create(`${p.path}/${p.name}.md`, "");
    }
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      fm[this.plugin.settings.fields.status] = status;
    });
  }
}
