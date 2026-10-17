import { Modal, Notice, Setting, TFolder, normalizePath } from "obsidian";
import { isoDate } from "../dates";
import type ProjectsPlugin from "../main";

/** The built-in template: the same shape as the project notes you already write. */
export const BUILTIN_TEMPLATE = `---
tags: [project]
status: {{status}}
github:
created: {{date}}
updated: {{date}}
summary: {{summary}}
languages: []
area:
category:
---

## Overview

`;

/** Fills {{name}}, {{date}}, {{status}}, {{summary}} and {{group}}. Values are YAML-safe. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)(?::[^}]*)?\s*\}\}/g, (m, key: string) => {
    const v = values[key.toLowerCase()];
    if (v === undefined) return m;
    return /[:#\[\]{},&*!|>'"%@`]/.test(v) ? JSON.stringify(v) : v;
  });
}

export class NewProjectModal extends Modal {
  private name = "";
  private folder: string;
  private asFolder = false;
  private status: string;
  private summary = "";

  constructor(private readonly plugin: ProjectsPlugin) {
    super(plugin.app);
    const folders = this.categoryFolders();
    this.folder = folders[0] ?? plugin.settings.root;
    this.status = plugin.index.statuses()[0] ?? "";
  }

  /** Folders a project can go in: the category level under the root (or the root itself). */
  private categoryFolders(): string[] {
    const { root, categoryDepth } = this.plugin.settings;
    const rootFolder = root ? this.app.vault.getFolderByPath(root) : this.app.vault.getRoot();
    if (!rootFolder) return [];
    let level: TFolder[] = [rootFolder];
    for (let i = 0; i < categoryDepth; i++) {
      level = level.flatMap((f) => f.children.filter((c): c is TFolder => c instanceof TFolder));
      // A folder that is itself a project (has its folder note) is not a category.
      level = level.filter((f) => !this.app.vault.getFileByPath(`${f.path}/${f.name}.md`));
    }
    return level.map((f) => f.path).sort();
  }

  override onOpen(): void {
    this.titleEl.setText("New project");
    const { contentEl } = this;
    const root = this.plugin.settings.root;

    new Setting(contentEl).setName("Name").addText((t) => {
      t.setPlaceholder("Project name").onChange((v) => (this.name = v.trim()));
      window.setTimeout(() => t.inputEl.focus(), 0);
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing) void this.create();
      });
    });
    const folders = this.categoryFolders();
    new Setting(contentEl)
      .setName("Category")
      .setDesc("The folder it goes in. Type a new name to create a category.")
      .addText((t) => {
        const listId = "ps-category-list";
        const list = contentEl.createEl("datalist", { attr: { id: listId } });
        const rel = (f: string): string => (root && f.startsWith(root + "/") ? f.slice(root.length + 1) : f === root ? "" : f);
        for (const f of folders) list.createEl("option", { value: rel(f) });
        t.inputEl.setAttr("list", listId);
        t.setValue(rel(this.folder)).onChange((v) => {
          this.folder = normalizePath(root ? `${root}/${v.trim()}` : v.trim());
        });
      });
    new Setting(contentEl)
      .setName("Folder project")
      .setDesc("Make a folder with a folder note, for projects with research and sub-notes. Off makes a single note.")
      .addToggle((t) => t.setValue(this.asFolder).onChange((v) => (this.asFolder = v)));
    new Setting(contentEl).setName("Status").addDropdown((d) => {
      for (const s of this.plugin.index.statuses()) d.addOption(s, s);
      d.setValue(this.status).onChange((v) => (this.status = v));
    });
    new Setting(contentEl).setName("Summary").setDesc("One line (optional).").addText((t) => t.onChange((v) => (this.summary = v.trim())));
    new Setting(contentEl).addButton((b) => b.setButtonText("Create").setCta().onClick(() => void this.create()));
  }

  private async create(): Promise<void> {
    if (!this.name || /[\\/:*?"<>|#^[\]]/.test(this.name)) {
      new Notice("Give the project a name without \\ / : * ? \" < > | # ^ [ ]");
      return;
    }
    const { vault } = this.app;
    const folder = this.folder.replace(/\/+$/, "");
    const dir = this.asFolder ? `${folder}/${this.name}` : folder;
    const path = normalizePath(`${dir}/${this.name}.md`);
    if (vault.getAbstractFileByPath(path) || (this.asFolder && vault.getAbstractFileByPath(dir))) {
      new Notice(`${path} already exists.`);
      return;
    }
    let template = BUILTIN_TEMPLATE;
    const tp = this.plugin.settings.templatePath;
    if (tp) {
      const file = vault.getFileByPath(normalizePath(tp.endsWith(".md") ? tp : `${tp}.md`));
      if (file) template = await vault.read(file);
      else new Notice(`Template ${tp} not found, using the built-in one.`);
    }
    const group = folder.split("/").pop() ?? "";
    const text = fillTemplate(template, {
      name: this.name,
      title: this.name,
      date: isoDate(new Date()),
      status: this.status,
      summary: this.summary,
      group: this.plugin.settings.root === folder ? "" : group,
    });
    for (const d of [folder, dir]) if (d && !vault.getAbstractFileByPath(d)) await vault.createFolder(d);
    const file = await vault.create(path, text);
    this.close();
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
