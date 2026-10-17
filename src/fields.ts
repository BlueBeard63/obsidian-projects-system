// Reads the frontmatter you already write into a uniform ProjectInfo. Which key holds which field is
// configurable, and status values are your own words. Pure: no Obsidian imports.

import { normaliseDate } from "./dates.ts";
import type { ProjectDef } from "./discovery.ts";

export interface FieldMap {
  status: string;
  summary: string;
  repo: string;
  stack: string;
  created: string;
  updated: string;
}

export const DEFAULT_FIELDS: FieldMap = {
  status: "status",
  summary: "summary",
  repo: "github",
  stack: "languages",
  created: "created",
  updated: "updated",
};

export interface ProjectInfo extends ProjectDef {
  /** Status as written (trimmed), or "" when unset. */
  status: string;
  summary: string;
  repo: string;
  stack: string[];
  created: string;
  updated: string;
  /** The main note's whole frontmatter, for filters on any key (area, category, ...). */
  fm: Record<string, unknown>;
}

/** Turns "[[Bosun]]" / "[[Bosun|label]]" into "Bosun"; leaves other text alone. */
export function stripWikilink(s: string): string {
  return s.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) =>
    (label ?? target).trim(),
  );
}

/** A frontmatter value as display text ("" for missing). Lists are joined with ", ". */
export function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(", ");
  if (v instanceof Date) return normaliseDate(v);
  if (typeof v === "object") return "";
  return stripWikilink(String(v)).trim();
}

/** A frontmatter value as a list: arrays as-is, "a, b" strings split on commas. */
export function asList(v: unknown): string[] {
  if (v === null || v === undefined || v === "") return [];
  if (Array.isArray(v)) return v.map(asText).filter(Boolean);
  return asText(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readProject(def: ProjectDef, fm: Record<string, unknown> | undefined, fields: FieldMap): ProjectInfo {
  const f = fm ?? {};
  return {
    ...def,
    status: asText(f[fields.status]),
    summary: asText(f[fields.summary]),
    repo: asText(f[fields.repo]),
    stack: asList(f[fields.stack]),
    created: normaliseDate(f[fields.created]),
    updated: normaliseDate(f[fields.updated]),
    fm: f,
  };
}

export function sameStatus(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The status list in display order: the configured order first, then any other value found in
 * the vault (alphabetically). Case-insensitive duplicates collapse to the configured spelling.
 */
export function orderedStatuses(found: string[], configured: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string): void => {
    const t = s.trim();
    if (!t || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  configured.forEach(add);
  [...found].sort((a, b) => a.localeCompare(b)).forEach(add);
  return out;
}

/** Sort position of a status; unset statuses sort last. */
export function statusRank(status: string, order: string[]): number {
  if (!status) return order.length + 1;
  const i = order.findIndex((s) => sameStatus(s, status));
  return i < 0 ? order.length : i;
}

export function isFinished(status: string, finished: string[]): boolean {
  return !!status && finished.some((s) => sameStatus(s, status));
}

/** The value of any field for filtering/grouping: built-ins first, then raw frontmatter keys. */
export function fieldValues(p: ProjectInfo, key: string): string[] {
  switch (key.trim().toLowerCase()) {
    case "name":
    case "title":
      return [p.name];
    case "status":
      return p.status ? [p.status] : [];
    case "group":
    case "folder":
      return p.group.length ? [p.group.join("/"), ...p.group] : [];
    case "kind":
      return [p.kind];
    case "stack":
      return p.stack;
    case "summary":
      return p.summary ? [p.summary] : [];
    case "repo":
      return p.repo ? [p.repo] : [];
    case "created":
      return p.created ? [p.created] : [];
    case "updated":
      return p.updated ? [p.updated] : [];
  }
  const raw = Object.entries(p.fm).find(([k]) => k.toLowerCase() === key.trim().toLowerCase());
  return raw ? asList(raw[1]) : [];
}
