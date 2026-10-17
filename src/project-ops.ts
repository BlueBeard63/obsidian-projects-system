import { normalizePath, type TFile } from "obsidian";
import { parentOf } from "./discovery";
import type { ProjectInfo } from "./fields";
import type ProjectsPlugin from "./main";

/** Characters Obsidian (or the OS) will not take in a file name. */
export const BAD_NAME = /[\\/:*?"<>|#^[\]]/;

/** The project's main note, creating X/X.md for a folder project that has none yet. */
export async function ensureMainNote(plugin: ProjectsPlugin, p: ProjectInfo): Promise<TFile> {
  const { vault } = plugin.app;
  const existing = p.mainPath ? vault.getFileByPath(p.mainPath) : null;
  if (existing) return existing;
  return vault.create(normalizePath(`${p.path}/${p.name}.md`), "");
}

/**
 * Turns a single-note project into a folder project: Category/X.md becomes Category/X/X.md.
 * Links to the note are updated by Obsidian (renameFile). Returns the new folder path.
 */
export async function convertToFolder(plugin: ProjectsPlugin, p: ProjectInfo): Promise<string> {
  const { vault, fileManager } = plugin.app;
  if (p.kind === "folder") return p.path;
  const file = vault.getFileByPath(p.path);
  if (!file) throw new Error(`${p.path} not found`);
  const folder = normalizePath(`${parentOf(p.path)}/${p.name}`);
  if (vault.getAbstractFileByPath(folder)) throw new Error(`${folder} already exists`);
  await vault.createFolder(folder);
  await fileManager.renameFile(file, `${folder}/${file.name}`);
  return folder;
}

/** Creates a note inside a folder project (optionally in a subfolder) and returns it. */
export async function createProjectNote(plugin: ProjectsPlugin, folder: string, name: string, subfolder: string, content = ""): Promise<TFile> {
  const { vault } = plugin.app;
  const dir = normalizePath(subfolder.trim() ? `${folder}/${subfolder.trim()}` : folder);
  if (!vault.getAbstractFileByPath(dir)) await vault.createFolder(dir);
  const path = normalizePath(`${dir}/${name}.md`);
  if (vault.getAbstractFileByPath(path)) throw new Error(`${path} already exists`);
  return vault.create(path, content);
}

/** Renames a project: the note for a single-note project; the folder and its folder note otherwise. */
export async function renameProject(plugin: ProjectsPlugin, p: ProjectInfo, newName: string): Promise<void> {
  const { vault, fileManager } = plugin.app;
  if (newName === p.name) return;
  if (p.kind === "file") {
    const file = vault.getFileByPath(p.path);
    if (file) await fileManager.renameFile(file, normalizePath(`${parentOf(p.path)}/${newName}.md`));
    return;
  }
  const target = normalizePath(`${parentOf(p.path)}/${newName}`);
  if (vault.getAbstractFileByPath(target)) throw new Error(`${target} already exists`);
  // Folder note first (inside the old folder), then the folder, so both keep matching.
  const note = p.mainPath ? vault.getFileByPath(p.mainPath) : null;
  if (note) await fileManager.renameFile(note, normalizePath(`${p.path}/${newName}.md`));
  const folder = vault.getFolderByPath(p.path);
  if (folder) await fileManager.renameFile(folder, target);
}

/**
 * Writes changed frontmatter values. A cleared value keeps its key (empty), matching how you
 * leave fields like `github:` blank; keys that were never there are not added when empty.
 */
export async function saveFields(plugin: ProjectsPlugin, p: ProjectInfo, values: Record<string, unknown>): Promise<void> {
  const file = await ensureMainNote(plugin, p);
  await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      const empty = value === "" || value === null || (Array.isArray(value) && value.length === 0);
      if (empty) {
        if (key in fm) fm[key] = Array.isArray(fm[key]) ? [] : null;
      } else {
        fm[key] = value;
      }
    }
  });
}
