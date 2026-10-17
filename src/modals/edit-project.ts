import { Modal, Notice, Setting } from "obsidian";
import type { ProjectInfo } from "../fields";
import type ProjectsPlugin from "../main";
import { BAD_NAME, renameProject, saveFields } from "../project-ops";

interface Field {
  key: string;
  label: string;
  kind: "text" | "textarea" | "list" | "date" | "status";
  /** Value as shown in the input. */
  initial: string;
  /** Suggestions for the input (datalist). */
  suggest?: string[];
}

/**
 * Edit a project's card in one place: name (renames the note/folder), status, summary, languages,
 * repository, area, category, dates, plus any extra properties (e.g. the ones a base shows).
 * Only fields you change are written.
 */
export class EditProjectModal extends Modal {
  private readonly fields: Field[];
  private readonly values = new Map<string, string>();
  private name: string;

  constructor(
    private readonly plugin: ProjectsPlugin,
    private readonly project: ProjectInfo,
    extraKeys: string[] = [],
  ) {
    super(plugin.app);
    this.name = project.name;
    const f = plugin.settings.fields;
    const fm = project.fm;
    const text = (key: string): string => (Array.isArray(fm[key]) ? asListText(fm[key]) : asRaw(fm[key]));
    this.fields = [
      { key: f.status, label: "Status", kind: "status", initial: project.status, suggest: plugin.index.statuses() },
      { key: f.summary, label: "Summary", kind: "textarea", initial: text(f.summary) },
      { key: f.stack, label: "Languages", kind: "list", initial: asListText(fm[f.stack]), suggest: uniqueValues(plugin, f.stack) },
      { key: f.repo, label: "Repository", kind: "text", initial: text(f.repo) },
      { key: "area", label: "Area", kind: "text", initial: text("area"), suggest: plugin.index.valuesOf("area") },
      { key: "category", label: "Category", kind: "text", initial: text("category"), suggest: plugin.index.valuesOf("category") },
      { key: f.created, label: "Created", kind: "date", initial: project.created },
      { key: f.updated, label: "Updated", kind: "date", initial: project.updated },
    ];
    const known = new Set(this.fields.map((x) => x.key.toLowerCase()));
    for (const key of extraKeys) {
      if (known.has(key.toLowerCase()) || key === "tags") continue;
      known.add(key.toLowerCase());
      const list = Array.isArray(fm[key]);
      this.fields.push({ key, label: key, kind: list ? "list" : "text", initial: list ? asListText(fm[key]) : asRaw(fm[key]), suggest: plugin.index.valuesOf(key) });
    }
    for (const field of this.fields) this.values.set(field.key, field.initial);
  }

  override onOpen(): void {
    this.titleEl.setText(`Edit ${this.project.name}`);
    this.modalEl.addClass("ps-edit-modal");
    const { contentEl } = this;
    contentEl.createDiv({ cls: "ps-muted", text: this.project.mainPath ?? `${this.project.path}/ (no folder note yet; saving creates one)` });

    new Setting(contentEl)
      .setName("Name")
      .setDesc(this.project.kind === "folder" ? "Renames the folder and its folder note. Links update." : "Renames the note. Links update.")
      .addText((t) => t.setValue(this.name).onChange((v) => (this.name = v.trim())));

    for (const field of this.fields) {
      const setting = new Setting(contentEl).setName(field.label);
      if (field.kind === "textarea") {
        setting.addTextArea((t) => {
          t.setValue(field.initial).onChange((v) => this.values.set(field.key, v));
          t.inputEl.rows = 2;
        });
        setting.settingEl.addClass("ps-edit-wide");
      } else {
        setting.addText((t) => {
          t.setValue(field.initial).onChange((v) => this.values.set(field.key, v));
          if (field.kind === "date") t.inputEl.type = "date";
          if (field.kind === "list") t.setPlaceholder("Comma separated");
          if (field.suggest?.length) {
            const id = `ps-edit-${field.key.replace(/\W/g, "_")}`;
            const list = contentEl.createEl("datalist", { attr: { id } });
            for (const s of field.suggest) list.createEl("option", { value: s });
            t.inputEl.setAttr("list", id);
          }
        });
      }
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Save").setCta().onClick(() => void this.save()));
    this.scope.register(["Mod"], "Enter", () => {
      void this.save();
      return false;
    });
  }

  private async save(): Promise<void> {
    if (!this.name || BAD_NAME.test(this.name)) {
      new Notice("The name can't be empty or contain \\ / : * ? \" < > | # ^ [ ]");
      return;
    }
    const changes: Record<string, unknown> = {};
    for (const field of this.fields) {
      const value = this.values.get(field.key) ?? "";
      if (value === field.initial) continue;
      changes[field.key] = field.kind === "list" ? value.split(",").map((s) => s.trim()).filter(Boolean) : value.trim();
    }
    try {
      if (Object.keys(changes).length) await saveFields(this.plugin, this.project, changes);
      if (this.name !== this.project.name) await renameProject(this.plugin, this.project, this.name);
      this.close();
    } catch (e) {
      new Notice(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

/** A scalar as typed in YAML, keeping wikilinks ("[[Bosun]]") as written so they survive a save. */
function asRaw(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && !(v instanceof Date)) return "";
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}

function asListText(v: unknown): string {
  if (Array.isArray(v)) return v.map(asRaw).filter(Boolean).join(", ");
  return asRaw(v);
}

function uniqueValues(plugin: ProjectsPlugin, key: string): string[] {
  return plugin.index.valuesOf(key);
}
