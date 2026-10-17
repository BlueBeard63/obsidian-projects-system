import { Events, TFile, TFolder, debounce, normalizePath, type TAbstractFile } from "obsidian";
import {
  addEvent,
  compact,
  emptyActivity,
  lastActivity,
  parseActivity,
  reattach,
  renamePath,
  summarise,
  type ActivityData,
  type ActivityEvent,
  type DaySummary,
} from "./activity-store";
import { isoDate, normaliseDate, type DateRange } from "./dates";
import type { ProjectInfo } from "./fields";
import type ProjectsPlugin from "./main";

/**
 * Records project activity from vault events into <plugin folder>/activity.json, so "what did I
 * work on" never depends on a hand-written log. Notes are never written to, except the optional
 * once-a-day updated: bump. Emits "changed" when the history changes.
 */
export class ActivityTracker extends Events {
  private data: ActivityData = emptyActivity();
  private last = new Map<string, string>();
  /** Paths this plugin just wrote, so its own writes are not counted as your edits. */
  private readonly selfWrites = new Map<string, number>();
  /** Projects whose updated: was already set today (id -> day). */
  private readonly bumped = new Map<string, string>();
  private readonly saveSoon = debounce(() => void this.save(), 2000, true);
  private readonly changedSoon = debounce(() => this.trigger("changed"), 250, true);
  /** Events for files the index did not know yet (a project created a moment ago), retried after it rebuilds. */
  private pending: { file: TFile; kind: "create" | "edit"; day: string }[] = [];

  constructor(private readonly plugin: ProjectsPlugin) {
    super();
  }

  private get file(): string {
    const dir = this.plugin.manifest.dir ?? `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
    return normalizePath(`${dir}/activity.json`);
  }

  async load(): Promise<void> {
    try {
      const adapter = this.plugin.app.vault.adapter;
      if (await adapter.exists(this.file)) this.data = parseActivity(JSON.parse(await adapter.read(this.file)));
    } catch (e) {
      console.error("[projects-system] could not read activity history, starting a new one", e);
      this.data = emptyActivity();
    }
    if (compact(this.data, today(), this.plugin.settings.detailDays)) this.saveSoon();
    this.last = lastActivity(this.data);
  }

  private async save(): Promise<void> {
    await this.plugin.app.vault.adapter.write(this.file, JSON.stringify(this.data));
  }

  /** Flushes a pending save (on unload). */
  async flush(): Promise<void> {
    this.saveSoon.cancel();
    await this.save();
  }

  /** Starts listening; call after the layout is ready so start-up "create" events are skipped. */
  start(): void {
    const { vault } = this.plugin.app;
    this.plugin.registerEvent(vault.on("create", (f) => this.onFile(f, "create")));
    this.plugin.registerEvent(vault.on("modify", (f) => this.onFile(f, "edit")));
    this.plugin.registerEvent(vault.on("delete", (f) => this.onFile(f, "delete")));
    this.plugin.registerEvent(vault.on("rename", (f, oldPath) => this.onRename(f, oldPath)));
    this.plugin.registerEvent(
      this.plugin.index.on("changed", () => {
        this.reattach();
        this.retryPending();
      }),
    );
    this.plugin.registerEvent(
      this.plugin.index.on("status", (...args: unknown[]) => {
        const [p, from, to] = args as [ProjectInfo, string, string];
        this.record({ d: today(), p: p.id, k: "status", from, to });
      }),
    );
    this.reattach();
    if (!this.data.backfilled) void this.backfill(false);
  }

  /** History of a project whose id changed (note turned into a folder) follows it. */
  private reattach(): void {
    const index = this.plugin.index;
    const moved = reattach(this.data, (id) => !!index.get(id), (path) => index.projectFor(path)?.id);
    if (!moved) return;
    this.last = lastActivity(this.data);
    this.saveSoon();
    this.changedSoon();
  }

  /** Marks a path as written by the plugin for the next couple of seconds. */
  noteSelfWrite(path: string): void {
    this.selfWrites.set(path, Date.now());
  }

  private isSelfWrite(path: string): boolean {
    const t = this.selfWrites.get(path);
    if (t === undefined) return false;
    if (Date.now() - t < 2000) return true;
    this.selfWrites.delete(path);
    return false;
  }

  private onFile(file: TAbstractFile, kind: "create" | "edit" | "delete"): void {
    if (!(file instanceof TFile) || this.isSelfWrite(file.path)) return;
    const project = this.plugin.index.projectFor(file.path);
    if (!project) {
      // A new project's first note: the index has not picked the project up yet.
      if (kind !== "delete" && this.plugin.index.isUnderRoot(file.path)) this.pending.push({ file, kind, day: today() });
      return;
    }
    this.record({ d: today(), p: project.id, k: kind, f: file.path });
    if (kind !== "delete") this.maybeBumpUpdated(project);
  }

  private retryPending(): void {
    const queue = this.pending;
    this.pending = [];
    for (const { file, kind, day } of queue) {
      const project = this.plugin.index.projectFor(file.path);
      if (project) this.record({ d: day, p: project.id, k: kind, f: file.path });
    }
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    renamePath(this.data, oldPath, file.path);
    this.last = lastActivity(this.data);
    this.saveSoon();
    // Moving a folder renames every file inside it; only a changed file name is worth recording.
    if (file instanceof TFile && oldPath.split("/").pop() !== file.name) {
      const project = this.plugin.index.projectFor(file.path);
      if (project) this.record({ d: today(), p: project.id, k: "rename", f: file.path, from: oldPath });
    } else if (file instanceof TFolder) {
      this.changedSoon();
    }
  }

  private record(ev: ActivityEvent): void {
    if (!addEvent(this.data, ev)) return;
    const prev = this.last.get(ev.p);
    if (!prev || ev.d > prev) this.last.set(ev.p, ev.d);
    this.saveSoon();
    this.changedSoon();
  }

  /** Sets the main note's updated: to today, once a day, only if the note already has the field. */
  private maybeBumpUpdated(project: ProjectInfo): void {
    const { settings, app } = this.plugin;
    if (!settings.bumpUpdated || !project.mainPath) return;
    const day = today();
    if (this.bumped.get(project.id) === day) return;
    const key = settings.fields.updated;
    if (!(key in project.fm) || normaliseDate(project.fm[key]) === day) {
      this.bumped.set(project.id, day);
      return;
    }
    this.bumped.set(project.id, day);
    const file = app.vault.getFileByPath(project.mainPath);
    if (!file) return;
    // Wait a little so the bump does not land in the middle of typing in that same note.
    window.setTimeout(() => {
      this.noteSelfWrite(file.path);
      void app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (key in fm) fm[key] = day;
      });
    }, 3000);
  }

  /**
   * Seeds history from file creation/modification dates. With `force`, runs again (adding only what
   * is missing). Returns the number of events added.
   */
  async backfill(force: boolean): Promise<number> {
    if (this.data.backfilled && !force) return 0;
    let added = 0;
    for (const file of this.plugin.app.vault.getFiles()) {
      const project = this.plugin.index.projectFor(file.path);
      if (!project) continue;
      const created = isoDate(new Date(file.stat.ctime));
      const modified = isoDate(new Date(file.stat.mtime));
      if (addEvent(this.data, { d: created, p: project.id, k: "create", f: file.path })) added++;
      if (modified !== created && addEvent(this.data, { d: modified, p: project.id, k: "edit", f: file.path })) added++;
    }
    this.data.backfilled = true;
    this.data.events.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    this.last = lastActivity(this.data);
    await this.save();
    this.trigger("changed");
    return added;
  }

  lastActivity(): Map<string, string> {
    return this.last;
  }

  summary(range: DateRange, include?: (projectId: string) => boolean): DaySummary[] {
    return summarise(this.data, range, include);
  }

  /** Ids of projects with any activity in the range. */
  activeIn(range: DateRange): Set<string> {
    const out = new Set<string>();
    for (const e of this.data.events) if (e.d >= range.start && e.d <= range.end) out.add(e.p);
    return out;
  }
}

function today(): string {
  return isoDate(new Date());
}
