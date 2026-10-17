import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addEvent,
  byProject,
  compact,
  emptyActivity,
  lastActivity,
  parseActivity,
  renamePath,
  summarise,
  touchedCount,
} from "../src/activity-store.ts";
import { activityMarkdown } from "../src/summary.ts";

const P = "Personal Projects/Platform/Ticket System";
const F = `${P}/Ticket System.md`;
const R = `${P}/Research/Competitors.md`;
const OCT = { start: "2026-10-01", end: "2026-10-31", label: "October 2026" };

test("dedupes edits per file per day, and edits of a file created that day", () => {
  const d = emptyActivity();
  assert.ok(addEvent(d, { d: "2026-10-17", p: P, k: "create", f: R }));
  assert.ok(!addEvent(d, { d: "2026-10-17", p: P, k: "edit", f: R }));
  assert.ok(addEvent(d, { d: "2026-10-17", p: P, k: "edit", f: F }));
  assert.ok(!addEvent(d, { d: "2026-10-17", p: P, k: "edit", f: F }));
  assert.ok(addEvent(d, { d: "2026-10-18", p: P, k: "edit", f: F }));
  assert.equal(d.events.length, 3);
});

test("status changes on one day collapse; flipping back removes them", () => {
  const d = emptyActivity();
  addEvent(d, { d: "2026-10-17", p: P, k: "status", from: "planning", to: "in progress" });
  addEvent(d, { d: "2026-10-17", p: P, k: "status", from: "in progress", to: "done" });
  assert.deepEqual(d.events.map((e) => [e.from, e.to]), [["planning", "done"]]);
  addEvent(d, { d: "2026-10-17", p: P, k: "status", from: "done", to: "planning" });
  assert.equal(d.events.length, 0);
});

test("rename rewrites project and file paths", () => {
  const d = emptyActivity();
  addEvent(d, { d: "2026-10-17", p: P, k: "edit", f: R });
  renamePath(d, P, "Personal Projects/Platform/Helpdesk");
  assert.deepEqual(d.events[0], { d: "2026-10-17", p: "Personal Projects/Platform/Helpdesk", k: "edit", f: "Personal Projects/Platform/Helpdesk/Research/Competitors.md" });
});

test("compaction folds old per-file edits into a count", () => {
  const d = emptyActivity();
  addEvent(d, { d: "2026-01-02", p: P, k: "edit", f: F });
  addEvent(d, { d: "2026-01-02", p: P, k: "edit", f: R });
  addEvent(d, { d: "2026-01-02", p: P, k: "create", f: `${P}/x.md` });
  addEvent(d, { d: "2026-10-16", p: P, k: "edit", f: F });
  assert.ok(compact(d, "2026-10-17", 90));
  assert.deepEqual(d.events.map((e) => [e.d, e.k, e.f ?? null, e.n ?? null]), [
    ["2026-01-02", "edit", null, 2],
    ["2026-01-02", "create", `${P}/x.md`, null],
    ["2026-10-16", "edit", F, null],
  ]);
  assert.ok(!compact(d, "2026-10-17", 90));
});

test("summaries by day and by project, and markdown", () => {
  const d = parseActivity({
    version: 1,
    backfilled: true,
    events: [
      { d: "2026-10-03", p: P, k: "create", f: R },
      { d: "2026-10-03", p: "Personal Projects/A-Level/BAnim.md", k: "edit", f: "Personal Projects/A-Level/BAnim.md" },
      { d: "2026-10-16", p: P, k: "edit", f: F },
      { d: "2026-10-16", p: P, k: "status", from: "planning", to: "in progress" },
      { d: "2026-09-30", p: P, k: "edit", f: F },
      { junk: true },
    ],
  });
  assert.equal(d.events.length, 5);
  const days = summarise(d, OCT);
  assert.deepEqual(days.map((x) => x.date), ["2026-10-16", "2026-10-03"]);
  assert.equal(touchedCount(days[1]!.projects.find((x) => x.project === P)!), 1);
  const per = byProject(days);
  assert.deepEqual(per.get(P)?.days, ["2026-10-16", "2026-10-03"]);
  assert.deepEqual([...per.get(P)!.files].sort(), [R, F].sort());
  assert.equal(lastActivity(d).get(P), "2026-10-16");

  const md = activityMarkdown(days, OCT, (id) => id.split("/").pop()!.replace(/\.md$/, ""));
  assert.match(md, /^## Activity: October 2026 \(2026-10-01 to 2026-10-31\)/);
  assert.match(md, /### \[\[Ticket System\]\]\n\n- Active on 2 days \(last 2026-10-16\)\n- 2026-10-16: status planning to in progress\n- New: \[\[Competitors\]\]\n- Edited: \[\[Ticket System\]\]/);
  // Only projects in the filter
  assert.equal(summarise(d, OCT, (id) => id === P).flatMap((x) => x.projects).length, 2);
});
