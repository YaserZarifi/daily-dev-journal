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

export interface Stats {
  totalEntries: number;
  totalDays: number;
  totalWeeks: number;
  currentStreak: number;
  longestStreak: number;
  avgPerActiveDay: number;
  mostActiveWeekday: string;
  heatmap: { date: string; count: number }[];
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function getStats(days: Day[]): Stats {
  const totalEntries = days.reduce((sum, d) => sum + d.entries.length, 0);
  const totalDays = days.length;
  const totalWeeks = new Set(days.map((d) => d.week)).size;

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const dateSet = new Set(sorted.map((d) => d.date));

  let longestStreak = 0;
  let run = 0;
  let prevDate: string | null = null;
  for (const d of sorted) {
    run = prevDate && addDays(prevDate, 1) === d.date ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    prevDate = d.date;
  }

  let currentStreak = 0;
  if (sorted.length) {
    const latest = sorted[sorted.length - 1].date;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = addDays(today, -1);
    if (latest === today || latest === yesterday) {
      let cursor = latest;
      while (dateSet.has(cursor)) {
        currentStreak++;
        cursor = addDays(cursor, -1);
      }
    }
  }

  const avgPerActiveDay = totalDays ? Math.round((totalEntries / totalDays) * 10) / 10 : 0;

  const weekdayCounts = new Map<string, number>();
  for (const d of days) {
    weekdayCounts.set(d.weekday, (weekdayCounts.get(d.weekday) ?? 0) + d.entries.length);
  }
  const mostActiveWeekday =
    [...weekdayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  const endDate = sorted.length ? sorted[sorted.length - 1].date : new Date().toISOString().slice(0, 10);
  const heatmap: { date: string; count: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const date = addDays(endDate, -i);
    const day = days.find((d) => d.date === date);
    heatmap.push({ date, count: day ? day.entries.length : 0 });
  }

  return {
    totalEntries,
    totalDays,
    totalWeeks,
    currentStreak,
    longestStreak,
    avgPerActiveDay,
    mostActiveWeekday,
    heatmap,
  };
}
