import { Notice, PluginSettingTab, Setting, normalizePath, requireApiVersion, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import type ProjectsPlugin from "./main";
import { DEFAULT_FIELDS, orderedStatuses, type FieldMap } from "./fields";
import type { ViewKind } from "./query";

export interface ProjectsSettings {
  /** Folder that holds your projects (category folders inside it). */
  root: string;
  /** Folder levels under the root that are categories. */
  categoryDepth: number;
  /** Notes with this tag are projects wherever they sit under the root. */
  projectTag: string;
  /** Folders (relative to the root) to skip. */
  ignore: string[];
  fields: FieldMap;
  /** Status values in display order; values found in notes but not listed here come after. */
  statusOrder: string[];
  /** Statuses that mean "finished": these projects can be exported to the portfolio. */
  finishedStatuses: string[];
  /** Set the main note's updated: date to today on the first edit of the day to the project. */
  bumpUpdated: boolean;
  /** No activity for this many days counts as stale. */
  staleDays: number;
  /** Per-file edit history is kept this many days, then folded into per-day counts. */
  detailDays: number;
  defaultView: ViewKind;
  defaultGroupBy: string;
  /** Note used as the template for "New project" ({{name}}, {{date}} are filled in); "" = built-in. */
  templatePath: string;
  /** The portfolio's content folder (Portfolio/content), an absolute path on disk. */
  portfolioPath: string;
  portfolioRole: string;
  /** Your status word -> the portfolio's status word, e.g. "done" -> "released". */
  portfolioStatusMap: Record<string, string>;
}

export const DEFAULT_SETTINGS: ProjectsSettings = {
  root: "Personal Projects",
  categoryDepth: 1,
  projectTag: "project",
  ignore: ["Templates", "Assets", "Attachments"],
  fields: { ...DEFAULT_FIELDS },
  statusOrder: ["idea", "planning", "in progress", "active", "paused", "done"],
  finishedStatuses: ["done"],
  bumpUpdated: true,
  staleDays: 30,
  detailDays: 120,
  defaultView: "grid",
  defaultGroupBy: "",
  templatePath: "",
  portfolioPath: "",
  portfolioRole: "solo / author",
  portfolioStatusMap: {},
};

function parseList(v: string): string[] {
  return v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseMap(v: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of v.split("\n")) {
    const m = /^\s*(.+?)\s*(?:=|->|:)\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Settings that change which notes are projects; saving them rebuilds the index. */
const REINDEX = new Set(["root", "categoryDepth", "projectTag", "ignore"]);

/** Settings shown on a page's entry (displayValue), so changing them redraws the tab. */
const SHOWN = new Set(["root", "statusOrder", "staleDays", "defaultView", "portfolioPath"]);

const VIEW_NAMES: Record<ViewKind, string> = { grid: "Grid", table: "Table", list: "List" };

const FIELD_NAMES: [keyof FieldMap, string][] = [
  ["status", "Status field"],
  ["summary", "Summary field"],
  ["repo", "Repository link field"],
  ["stack", "Languages field"],
  ["created", "Created date field"],
  ["updated", "Updated date field"],
];

function wholeNumber(min: number): (n: number) => string | void {
  return (n) => {
    if (!Number.isInteger(n) || n < min) return `Enter a whole number, ${min} or more.`;
  };
}

/**
 * One list of definitions drives both the declarative settings (1.13+, searchable) and the
 * classic display() for older Obsidian. Keys are virtual ("fields.status", "ignore") and are
 * converted to and from the stored shape in getControlValue / setControlValue.
 */
export class ProjectsSettingTab extends PluginSettingTab {
  private readonly plugin: ProjectsPlugin;

  constructor(plugin: ProjectsPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    const found = this.plugin.index.foundStatuses();
    return [
      {
        type: "page",
        name: "Projects",
        desc: "Where your projects are and which frontmatter fields they use.",
        displayValue: () => this.plugin.settings.root || "Whole vault",
        items: [
          {
            type: "group",
            heading: "Where your projects are",
            items: [
              {
                name: "Projects folder",
                desc: "The folder that holds your category folders. Leave empty for the whole vault.",
                control: { type: "folder", key: "root", includeRoot: true },
              },
              {
                name: "Category levels",
                desc: "How many folder levels under the projects folder are categories. 1 means a project sits in a category folder; 0 means projects sit directly in the projects folder.",
                control: { type: "dropdown", key: "categoryDepth", options: { "0": "0", "1": "1", "2": "2", "3": "3" } },
              },
              {
                name: "Project tag",
                desc: "A note with this tag is a project wherever it sits under the projects folder. Leave empty to rely on folders only.",
                control: { type: "text", key: "projectTag" },
              },
              {
                name: "Ignored folders",
                desc: "Folder names or paths (relative to the projects folder) to skip, one per line.",
                control: { type: "textarea", key: "ignore", rows: 3 },
              },
            ],
          },
          {
            type: "group",
            heading: "Frontmatter fields",
            items: FIELD_NAMES.map(
              ([key, name]): SettingDefinition => ({
                name,
                desc: `The frontmatter key that holds this field (default: ${DEFAULT_FIELDS[key]}).`,
                control: { type: "text", key: `fields.${key}` },
              }),
            ),
          },
        ],
      },
      {
        type: "page",
        name: "Statuses",
        desc: "The order of your status words and which ones mean finished.",
        displayValue: () => {
          const n = orderedStatuses(this.plugin.index.foundStatuses(), this.plugin.settings.statusOrder).length;
          return `${n} ${n === 1 ? "status" : "statuses"}`;
        },
        items: [
          {
            type: "group",
            items: [
              {
                name: "Status order",
                desc: `Your status words in the order they sort and appear in the status menu, one per line. Found in your notes: ${found.length ? found.join(", ") : "none yet"}.`,
                control: { type: "textarea", key: "statusOrder", rows: 7 },
              },
              {
                name: "Finished statuses",
                desc: "Statuses that mean a project is finished. Only these can be exported to the portfolio. One per line.",
                control: { type: "textarea", key: "finishedStatuses", rows: 2 },
              },
            ],
          },
        ],
      },
      {
        type: "page",
        name: "Activity",
        desc: "Edit history, stale projects and the updated date.",
        displayValue: () => `Stale after ${this.plugin.settings.staleDays} days`,
        items: [
          {
            type: "group",
            items: [
              {
                name: "Keep updated date current",
                desc: "When you edit any note in a project, set the main note's updated date to today (at most once a day, and only if the note already has that field).",
                control: { type: "toggle", key: "bumpUpdated" },
              },
              {
                name: "Stale after (days)",
                desc: "Projects with no activity for this long show as stale.",
                control: { type: "number", key: "staleDays", min: 1, step: 1, validate: wholeNumber(1) },
              },
              {
                name: "Detailed history (days)",
                desc: "Which notes you edited is kept this long. Older edits are kept as a count per day.",
                control: { type: "number", key: "detailDays", min: 1, step: 1, validate: wholeNumber(1) },
              },
              {
                name: "Rebuild history from file dates",
                desc: "Seeds activity from each file's created and modified dates. Existing history is kept.",
                action: () => {
                  void this.plugin.activity.backfill(true).then((n) => new Notice(`Added ${n} activity events from file dates.`));
                },
              },
            ],
          },
        ],
      },
      {
        type: "page",
        name: "Views",
        desc: "How the dashboard opens and the template for new projects.",
        displayValue: () => VIEW_NAMES[this.plugin.settings.defaultView],
        items: [
          {
            type: "group",
            items: [
              {
                name: "Default view",
                control: { type: "dropdown", key: "defaultView", options: VIEW_NAMES },
              },
              {
                name: "Group the dashboard by",
                desc: "A field such as status, group, area or category. Leave empty for no sections.",
                control: { type: "text", key: "defaultGroupBy" },
              },
              {
                name: "New project template",
                desc: "A note to copy for new projects ({{name}}, {{date}}, {{status}} and {{summary}} are filled in). Leave empty for the built-in one.",
                control: { type: "file", key: "templatePath", filter: (f) => f.extension === "md" },
              },
            ],
          },
        ],
      },
      {
        type: "page",
        name: "Portfolio",
        desc: "Exporting finished projects to your portfolio site.",
        displayValue: () => this.plugin.settings.portfolioPath || "Not set",
        items: [
          {
            type: "group",
            items: [
              {
                name: "Portfolio content folder",
                desc: "Absolute path on disk to the portfolio's content folder, the one with the projects, writing and assets folders. Desktop only.",
                control: { type: "text", key: "portfolioPath" },
              },
              {
                name: "Role",
                desc: "Written to role: on exported projects.",
                control: { type: "text", key: "portfolioRole" },
              },
              {
                name: "Status on the portfolio",
                desc: 'Map your status words to the portfolio\'s, one per line, e.g. "done = released". Unlisted statuses are copied as they are.',
                control: { type: "textarea", key: "portfolioStatusMap", rows: 3 },
              },
            ],
          },
        ],
      },
    ];
  }

  override getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    if (key.startsWith("fields.")) return s.fields[key.slice("fields.".length) as keyof FieldMap];
    switch (key) {
      case "categoryDepth":
        return String(s.categoryDepth);
      case "ignore":
      case "finishedStatuses":
        return s[key].join("\n");
      case "statusOrder":
        return orderedStatuses(this.plugin.index.foundStatuses(), s.statusOrder).join("\n");
      case "portfolioStatusMap":
        return Object.entries(s.portfolioStatusMap)
          .map(([k, v]) => `${k} = ${v}`)
          .join("\n");
    }
    return (s as unknown as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    const text = typeof value === "string" ? value : "";
    if (key.startsWith("fields.")) {
      const field = key.slice("fields.".length) as keyof FieldMap;
      s.fields[field] = text.trim() || DEFAULT_FIELDS[field];
    } else {
      switch (key) {
        case "root":
          s.root = text.trim() && text.trim() !== "/" ? normalizePath(text.trim()) : "";
          break;
        case "categoryDepth":
          s.categoryDepth = Number(text) || 0;
          break;
        case "projectTag":
          s.projectTag = text.trim().replace(/^#/, "");
          break;
        case "ignore":
        case "statusOrder":
        case "finishedStatuses":
          s[key] = parseList(text);
          break;
        case "portfolioStatusMap":
          s.portfolioStatusMap = parseMap(text);
          break;
        case "staleDays":
        case "detailDays":
          if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return;
          s[key] = value;
          break;
        case "bumpUpdated":
          s.bumpUpdated = value === true;
          break;
        case "defaultView":
          if (text === "grid" || text === "table" || text === "list") s.defaultView = text;
          break;
        case "defaultGroupBy":
          s.defaultGroupBy = text.trim().toLowerCase();
          break;
        case "templatePath":
        case "portfolioPath":
          s[key] = text.trim();
          break;
        case "portfolioRole":
          s.portfolioRole = text;
          break;
        default:
          return;
      }
    }
    await this.plugin.saveSettings();
    // Page entries show these values; update() is 1.13+.
    if (requireApiVersion("1.13.0") && SHOWN.has(key)) this.update();
    // Field keys change what is read from each note, so they need a fresh index too.
    if (REINDEX.has(key) || key.startsWith("fields.")) this.plugin.index.rebuild();
    this.plugin.index.refresh();
  }

  /** Fallback for Obsidian before 1.13, which does not use getSettingDefinitions(): the same definitions, drawn by hand. */
  override display(): void {
    this.containerEl.empty();
    this.drawItems(this.getSettingDefinitions());
  }

  /** Pages and groups become headings, so older Obsidian shows one page in the same sections. */
  private drawItems(items: SettingDefinitionItem[]): void {
    for (const item of items) {
      if (!("type" in item)) {
        this.drawClassic(item);
      } else if (item.type === "page") {
        const heading = new Setting(this.containerEl).setName(item.name).setHeading();
        if (typeof item.desc === "string") heading.setDesc(item.desc);
        this.drawItems(item.items ?? []);
      } else if (item.type === "group") {
        if (item.heading) new Setting(this.containerEl).setName(item.heading).setHeading().settingEl.addClass("ps-subheading");
        for (const def of item.items ?? []) {
          if (!("type" in def)) this.drawClassic(def);
        }
      }
    }
  }

  private drawClassic(def: SettingDefinition): void {
    const setting = new Setting(this.containerEl).setName(def.name);
    if (typeof def.desc === "string") setting.setDesc(def.desc);
    if (def.action) {
      const run = def.action;
      setting.addButton((b) => b.setButtonText("Run").onClick(() => run(b.buttonEl, 0)));
      return;
    }
    const c = def.control;
    if (!c) return;
    const value = this.getControlValue(c.key);
    const str = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
    switch (c.type) {
      case "toggle":
        setting.addToggle((t) => t.setValue(value === true).onChange((v) => this.setControlValue(c.key, v)));
        break;
      case "dropdown":
        setting.addDropdown((d) => d.addOptions(c.options).setValue(str).onChange((v) => this.setControlValue(c.key, v)));
        break;
      case "textarea":
        setting.addTextArea((t) => {
          t.setValue(str).onChange((v) => this.setControlValue(c.key, v));
          if (c.rows) t.inputEl.rows = c.rows;
        });
        break;
      case "number":
        setting.addText((t) =>
          t.setValue(str).onChange((v) => {
            const n = Number(v);
            if (!c.validate?.(n)) void this.setControlValue(c.key, n);
          }),
        );
        break;
      default:
        setting.addText((t) => {
          t.setValue(str).onChange((v) => this.setControlValue(c.key, v));
          t.inputEl.addClass("ps-wide-input");
        });
    }
  }
}
