// Date helpers and the range syntax shared by the dashboard, the code blocks and the commands.
// Pure (no Obsidian imports) so it can be unit tested. Dates are local-time YYYY-MM-DD strings,
// which compare correctly as plain strings.

export interface DateRange {
  /** First day, inclusive (YYYY-MM-DD). */
  start: string;
  /** Last day, inclusive (YYYY-MM-DD). */
  end: string;
  /** Human label, e.g. "This week" or "October 2026". */
  label: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parses YYYY-MM-DD as a local date (new Date("2026-10-17") would be UTC midnight). */
export function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Whole days from a to b (b later is positive). */
export function daysBetween(a: string, b: string): number {
  const da = parseIsoDate(a);
  const db = parseIsoDate(b);
  if (!da || !db) return NaN;
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/** Monday of the week containing d. */
function weekStart(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

function monthRange(year: number, month: number): DateRange {
  return {
    start: isoDate(new Date(year, month, 1)),
    end: isoDate(new Date(year, month + 1, 0)),
    label: `${MONTHS[month]} ${year}`,
  };
}

/**
 * Parses a range spec:
 *   today | yesterday | this-week | last-week | this-month | last-month | this-year
 *   7d / 14d (the last N days including today) | 2026-10 | 2026-10-01..2026-10-17 | 2026-10-17
 * Returns null for anything else.
 */
export function parseRange(spec: string, now: Date = new Date()): DateRange | null {
  const s = spec.trim().toLowerCase().replace(/[\s_]+/g, "-");
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (s) {
    case "today":
      return { start: isoDate(today), end: isoDate(today), label: "Today" };
    case "yesterday": {
      const y = isoDate(addDays(today, -1));
      return { start: y, end: y, label: "Yesterday" };
    }
    case "this-week":
    case "week": {
      const start = weekStart(today);
      return { start: isoDate(start), end: isoDate(addDays(start, 6)), label: "This week" };
    }
    case "last-week": {
      const start = addDays(weekStart(today), -7);
      return { start: isoDate(start), end: isoDate(addDays(start, 6)), label: "Last week" };
    }
    case "this-month":
    case "month":
      return { ...monthRange(today.getFullYear(), today.getMonth()), label: "This month" };
    case "last-month": {
      const r = monthRange(today.getFullYear(), today.getMonth() - 1);
      // monthRange's label uses the month index as given, so rebuild it from the start date.
      const d = parseIsoDate(r.start)!;
      return { ...r, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` };
    }
    case "this-year":
    case "year":
      return { start: `${today.getFullYear()}-01-01`, end: `${today.getFullYear()}-12-31`, label: String(today.getFullYear()) };
  }
  let m = /^(\d+)d$/.exec(s);
  if (m) {
    const n = Math.max(1, Number(m[1]));
    return { start: isoDate(addDays(today, -(n - 1))), end: isoDate(today), label: `Last ${n} days` };
  }
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const month = Number(m[2]) - 1;
    if (month < 0 || month > 11) return null;
    return monthRange(Number(m[1]), month);
  }
  m = /^(\d{4}-\d{2}-\d{2})(?:\.\.|-to-)(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (m) {
    if (!parseIsoDate(m[1]) || !parseIsoDate(m[2])) return null;
    const [start, end] = m[1] <= m[2] ? [m[1], m[2]] : [m[2], m[1]];
    return { start, end, label: `${start} to ${end}` };
  }
  if (parseIsoDate(s)) return { start: s, end: s, label: s };
  return null;
}

export function inRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

/**
 * Normalises a frontmatter date (YAML may give a string, a Date or a number) to YYYY-MM-DD,
 * or "" when it is not a date.
 */
export function normaliseDate(v: unknown): string {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
    if (m && parseIsoDate(m[1])) return m[1];
  }
  return "";
}

/** "today", "yesterday", "3 days ago", "5 weeks ago", ... relative to `today`. */
export function relativeDay(date: string, today: string): string {
  const n = daysBetween(date, today);
  if (!Number.isFinite(n)) return "";
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  if (n < 730) return `${Math.round(n / 30)} months ago`;
  return `${Math.round(n / 365)} years ago`;
}

/** "Fri 17 Oct" style heading for a day. */
export function dayLabel(date: string): string {
  const d = parseIsoDate(date);
  if (!d) return date;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${wd} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}
