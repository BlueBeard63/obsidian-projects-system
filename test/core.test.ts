import { test } from "node:test";
import assert from "node:assert/strict";
import { daysBetween, normaliseDate, parseRange, relativeDay } from "../src/dates.ts";
import { discoverProjects, projectForPath, type NoteEntry } from "../src/discovery.ts";
import { asList, asText, DEFAULT_FIELDS, fieldValues, isFinished, orderedStatuses, readProject } from "../src/fields.ts";
import { groupProjects, matches, parseQuery, sortProjects } from "../src/query.ts";

// Fri 17 Oct 2026
const NOW = new Date(2026, 9, 17, 15, 30);

test("ranges", () => {
  assert.deepEqual(parseRange("this-week", NOW), { start: "2026-10-12", end: "2026-10-18", label: "This week" });
  assert.deepEqual(parseRange("last week", NOW), { start: "2026-10-05", end: "2026-10-11", label: "Last week" });
  assert.deepEqual(parseRange("this-month", NOW), { start: "2026-10-01", end: "2026-10-31", label: "This month" });
  assert.deepEqual(parseRange("last-month", NOW), { start: "2026-09-01", end: "2026-09-30", label: "September 2026" });
  assert.deepEqual(parseRange("14d", NOW), { start: "2026-10-04", end: "2026-10-17", label: "Last 14 days" });
  assert.deepEqual(parseRange("2026-02", NOW), { start: "2026-02-01", end: "2026-02-28", label: "February 2026" });
  assert.deepEqual(parseRange("2026-10-20..2026-10-01", NOW)?.start, "2026-10-01");
  assert.equal(parseRange("2026-13", NOW), null);
  assert.equal(parseRange("whenever", NOW), null);
  // January's "last month" crosses the year
  assert.equal(parseRange("last-month", new Date(2026, 0, 5))?.start, "2025-12-01");
  // Sunday still belongs to the week that started Monday
  assert.equal(parseRange("this-week", new Date(2026, 9, 18))?.start, "2026-10-12");
});

test("date helpers", () => {
  assert.equal(daysBetween("2026-10-01", "2026-10-17"), 16);
  assert.equal(normaliseDate("2025-10-14"), "2025-10-14");
  assert.equal(normaliseDate(new Date(Date.UTC(2023, 3, 9))), "2023-04-09");
  assert.equal(normaliseDate("soon"), "");
  assert.equal(relativeDay("2026-10-17", "2026-10-17"), "today");
  assert.equal(relativeDay("2026-10-16", "2026-10-17"), "yesterday");
  assert.equal(relativeDay("2026-10-01", "2026-10-17"), "2 weeks ago");
});

const OPTS = { root: "Personal Projects", categoryDepth: 1, projectTag: "project", ignore: ["Templates"] };
const n = (path: string, ...tags: string[]): NoteEntry => ({ path, tags });
const NOTES: NoteEntry[] = [
  n("Personal Projects/A-Level/BAnim.md", "#project"),
  n("Personal Projects/A-Level/Savers.md"),
  n("Personal Projects/Platform/Ticket System/Ticket System.md", "#project"),
  n("Personal Projects/Platform/Ticket System/Research/Competitors.md"),
  n("Personal Projects/Platform/Ticket System/Research/Deep/Notes.md"),
  n("Personal Projects/Platform/Marlin/Design.md"), // folder project without a folder note
  n("Personal Projects/A-Level/Assets/preview.png"),
  n("Personal Projects/Platform/Nested/Deeper/Thing.md", "#project"), // inside the Nested folder project
  n("Personal Projects/Templates/Project.md", "#project"),
  n("Personal Projects/README.md"),
  n("Elsewhere/Other.md", "#project"),
];
const FOLDERS = [
  "Personal Projects",
  "Personal Projects/A-Level",
  "Personal Projects/Platform",
  "Personal Projects/Platform/Ticket System",
  "Personal Projects/Platform/Ticket System/Research",
  "Personal Projects/Platform/Ticket System/Research/Deep",
  "Personal Projects/Platform/Marlin",
  "Personal Projects/Platform/Nested",
  "Personal Projects/Platform/Nested/Deeper",
  "Personal Projects/Templates",
  "Personal Projects/A-Level/Assets", // only images, no notes
  "Elsewhere",
];

test("discovery: file and folder projects in category folders", () => {
  const ps = discoverProjects(NOTES, FOLDERS, OPTS);
  assert.deepEqual(
    ps.map((p) => [p.name, p.kind, p.mainPath, p.group.join("/")]),
    [
      ["BAnim", "file", "Personal Projects/A-Level/BAnim.md", "A-Level"],
      ["Marlin", "folder", null, "Platform"],
      ["Nested", "folder", null, "Platform"],
      ["Savers", "file", "Personal Projects/A-Level/Savers.md", "A-Level"],
      ["Ticket System", "folder", "Personal Projects/Platform/Ticket System/Ticket System.md", "Platform"],
    ],
  );
  assert.equal(projectForPath("Personal Projects/Platform/Ticket System/Research/Deep/Notes.md", ps)?.name, "Ticket System");
  assert.equal(projectForPath("Personal Projects/README.md", ps), undefined);
  assert.equal(projectForPath("Personal Projects/A-Level/BAnim.md", ps)?.name, "BAnim");
});

test("discovery: tagged notes anywhere under the root, depth 0, whole vault", () => {
  const tagged = discoverProjects([...NOTES, n("Personal Projects/A-Level/Old/Side.md", "project/archived")], FOLDERS, OPTS);
  assert.ok(tagged.some((p) => p.name === "Side" && p.kind === "file"));
  const flat = discoverProjects(NOTES, FOLDERS, { ...OPTS, categoryDepth: 0 });
  assert.deepEqual(flat.map((p) => p.name).sort(), ["A-Level", "Platform", "README"]);
  const vault = discoverProjects(NOTES, FOLDERS, { ...OPTS, root: "", categoryDepth: 2 });
  assert.ok(vault.some((p) => p.name === "Other")); // tagged, outside Personal Projects
});

test("fields: your frontmatter shape", () => {
  const def = discoverProjects(NOTES, FOLDERS, OPTS).find((p) => p.name === "Ticket System")!;
  const p = readProject(
    def,
    {
      tags: ["project", "personal"],
      status: "planning",
      updated: "2026-10-14",
      summary: "Self-hosted support desk; Nerve hosts a copy",
      languages: ["Go", "TypeScript"],
      framework: "[[Bosun]]",
      area: "Personal",
      category: "Platform",
    },
    DEFAULT_FIELDS,
  );
  assert.equal(p.status, "planning");
  assert.deepEqual(p.stack, ["Go", "TypeScript"]);
  assert.equal(p.updated, "2026-10-14");
  assert.equal(p.created, "");
  assert.deepEqual(fieldValues(p, "framework"), ["Bosun"]);
  assert.deepEqual(fieldValues(p, "Area"), ["Personal"]);
  assert.deepEqual(fieldValues(p, "group"), ["Platform", "Platform"]);
  assert.equal(asText("[[Bosun|the framework]]"), "the framework");
  assert.deepEqual(asList("C#, Go"), ["C#", "Go"]);
  assert.deepEqual(orderedStatuses(["done", "Planning", "live"], ["planning", "in progress", "done"]), ["planning", "in progress", "done", "live"]);
  assert.ok(isFinished("Done", ["done"]));
  assert.ok(!isFinished("", ["done"]));
});

function project(name: string, fm: Record<string, unknown>, group = "A") {
  return readProject({ id: name, name, kind: "file", path: name, mainPath: name, group: [group] }, fm, DEFAULT_FIELDS);
}

test("query: parse, match, sort, group", () => {
  const q = parseQuery("status: planning, In Progress\n-area: A-Level\nsort: last-activity\nview: table\nlimit: 2\nbogus\nrange: 2026-10", NOW);
  assert.deepEqual(q.filters, [
    { key: "status", values: ["planning", "In Progress"], negate: false },
    { key: "area", values: ["A-Level"], negate: true },
  ]);
  assert.equal(q.sort, "last-activity");
  assert.equal(q.view, "table");
  assert.equal(q.limit, 2);
  assert.equal(q.range?.start, "2026-10-01");
  assert.equal(q.errors.length, 1);

  const a = project("Alpha", { status: "in progress", area: "Personal", updated: "2026-10-01" });
  const b = project("Beta", { status: "planning", area: "A-Level", updated: "2026-09-01" });
  const c = project("Gamma", { status: "done", updated: "2026-10-10" }, "B");
  const d = project("Delta", {});
  assert.deepEqual([a, b, c, d].filter((p) => matches(p, q)).map((p) => p.name), ["Alpha"]);
  assert.deepEqual([a, b, c, d].filter((p) => matches(p, parseQuery("status: none"))).map((p) => p.name), ["Delta"]);
  assert.deepEqual([a, b, c, d].filter((p) => matches(p, parseQuery("search: alp"))).map((p) => p.name), ["Alpha"]);

  const order = ["planning", "in progress", "done"];
  const last = new Map([["Beta", "2026-10-16"], ["Alpha", "2026-10-02"]]);
  assert.deepEqual(sortProjects([a, b, c, d], "status", false, order, last).map((p) => p.name), ["Beta", "Alpha", "Gamma", "Delta"]);
  assert.deepEqual(sortProjects([a, b, c, d], "last-activity", false, order, last).map((p) => p.name), ["Beta", "Alpha", "Delta", "Gamma"]);
  assert.deepEqual(sortProjects([a, b, c, d], "updated", false, order, last).map((p) => p.name), ["Gamma", "Alpha", "Beta", "Delta"]);
  assert.deepEqual(sortProjects([a, b, c, d], "name", true, order, last).map((p) => p.name), ["Gamma", "Delta", "Beta", "Alpha"]);

  const groups = groupProjects([a, b, c, d], "status", order);
  assert.deepEqual(groups.map((g) => g.title), ["planning", "in progress", "done", "(none)"]);
  assert.deepEqual(groupProjects([a, b, c], "group", order).map((g) => [g.title, g.items.length]), [["A", 2], ["B", 1]]);
});
