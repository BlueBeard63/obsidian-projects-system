// The activity history: what happened to which project on which day. Recorded automatically from
// vault events, so there is no log to keep by hand. Pure: no Obsidian imports.

import { daysBetween, inRange, type DateRange } from "./dates.ts";

export type ActivityKind = "create" | "edit" | "rename" | "delete" | "status";

export interface ActivityEvent {
  /** Day, YYYY-MM-DD (local). */
  d: string;
  /** Project id (folder path or note path) at the time. */
  p: string;
  k: ActivityKind;
  /** File path (create/edit/rename/delete); for a compacted edit, absent. */
  f?: string;
  /** Previous path (rename) or previous status (status). */
  from?: string;
  /** New status (status). */
  to?: string;
  /** Number of files folded into a compacted edit. */
  n?: number;
}

export interface ActivityData {
  version: 1;
  /** True once the history has been seeded from file dates. */
  backfilled: boolean;
  events: ActivityEvent[];
}

export function emptyActivity(): ActivityData {
  return { version: 1, backfilled: false, events: [] };
}

/** Loads saved JSON defensively (a hand-edited or old file must never break the plugin). */
export function parseActivity(raw: unknown): ActivityData {
  const data = emptyActivity();
  if (!raw || typeof raw !== "object") return data;
  const r = raw as Partial<ActivityData>;
  data.backfilled = r.backfilled === true;
  if (Array.isArray(r.events)) {
    data.events = r.events.filter(
      (e): e is ActivityEvent =>
        !!e && typeof e.d === "string" && typeof e.p === "string" && typeof e.k === "string",
    );
  }
  return data;
}

/**
 * Adds an event, skipping noise: the same file edited again the same day, or an edit to a file
 * already created that day. Returns true when the history changed.
 */
export function addEvent(data: ActivityData, ev: ActivityEvent): boolean {
  if (ev.k === "edit") {
    const dup = data.events.some(
      (e) => e.d === ev.d && e.p === ev.p && e.f === ev.f && (e.k === "edit" || e.k === "create"),
    );
    if (dup) return false;
  }
  if (ev.k === "create") {
    if (data.events.some((e) => e.d === ev.d && e.p === ev.p && e.f === ev.f && e.k === "create")) return false;
  }
  if (ev.k === "status") {
    // Flip-flopping on the same day keeps one event from the first old value to the latest new one.
    const same = data.events.find((e) => e.d === ev.d && e.p === ev.p && e.k === "status");
    if (same) {
      if (same.to === ev.to) return false;
      same.to = ev.to;
      if (same.from === same.to) data.events.splice(data.events.indexOf(same), 1);
      return true;
    }
  }
  data.events.push(ev);
  return true;
}

/** A file moved: rewrite its path in history so it stays attached to the right file. */
export function renamePath(data: ActivityData, oldPath: string, newPath: string): void {
  for (const e of data.events) {
    if (e.f === oldPath) e.f = newPath;
    else if (e.f?.startsWith(oldPath + "/")) e.f = newPath + e.f.slice(oldPath.length);
    if (e.p === oldPath) e.p = newPath;
    else if (e.p.startsWith(oldPath + "/")) e.p = newPath + e.p.slice(oldPath.length);
  }
}

/**
 * Folds per-file edit events older than `keepDays` into one edit per project per day (with a
 * count), so the file stays small after years of use. Creates, deletes and status changes stay.
 */
export function compact(data: ActivityData, today: string, keepDays: number): boolean {
  const keep: ActivityEvent[] = [];
  const folded = new Map<string, ActivityEvent>();
  let changed = false;
  for (const e of data.events) {
    if (e.k !== "edit" || daysBetween(e.d, today) <= keepDays) {
      keep.push(e);
      continue;
    }
    const key = `${e.d}\u0000${e.p}`;
    const prev = folded.get(key);
    if (prev) {
      prev.n = (prev.n ?? 1) + (e.n ?? 1);
      changed = true;
    } else {
      const c: ActivityEvent = { d: e.d, p: e.p, k: "edit", n: e.n ?? 1 };
      if (e.f !== undefined) changed = true;
      folded.set(key, c);
      keep.push(c);
    }
  }
  if (changed) data.events = keep;
  return changed;
}

/** Latest activity day per project id. */
export function lastActivity(data: ActivityData): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of data.events) {
    const prev = out.get(e.p);
    if (!prev || e.d > prev) out.set(e.p, e.d);
  }
  return out;
}

export interface ProjectDay {
  project: string;
  created: string[];
  edited: string[];
  /** Edits folded by compaction (counted, files unknown). */
  editedCount: number;
  renamed: { from: string; to: string }[];
  deleted: string[];
  status: { from: string; to: string }[];
}

export interface DaySummary {
  date: string;
  projects: ProjectDay[];
}

/** Groups the events in a range by day (newest first) and project. */
export function summarise(
  data: ActivityData,
  range: DateRange,
  include: (projectId: string) => boolean = () => true,
): DaySummary[] {
  const days = new Map<string, Map<string, ProjectDay>>();
  for (const e of data.events) {
    if (!inRange(e.d, range) || !include(e.p)) continue;
    let day = days.get(e.d);
    if (!day) days.set(e.d, (day = new Map()));
    let pd = day.get(e.p);
    if (!pd) {
      pd = { project: e.p, created: [], edited: [], editedCount: 0, renamed: [], deleted: [], status: [] };
      day.set(e.p, pd);
    }
    switch (e.k) {
      case "create":
        if (e.f && !pd.created.includes(e.f)) pd.created.push(e.f);
        break;
      case "edit":
        if (e.f) {
          if (!pd.edited.includes(e.f)) pd.edited.push(e.f);
        } else pd.editedCount += e.n ?? 1;
        break;
      case "rename":
        if (e.f) pd.renamed.push({ from: e.from ?? "", to: e.f });
        break;
      case "delete":
        if (e.f) pd.deleted.push(e.f);
        break;
      case "status":
        pd.status.push({ from: e.from ?? "", to: e.to ?? "" });
        break;
    }
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, map]) => ({ date, projects: [...map.values()] }));
}

/** Total distinct files touched (created + edited) in a ProjectDay, counting folded edits. */
export function touchedCount(pd: ProjectDay): number {
  return new Set([...pd.created, ...pd.edited]).size + pd.editedCount;
}

export interface ProjectRange {
  /** Days with activity, newest first. */
  days: string[];
  /** Files created or edited. */
  files: Set<string>;
  created: Set<string>;
  /** Edits folded by compaction (counted, files unknown). */
  folded: number;
  status: { date: string; from: string; to: string }[];
}

/** Collapses a summary to one entry per project over the whole range. */
export function byProject(days: DaySummary[]): Map<string, ProjectRange> {
  const out = new Map<string, ProjectRange>();
  for (const day of days) {
    for (const pd of day.projects) {
      let agg = out.get(pd.project);
      if (!agg) out.set(pd.project, (agg = { days: [], files: new Set(), created: new Set(), folded: 0, status: [] }));
      agg.days.push(day.date);
      for (const f of pd.created) {
        agg.files.add(f);
        agg.created.add(f);
      }
      for (const f of pd.edited) agg.files.add(f);
      agg.folded += pd.editedCount;
      for (const st of pd.status) agg.status.push({ date: day.date, ...st });
    }
  }
  return out;
}
