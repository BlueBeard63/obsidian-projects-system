// Splits a note into its frontmatter and `##` sections, so an export can pick which sections to
// copy. Pure: no Obsidian imports.

export interface Section {
  /** Heading text without the ##, or "" for the text before the first ## heading. */
  heading: string;
  /** Heading line plus everything up to the next ## (or end). */
  body: string;
}

export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { frontmatter: "", body: text };
  return { frontmatter: m[1], body: text.slice(m[0].length) };
}

/** Level-2 sections, skipping headings inside code fences. A leading # title is dropped. */
export function splitSections(body: string): Section[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  let current: Section = { heading: "", body: "" };
  const buf: string[] = [];
  let fence: string | null = null;
  const flush = (): void => {
    current.body = buf.join("\n").replace(/\s+$/, "");
    if (current.heading || current.body.trim()) sections.push(current);
    buf.length = 0;
  };
  for (const line of lines) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      buf.push(line);
      continue;
    }
    if (f) {
      fence = f[1]!;
      buf.push(line);
      continue;
    }
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      current = { heading: h[1], body: "" };
    } else if (/^#\s+/.test(line) && !current.heading && !buf.some((l) => l.trim())) {
      continue; // a "# Title" at the top duplicates the note name
    }
    buf.push(line);
  }
  flush();
  return sections;
}
