# Projects System

An Obsidian plugin for the project notes you already keep. It finds your projects from the folders and frontmatter you already use, records what you work on automatically, and turns finished projects into portfolio drafts.

There is nothing new to maintain: no required fields, no log to write, no new folder layout.

## How it finds projects

```
Personal Projects/                 <- projects folder (setting)
  A-Level/                         <- category folders (setting: category levels = 1)
    BAnim.md                       <- a single-note project
  Platform/
    Ticket System/                 <- a folder project...
      Ticket System.md             <- ...its folder note is the main note
      Research/Competitors.md      <- everything inside belongs to it
```

- A note with the `project` tag is a project wherever it sits under the projects folder.
- Folders called `Templates`, `Assets` or `Attachments` are skipped (setting).
- A folder with no notes in it is not a project.

Fields come from your existing frontmatter. Which key holds each field can be changed in settings:

| Field | Default key |
|---|---|
| status | `status` |
| summary | `summary` |
| repository | `github` |
| languages | `languages` |
| created | `created` |
| updated | `updated` |

Any other key (`area`, `category`, `framework`, ...) works in filters by its own name. Status values are your own words. You set their order in settings, and any value found in your notes that isn't in that list is added at the end.

## Activity, without a log

The plugin watches the vault. When you create, edit, rename or delete a note inside a project, or change a project's `status:`, it records the day. History is stored in the plugin's own `activity.json`, never in your notes.

- **First run:** history is seeded from file created/modified dates.
- **Long-term size:** after 120 days (setting), per-note edits are folded into a count per day.
- **`updated:` kept current (setting, on by default):** the first edit of the day to any note in a project sets the main note's `updated:` to today. It only does this if the note already has that field.

## Dashboard

Open it with the ribbon icon or **Open projects dashboard**.

- **Grid:** one card per project, showing status, summary, languages and "worked on 3 days ago". Projects with no activity for 30 days are marked stale.
- **Table:** sortable columns.
- **Activity:** a day-by-day timeline of what you touched, for this week, last month, a picked month, and so on. The copy button puts it on the clipboard as markdown.

You can filter by text, status and folder, or use the quick filters: not finished, worked on recently, stale, finished. You can also group by status, folder, area or category.

To change a status, click the status pill on a card or right-click a project. Only `status:` in the main note is changed. A folder project without its folder note asks before one is created.

## Code blocks

Put these in any note, such as a weekly review or a daily note. They update live.

````md
```projects
status: planning, in progress   any listed value; any frontmatter key works
-area: A-Level                  leading - excludes
search: sql                     name, summary, languages
active: this-month              only projects with activity in that range
sort: last-activity             name | status | updated | created | last-activity | <key>  (add "desc"/"asc")
group-by: status                status | group | area | category | <key>
view: grid                      grid | table | list
limit: 10
```

```project-activity
range: this-week                today | yesterday | this-week | last-week | this-month | last-month | this-year | 14d | 2026-10 | 2026-10-01..2026-10-17
area: Personal                  same filters as above narrow which projects show
view: list                      compact: one line per project per day
```
````

## Quick actions and editing

Hover a card in the dashboard for three buttons:

- **New note:** asks for a name and an optional subfolder (e.g. `Research`), creates the note inside the project and opens it. For a single-note project this first turns it into a folder project: `Category/X.md` moves to `Category/X/X.md`, and Obsidian updates the links.
- **Edit:** opens one dialog for the whole card.
  - Fields: name, status, summary, languages, repository, area, category, created and updated dates.
  - Only the fields you change are written. Renaming renames the note, or the folder and its folder note, and links update.
  - Ctrl/Cmd+Enter saves.
- **More:** the same menu as right-clicking: open, edit, new note, set status, copy activity, export.

The commands **Edit current project** and **New note in current project** do the same for the note you have open.

## Commands

- **Open projects dashboard**
- **Open a project**
- **New project:** asks for name, category, single note or folder, status and summary. It uses your frontmatter shape or a template note (setting). The template can use `{{name}}`, `{{date}}`, `{{status}}` and `{{summary}}`.
- **Set status of current project:** type a new value to add a status.
- **Copy activity summary** and **Insert activity summary at cursor:** markdown for a range, with links to the notes. Useful to paste into a review, or to hand to an LLM to write up.
- **Export project to portfolio** (desktop): see below.
- **Draft monthly portfolio post** (desktop): see below.

Right-clicking a project folder or note in the file explorer shows its status too.

## Portfolio export (desktop)

Set **Portfolio content folder** to the portfolio's `content/` folder: the one with `Projects/`, `Writing/` and `Assets/`.

**Export project to portfolio** works for projects with a finished status. It writes `Projects/<Name>.md` as a draft that matches the site's `Project` fields:

| Portfolio field | Comes from |
|---|---|
| `title` | project name |
| `slug` | project name, slugified |
| `summary`, `updated` | the same fields |
| `stack` | `languages`, lowercased |
| `links.repo` | `github` |
| `year` | year of `created` |
| `status` | your status, mapped (setting) |
| `case` | next free number; a re-export keeps its number |

- **Sections:** you choose which `##` sections to copy. Log, notes and research sections are off by default. Missing standard sections (Overview, The problem, What I built, Outcome) are stubbed in order.
- **Strict-safe output:**
  - Characters the site rejects are replaced: em/en dashes, curly quotes, ellipses, arrows, `×` and `·`.
  - Embedded images and videos are copied flat into `Assets/`.
  - Links the portfolio cannot resolve become plain text.
  - Note embeds and `%% comments %%` are removed.
  - Code blocks are left alone.
- **No silent overwrites:** if the file exists you see a diff and confirm first.
- **Writes back:** `portfolio: <slug>` is added to your project note.

**Draft monthly portfolio post** builds `Writing/YYYY-MM.md` from that month's activity. It contains one section per project, plus status changes and new notes as hidden `%% %%` notes for you to rewrite. If the post exists, only projects it doesn't cover yet are appended, after a diff.

Committing and building the portfolio stay manual.

## Bases and Dataview

Everything is plain frontmatter, so Bases and Dataview can query the same notes if you want them to.

## Development

```sh
npm install
npm test            # unit tests (Node 22+ runs the TypeScript directly)
npm run build       # typecheck + bundle main.js
npm run demo        # build and install into demo/, then open demo/ as a vault
OBSIDIAN_VAULT="D:/path/to/vault" npm run dev   # watch and install into another vault
```

The `demo/` vault has sample projects in your frontmatter shape, a seeded activity history, `Reviews/Weekly review.md` showing the code blocks, and a stand-in `portfolio/content/` to export into.
