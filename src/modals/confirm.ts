import { App, Modal, Setting } from "obsidian";

/** Line diff (LCS) for small files: what an overwrite would change. */
export function lineDiff(before: string, after: string): { op: " " | "-" | "+"; line: string }[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: { op: " " | "-" | "+"; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: " ", line: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: "-", line: a[i++] });
    else out.push({ op: "+", line: b[j++] });
  }
  while (i < n) out.push({ op: "-", line: a[i++] });
  while (j < m) out.push({ op: "+", line: b[j++] });
  return out;
}

/** Asks before overwriting/appending a file, showing what changes. Resolves true to go ahead. */
export function confirmWrite(app: App, title: string, message: string, before: string, after: string, action: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      decided = false;
      override onOpen(): void {
        this.titleEl.setText(title);
        this.contentEl.createEl("p", { text: message });
        const diff = lineDiff(before, after);
        const changed = diff.filter((d) => d.op !== " ").length;
        if (!changed) this.contentEl.createEl("p", { cls: "ps-muted", text: "No changes." });
        const pre = this.contentEl.createEl("pre", { cls: "ps-diff" });
        // Show changed lines with two lines of context around them.
        const keep = new Set<number>();
        diff.forEach((d, i) => {
          if (d.op !== " ") for (let k = i - 2; k <= i + 2; k++) keep.add(k);
        });
        let gap = false;
        diff.forEach((d, i) => {
          if (!keep.has(i)) {
            if (!gap) pre.createDiv({ cls: "ps-diff-gap", text: "..." });
            gap = true;
            return;
          }
          gap = false;
          pre.createDiv({ cls: `ps-diff-${d.op === "+" ? "add" : d.op === "-" ? "del" : "ctx"}`, text: `${d.op} ${d.line}` });
        });
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
          .addButton((b) =>
            b
              .setButtonText(action)
              .setCta()
              .onClick(() => {
                this.decided = true;
                resolve(true);
                this.close();
              }),
          );
      }
      override onClose(): void {
        if (!this.decided) resolve(false);
        this.contentEl.empty();
      }
    })(app);
    modal.modalEl.addClass("ps-wide-modal");
    modal.open();
  });
}

/** Shows a list of what an export did (or would need fixing). */
export class ReportModal extends Modal {
  constructor(app: App, private readonly heading: string, private readonly lines: string[], private readonly path?: string) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.heading);
    if (this.path) this.contentEl.createEl("p", { cls: "ps-muted", text: this.path });
    const ul = this.contentEl.createEl("ul");
    for (const l of this.lines) ul.createEl("li", { text: l });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("OK").setCta().onClick(() => this.close()));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
