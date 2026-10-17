import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOutsideCode, nextCase, rewriteLinks, sanitizeTyping, slugify, stripComments } from "../src/export/sanitize.ts";
import { buildMonthlyPost, buildProjectNote, portfolioFields, yamlScalar } from "../src/export/notes.ts";
import { splitFrontmatter, splitSections } from "../src/sections.ts";
import { DEFAULT_FIELDS, readProject } from "../src/fields.ts";

// Every character Portfolio/internal/site/typeable.go rejects.
const UNTYPEABLE = /[—–·×‘’“”…→←]/;

test("typing rule: same characters as typeable.go", () => {
  const r = sanitizeTyping("A — B–C · D 3×4 ‘x’ “y” wait… a→b b←a and A—B");
  assert.equal(r.text, `A - B-C / D 3x4 'x' "y" wait... a->b b<-a and A - B`);
  assert.ok(!UNTYPEABLE.test(r.text));
  assert.ok(r.changes.includes("2 x em dash"));
  assert.ok(r.changes.includes("4 x curly quote"));
});

test("slugify matches content.go; case numbers", () => {
  assert.equal(slugify("Nerve Media"), "nerve-media");
  assert.equal(slugify("  C# / .NET ORM!! "), "c-net-orm");
  assert.equal(nextCase(['"0x01"', "0x0B", "0x02", "nope"]), "0x0C");
  assert.equal(nextCase([]), "0x01");
  assert.equal(nextCase(["0xFF"]), "0x100");
});

test("links: keep resolvable, unlink the rest, keep media embeds, drop note embeds, skip code", () => {
  const known = new Set(["bosun"]);
  const text = [
    "Built on [[Bosun]] and [[Private Notes|my notes]] and [[Research/Competitors#Pricing]].",
    "![[Projects/shots/banim-editor.png|The editor]]",
    "![[Some Note]]",
    "`[[Inline]]`",
    "```md",
    "[[InFence]]",
    "```",
  ].join("\n");
  const r = rewriteLinks(text, (t) => known.has(t.toLowerCase()));
  assert.equal(
    r.text,
    [
      "Built on [[Bosun]] and my notes and Competitors.",
      "![[banim-editor.png|The editor]]",
      "",
      "`[[Inline]]`",
      "```md",
      "[[InFence]]",
      "```",
    ].join("\n"),
  );
  assert.deepEqual(r.embeds, ["Projects/shots/banim-editor.png"]);
  assert.deepEqual(r.unlinked, ["Private Notes", "Research/Competitors#Pricing"]);
  assert.deepEqual(r.droppedEmbeds, ["Some Note"]);
  assert.equal(mapOutsideCode("a `b` c", (s) => s.toUpperCase()), "A `b` C");
  assert.equal(stripComments("keep %% secret %%\nthis"), "keep this");
});

test("sections: frontmatter, ## headings, fences, title line", () => {
  const { frontmatter, body } = splitFrontmatter("---\nstatus: done\n---\n# BAnim\n\nIntro text.\n\n## Overview\n\nOne.\n\n```md\n## not a heading\n```\n\n## Log\n- did x\n");
  assert.equal(frontmatter, "status: done");
  const s = splitSections(body);
  assert.deepEqual(s.map((x) => x.heading), ["", "Overview", "Log"]);
  assert.equal(s[0]!.body.trim(), "Intro text.");
  assert.match(s[1]!.body, /## not a heading/);
  assert.equal(splitFrontmatter("no frontmatter").body, "no frontmatter");
});

const BANIM = readProject(
  { id: "x", name: "BAnim", kind: "file", path: "x", mainPath: "x", group: ["A-Level"] },
  {
    tags: ["project", "banim"],
    status: "done",
    github: "https://github.com/BlueBeard63/BAnim",
    language: "C#",
    created: "2023-04-09",
    updated: "2025-10-14",
    summary: "Frame-by-frame sprite animation engine — fast",
    languages: ["C#"],
    area: "A-Level",
    category: "Library",
  },
  DEFAULT_FIELDS,
);

test("portfolio project note: fields, order, stubs, typing rule", () => {
  const f = portfolioFields(BANIM, { caseNumber: "0x0D", statusMap: { Done: "released" }, role: "solo / author", today: "2026-10-17" });
  assert.equal(f.slug, "banim");
  assert.equal(f.status, "released");
  assert.equal(f.year, "2023");
  assert.deepEqual(f.stack, ["c#"]);
  assert.equal(f.private, false);
  const note = buildProjectNote(f, [{ heading: "Overview", body: "## Overview\n\nIt animates sprites… quickly." }], true);
  assert.ok(!UNTYPEABLE.test(note.text));
  const { frontmatter, body } = splitFrontmatter(note.text);
  assert.match(frontmatter, /^title: BAnim\nslug: banim\nsummary: Frame-by-frame sprite animation engine - fast\n/);
  assert.match(frontmatter, /stack:\n {2}- "c#"\ncase: "0x0D"\nrole: solo \/ author\nyear: 2023\nfeatured: false\n/);
  assert.match(frontmatter, /draft: true\nlinks:\n {2}live:\n {2}repo: "https:\/\/github.com\/BlueBeard63\/BAnim"\n {2}release:\n {2}docs:$/);
  assert.deepEqual(splitSections(body).map((s) => s.heading).filter(Boolean), ["Overview", "The problem", "What I built", "Outcome"]);
  const mixed = buildProjectNote(f, [{ heading: "Intro", body: "## Intro\n\nx" }, { heading: "What I built", body: "## What I built\n\n- y" }], true);
  assert.deepEqual(splitSections(splitFrontmatter(mixed.text).body).map((s) => s.heading).filter(Boolean), ["Intro", "Overview", "The problem", "What I built", "Outcome"]);
  assert.match(body, /It animates sprites\.\.\. quickly\./);
});

test("yaml scalars", () => {
  assert.equal(yamlScalar("solo / author"), "solo / author");
  assert.equal(yamlScalar("true"), '"true"');
  assert.equal(yamlScalar("2026"), '"2026"');
  assert.equal(yamlScalar("a: b"), '"a: b"');
  assert.equal(yamlScalar("C#"), '"C#"');
  assert.equal(yamlScalar(""), "");
});

test("monthly post", () => {
  const post = buildMonthlyPost("2026-10", [
    { name: "BAnim", slug: "banim", days: 3, files: ["a.md", "b.md"], created: ["A-Level/BAnim/New idea.md"], status: [{ date: "2026-10-16", from: "in progress", to: "done" }] },
    { name: "Ticket System", slug: "", days: 1, files: ["c.md"], created: [], status: [] },
  ]);
  const { frontmatter, body } = splitFrontmatter(post.text);
  assert.match(frontmatter, /^title: October 2026\n/);
  assert.match(frontmatter, /\ndate: 2026-10-01\nprojects: \[banim\]\n/);
  assert.match(frontmatter, /\ndraft: true$/);
  assert.deepEqual(splitSections(body).map((s) => s.heading).filter(Boolean), ["[[BAnim]]", "Ticket System"]);
  assert.match(body, /- 2026-10-16: status in progress to done/);
  assert.match(body, /- New notes: New idea/);
  assert.ok(!UNTYPEABLE.test(post.text));
});
