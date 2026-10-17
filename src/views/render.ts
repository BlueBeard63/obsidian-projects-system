// Rendering shared by the dashboard and the code blocks: grid cards, table, list and the activity
// timeline. Everything uses Obsidian's theme variables (see styles.css), so light/dark just work.

import { Keymap, Menu, Notice, setIcon, type App } from "obsidian";
import { touchedCount, type DaySummary } from "../activity-store";
import { dayLabel, daysBetween, isoDate, relativeDay } from "../dates";
import { asText, isFinished, statusRank, type ProjectInfo } from "../fields";
import { groupProjects, type ViewKind } from "../query";
import type ProjectsPlugin from "../main";

const PALETTE = ["blue", "purple", "orange", "cyan", "yellow", "pink", "red"];

/** Theme colour for a status: finished ones are green, the rest follow their position in the order. */
export function statusColour(plugin: ProjectsPlugin, status: string): string {
  if (!status) return "base";
  if (isFinished(status, plugin.settings.finishedStatuses)) return "green";
  const rank = statusRank(status, plugin.index.statuses());
  return PALETTE[rank % PALETTE.length];
}

export async function openProject(app: App, p: ProjectInfo, evt?: MouseEvent | KeyboardEvent): Promise<void> {
  const path = p.mainPath ?? app.vault.getFiles().find((f) => f.path.startsWith(p.path + "/") && f.extension === "md")?.path;
  const file = path ? app.vault.getFileByPath(path) : null;
  if (!file) {
    new Notice(`${p.name} has no notes yet.`);
    return;
  }
  await app.workspace.getLeaf(evt ? Keymap.isModEvent(evt) : false).openFile(file);
}

/** The status as plain text; when editable, clicking it opens the status menu. */
export function statusText(el: HTMLElement, plugin: ProjectsPlugin, p: ProjectInfo, editable = true): HTMLElement {
  const span = el.createSpan({ cls: "ps-status-text", text: p.status });
  if (!editable) return span;
  span.addClass("ps-status-edit");
  span.setAttr("aria-label", "Change status");
  span.addEventListener("click", (e) => {
    const evt = e as MouseEvent;
    evt.preventDefault();
    evt.stopPropagation();
    statusMenu(plugin, p).showAtMouseEvent(evt);
  });
  return span;
}

export function statusMenu(plugin: ProjectsPlugin, p: ProjectInfo): Menu {
  const menu = new Menu();
  for (const s of plugin.index.statuses()) {
    menu.addItem((item) =>
      item
        .setTitle(s)
        .setChecked(s.toLowerCase() === p.status.toLowerCase())
        .onClick(() => void plugin.index.setStatus(p, s)),
    );
  }
  return menu;
}

export interface RenderOptions {
  view: ViewKind;
  groupBy: string;
  /** Status pills open a menu (dashboard and blocks), unless false. */
  editable?: boolean;
  /** Current table sort, to mark the header; clicking a header calls onSort. */
  sort?: string;
  descending?: boolean;
  onSort?: (key: string) => void;
}

export function renderProjects(el: HTMLElement, plugin: ProjectsPlugin, list: ProjectInfo[], opts: RenderOptions): void {
  if (!list.length) {
    el.createDiv({ cls: "ps-empty", text: "No projects match." });
    return;
  }
  const sections = groupProjects(list, opts.groupBy, plugin.index.statuses());
  for (const section of sections) {
    const wrap = el.createDiv({ cls: "ps-section" });
    if (section.title) {
      const h = wrap.createDiv({ cls: "ps-section-title" });
      h.createSpan({ text: section.title });
      h.createSpan({ cls: "ps-count", text: String(section.items.length) });
    }
    if (opts.view === "table") renderTable(wrap, plugin, section.items, opts);
    else if (opts.view === "list") renderList(wrap, plugin, section.items);
    else renderGrid(wrap, plugin, section.items);
  }
}

function lastWorked(plugin: ProjectsPlugin, p: ProjectInfo): string {
  return plugin.activity.lastActivity().get(p.id) ?? "";
}

function isStale(plugin: ProjectsPlugin, p: ProjectInfo, today: string): boolean {
  if (isFinished(p.status, plugin.settings.finishedStatuses)) return false;
  const last = lastWorked(plugin, p) || p.updated;
  return !!last && daysBetween(last, today) > plugin.settings.staleDays;
}

function clickable(el: HTMLElement, plugin: ProjectsPlugin, p: ProjectInfo): void {
  el.addClass("ps-clickable");
  el.tabIndex = 0;
  el.addEventListener("click", (evt) => void openProject(plugin.app, p, evt));
  el.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") void openProject(plugin.app, p, evt);
  });
  el.addEventListener("contextmenu", (evt) => {
    evt.preventDefault();
    plugin.projectMenu(p).showAtMouseEvent(evt);
  });
}

function renderGrid(el: HTMLElement, plugin: ProjectsPlugin, list: ProjectInfo[]): void {
  const grid = el.createDiv({ cls: "ps-grid" });
  const today = isoDate(new Date());
  for (const p of list) {
    const card = grid.createDiv({ cls: "ps-card" });
    card.style.setProperty("--ps-accent", `var(--color-${statusColour(plugin, p.status)}, var(--text-faint))`);
    clickable(card, plugin, p);
    const top = card.createDiv({ cls: "ps-card-top" });
    if (p.group.length) top.createSpan({ cls: "ps-group", text: p.group.join(" / ") });
    cardActions(card, plugin, p);
    const title = card.createDiv({ cls: "ps-card-title" });
    setIcon(title.createSpan({ cls: "ps-kind" }), p.kind === "folder" ? "folder" : "file-text");
    title.createSpan({ text: p.name });
    if (p.summary) card.createDiv({ cls: "ps-summary", text: p.summary });
    if (p.stack.length) {
      const chips = card.createDiv({ cls: "ps-chips" });
      for (const s of p.stack) chips.createSpan({ cls: "ps-chip", text: s });
    }
    const foot = card.createDiv({ cls: "ps-card-foot" });
    const last = lastWorked(plugin, p);
    const when = foot.createSpan({ cls: "ps-when" });
    setIcon(when.createSpan(), "history");
    when.createSpan({ text: last ? `worked on ${relativeDay(last, today)}` : p.updated ? `updated ${relativeDay(p.updated, today)}` : "no activity yet" });
    if (isStale(plugin, p, today)) foot.createSpan({ cls: "ps-stale", text: "stale" });
    if (p.repo) {
      const link = foot.createEl("a", { cls: "ps-repo", href: p.repo, attr: { "aria-label": p.repo, target: "_blank" } });
      setIcon(link, "github");
      link.addEventListener("click", (evt) => evt.stopPropagation());
    }
  }
}

/** Small buttons shown on hover (always on touch screens): new note, edit, more. */
function cardActions(card: HTMLElement, plugin: ProjectsPlugin, p: ProjectInfo): void {
  const bar = card.createDiv({ cls: "ps-card-actions" });
  const button = (icon: string, label: string, run: (evt: MouseEvent) => void): void => {
    const b = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
    setIcon(b, icon);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      run(e);
    });
    b.addEventListener("keydown", (e) => e.stopPropagation());
  };
  button("file-plus", "New note in project", () => plugin.newProjectNote(p));
  button("pencil", "Edit project", () => plugin.editProject(p));
  button("more-horizontal", "More", (e) => plugin.projectMenu(p).showAtMouseEvent(e));
}

const TABLE_COLUMNS: { key: string; label: string }[] = [
  { key: "name", label: "Project" },
  { key: "group", label: "Group" },
  { key: "status", label: "Status" },
  { key: "area", label: "Area" },
  { key: "category", label: "Category" },
  { key: "stack", label: "Languages" },
  { key: "updated", label: "Updated" },
  { key: "last-activity", label: "Last worked on" },
];

function renderTable(el: HTMLElement, plugin: ProjectsPlugin, list: ProjectInfo[], opts: RenderOptions): void {
  const wrap = el.createDiv({ cls: "ps-table-wrap" });
  const table = wrap.createEl("table", { cls: "ps-table" });
  const head = table.createEl("thead").createEl("tr");
  const today = isoDate(new Date());
  for (const col of TABLE_COLUMNS) {
    const th = head.createEl("th", { text: col.label });
    if (opts.onSort) {
      th.addClass("ps-sortable");
      if (opts.sort === col.key) th.addClass(opts.descending ? "ps-sorted-desc" : "ps-sorted-asc");
      th.addEventListener("click", () => opts.onSort!(col.key));
    }
  }
  const body = table.createEl("tbody");
  for (const p of list) {
    const tr = body.createEl("tr");
    const name = tr.createEl("td", { cls: "ps-name" });
    const link = name.createEl("a", { text: p.name, cls: "internal-link" });
    link.addEventListener("click", (evt) => {
      evt.preventDefault();
      void openProject(plugin.app, p, evt);
    });
    if (p.summary) name.createDiv({ cls: "ps-summary", text: p.summary });
    tr.createEl("td", { text: p.group.join(" / ") });
    statusText(tr.createEl("td"), plugin, p, opts.editable !== false);
    tr.createEl("td", { text: asText(p.fm["area"]) });
    tr.createEl("td", { text: asText(p.fm["category"]) });
    tr.createEl("td", { text: p.stack.join(", ") });
    tr.createEl("td", { text: p.updated, cls: "ps-date" });
    const last = lastWorked(plugin, p);
    const lastTd = tr.createEl("td", { cls: "ps-date", text: last ? relativeDay(last, today) : "" });
    if (last) lastTd.setAttr("title", last);
    if (isStale(plugin, p, today)) lastTd.createSpan({ cls: "ps-stale", text: "stale" });
    tr.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      plugin.projectMenu(p).showAtMouseEvent(evt);
    });
  }
}

function renderList(el: HTMLElement, plugin: ProjectsPlugin, list: ProjectInfo[]): void {
  const ul = el.createEl("ul", { cls: "ps-list" });
  for (const p of list) {
    const li = ul.createEl("li");
    const link = li.createEl("a", { text: p.name, cls: "internal-link" });
    link.addEventListener("click", (evt) => {
      evt.preventDefault();
      void openProject(plugin.app, p, evt);
    });
    if (p.status) li.createSpan({ cls: "ps-muted", text: ` (${p.status})` });
    if (p.summary) li.createSpan({ cls: "ps-summary-inline", text: ` ${p.summary}` });
  }
}

function noteLink(el: HTMLElement, plugin: ProjectsPlugin, path: string): void {
  const name = path.split("/").pop()!.replace(/\.md$/i, "");
  const exists = !!plugin.app.vault.getFileByPath(path);
  const a = el.createEl("a", { text: name, cls: exists ? "internal-link" : "ps-gone" });
  if (!exists) {
    a.setAttr("title", "No longer exists");
    return;
  }
  a.addEventListener("click", (evt) => {
    evt.preventDefault();
    void plugin.app.workspace.openLinkText(path, "", Keymap.isModEvent(evt));
  });
}

/** The activity timeline: one block per day, one row per project touched that day. */
export function renderActivity(el: HTMLElement, plugin: ProjectsPlugin, days: DaySummary[], opts: { compact?: boolean } = {}): void {
  if (!days.length) {
    el.createDiv({ cls: "ps-empty", text: "No project activity in this range." });
    return;
  }
  const projectsTouched = new Set(days.flatMap((d) => d.projects.map((p) => p.project)));
  el.createDiv({
    cls: "ps-activity-stats",
    text: `${projectsTouched.size} project${projectsTouched.size === 1 ? "" : "s"} on ${days.length} day${days.length === 1 ? "" : "s"}`,
  });
  const timeline = el.createDiv({ cls: "ps-timeline" });
  for (const day of days) {
    const block = timeline.createDiv({ cls: "ps-day" });
    block.createDiv({ cls: "ps-day-title", text: dayLabel(day.date) });
    for (const pd of day.projects) {
      const p = plugin.index.get(pd.project);
      const row = block.createDiv({ cls: "ps-day-row" });
      const name = row.createDiv({ cls: "ps-day-project" });
      if (p) {
        const a = name.createEl("a", { text: p.name, cls: "internal-link" });
        a.addEventListener("click", (evt) => {
          evt.preventDefault();
          void openProject(plugin.app, p, evt);
        });
      } else {
        name.createSpan({ cls: "ps-gone", text: pd.project.split("/").pop()!.replace(/\.md$/i, "") });
      }
      const detail = row.createDiv({ cls: "ps-day-detail" });
      for (const s of pd.status) {
        const line = detail.createDiv({ cls: "ps-change" });
        setIcon(line.createSpan(), "flag");
        line.createSpan({ text: ` ${s.from || "no status"} ` });
        setIcon(line.createSpan(), "arrow-right");
        line.createSpan({ text: ` ${s.to || "no status"}` });
      }
      if (opts.compact) {
        const n = touchedCount(pd);
        if (n) detail.createDiv({ cls: "ps-muted", text: `${n} note${n === 1 ? "" : "s"} touched` });
        continue;
      }
      const files = (label: string, icon: string, paths: string[]): void => {
        if (!paths.length) return;
        const line = detail.createDiv({ cls: "ps-files" });
        setIcon(line.createSpan({ cls: "ps-files-icon", attr: { "aria-label": label } }), icon);
        paths.forEach((path, i) => {
          if (i) line.appendText(", ");
          noteLink(line, plugin, path);
        });
      };
      files("Created", "file-plus", pd.created);
      files("Edited", "pencil", pd.edited.filter((f) => !pd.created.includes(f)));
      files("Deleted", "trash-2", pd.deleted);
      if (pd.renamed.length) files("Renamed", "pencil-line", pd.renamed.map((r) => r.to));
      if (pd.editedCount) detail.createDiv({ cls: "ps-muted", text: `${pd.editedCount} edit${pd.editedCount === 1 ? "" : "s"}` });
    }
  }
}
