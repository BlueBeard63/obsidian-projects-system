import { Notice, Platform } from "obsidian";
import { isFinished, type ProjectInfo } from "./fields";
import type ProjectsPlugin from "./main";
import { draftMonthlyPost, exportProject } from "./export/portfolio";
import { NewProjectModal } from "./modals/new-project";
import { BaseViewPicker, MonthPicker, ProjectPicker, RangePicker, StatusPicker } from "./modals/pickers";
import { confirmWrite } from "./modals/confirm";
import { defaultBasePath, projectsBaseFile } from "./views/bases";

export function registerCommands(plugin: ProjectsPlugin): void {
  const { app } = plugin;

  /** The project of the open note, if any. */
  const current = (): ProjectInfo | undefined => {
    const file = app.workspace.getActiveFile();
    return file ? plugin.index.projectFor(file.path) : undefined;
  };

  /** Runs fn on the current note's project, or asks which project when the note is not in one. */
  const withProject = (fn: (p: ProjectInfo) => void, filter: (p: ProjectInfo) => boolean = () => true, placeholder?: string): void => {
    const p = current();
    if (p && filter(p)) fn(p);
    else new ProjectPicker(app, plugin.index.projects.filter(filter), fn, placeholder).open();
  };

  plugin.addCommand({
    id: "open-dashboard",
    name: "Open projects dashboard",
    callback: () => void plugin.openDashboard(),
  });

  plugin.addCommand({
    id: "set-status",
    name: "Set status of current project",
    callback: () =>
      withProject((p) =>
        new StatusPicker(app, plugin.index.statuses(), p.status, (s) => void plugin.index.setStatus(p, s)).open(),
      ),
  });

  plugin.addCommand({
    id: "edit-project",
    name: "Edit current project",
    callback: () => withProject((p) => plugin.editProject(p)),
  });

  plugin.addCommand({
    id: "new-project-note",
    name: "New note in current project",
    callback: () => withProject((p) => plugin.newProjectNote(p)),
  });

  plugin.addCommand({
    id: "open-project",
    name: "Open a project",
    callback: () => new ProjectPicker(app, plugin.index.projects, (p) => void plugin.open(p)).open(),
  });

  plugin.addCommand({
    id: "new-project",
    name: "New project",
    callback: () => new NewProjectModal(plugin).open(),
  });

  plugin.addCommand({
    id: "copy-activity",
    name: "Copy activity summary",
    callback: () => new RangePicker(app, (r) => void plugin.copyActivity(r)).open(),
  });

  plugin.addCommand({
    id: "insert-activity",
    name: "Insert activity summary at cursor",
    editorCallback: (editor) =>
      new RangePicker(app, (r) => editor.replaceSelection(plugin.activityText(r) + "\n")).open(),
  });

  plugin.addCommand({
    id: "create-projects-base",
    name: "Create projects base",
    callback: () =>
      new BaseViewPicker(app, async (first) => {
        const { settings } = plugin;
        const path = defaultBasePath(settings.root);
        const text = projectsBaseFile(settings.root, first, settings.fields.status);
        const existing = app.vault.getFileByPath(path);
        if (existing) {
          const before = await app.vault.read(existing);
          const ok = await confirmWrite(app, `Replace ${path}?`, "This base already exists. Replacing it changes:", before, text, "Replace");
          if (!ok) return;
          await app.vault.modify(existing, text);
        } else {
          await app.vault.create(path, text);
        }
        await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(path)!);
      }).open(),
  });

  if (Platform.isDesktopApp) {
    const finished = (p: ProjectInfo): boolean => isFinished(p.status, plugin.settings.finishedStatuses);
    plugin.addCommand({
      id: "export-to-portfolio",
      name: "Export project to portfolio",
      callback: () => {
        const p = current();
        if (p && !finished(p)) {
          new Notice(`${p.name} isn't finished yet ("${p.status || "no status"}"). Pick a finished project to export.`);
        }
        withProject((q) => void exportProject(plugin, q), finished, "Export which finished project?");
      },
    });
    plugin.addCommand({
      id: "draft-monthly-post",
      name: "Draft monthly portfolio post",
      callback: () => new MonthPicker(app, (m) => void draftMonthlyPost(plugin, m)).open(),
    });
  }
}
