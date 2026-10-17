import { App, FuzzySuggestModal, SuggestModal, type FuzzyMatch } from "obsidian";
import { isoDate, parseRange, type DateRange } from "../dates";
import type { ProjectInfo } from "../fields";

export class ProjectPicker extends FuzzySuggestModal<ProjectInfo> {
  constructor(
    app: App,
    private readonly projects: ProjectInfo[],
    private readonly onPick: (p: ProjectInfo) => void,
    placeholder = "Pick a project",
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  override getItems(): ProjectInfo[] {
    return this.projects;
  }

  override getItemText(p: ProjectInfo): string {
    return [p.name, p.group.join("/"), p.status].filter(Boolean).join("  ");
  }

  override renderSuggestion(match: FuzzyMatch<ProjectInfo>, el: HTMLElement): void {
    const p = match.item;
    el.createDiv({ text: p.name });
    el.createDiv({ cls: "ps-muted", text: [p.group.join(" / "), p.status].filter(Boolean).join(" | ") });
  }

  override onChooseItem(p: ProjectInfo): void {
    this.onPick(p);
  }
}

export class StatusPicker extends SuggestModal<string> {
  constructor(
    app: App,
    private readonly statuses: string[],
    private readonly current: string,
    private readonly onPick: (s: string) => void,
  ) {
    super(app);
    this.setPlaceholder(`Status (now: ${current || "none"}). Type a new one to add it.`);
  }

  override getSuggestions(query: string): string[] {
    const q = query.trim().toLowerCase();
    const list = this.statuses.filter((s) => s.toLowerCase().includes(q));
    if (q && !this.statuses.some((s) => s.toLowerCase() === q)) list.push(query.trim());
    return list;
  }

  override renderSuggestion(s: string, el: HTMLElement): void {
    el.setText(s);
    if (s.toLowerCase() === this.current.toLowerCase()) el.createSpan({ cls: "ps-muted", text: "  (current)" });
    else if (!this.statuses.includes(s)) el.createSpan({ cls: "ps-muted", text: "  (new)" });
  }

  override onChooseSuggestion(s: string): void {
    this.onPick(s);
  }
}

const RANGE_CHOICES = ["this-week", "last-week", "this-month", "last-month", "14d", "30d", "this-year"];

/** Pick a range; typing any range spec (2026-09, 7d, 2026-10-01..2026-10-17) works too. */
export class RangePicker extends SuggestModal<DateRange> {
  constructor(app: App, private readonly onPick: (r: DateRange) => void) {
    super(app);
    this.setPlaceholder("This week, last month, 2026-09, 14d, 2026-10-01..2026-10-17 ...");
  }

  override getSuggestions(query: string): DateRange[] {
    const typed = query.trim() ? parseRange(query) : null;
    const base = RANGE_CHOICES.map((c) => parseRange(c)!).filter(
      (r) => !query.trim() || r.label.toLowerCase().includes(query.trim().toLowerCase()),
    );
    return typed ? [typed, ...base.filter((r) => r.label !== typed.label)] : base;
  }

  override renderSuggestion(r: DateRange, el: HTMLElement): void {
    el.createDiv({ text: r.label });
    el.createDiv({ cls: "ps-muted", text: r.start === r.end ? r.start : `${r.start} to ${r.end}` });
  }

  override onChooseSuggestion(r: DateRange): void {
    this.onPick(r);
  }
}

/** The last 12 months, newest first, as YYYY-MM. */
export class MonthPicker extends SuggestModal<string> {
  constructor(app: App, private readonly onPick: (month: string) => void) {
    super(app);
    this.setPlaceholder("Month (YYYY-MM)");
  }

  override getSuggestions(query: string): string[] {
    const now = new Date();
    const months: string[] = [];
    for (let i = 0; i < 12; i++) months.push(isoDate(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7));
    const q = query.trim();
    const list = months.filter((m) => m.includes(q) || (parseRange(m)?.label.toLowerCase().includes(q.toLowerCase()) ?? false));
    if (/^\d{4}-\d{2}$/.test(q) && !list.includes(q)) list.unshift(q);
    return list;
  }

  override renderSuggestion(m: string, el: HTMLElement): void {
    el.createDiv({ text: parseRange(m)?.label ?? m });
    el.createDiv({ cls: "ps-muted", text: m });
  }

  override onChooseSuggestion(m: string): void {
    this.onPick(m);
  }
}
