// Builds the portfolio's markdown files: a project note (content/Projects/<Title>.md, matching the
// Project struct in Portfolio/internal/site/content.go) and a monthly post (content/Writing/YYYY-MM.md).
// Pure: no Obsidian imports.

import { sanitizeTyping, slugify } from "./sanitize.ts";
import type { ProjectInfo } from "../fields.ts";

/** A YAML scalar: plain when safe, otherwise double-quoted. */
export function yamlScalar(v: string): string {
  if (v === "") return "";
  const plainSafe =
    /^[A-Za-z0-9][A-Za-z0-9 ._/()'+,;!?&-]*$/.test(v) &&
    !/^(true|false|yes|no|on|off|null|~)$/i.test(v) &&
    !/^[0-9.+-]+$/.test(v) &&
    !/ $/.test(v);
  return plainSafe ? v : JSON.stringify(v);
}

export interface PortfolioProjectFields {
  title: string;
  slug: string;
  summary: string;
  status: string;
  stack: string[];
  case: string;
  role: string;
  year: string;
  featured: boolean;
  private: boolean;
  updated: string;
  draft: boolean;
  repo: string;
  live: string;
}

/** Maps a project onto the portfolio's fields. `statusMap` maps your status words to the site's. */
export function portfolioFields(
  p: ProjectInfo,
  opts: { caseNumber: string; statusMap: Record<string, string>; role: string; today: string },
): PortfolioProjectFields {
  const status = p.status.toLowerCase();
  const mapped = Object.entries(opts.statusMap).find(([k]) => k.toLowerCase() === status)?.[1] ?? p.status;
  const live = typeof p.fm["live"] === "string" ? (p.fm["live"]) : "";
  return {
    title: sanitizeTyping(p.name).text,
    slug: slugify(p.name),
    summary: sanitizeTyping(p.summary).text,
    status: mapped,
    stack: p.stack.map((s) => s.toLowerCase()),
    case: opts.caseNumber,
    role: opts.role,
    year: (p.created || p.updated || opts.today).slice(0, 4),
    featured: false,
    private: !p.repo,
    updated: p.updated || opts.today,
    draft: true,
    repo: /^https?:\/\//.test(p.repo) ? p.repo : "",
    live,
  };
}

/** The frontmatter block, in the same order as Portfolio/content/Templates/Project.md. */
export function projectFrontmatter(f: PortfolioProjectFields): string {
  const lines = [
    "---",
    `title: ${yamlScalar(f.title)}`,
    `slug: ${f.slug}`,
    `summary: ${yamlScalar(f.summary)}`,
    "seo_title:",
    `status: ${yamlScalar(f.status)}`,
    f.stack.length ? "stack:\n" + f.stack.map((s) => `  - ${yamlScalar(s)}`).join("\n") : "stack: []",
    `case: "${f.case}"`,
    `role: ${yamlScalar(f.role)}`,
    `year: ${f.year}`,
    `featured: ${f.featured}`,
    "art:",
    "art_label:",
    "image:",
    `private: ${f.private}`,
    `updated: ${f.updated}`,
    `draft: ${f.draft}`,
    "links:",
    `  live: ${yamlScalar(f.live)}`.trimEnd(),
    `  repo: ${yamlScalar(f.repo)}`.trimEnd(),
    "  release:",
    "  docs:",
    "---",
  ];
  return lines.join("\n") + "\n";
}

/** The four sections the portfolio's writing guide recommends, used to stub missing ones. */
export const STANDARD_SECTIONS: { heading: string; stub: string }[] = [
  { heading: "Overview", stub: "What it is, in two or three sentences." },
  { heading: "The problem", stub: "Why it exists." },
  { heading: "What I built", stub: "- \n- " },
  { heading: "Outcome", stub: "Where it is now, and what I learned." },
];

/**
 * Assembles the note: frontmatter, a reminder comment, the chosen sections (bodies as given, each
 * starting with its "## Heading" line), then stubs for any standard section not already present.
 * The whole thing is run through the typing-rule sanitiser.
 */
export function buildProjectNote(
  fields: PortfolioProjectFields,
  sections: { heading: string; body: string }[],
  addStubs: boolean,
): { text: string; changes: string[] } {
  const std = (heading: string): number => STANDARD_SECTIONS.findIndex((st) => st.heading.toLowerCase() === heading.trim().toLowerCase());
  const parts = sections.map((s) => ({ rank: std(s.heading), text: s.body.trim() }));
  if (addStubs) {
    STANDARD_SECTIONS.forEach((st, i) => {
      if (parts.some((p) => p.rank === i)) return;
      // Before the first standard section that should come after it, so the order stays natural.
      const at = parts.findIndex((p) => p.rank > i);
      const stub = { rank: i, text: `## ${st.heading}

${st.stub}` };
      if (at < 0) parts.push(stub);
      else parts.splice(at, 0, stub);
    });
  }
  const body = parts.map((p) => p.text).filter(Boolean).join("\n\n");
  const raw =
    projectFrontmatter(fields) +
    "%% Exported by Projects System. Remove draft: true when it's ready to publish. %%\n\n" +
    body +
    "\n";
  return sanitizeTyping(raw);
}

export interface MonthlyProject {
  name: string;
  /** Portfolio slug if the project has been exported, else "". */
  slug: string;
  days: number;
  files: string[];
  created: string[];
  status: { date: string; from: string; to: string }[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A draft monthly post (Portfolio/content/Templates/Monthly post.md shape) from a month's activity. */
export function buildMonthlyPost(month: string, projects: MonthlyProject[]): { text: string; changes: string[] } {
  const [y, m] = month.split("-");
  const title = `${MONTHS[Number(m) - 1]} ${y}`;
  const slugs = projects.map((p) => p.slug).filter(Boolean);
  const fm = [
    "---",
    `title: ${yamlScalar(title)}`,
    "dek: One line on what this month was about.",
    "seo_title:",
    `date: ${month}-01`,
    slugs.length ? `projects: [${slugs.join(", ")}]` : "projects: []",
    "image:",
    "art:",
    "art_label:",
    "draft: true",
    "---",
  ].join("\n");
  return sanitizeTyping(fm + "\n" + monthlyBody(projects) + "\n");
}

/** The body of a monthly post (also what gets appended to an existing post). */
export function monthlyBody(projects: MonthlyProject[]): string {
  const out: string[] = [
    "%% Drafted by Projects System from your activity. Rewrite in your own words; the lists are notes for you. %%",
    "",
  ];
  for (const p of projects) {
    out.push(`## ${p.slug ? `[[${p.name}]]` : p.name}`, "");
    out.push("What happened, in a few sentences.", "");
    const notes: string[] = [];
    for (const s of p.status) notes.push(`- ${s.date}: status ${s.from || "(none)"} to ${s.to || "(none)"}`);
    notes.push(`- Worked on ${p.days} day${p.days === 1 ? "" : "s"}, touched ${p.files.length} note${p.files.length === 1 ? "" : "s"}`);
    if (p.created.length) notes.push(`- New notes: ${p.created.map((f) => f.split("/").pop()!.replace(/\.md$/, "")).join(", ")}`);
    out.push("%%", ...notes, "%%", "");
  }
  return out.join("\n").trimEnd();
}
