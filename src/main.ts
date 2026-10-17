import { Menu, Notice, Platform, Plugin, TFolder } from "obsidian";
import { ActivityTracker } from "./activity";
import { registerBlocks } from "./blocks";
import { registerCommands } from "./commands";
import { parseRange, type DateRange } from "./dates";
import { exportProject } from "./export/portfolio";
import { DEFAULT_FIELDS, isFinished, type ProjectInfo } from "./fields";
import { ProjectIndex } from "./index";
import { StatusPicker } from "./modals/pickers";
import { EditProjectModal } from "./modals/edit-project";
import { NewProjectNoteModal } from "./modals/new-note";
import { DEFAULT_SETTINGS, ProjectsSettingTab, type ProjectsSettings } from "./settings";
import { activityMarkdown } from "./summary";
import { DASHBOARD_VIEW, DashboardView } from "./views/dashboard";
import { openProject } from "./views/render";
import { registerBasesViews } from "./views/bases";

export default class ProjectsPlugin extends Plugin {
  override settings: ProjectsSettings = { ...DEFAULT_SETTINGS };
  index!: ProjectIndex;
  activity!: ActivityTracker;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.index = new ProjectIndex(this);
    this.activity = new ActivityTracker(this);
    await this.activity.load();

    this.registerView(DASHBOARD_VIEW, (leaf) => new DashboardView(leaf, this));
    registerBlocks(this);
    // "Project cards" and "Project activity" in the Bases view picker (Obsidian 1.10+, Bases enabled).
    registerBasesViews(this);
    registerCommands(this);
    this.addSettingTab(new ProjectsSettingTab(this));
    this.addRibbonIcon("folder-kanban", "Open projects dashboard", () => void this.openDashboard());

    // Right-click a project folder or note in the file explorer.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const p = file instanceof TFolder ? this.index.get(file.path) : this.index.projectFor(file.path);
        if (!p || (file instanceof TFolder && p.path !== file.path)) return;
        menu.addItem((item) =>
          item
            .setTitle(`Status: ${p.status || "none"}`)
            .setIcon("flag")
            .onClick(() => new StatusPicker(this.app, this.index.statuses(), p.status, (s) => void this.index.setStatus(p, s)).open()),
        );
      }),
    );

    // Start once metadata is cached; start-up "create" events for every file are over by then.
    this.app.workspace.onLayoutReady(() => {
      this.index.start();
      this.activity.start();
    });
  }

  override async onunload(): Promise<void> {
    await this.activity.flush();
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<ProjectsSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    this.settings.fields = { ...DEFAULT_FIELDS, ...(data?.fields ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async openDashboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: DASHBOARD_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async open(p: ProjectInfo): Promise<void> {
    await openProject(this.app, p);
  }

  activityText(range: DateRange, include?: (id: string) => boolean): string {
    const days = this.activity.summary(range, (id) => (include ? include(id) : true) && !!this.index.get(id));
    return activityMarkdown(days, range, (id) => this.index.get(id)?.name ?? id.split("/").pop()!.replace(/\.md$/, ""));
  }

  async copyActivity(range: DateRange, include?: (id: string) => boolean): Promise<void> {
    await navigator.clipboard.writeText(this.activityText(range, include));
    new Notice(`Copied activity for ${range.label.toLowerCase()}.`);
  }

  editProject(p: ProjectInfo, extraKeys: string[] = []): void {
    new EditProjectModal(this, p, extraKeys).open();
  }

  newProjectNote(p: ProjectInfo): void {
    new NewProjectNoteModal(this, p).open();
  }

  /** Right-click menu for a project card or row. */
  projectMenu(p: ProjectInfo): Menu {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Open").setIcon("file-text").onClick(() => void this.open(p)));
    menu.addItem((i) => i.setTitle("Edit...").setIcon("pencil").onClick(() => this.editProject(p)));
    menu.addItem((i) => i.setTitle("New note in project...").setIcon("file-plus").onClick(() => this.newProjectNote(p)));
    menu.addSeparator();
    for (const s of this.index.statuses()) {
      menu.addItem((i) =>
        i
          .setTitle(s)
          .setSection("status")
          .setChecked(s.toLowerCase() === p.status.toLowerCase())
          .onClick(() => void this.index.setStatus(p, s)),
      );
    }
    menu.addSeparator();
    menu.addItem((i) =>
      i.setTitle("Copy this month's activity").setIcon("copy").onClick(() => {
        const range = { ...parseRange("this-month")!, label: `${p.name}, this month` };
        void this.copyActivity(range, (id) => id === p.id);
      }),
    );
    if (Platform.isDesktopApp && isFinished(p.status, this.settings.finishedStatuses)) {
      menu.addItem((i) => i.setTitle("Export to portfolio").setIcon("upload").onClick(() => void exportProject(this, p)));
    }
    return menu;
  }
}
