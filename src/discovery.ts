// Finds projects in the folder layout you already use. Pure: works on a plain list of paths so it
// can be tested without Obsidian.
//
//   <root>/<category>/Project.md              a single-file project
//   <root>/<category>/Project/Project.md      a folder project (the folder note is its main note)
//   <root>/<category>/Project/research/...    ...and everything under the folder belongs to it
//
// `categoryDepth` is how many folder levels under the root are categories (default 1). A note
// tagged with the project tag is a project wherever it sits under the root.

export interface DiscoveryOptions {
  /** Vault path of the projects root, e.g. "Personal Projects". "" means the whole vault. */
  root: string;
  /** Folder levels under the root that are categories. 0 = projects sit directly in the root. */
  categoryDepth: number;
  /** Tag (without #) that marks a note as a project anywhere under the root. "" disables it. */
  projectTag: string;
  /** Folder paths relative to the root (or names) to skip, e.g. "Templates", "Archive/Old". */
  ignore: string[];
}

export interface NoteEntry {
  /** Vault path, e.g. "Personal Projects/Library/BAnim.md". */
  path: string;
  /** Tags on the note, with or without leading #. */
  tags: string[];
}

export interface ProjectDef {
  /** Stable id: the folder path for folder projects, the note path for file projects. */
  id: string;
  /** Display name: the folder name or the note's basename. */
  name: string;
  kind: "folder" | "file";
  /** The folder (folder projects) or the note (file projects). */
  path: string;
  /** The main note, or null for a folder project without a folder note yet. */
  mainPath: string | null;
  /** Folder names between the root and the project, e.g. ["Library"]. */
  group: string[];
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function baseName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}

function normaliseFolder(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** Path relative to the root, or null when outside it. */
function underRoot(path: string, root: string): string | null {
  if (root === "") return path;
  if (path === root) return "";
  return path.startsWith(root + "/") ? path.slice(root.length + 1) : null;
}

export function hasTag(tags: string[], tag: string): boolean {
  if (!tag) return false;
  const want = tag.replace(/^#/, "").toLowerCase();
  return tags.some((t) => {
    const have = t.replace(/^#/, "").toLowerCase();
    return have === want || have.startsWith(want + "/");
  });
}

function isIgnored(rel: string, ignore: string[]): boolean {
  const segs = rel.split("/");
  return ignore.some((raw) => {
    const ig = normaliseFolder(raw);
    if (!ig) return false;
    if (ig.includes("/")) return rel === ig || rel.startsWith(ig + "/");
    return segs.slice(0, -1).includes(ig) || rel === ig;
  });
}

/**
 * Works out every project from the notes and folders in the vault.
 * `folders` is the list of all folder paths (so empty project folders are found too).
 */
export function discoverProjects(notes: NoteEntry[], folders: string[], options: DiscoveryOptions): ProjectDef[] {
  const root = normaliseFolder(options.root);
  const depth = Math.max(0, Math.floor(options.categoryDepth));
  const notesByPath = new Map(notes.map((n) => [n.path, n]));

  // Folder projects: folders right below the category level, plus any folder whose folder note
  // carries the project tag. The outermost one wins, so a project's subfolders never split off.
  const folderCandidates = new Set<string>();
  for (const raw of folders) {
    const folder = normaliseFolder(raw);
    const rel = underRoot(folder, root);
    if (rel === null || rel === "" || isIgnored(rel + "/x", options.ignore)) continue;
    const level = rel.split("/").length; // 1 = directly in the root
    const folderNote = notesByPath.get(`${folder}/${baseName(folder)}.md`);
    if (level === depth + 1 || (level > depth && folderNote && hasTag(folderNote.tags, options.projectTag))) {
      folderCandidates.add(folder);
    }
  }
  const folderProjects = [...folderCandidates].filter((f) => {
    for (let p = parentOf(f); p && p !== root; p = parentOf(p)) {
      if (folderCandidates.has(p)) return false;
    }
    // A folder with no notes at all (attachments, an empty new folder) is not a project.
    return notes.some((n) => n.path.startsWith(f + "/") && /\.md$/i.test(n.path));
  });
  const insideFolderProject = (path: string): boolean =>
    folderProjects.some((f) => path.startsWith(f + "/"));

  const projects: ProjectDef[] = folderProjects.map((folder) => {
    const mainPath = `${folder}/${baseName(folder)}.md`;
    return {
      id: folder,
      name: baseName(folder),
      kind: "folder",
      path: folder,
      mainPath: notesByPath.has(mainPath) ? mainPath : null,
      group: groupOf(parentOf(folder), root),
    };
  });

  // File projects: notes sitting directly in a category folder, or tagged notes anywhere.
  for (const note of notes) {
    if (!/\.md$/i.test(note.path)) continue;
    const rel = underRoot(note.path, root);
    if (rel === null || isIgnored(rel, options.ignore) || insideFolderProject(note.path)) continue;
    const level = rel.split("/").length - 1; // folders above the note, within the root
    if (level === depth || hasTag(note.tags, options.projectTag)) {
      projects.push({
        id: note.path,
        name: baseName(note.path),
        kind: "file",
        path: note.path,
        mainPath: note.path,
        group: groupOf(parentOf(note.path), root),
      });
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/** The folder names between the root and `folder` (the folder that holds the project). */
function groupOf(folder: string, root: string): string[] {
  const rel = underRoot(folder, root) ?? "";
  return rel ? rel.split("/") : [];
}

/** The project a file belongs to, or undefined. */
export function projectForPath(path: string, projects: ProjectDef[]): ProjectDef | undefined {
  for (const p of projects) {
    if (p.kind === "file" ? p.path === path : path === p.path || path.startsWith(p.path + "/")) return p;
  }
  return undefined;
}
