// Activity as markdown: "Copy activity summary", and the frozen text the review command writes.
// Pure: no Obsidian imports.

import { byProject, type DaySummary } from "./activity-store.ts";
import type { DateRange } from "./dates.ts";

function noteName(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

/**
 * One section per project (most active first) with status changes, new notes and edited notes as
 * wikilinks, so the result is useful pasted into a note or handed to an LLM to write up.
 */
export function activityMarkdown(days: DaySummary[], range: DateRange, nameOf: (id: string) => string): string {
  const per = [...byProject(days).entries()].sort((a, b) => b[1].days.length - a[1].days.length || nameOf(a[0]).localeCompare(nameOf(b[0])));
  const lines = [`## Activity: ${range.label} (${range.start} to ${range.end})`, ""];
  if (!per.length) {
    lines.push("No project activity in this range.");
    return lines.join("\n");
  }
  for (const [id, agg] of per) {
    const n = agg.days.length;
    lines.push(`### [[${nameOf(id)}]]`, "");
    lines.push(`- Active on ${n} day${n === 1 ? "" : "s"} (last ${agg.days[0]})`);
    for (const s of [...agg.status].reverse()) lines.push(`- ${s.date}: status ${s.from || "(none)"} to ${s.to || "(none)"}`);
    const created = [...agg.created].filter((f) => /\.md$/i.test(f));
    const edited = [...agg.files].filter((f) => !agg.created.has(f) && /\.md$/i.test(f));
    const other = [...agg.files].filter((f) => !/\.md$/i.test(f)).length;
    if (created.length) lines.push(`- New: ${created.map((f) => `[[${noteName(f)}]]`).join(", ")}`);
    if (edited.length) lines.push(`- Edited: ${edited.map((f) => `[[${noteName(f)}]]`).join(", ")}`);
    if (other) lines.push(`- ${other} attachment${other === 1 ? "" : "s"} added or changed`);
    if (agg.folded) lines.push(`- ${agg.folded} older edit${agg.folded === 1 ? "" : "s"}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
