// The `projects` / `project-activity` code block syntax, and the filter + sort shared with the
// dashboard. Pure: no Obsidian imports.
//
//   ```projects
//   status: planning, in progress     <- any listed value matches (case-insensitive)
//   area: Personal                    <- any frontmatter key works
//   -status: done                     <- leading "-" excludes
//   search: sql                       <- name / summary / stack contains
//   active: this-month                <- only projects with activity in that range
//   sort: last-activity               <- name | status | updated | created | last-activity | group | <key>
//   group-by: status                  <- split into headed sections
//   view: grid                        <- grid | table | list
//   limit: 10
//   ```

import { parseRange, type DateRange } from "./dates.ts";
import { fieldValues, statusRank, type ProjectInfo } from "./fields.ts";

export type ViewKind = "grid" | "table" | "list";

export interface Filter {
  key: string;
  values: string[];
  negate: boolean;
}

export interface ProjectQuery {
  filters: Filter[];
  search: string;
  /** Only projects with activity in this range. */
  active: DateRange | null;
  sort: string;
  descending: boolean;
  groupBy: string;
  view: ViewKind | null;
  limit: number;
  /** Activity blocks: the range to show. */
  range: DateRange | null;
  /** Problems found while parsing, shown under the block. */
  errors: string[];
}

export function emptyQuery(): ProjectQuery {
  return {
    filters: [],
    search: "",
    active: null,
    sort: "",
    descending: false,
    groupBy: "",
    view: null,
    limit: 0,
    range: null,
    errors: [],
  };
}

function splitValues(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export function parseQuery(source: string, now: Date = new Date()): ProjectQuery {
  const q = emptyQuery();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) {
      q.errors.push(`Expected "key: value", got "${line}"`);
      continue;
    }
    let key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    switch (key) {
      case "sort": {
        const m = /^(.*?)(?:\s+(asc|desc))?$/i.exec(value)!;
        q.sort = m[1].trim().toLowerCase();
        q.descending = (m[2] ?? "").toLowerCase() === "desc";
        break;
      }
      case "group-by":
      case "groupby":
      case "group by":
        q.groupBy = value.toLowerCase();
        break;
      case "view":
        if (value === "grid" || value === "table" || value === "list") q.view = value;
        else q.errors.push(`Unknown view "${value}" (use grid, table or list)`);
        break;
      case "limit": {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) q.limit = n;
        else q.errors.push(`limit must be a whole number, got "${value}"`);
        break;
      }
      case "search":
        q.search = value.toLowerCase();
        break;
      case "range":
      case "active": {
        const r = parseRange(value, now);
        if (!r) q.errors.push(`Unknown range "${value}" (try this-week, last-month, 14d, 2026-10)`);
        else if (key === "range") q.range = r;
        else q.active = r;
        break;
      }
      default: {
        const negate = key.startsWith("-") || key.startsWith("!");
        if (negate) key = key.slice(1).trim();
        if (key === "project") key = "name";
        const values = splitValues(value);
        if (values.length) q.filters.push({ key, values, negate });
      }
    }
  }
  return q;
}

export interface MatchContext {
  /** Latest activity day per project id. */
  lastActivity: Map<string, string>;
  /** Projects with any activity in the query's `active` range. */
  activeIn?: Set<string>;
}

export function matches(p: ProjectInfo, q: ProjectQuery, ctx?: MatchContext): boolean {
  for (const f of q.filters) {
    const have = fieldValues(p, f.key).map((v) => v.toLowerCase());
    const hit = f.values.some((v) => {
      const want = v.toLowerCase();
      // "none" / "empty" matches projects without the field.
      if (want === "none" || want === "empty") return have.length === 0;
      return have.includes(want);
    });
    if (hit === f.negate) return false;
  }
  if (q.search) {
    const hay = [p.name, p.summary, ...p.stack, p.group.join("/")].join(" ").toLowerCase();
    if (!hay.includes(q.search)) return false;
  }
  if (q.active && ctx?.activeIn && !ctx.activeIn.has(p.id)) return false;
  return true;
}

/** Sorts in place and returns the array. Unknown sort keys sort by that frontmatter key. */
export function sortProjects(
  list: ProjectInfo[],
  sort: string,
  descending: boolean,
  statusOrder: string[],
  lastActivity: Map<string, string>,
): ProjectInfo[] {
  const key = sort || "status";
  const byName = (a: ProjectInfo, b: ProjectInfo): number => a.name.localeCompare(b.name);
  // Dates read most naturally newest-first, so "sort: updated" means newest first unless "asc".
  const dateKey = key === "updated" || key === "created" || key === "last-activity" || key === "activity";
  const dir = dateKey ? (descending ? 1 : -1) : descending ? -1 : 1;
  const cmp = (a: ProjectInfo, b: ProjectInfo): number => {
    let r = 0;
    switch (key) {
      case "name":
        return byName(a, b) * dir;
      case "status":
        r = statusRank(a.status, statusOrder) - statusRank(b.status, statusOrder);
        break;
      case "updated":
      case "created":
        r = cmpEmptyLast(a[key], b[key], dir);
        return r || byName(a, b);
      case "last-activity":
      case "activity":
        r = cmpEmptyLast(lastActivity.get(a.id) ?? "", lastActivity.get(b.id) ?? "", dir);
        return r || byName(a, b);
      case "group":
        r = a.group.join("/").localeCompare(b.group.join("/"));
        break;
      default:
        r = cmpEmptyLast(fieldValues(a, key).join(", "), fieldValues(b, key).join(", "), 1);
    }
    return r * dir || byName(a, b);
  };
  return list.sort(cmp);
}

/** Compares strings with empty values always last, whatever the direction. */
function cmpEmptyLast(a: string, b: string, dir: number): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b) * dir;
}

/** Splits a sorted list into sections by a field. Projects without the field go under "(none)". */
export function groupProjects(list: ProjectInfo[], key: string, statusOrder: string[]): { title: string; items: ProjectInfo[] }[] {
  if (!key) return [{ title: "", items: list }];
  const sections = new Map<string, ProjectInfo[]>();
  for (const p of list) {
    const k = key === "group" || key === "folder" ? p.group.join(" / ") : fieldValues(p, key)[0] ?? "";
    const title = k || "(none)";
    if (!sections.has(title)) sections.set(title, []);
    sections.get(title)!.push(p);
  }
  const titles = [...sections.keys()];
  if (key === "status") titles.sort((a, b) => statusRank(a === "(none)" ? "" : a, statusOrder) - statusRank(b === "(none)" ? "" : b, statusOrder));
  else titles.sort((a, b) => (a === "(none)" ? 1 : b === "(none)" ? -1 : a.localeCompare(b)));
  return titles.map((title) => ({ title, items: sections.get(title)! }));
}
