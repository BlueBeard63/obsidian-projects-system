// Export to the portfolio (Portfolio/content, a separate vault on disk). Desktop only: it writes
// outside this vault with Node's fs. Every write is shown first; nothing is overwritten silently.

import { Modal, Notice, Platform, Setting, normalizePath } from "obsidian";
import type * as NodeFs from "node:fs";
import { byProject } from "../activity-store";
import { isoDate, parseRange } from "../dates";
import { isFinished, type ProjectInfo } from "../fields";
import { splitFrontmatter, splitSections, type Section } from "../sections";
import type ProjectsPlugin from "../main";
import { confirmWrite, ReportModal } from "../modals/confirm";
import { buildMonthlyPost, buildProjectNote, monthlyBody, portfolioFields, type MonthlyProject } from "./notes";
import { nextCase, rewriteLinks, sanitizeTyping, slugify, stripComments } from "./sanitize";

type Fs = typeof NodeFs.promises;

function nodeFs(): Fs | null {
  if (!Platform.isDesktopApp) return null;
  const req = (window as unknown as { require?: (m: string) => unknown }).require;
  return req ? (req("fs") as typeof NodeFs).promises : null;
}

async function exists(fs: Fs, path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(fs: Fs, path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Checks the portfolio folder is set and looks right; returns its path or null (after a notice). */
async function portfolioRoot(plugin: ProjectsPlugin, fs: Fs): Promise<string | null> {
  const root = plugin.settings.portfolioPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) {
    new Notice("Set the portfolio content folder in the Projects System settings first.");
    return null;
  }
  if (!(await exists(fs, `${root}/Projects`))) {
    new Notice(`${root} has no Projects folder. Point the setting at the portfolio's content folder.`);
    return null;
  }
  return root;
}

interface PortfolioIndex {
  /** Lowercased names a [[link]] can resolve to: project titles and slugs, post slugs and titles. */
  names: Set<string>;
  cases: string[];
  /** Existing project files by slug: file name and case. */
  bySlug: Map<string, { file: string; case: string }>;
}

function fmValue(fm: string, key: string): string {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(fm);
  return m ? m[1]!.trim().replace(/^["']|["']$/g, "") : "";
}

/** Reads what the site's resolver knows (Portfolio/internal/site/build.go: resolve). */
async function indexPortfolio(fs: Fs, root: string): Promise<PortfolioIndex> {
  const idx: PortfolioIndex = { names: new Set(["about"]), cases: [], bySlug: new Map() };
  for (const dir of ["Projects", "Writing"]) {
    let files: string[] = [];
    try {
      files = await fs.readdir(`${root}/${dir}`);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".md") || file.startsWith("_")) continue;
      const base = file.slice(0, -3);
      const { frontmatter } = splitFrontmatter((await readIfExists(fs, `${root}/${dir}/${file}`)) ?? "");
      const title = fmValue(frontmatter, "title") || base;
      const slug = dir === "Writing" ? base : fmValue(frontmatter, "slug") || slugify(base);
      idx.names.add(title.toLowerCase());
      idx.names.add(slug);
      idx.names.add(base.toLowerCase());
      if (dir === "Projects") {
        const c = fmValue(frontmatter, "case");
        if (c) idx.cases.push(c);
        idx.bySlug.set(slug, { file, case: c });
      }
    }
  }
  return idx;
}

function resolver(idx: PortfolioIndex): (target: string) => boolean {
  return (target) => {
    const t = target.split("#")[0]!.split("/").pop()!.replace(/\.md$/i, "").trim().toLowerCase();
    return idx.names.has(t) || idx.names.has(slugify(t));
  };
}

const SKIP_BY_DEFAULT = /\b(log|todo|to do|tasks?|notes?|research|ideas?|scratch|links|references|questions)\b/i;

/** Lets you pick which sections of the project note go into the export. */
class ExportModal extends Modal {
  private readonly chosen: boolean[];
  private stubs = true;

  constructor(
    plugin: ProjectsPlugin,
    private readonly project: ProjectInfo,
    private readonly sections: Section[],
    private readonly target: string,
    private readonly onExport: (sections: Section[], stubs: boolean) => void,
  ) {
    super(plugin.app);
    this.chosen = sections.map((s) => !!s.heading && !SKIP_BY_DEFAULT.test(s.heading));
  }

  override onOpen(): void {
    this.titleEl.setText(`Export ${this.project.name} to the portfolio`);
    const { contentEl } = this;
    contentEl.createEl("p", { cls: "ps-muted", text: this.target });
    contentEl.createEl("p", { text: "Sections to copy (the portfolio uses ## headings for its contents sidebar):" });
    if (!this.sections.length) contentEl.createEl("p", { cls: "ps-muted", text: "The note has no ## sections yet." });
    this.sections.forEach((s, i) => {
      const words = s.body.split(/\s+/).filter(Boolean).length;
      new Setting(contentEl)
        .setName(s.heading || "(text before the first heading)")
        .setDesc(`${words} words`)
        .addToggle((t) => t.setValue(this.chosen[i]!).onChange((v) => (this.chosen[i] = v)));
    });
    new Setting(contentEl)
      .setName("Add missing standard sections")
      .setDesc("Stubs for Overview, The problem, What I built and Outcome when the note has no section with that name.")
      .addToggle((t) => t.setValue(this.stubs).onChange((v) => (this.stubs = v)));
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Export")
          .setCta()
          .onClick(() => {
            this.close();
            this.onExport(
              this.sections.filter((_, i) => this.chosen[i]),
              this.stubs,
            );
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export async function exportProject(plugin: ProjectsPlugin, p: ProjectInfo): Promise<void> {
  const fs = nodeFs();
  if (!fs) {
    new Notice("Exporting to the portfolio needs the desktop app.");
    return;
  }
  if (!isFinished(p.status, plugin.settings.finishedStatuses)) {
    new Notice(`${p.name} is "${p.status || "no status"}". Only finished projects (${plugin.settings.finishedStatuses.join(", ")}) can be exported.`);
    return;
  }
  const root = await portfolioRoot(plugin, fs);
  if (!root || !p.mainPath) {
    if (root) new Notice(`${p.name} has no main note to export.`);
    return;
  }
  const file = plugin.app.vault.getFileByPath(p.mainPath);
  if (!file) return;
  const { body } = splitFrontmatter(await plugin.app.vault.read(file));
  const sections = splitSections(stripComments(body));
  const idx = await indexPortfolio(fs, root);
  const slug = slugify(p.name);
  const existing = idx.bySlug.get(slug);
  const target = `${root}/Projects/${existing?.file ?? `${p.name}.md`}`;

  new ExportModal(plugin, p, sections, target, (chosen, stubs) => {
    void (async () => {
      const report: string[] = [];
      // Links to this project itself resolve once it is exported.
      idx.names.add(p.name.toLowerCase());
      idx.names.add(slug);
      const resolves = resolver(idx);
      const rewritten = chosen.map((s) => {
        const r = rewriteLinks(s.body, resolves);
        for (const u of r.unlinked) report.push(`Unlinked [[${u}]] (not on the portfolio), kept as plain text`);
        for (const d of r.droppedEmbeds) report.push(`Removed embed ![[${d}]] (only images and videos can be embedded)`);
        return { heading: s.heading, body: r.text, embeds: r.embeds };
      });
      const fields = portfolioFields(p, {
        // Re-exports keep their case number, so the order on the site does not change.
        caseNumber: existing?.case || nextCase(idx.cases),
        statusMap: plugin.settings.portfolioStatusMap,
        role: plugin.settings.portfolioRole,
        today: isoDate(new Date()),
      });
      const note = buildProjectNote(fields, rewritten, stubs);
      if (note.changes.length) report.push(`Replaced characters the site does not allow: ${note.changes.join(", ")}`);

      const before = await readIfExists(fs, target);
      if (before !== null) {
        const ok = await confirmWrite(
          plugin.app,
          `Overwrite ${p.name} on the portfolio?`,
          "The portfolio already has this project. This is what the export would change (- removed, + added):",
          before,
          note.text,
          "Overwrite",
        );
        if (!ok) return;
      }

      // Copy embedded images and videos into Assets/ (flat, by file name, as the site expects).
      const assets = `${root}/Assets`;
      for (const embed of rewritten.flatMap((s) => s.embeds)) {
        const src = plugin.app.metadataCache.getFirstLinkpathDest(embed.split("|")[0]!.split("#")[0]!, p.mainPath!);
        if (!src) {
          report.push(`Missing image ${embed}: not found in this vault, the site build will warn`);
          continue;
        }
        const dest = `${assets}/${src.name}`;
        if (await exists(fs, dest)) {
          report.push(`Kept existing Assets/${src.name}`);
          continue;
        }
        await fs.mkdir(assets, { recursive: true });
        await fs.writeFile(dest, new Uint8Array(await plugin.app.vault.readBinary(src)));
        report.push(`Copied ${src.name} to Assets/`);
      }

      await fs.writeFile(target, note.text, "utf8");
      plugin.activity.noteSelfWrite(file.path);
      await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        fm["portfolio"] = fields.slug;
      });
      report.unshift(`Wrote Projects/${target.split("/").pop()} as a draft (case ${fields.case}, slug ${fields.slug})`);
      report.push("Remove draft: true in the portfolio when it is ready, then build and commit as usual.");
      new ReportModal(plugin.app, `Exported ${p.name}`, report, target).open();
    })().catch((e: unknown) => {
      console.error("[projects-system] export failed", e);
      new Notice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }).open();
}

/** Drafts (or appends to) content/Writing/YYYY-MM.md from that month's activity. */
export async function draftMonthlyPost(plugin: ProjectsPlugin, month: string): Promise<void> {
  const fs = nodeFs();
  if (!fs) {
    new Notice("Writing to the portfolio needs the desktop app.");
    return;
  }
  const root = await portfolioRoot(plugin, fs);
  const range = parseRange(month);
  if (!root || !range) return;
  const per = byProject(plugin.activity.summary(range, (id) => !!plugin.index.get(id)));
  if (!per.size) {
    new Notice(`No project activity in ${range.label}.`);
    return;
  }
  const projects: MonthlyProject[] = [...per.entries()]
    .map(([id, agg]) => {
      const p = plugin.index.get(id)!;
      const slug = typeof p.fm["portfolio"] === "string" ? (p.fm["portfolio"] as string) : "";
      return {
        name: p.name,
        slug,
        days: agg.days.length,
        files: [...agg.files],
        created: [...agg.created].filter((f) => f.endsWith(".md")),
        status: [...agg.status].reverse(),
      };
    })
    .sort((a, b) => b.days - a.days);

  const target = normalizePath(`${root}/Writing/${month}.md`);
  const before = await readIfExists(fs, target);
  let text: string;
  if (before === null) {
    text = buildMonthlyPost(month, projects).text;
  } else {
    // Append only projects the post does not already have a section for.
    const have = new Set(splitSections(splitFrontmatter(before).body).map((s) => s.heading.replace(/\[\[|\]\]/g, "").toLowerCase()));
    const fresh = projects.filter((p) => !have.has(p.name.toLowerCase()));
    if (!fresh.length) {
      new Notice(`Writing/${month}.md already covers every project from ${range.label}.`);
      return;
    }
    text = before.replace(/\s*$/, "\n\n") + sanitizeTyping(monthlyBody(fresh)).text + "\n";
    const ok = await confirmWrite(plugin.app, `Add to ${month}.md?`, `Writing/${month}.md exists. These sections would be added:`, before, text, "Append");
    if (!ok) return;
  }
  await fs.mkdir(`${root}/Writing`, { recursive: true });
  await fs.writeFile(target, text, "utf8");
  new ReportModal(
    plugin.app,
    `${before === null ? "Drafted" : "Updated"} ${range.label}`,
    [
      `${projects.length} project${projects.length === 1 ? "" : "s"} from your activity`,
      "The lists inside %% %% are notes for you and are not published. Rewrite each section in your own words.",
      "Projects not yet on the portfolio are plain headings, not links.",
    ],
    target,
  ).open();
}
