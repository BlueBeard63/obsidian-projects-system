// Makes exported text pass the portfolio's strict build (Portfolio/internal/site/typeable.go and
// the wikilink/embed checks in markdown.go). Pure: no Obsidian imports.

/** Same characters and replacements as untypeableChars in typeable.go. */
const UNTYPEABLE: [RegExp, string, string][] = [
  [/ ?— ?/g, " - ", "em dash"],
  [/–/g, "-", "en dash"],
  [/ ?· ?/g, " / ", "middle dot"],
  [/×/g, "x", "multiplication sign"],
  [/[‘’]/g, "'", "curly quote"],
  [/[“”]/g, '"', "curly quote"],
  [/…/g, "...", "ellipsis"],
  [/→/g, "->", "arrow"],
  [/←/g, "<-", "arrow"],
];

export interface SanitizeResult {
  text: string;
  /** e.g. ["3 x em dash", "2 x curly quote"] */
  changes: string[];
}

export function sanitizeTyping(text: string): SanitizeResult {
  const counts = new Map<string, number>();
  let out = text;
  for (const [re, rep, label] of UNTYPEABLE) {
    out = out.replace(re, () => {
      counts.set(label, (counts.get(label) ?? 0) + 1);
      return rep;
    });
  }
  return { text: out, changes: [...counts].map(([label, n]) => `${n} x ${label}`) };
}

/** Same as slugify in content.go: lowercase, runs of anything but a-z0-9 become "-". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The next free case number ("0x0D") after the highest one in use. */
export function nextCase(existing: string[]): string {
  let max = 0;
  for (const c of existing) {
    const m = /^0x([0-9a-f]+)$/i.exec(c.trim().replace(/^["']|["']$/g, ""));
    if (m) max = Math.max(max, parseInt(m[1]!, 16));
  }
  return "0x" + (max + 1).toString(16).toUpperCase().padStart(2, "0");
}

export interface LinkRewrite {
  text: string;
  /** Embedded files to copy into Assets/ (link targets as written, e.g. "shot.png"). */
  embeds: string[];
  /** Links turned into plain text because the portfolio cannot resolve them. */
  unlinked: string[];
  /** Embeds dropped because they are notes, not files the site can show. */
  droppedEmbeds: string[];
}

const MEDIA = /\.(png|jpe?g|gif|webp|svg|avif|mp4|webm)$/i;

/**
 * Rewrites [[links]] and ![[embeds]] for the portfolio:
 *  - media embeds stay (flattened to the bare file name) and are listed for copying;
 *  - other embeds (notes, PDFs, ...) are removed;
 *  - links the portfolio resolves stay; the rest become their label as plain text.
 * Code (fenced and inline) is left untouched.
 */
export function rewriteLinks(text: string, resolves: (target: string) => boolean): LinkRewrite {
  const res: LinkRewrite = { text: "", embeds: [], unlinked: [], droppedEmbeds: [] };
  res.text = mapOutsideCode(text, (chunk) =>
    chunk.replace(/(!?)\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_m, bang: string, rawTarget: string, label?: string) => {
      const target = rawTarget.trim();
      if (bang) {
        const file = target.split("#")[0]!.split("/").pop()!;
        if (MEDIA.test(file)) {
          if (!res.embeds.includes(target)) res.embeds.push(target);
          return label !== undefined ? `![[${file}|${label}]]` : `![[${file}]]`;
        }
        res.droppedEmbeds.push(target);
        return "";
      }
      const shown = (label ?? target.split("#")[0]!.split("/").pop()!).trim();
      if (resolves(target)) return label !== undefined ? `[[${target}|${label}]]` : `[[${target}]]`;
      if (!res.unlinked.includes(target)) res.unlinked.push(target);
      return shown;
    }),
  );
  return res;
}

/** Applies fn to the parts of markdown outside fenced code blocks and inline code spans. */
export function mapOutsideCode(text: string, fn: (s: string) => string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && line.trim() === m[1]) fence = null;
      continue;
    }
    if (m) {
      fence = m[1]!;
      out.push(line);
      continue;
    }
    out.push(line.split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part : fn(part))).join(""));
  }
  return out.join("\n");
}

/** Removes %% comments %% (the site strips them anyway, but they should not leak private notes). */
export function stripComments(text: string): string {
  return text.replace(/%%[\s\S]*?%%\n?/g, "");
}
