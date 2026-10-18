import { ItemView, debounce, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import { daysBetween, isoDate, parseRange } from "../dates";
import { isFinished, type ProjectInfo } from "../fields";
import { emptyQuery, matches, sortProjects, type ViewKind } from "../query";
import type ProjectsPlugin from "../main";
import { NewProjectModal } from "../modals/new-project";
import { renderActivity, renderProjects } from "./render";

export const DASHBOARD_VIEW = "projects-dashboard";

type Tab = ViewKind | "activity";
type Quick = "all" | "open" | "recent" | "stale" | "finished";

interface DashState {
  tab: Tab;
  search: string;
  status: string;
  group: string;
  quick: Quick;
  groupBy: string;
  sort: string;
  descending: boolean;
  range: string;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "grid", label: "Grid", icon: "layout-grid" },
  { id: "table", label: "Table", icon: "table" },
  { id: "activity", label: "Activity", icon: "history" },
];

const RANGES: Record<string, string> = {
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "this-year": "This year",
};

const QUICK: Record<Quick, string> = {
  all: "All projects",
  open: "Not finished",
  recent: "Worked on in last 14 days",
  stale: "Stale",
  finished: "Finished",
};

export class DashboardView extends ItemView {
  private state: DashState;
  private toolbarEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private readonly refresh = debounce(() => this.renderBody(), 150, true);

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ProjectsPlugin) {
    super(leaf);
    this.state = {
      tab: plugin.settings.defaultView === "list" ? "grid" : plugin.settings.defaultView,
      search: "",
      status: "",
      group: "",
      quick: "all",
      groupBy: plugin.settings.defaultGroupBy,
      sort: "status",
      descending: false,
      range: "this-week",
    };
  }

  override getViewType(): string {
    return DASHBOARD_VIEW;
  }

  override getDisplayText(): string {
    return "Projects";
  }

  override getIcon(): string {
    return "folder-kanban";
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), ...this.state };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === "object") {
      const s = state as Partial<DashState>;
      for (const key of Object.keys(this.state) as (keyof DashState)[]) {
        if (s[key] !== undefined && typeof s[key] === typeof this.state[key]) (this.state as unknown as Record<string, unknown>)[key] = s[key];
      }
    }
    await super.setState(state, result);
    this.renderToolbar();
    this.renderBody();
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("ps-dashboard");
    this.toolbarEl = this.contentEl.createDiv({ cls: "ps-toolbar" });
    this.bodyEl = this.contentEl.createDiv({ cls: "ps-body" });
    this.registerEvent(this.plugin.index.on("changed", () => {
      this.renderToolbar();
      this.refresh();
    }));
    this.registerEvent(this.plugin.activity.on("changed", () => this.refresh()));
    this.renderToolbar();
    this.renderBody();
  }

  private set<K extends keyof DashState>(key: K, value: DashState[K]): void {
    this.state[key] = value;
    this.app.workspace.requestSaveLayout();
    this.renderToolbar();
    this.renderBody();
  }

  private renderToolbar(): void {
    if (!this.toolbarEl) return;
    // Keep focus and caret in the search box across re-renders.
    const focused = document.activeElement?.hasClass?.("ps-search");
    const caret = focused ? (document.activeElement as HTMLInputElement).selectionStart : null;
    const el = this.toolbarEl;
    el.empty();
    const { state } = this;
    const index = this.plugin.index;

    const tabs = el.createDiv({ cls: "ps-tabs" });
    for (const t of TABS) {
      const b = tabs.createEl("button", { cls: "ps-tab" + (state.tab === t.id ? " is-active" : "") });
      setIcon(b.createSpan(), t.icon);
      b.createSpan({ text: t.label });
      b.addEventListener("click", () => this.set("tab", t.id));
    }
    const count = tabs.createDiv({ cls: "ps-total" });
    count.setText(`${this.filtered().length} / ${index.projects.length} projects`);
    this.newProjectButton(tabs);

    const row = el.createDiv({ cls: "ps-filters" });
    const search = row.createEl("input", { cls: "ps-search", type: "search", placeholder: "Search projects" });
    search.value = state.search;
    const onSearch = debounce(() => {
      this.state.search = search.value;
      this.app.workspace.requestSaveLayout();
      this.renderBody();
    }, 200, true);
    search.addEventListener("input", onSearch);
    if (focused) {
      search.focus();
      if (caret !== null) search.setSelectionRange(caret, caret);
    }

    const select = (label: string, value: string, options: [string, string][], onChange: (v: string) => void): void => {
      const s = row.createEl("select", { cls: "dropdown", attr: { "aria-label": label } });
      for (const [v, text] of options) s.createEl("option", { value: v, text });
      s.value = value;
      s.addEventListener("change", () => onChange(s.value));
    };

    select("Quick filter", state.quick, Object.entries<string>(QUICK), (v) => this.set("quick", v as Quick));
    select("Status", state.status, [["", "Any status"], ...index.statuses().map((s): [string, string] => [s, s]), ["(none)", "No status"]], (v) =>
      this.set("status", v),
    );
    const groups = [...new Set(index.projects.map((p) => p.group.join("/")).filter(Boolean))].sort();
    if (groups.length) {
      select("Folder", state.group, [["", "Any folder"], ...groups.map((g): [string, string] => [g, g.replace(/\//g, " / ")])], (v) =>
        this.set("group", v),
      );
    }

    if (state.tab === "activity") {
      const custom = parseRange(state.range) && !(state.range in RANGES) ? [[state.range, parseRange(state.range)!.label] as [string, string]] : [];
      select("Range", state.range, [...Object.entries(RANGES), ...custom], (v) => this.set("range", v));
      const month = row.createEl("input", { type: "month", cls: "ps-month", attr: { "aria-label": "Pick a month" } });
      if (/^\d{4}-\d{2}$/.test(state.range)) month.value = state.range;
      month.addEventListener("change", () => month.value && this.set("range", month.value));
    } else {
      select(
        "Group by",
        state.groupBy,
        [["", "No grouping"], ["status", "Group by status"], ["group", "Group by folder"], ["area", "Group by area"], ["category", "Group by category"]],
        (v) => this.set("groupBy", v),
      );
      select(
        "Sort",
        state.sort,
        [["status", "Sort by status"], ["name", "Sort by name"], ["last-activity", "Sort by last worked on"], ["updated", "Sort by updated"], ["created", "Sort by created"]],
        (v) => {
          this.state.descending = false;
          this.set("sort", v);
        },
      );
    }
  }

  private newProjectButton(parent: HTMLElement): void {
    const b = parent.createEl("button", { cls: "mod-cta ps-new" });
    setIcon(b.createSpan(), "plus");
    b.createSpan({ text: "New project" });
    b.addEventListener("click", () => new NewProjectModal(this.plugin).open());
  }

  /** Projects after the toolbar filters, sorted. */
  private filtered(): ProjectInfo[] {
    const { state, plugin } = this;
    const q = emptyQuery();
    q.search = state.search.trim().toLowerCase();
    if (state.status) q.filters.push({ key: "status", values: [state.status === "(none)" ? "none" : state.status], negate: false });
    const last = plugin.activity.lastActivity();
    const today = isoDate(new Date());
    const finished = plugin.settings.finishedStatuses;
    const list = plugin.index.projects.filter((p) => {
      if (!matches(p, q)) return false;
      if (state.group && p.group.join("/") !== state.group && !p.group.join("/").startsWith(state.group + "/")) return false;
      const worked = last.get(p.id) || p.updated;
      switch (state.quick) {
        case "open":
          return !isFinished(p.status, finished);
        case "finished":
          return isFinished(p.status, finished);
        case "recent":
          return !!last.get(p.id) && daysBetween(last.get(p.id)!, today) <= 14;
        case "stale":
          return !isFinished(p.status, finished) && (!worked || daysBetween(worked, today) > plugin.settings.staleDays);
      }
      return true;
    });
    return sortProjects(list, state.sort, state.descending, plugin.index.statuses(), last);
  }

  private renderBody(): void {
    if (!this.bodyEl) return;
    const el = this.bodyEl;
    el.empty();
    const { state, plugin } = this;
    const list = this.filtered();
    if (!plugin.index.projects.length) {
      const empty = el.createDiv({ cls: "ps-empty" });
      empty.createDiv({ text: `No projects found under "${plugin.settings.root || "/"}".` });
      empty.createDiv({ cls: "ps-muted", text: "Check the projects folder and category levels in the plugin settings, or start one." });
      this.newProjectButton(empty);
      return;
    }
    if (state.tab === "activity") {
      const range = parseRange(state.range) ?? parseRange("this-week")!;
      const ids = new Set(list.map((p) => p.id));
      const head = el.createDiv({ cls: "ps-range-title" });
      head.createSpan({ text: range.label });
      head.createSpan({ cls: "ps-muted", text: ` ${range.start} to ${range.end}` });
      const copy = head.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Copy as Markdown" } });
      setIcon(copy, "copy");
      copy.addEventListener("click", () => void plugin.copyActivity(range, (id) => ids.has(id)));
      // Deleted projects only show when nothing is filtered (they cannot match a filter).
      const unfiltered = !state.search.trim() && !state.status && !state.group && state.quick === "all";
      renderActivity(el, plugin, plugin.activity.summary(range, (id) => ids.has(id) || (unfiltered && !plugin.index.get(id))));
      return;
    }
    renderProjects(el, plugin, list, {
      view: state.tab,
      groupBy: state.groupBy,
      sort: state.sort,
      descending: state.descending,
      onSort: (key) => {
        if (state.sort === key) this.state.descending = !state.descending;
        else this.state.descending = false;
        this.set("sort", key);
      },
    });
  }
}
