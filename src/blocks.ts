import { MarkdownRenderChild, debounce, setIcon } from "obsidian";
import { parseQuery, matches, sortProjects, type ProjectQuery } from "./query";
import { parseRange } from "./dates";
import type ProjectsPlugin from "./main";
import { renderActivity, renderProjects } from "./views/render";

/**
 * The plugin's code blocks. Both re-render when projects or activity change.
 *
 *   ```projects            a filtered grid / table / list of projects
 *   ```project-activity    what you worked on in a range
 */
export function registerBlocks(plugin: ProjectsPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor("projects", (source, el, ctx) => {
    ctx.addChild(new LiveBlock(el, plugin, source, renderProjectsBlock));
  });
  plugin.registerMarkdownCodeBlockProcessor("project-activity", (source, el, ctx) => {
    ctx.addChild(new LiveBlock(el, plugin, source, renderActivityBlock));
  });
}

type BlockRenderer = (el: HTMLElement, plugin: ProjectsPlugin, q: ProjectQuery) => void;

class LiveBlock extends MarkdownRenderChild {
  private readonly rerender = debounce(() => this.render(), 200, true);

  constructor(
    el: HTMLElement,
    private readonly plugin: ProjectsPlugin,
    private readonly source: string,
    private readonly renderer: BlockRenderer,
  ) {
    super(el);
  }

  override onload(): void {
    this.registerEvent(this.plugin.index.on("changed", this.rerender));
    this.registerEvent(this.plugin.activity.on("changed", this.rerender));
    this.render();
  }

  private render(): void {
    const el = this.containerEl;
    el.empty();
    el.addClass("ps-block");
    // Ranges like "this-week" are relative to now, so parse on every render.
    const q = parseQuery(this.source);
    try {
      this.renderer(el, this.plugin, q);
    } catch (e) {
      el.createDiv({ cls: "ps-error", text: `Could not render: ${e instanceof Error ? e.message : String(e)}` });
      console.error("[projects-system]", e);
    }
    if (q.errors.length) {
      const err = el.createDiv({ cls: "ps-error" });
      setIcon(err.createSpan(), "alert-triangle");
      err.createSpan({ text: ` ${q.errors.join("; ")}` });
    }
  }
}

function selectProjects(plugin: ProjectsPlugin, q: ProjectQuery) {
  const last = plugin.activity.lastActivity();
  const activeIn = q.active ? plugin.activity.activeIn(q.active) : undefined;
  let list = plugin.index.projects.filter((p) => matches(p, q, { lastActivity: last, activeIn }));
  list = sortProjects(list, q.sort, q.descending, plugin.index.statuses(), last);
  return q.limit ? list.slice(0, q.limit) : list;
}

function renderProjectsBlock(el: HTMLElement, plugin: ProjectsPlugin, q: ProjectQuery): void {
  const view = q.view ?? plugin.settings.defaultView;
  renderProjects(el, plugin, selectProjects(plugin, q), { view, groupBy: q.groupBy });
}

function renderActivityBlock(el: HTMLElement, plugin: ProjectsPlugin, q: ProjectQuery): void {
  const range = q.range ?? q.active ?? parseRange("this-week")!;
  // Filters (project:, status:, area:, ...) narrow which projects' activity is shown.
  const hasFilters = q.filters.length > 0 || !!q.search;
  const ids = new Set(selectProjects(plugin, { ...q, active: null, limit: 0 }).map((p) => p.id));
  const head = el.createDiv({ cls: "ps-range-title" });
  head.createSpan({ text: range.label });
  head.createSpan({ cls: "ps-muted", text: ` ${range.start} to ${range.end}` });
  const days = plugin.activity.summary(range, (id) => ids.has(id) || (!hasFilters && !plugin.index.get(id)));
  renderActivity(el, plugin, q.limit ? days.slice(0, q.limit) : days, { compact: q.view === "list" });
}
