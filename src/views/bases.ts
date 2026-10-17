// Custom Bases view types (Obsidian 1.10+): "Project cards" and "Project activity". Bases does the
// filtering, sorting and grouping from the .base file; these views draw the result with the same
// cards and timeline as the dashboard.

import * as obsidian from "obsidian";
import { debounce, normalizePath, setIcon, type BasesAllOptions, type BasesEntry, type BasesPropertyId, type BasesViewConfig, type QueryController } from "obsidian";
import { parseRange } from "../dates";
import { readProject, type ProjectInfo } from "../fields";
import { baseName, parentOf } from "../discovery";
import type ProjectsPlugin from "../main";
import { renderActivity, renderCard } from "./render";

export const CARDS_VIEW = "projects-cards";
export const ACTIVITY_VIEW = "project-activity";

const RANGE_OPTIONS: Record<string, string> = {
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "this-year": "This year",
  custom: "Custom...",
};

/**
 * Registers both views when this Obsidian has the Bases API and Bases is enabled.
 * The classes are created inside this function: on an Obsidian without BasesView, defining them at
 * module load would throw and take the whole plugin down.
 */
export function registerBasesViews(plugin: ProjectsPlugin): boolean {
  const BasesView = (obsidian as { BasesView?: typeof obsidian.BasesView }).BasesView;
  if (typeof BasesView !== "function" || typeof plugin.registerBasesView !== "function") return false;

  /** Shared: re-render when projects or activity change, not just when the base's data does. */
  abstract class LiveView extends BasesView {
    protected readonly rerender = debounce(() => this.onDataUpdated(), 200, true);

    constructor(controller: QueryController, protected readonly el: HTMLElement) {
      super(controller);
    }

    override onload(): void {
      this.registerEvent(plugin.index.on("changed", this.rerender));
      this.registerEvent(plugin.activity.on("changed", this.rerender));
    }

    /** The project an entry belongs to, or null when the note is not part of one. */
    protected projectOf(entry: BasesEntry): ProjectInfo | null {
      return plugin.index.projectFor(entry.file.path) ?? null;
    }
  }

  class ProjectCardsView extends LiveView {
    override type = CARDS_VIEW;

    override onDataUpdated(): void {
      const el = this.el;
      el.empty();
      el.addClass("ps-bases");
      const cfg = this.config;
      const onePerProject = cfg.get("onePerProject") !== false;
      const onlyProjects = cfg.get("onlyProjects") !== false;
      const width = Number(cfg.get("cardWidth") ?? 15);
      const seen = new Set<string>();
      const shown = this.shownProperties();
      // The edit dialog also offers the frontmatter properties this base shows.
      const editKeys = this.config
        .getOrder()
        .filter((id) => id.startsWith("note."))
        .map((id) => id.slice("note.".length));
      let total = 0;

      for (const group of this.data.groupedData) {
        const cards: { p: ProjectInfo; entry: BasesEntry }[] = [];
        for (const entry of group.entries) {
          const project = this.projectOf(entry);
          let p: ProjectInfo | null = null;
          if (project && (onePerProject || entry.file.path === project.mainPath)) {
            if (seen.has(project.id)) continue;
            seen.add(project.id);
            p = project;
          } else if (!onlyProjects || project) {
            p = this.noteAsProject(entry, project);
          }
          if (p) cards.push({ p, entry });
        }
        if (!cards.length) continue;
        total += cards.length;
        const section = el.createDiv({ cls: "ps-section" });
        if (group.hasKey()) {
          const h = section.createDiv({ cls: "ps-section-title" });
          h.createSpan({ text: group.key!.toString() || "(none)" });
          h.createSpan({ cls: "ps-count", text: String(cards.length) });
        }
        const grid = section.createDiv({ cls: "ps-grid" });
        grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${Math.max(10, Math.min(40, width))}rem, 1fr))`;
        for (const { p, entry } of cards) {
          renderCard(grid, plugin, p, {
            status: cfg.get("showStatus") === true,
            actions: cfg.get("showActions") !== false,
            editKeys,
            summary: cfg.get("showSummary") !== false,
            stack: cfg.get("showStack") !== false,
            activity: cfg.get("showActivity") !== false,
            extra: (card) => this.renderProperties(card, entry, shown),
          });
        }
      }
      if (!total) el.createDiv({ cls: "ps-empty", text: "No projects in this base. Check its filters, or turn off \"Only projects\"." });
    }

    /** Properties picked in the base's Properties menu, minus the ones a card already shows. */
    private shownProperties(): BasesPropertyId[] {
      const f = plugin.settings.fields;
      const onCard = new Set<string>([
        "file.name",
        "file.basename",
        `note.${f.status}`,
        `note.${f.summary}`,
        `note.${f.stack}`,
        `note.${f.repo}`,
      ]);
      return this.config.getOrder().filter((id) => !onCard.has(id));
    }

    private renderProperties(card: HTMLElement, entry: BasesEntry, props: BasesPropertyId[]): void {
      const rows: [string, obsidian.Value][] = [];
      for (const id of props) {
        const v = entry.getValue(id);
        if (v && v.isTruthy() && v.toString() !== "") rows.push([this.config.getDisplayName(id), v]);
      }
      if (!rows.length) return;
      const dl = card.createDiv({ cls: "ps-props" });
      for (const [label, value] of rows) {
        dl.createSpan({ cls: "ps-prop-label", text: label });
        const cell = dl.createSpan({ cls: "ps-prop-value" });
        value.renderTo(cell, plugin.app.renderContext);
        // Links inside a card should open their target, not the card's note.
        cell.addEventListener("click", (evt) => {
          if ((evt.target as HTMLElement).closest("a")) evt.stopPropagation();
        });
      }
    }

    /** A card for a single note (research note, or a note outside any project). */
    private noteAsProject(entry: BasesEntry, project: ProjectInfo | null): ProjectInfo {
      const path = entry.file.path;
      const fm = plugin.app.metadataCache.getFileCache(entry.file)?.frontmatter as Record<string, unknown> | undefined;
      const group = project ? [...project.group, project.name] : parentOf(path).split("/").filter(Boolean).slice(-1);
      return readProject({ id: path, name: baseName(path), kind: "file", path, mainPath: path, group }, fm, plugin.settings.fields);
    }
  }

  class ProjectActivityView extends LiveView {
    override type = ACTIVITY_VIEW;

    override onDataUpdated(): void {
      const el = this.el;
      el.empty();
      el.addClass("ps-bases");
      const cfg = this.config;
      const choice = String(cfg.get("range") ?? "this-week");
      const spec = choice === "custom" ? String(cfg.get("customRange") ?? "") : choice;
      const range = parseRange(spec);
      if (!range) {
        el.createDiv({ cls: "ps-error", text: `Unknown range "${spec}". Try 2026-10, 14d or 2026-10-01..2026-10-17.` });
        return;
      }
      // Activity for every project (or loose note) the base's filters let through.
      const ids = new Set<string>();
      for (const entry of this.data.data) ids.add(this.projectOf(entry)?.id ?? entry.file.path);

      const head = el.createDiv({ cls: "ps-range-title" });
      head.createSpan({ text: range.label });
      head.createSpan({ cls: "ps-muted", text: ` ${range.start} to ${range.end}` });
      const copy = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Copy as markdown" } });
      setIcon(copy, "copy");
      copy.addEventListener("click", () => void plugin.copyActivity(range, (id) => ids.has(id)));
      renderActivity(el, plugin, plugin.activity.summary(range, (id) => ids.has(id)), { compact: cfg.get("compact") === true });
    }
  }

  const cardsOk = plugin.registerBasesView(CARDS_VIEW, {
    name: "Project cards",
    icon: "layout-grid",
    factory: (controller, containerEl) => new ProjectCardsView(controller, containerEl),
    options: (): BasesAllOptions[] => [
      { type: "toggle", key: "onePerProject", displayName: "One card per project", default: true },
      { type: "toggle", key: "onlyProjects", displayName: "Only projects", default: true },
      { type: "slider", key: "cardWidth", displayName: "Card width", default: 15, min: 10, max: 30, step: 1 },
      {
        type: "group",
        displayName: "Show",
        items: [
          { type: "toggle", key: "showStatus", displayName: "Status badge", default: false },
          { type: "toggle", key: "showActions", displayName: "Quick actions", default: true },
          { type: "toggle", key: "showSummary", displayName: "Summary", default: true },
          { type: "toggle", key: "showStack", displayName: "Languages", default: true },
          { type: "toggle", key: "showActivity", displayName: "Last worked on", default: true },
        ],
      },
    ],
  });
  const activityOk = plugin.registerBasesView(ACTIVITY_VIEW, {
    name: "Project activity",
    icon: "history",
    factory: (controller, containerEl) => new ProjectActivityView(controller, containerEl),
    options: (config: BasesViewConfig): BasesAllOptions[] => [
      { type: "dropdown", key: "range", displayName: "Range", default: "this-week", options: RANGE_OPTIONS },
      {
        type: "text",
        key: "customRange",
        displayName: "Custom range",
        placeholder: "2026-10, 14d, 2026-10-01..2026-10-17",
        shouldHide: () => config.get("range") !== "custom",
      },
      { type: "toggle", key: "compact", displayName: "Compact", default: false },
    ],
  });
  return cardsOk && activityOk;
}

/**
 * A .base file for your projects folder. Views are listed in the order you choose; Bases opens
 * the first one when the file is opened, so `first` decides the default view.
 */
export function projectsBaseFile(root: string, first: "cards" | "activity" | "table", statusKey: string): string {
  const filter = root ? `    - file.inFolder(${JSON.stringify(root)})\n` : "";
  const views: Record<typeof first, string> = {
    cards: `  - type: ${CARDS_VIEW}\n    name: Projects\n    order:\n      - note.area\n      - note.category\n    sort:\n      - property: file.mtime\n        direction: DESC\n`,
    activity: `  - type: ${ACTIVITY_VIEW}\n    name: Activity\n    range: this-week\n`,
    table: `  - type: table\n    name: Table\n    order:\n      - file.name\n      - note.${statusKey}\n      - note.area\n      - note.category\n      - note.updated\n`,
  };
  const order: (typeof first)[] = [first, ...(["cards", "activity", "table"] as const).filter((v) => v !== first)];
  return `filters:\n  and:\n${filter}    - file.ext == "md"\nviews:\n${order.map((v) => views[v]).join("")}`;
}

export function defaultBasePath(root: string): string {
  return normalizePath(root ? `${root}/Projects.base` : "Projects.base");
}
