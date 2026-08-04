// Reads every real journal entry out of the `YYYY-Wxx/Weekday-YYYY-MM-DD/Journal-*.md`
// folders your Telegram automation writes into. Deliberately ignores the
// `Journal-*.txt` / `Daily-Quote-*.txt` files (those are single quote lines,
// not entries) and the legacy loose files at the repo root.

export interface Entry {
  path: string;
  slug: string;
  title: string;
  html: string;
  date: string; // YYYY-MM-DD
  weekday: string;
  week: string; // e.g. "2026-W32"
  seq: number;
}

export interface Day {
  date: string;
  weekday: string;
  week: string;
  entries: Entry[];
}

export interface Week {
  week: string;
  days: Day[];
  entryCount: number;
}

const modules = import.meta.glob('/2026-W*/**/Journal-*.md', { eager: true }) as Record<
  string,
  { rawContent?: () => string; compiledContent?: () => string }
>;

const PATH_RE = /\/(\d{4}-W\d{2})\/([A-Za-z]+)-(\d{4}-\d{2}-\d{2})\/([^/]+)\.md$/;
const SEQ_RE = /-(\d+)-\d+$/; // "...-1-406" -> sequence 1
const TITLE_RE = /^#{1,6}\s+(.+)$/m;

function extractTitle(raw: string, fallback: string): string {
  const match = raw.match(TITLE_RE);
  if (match) return match[1].trim();
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0);
  return firstLine ? firstLine.slice(0, 80).trim() : fallback;
}

export function getEntries(): Entry[] {
  const entries: Entry[] = [];

  for (const [path, mod] of Object.entries(modules)) {
    const match = path.match(PATH_RE);
    if (!match) continue;
    const [, week, weekday, date, filename] = match;

    const raw = mod.rawContent ? mod.rawContent() : '';
    const compiled = mod.compiledContent ? mod.compiledContent() : '';
    const seqMatch = filename.match(SEQ_RE);
    const seq = seqMatch ? parseInt(seqMatch[1], 10) : 0;

    entries.push({
      path,
      slug: filename,
      title: extractTitle(raw, filename),
      html: compiled,
      date,
      weekday,
      week,
      seq,
    });
  }

  // Newest week, newest day, latest entry of the day first.
  entries.sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
  return entries;
}

export function groupByDay(entries: Entry[]): Day[] {
  const map = new Map<string, Day>();
  for (const entry of entries) {
    if (!map.has(entry.date)) {
      map.set(entry.date, { date: entry.date, weekday: entry.weekday, week: entry.week, entries: [] });
    }
    map.get(entry.date)!.entries.push(entry);
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function groupByWeek(days: Day[]): Week[] {
  const map = new Map<string, Day[]>();
  for (const day of days) {
    if (!map.has(day.week)) map.set(day.week, []);
    map.get(day.week)!.push(day);
  }
  return [...map.entries()]
    .map(([week, weekDays]) => ({
      week,
      days: weekDays,
      entryCount: weekDays.reduce((sum, d) => sum + d.entries.length, 0),
    }))
    .sort((a, b) => b.week.localeCompare(a.week));
}
