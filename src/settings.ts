import { PluginSettingTab, Setting, normalizePath } from "obsidian";
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
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export class ProjectsSettingTab extends PluginSettingTab {
  private readonly plugin: ProjectsPlugin;

  constructor(plugin: ProjectsPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async (reindex = true): Promise<void> => {
      await this.plugin.saveSettings();
      if (reindex) this.plugin.index.rebuild();
      this.plugin.index.refresh();
    };

    new Setting(containerEl).setName("Where your projects are").setHeading();
    new Setting(containerEl)
      .setName("Projects folder")
      .setDesc("The folder that holds your category folders. Leave empty for the whole vault.")
      .addText((t) =>
        t.setPlaceholder("Personal Projects").setValue(s.root).onChange(async (v) => {
          s.root = v.trim() ? normalizePath(v.trim()) : "";
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Category levels")
      .setDesc(
        "How many folder levels under the projects folder are categories. 1 means Projects/<Category>/<Project>. " +
          "0 means projects sit directly in the projects folder.",
      )
      .addDropdown((d) =>
        d
          .addOptions({ "0": "0", "1": "1", "2": "2", "3": "3" })
          .setValue(String(s.categoryDepth))
          .onChange(async (v) => {
            s.categoryDepth = Number(v);
            await save();
          }),
      );
    new Setting(containerEl)
      .setName("Project tag")
      .setDesc("A note with this tag is a project wherever it sits under the projects folder. Leave empty to rely on folders only.")
      .addText((t) =>
        t.setPlaceholder("project").setValue(s.projectTag).onChange(async (v) => {
          s.projectTag = v.trim().replace(/^#/, "");
          await save();
        }),
      );
    new Setting(containerEl)
      .setName("Ignored folders")
      .setDesc("Folder names or paths (relative to the projects folder) to skip, one per line.")
      .addTextArea((t) =>
        t.setValue(s.ignore.join("\n")).onChange(async (v) => {
          s.ignore = parseList(v);
          await save();
        }),
      );

    new Setting(containerEl).setName("Frontmatter fields").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Which frontmatter key holds each field. Anything else (area, category, ...) can be filtered on by its own name.",
    });
    const fieldNames: [keyof FieldMap, string][] = [
      ["status", "Status"],
      ["summary", "Summary"],
      ["repo", "Repository link"],
      ["stack", "Languages / stack"],
      ["created", "Created date"],
      ["updated", "Updated date"],
    ];
    for (const [key, name] of fieldNames) {
      new Setting(containerEl).setName(name).addText((t) =>
        t.setPlaceholder(DEFAULT_FIELDS[key]).setValue(s.fields[key]).onChange(async (v) => {
          s.fields[key] = v.trim() || DEFAULT_FIELDS[key];
          await save();
        }),
      );
    }

    new Setting(containerEl).setName("Statuses").setHeading();
    const found = this.plugin.index.foundStatuses();
    const order = orderedStatuses(found, s.statusOrder);
    new Setting(containerEl)
      .setName("Status order")
      .setDesc(
        "Your status words in the order they should sort and appear in the status menu, one per line. " +
          `Found in your notes: ${found.length ? found.join(", ") : "(none yet)"}.`,
      )
      .addTextArea((t) => {
        t.setValue(order.join("\n")).onChange(async (v) => {
          s.statusOrder = parseList(v);
          await save(false);
        });
        t.inputEl.rows = 7;
      });
    new Setting(containerEl)
      .setName("Finished statuses")
      .setDesc("Statuses that mean a project is finished. Only these can be exported to the portfolio. One per line.")
      .addTextArea((t) =>
        t.setValue(s.finishedStatuses.join("\n")).onChange(async (v) => {
          s.finishedStatuses = parseList(v);
          await save(false);
        }),
      );

    new Setting(containerEl).setName("Activity").setHeading();
    new Setting(containerEl)
      .setName("Keep updated: current")
      .setDesc(
        "When you edit any note in a project, set the main note's updated date to today (at most once a day, " +
          "and only if the note already has that field).",
      )
      .addToggle((t) =>
        t.setValue(s.bumpUpdated).onChange(async (v) => {
          s.bumpUpdated = v;
          await save(false);
        }),
      );
    new Setting(containerEl)
      .setName("Stale after (days)")
      .setDesc("Projects with no activity for this long show as stale.")
      .addText((t) =>
        t.setValue(String(s.staleDays)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n > 0) {
            s.staleDays = n;
            await save(false);
          }
        }),
      );
    new Setting(containerEl)
      .setName("Detailed history (days)")
      .setDesc("Which notes you edited is kept this long. Older edits are kept as a count per day.")
      .addText((t) =>
        t.setValue(String(s.detailDays)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isInteger(n) && n > 0) {
            s.detailDays = n;
            await save(false);
          }
        }),
      );
    new Setting(containerEl)
      .setName("Rebuild history from file dates")
      .setDesc("Seeds activity from each file's created and modified dates. Existing history is kept.")
      .addButton((b) =>
        b.setButtonText("Rebuild").onClick(async () => {
          const n = await this.plugin.activity.backfill(true);
          b.setButtonText(`Added ${n} events`);
        }),
      );

    new Setting(containerEl).setName("Views").setHeading();
    new Setting(containerEl).setName("Default view").addDropdown((d) =>
      d
        .addOptions({ grid: "Grid", table: "Table", list: "List" })
        .setValue(s.defaultView)
        .onChange(async (v) => {
          s.defaultView = v as ViewKind;
          await save(false);
        }),
    );
    new Setting(containerEl)
      .setName("Group the dashboard by")
      .setDesc('A field such as status, group, area or category. Leave empty for no sections.')
      .addText((t) =>
        t.setValue(s.defaultGroupBy).onChange(async (v) => {
          s.defaultGroupBy = v.trim().toLowerCase();
          await save(false);
        }),
      );
    new Setting(containerEl)
      .setName("New project template")
      .setDesc("A note to copy for new projects ({{name}} and {{date}} are filled in). Leave empty for the built-in one.")
      .addText((t) =>
        t.setPlaceholder("Templates/Project.md").setValue(s.templatePath).onChange(async (v) => {
          s.templatePath = v.trim();
          await save(false);
        }),
      );

    new Setting(containerEl).setName("Portfolio").setHeading();
    new Setting(containerEl)
      .setName("Portfolio content folder")
      .setDesc("Absolute path to the portfolio's content folder (the one with Projects/, Writing/ and Assets/). Desktop only.")
      .addText((t) => {
        t.setPlaceholder("D:/New Source/Personal/Portfolio/content").setValue(s.portfolioPath).onChange(async (v) => {
          s.portfolioPath = v.trim();
          await save(false);
        });
        t.inputEl.style.width = "100%";
      });
    new Setting(containerEl).setName("Role").setDesc("Written to role: on exported projects.").addText((t) =>
      t.setValue(s.portfolioRole).onChange(async (v) => {
        s.portfolioRole = v;
        await save(false);
      }),
    );
    new Setting(containerEl)
      .setName("Status on the portfolio")
      .setDesc('Map your status words to the portfolio\'s, one per line, e.g. "done = released". Unlisted statuses are copied as they are.')
      .addTextArea((t) =>
        t
          .setValue(
            Object.entries(s.portfolioStatusMap)
              .map(([k, v]) => `${k} = ${v}`)
              .join("\n"),
          )
          .onChange(async (v) => {
            s.portfolioStatusMap = parseMap(v);
            await save(false);
          }),
      );
  }
}
