import { Modal, Notice, Setting, TFolder } from "obsidian";
import type { ProjectInfo } from "../fields";
import type ProjectsPlugin from "../main";
import { BAD_NAME, convertToFolder, createProjectNote } from "../project-ops";

/**
 * A new note inside a project. A single-note project becomes a folder project first
 * (Category/X.md -> Category/X/X.md), so the new note belongs to it instead of becoming a project
 * of its own.
 */
export class NewProjectNoteModal extends Modal {
  private name = "";
  private subfolder = "";

  constructor(private readonly plugin: ProjectsPlugin, private readonly project: ProjectInfo) {
    super(plugin.app);
  }

  /** Existing subfolders of the project, relative to it, for suggestions. */
  private subfolders(): string[] {
    const root = this.app.vault.getFolderByPath(this.project.path);
    if (!(root instanceof TFolder)) return [];
    const out: string[] = [];
    const walk = (f: TFolder): void => {
      for (const c of f.children) {
        if (c instanceof TFolder) {
          out.push(c.path.slice(root.path.length + 1));
          walk(c);
        }
      }
    };
    walk(root);
    return out.sort();
  }

  override onOpen(): void {
    const p = this.project;
    this.titleEl.setText(`New note in ${p.name}`);
    const { contentEl } = this;
    if (p.kind === "file") {
      contentEl.createEl("p", {
        cls: "ps-muted",
        text: `${p.name} is a single note. Adding a note turns it into a folder project: ${p.name}/${p.name}.md, with links updated.`,
      });
    }
    new Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Note name").onChange((v) => (this.name = v.trim()));
      window.setTimeout(() => t.inputEl.focus(), 0);
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) void this.create();
      });
    });
    new Setting(contentEl)
      .setName("Folder")
      .setDesc("Optional subfolder inside the project, e.g. Research.")
      .addText((t) => {
        const id = "ps-note-folders";
        const list = contentEl.createEl("datalist", { attr: { id } });
        for (const f of ["Research", ...this.subfolders()].filter((v, i, a) => a.indexOf(v) === i)) list.createEl("option", { value: f });
        t.inputEl.setAttr("list", id);
        t.onChange((v) => (this.subfolder = v.trim().replace(/^\/+|\/+$/g, "")));
      });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Create").setCta().onClick(() => void this.create()));
  }

  private async create(): Promise<void> {
    if (!this.name || BAD_NAME.test(this.name)) {
      new Notice("Give the note a name without \\ / : * ? \" < > | # ^ [ ]");
      return;
    }
    if (this.subfolder.split("/").some((s) => s === ".." || BAD_NAME.test(s))) {
      new Notice("That folder name isn't allowed.");
      return;
    }
    try {
      const folder = await convertToFolder(this.plugin, this.project);
      const file = await createProjectNote(this.plugin, folder, this.name, this.subfolder, `# ${this.name}\n\n`);
      this.close();
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new Notice(`Could not create the note: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
