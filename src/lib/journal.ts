// Reads every real journal entry out of the `YYYY-Wxx/Weekday-YYYY-MM-DD/Journal-*.md`
// folders your Telegram automation writes into. Deliberately ignores the
// `Journal-*.txt` / `Daily-Quote-*.txt` files (those are single quote lines,
// not entries) and the legacy loose files at the repo root.

import commitTimes from '../data/commit-times.json';

export interface Entry {
  path: string;
  slug: string;
  title: string;
  html: string;
  date: string; // YYYY-MM-DD
  weekday: string;
  week: string; // e.g. "2026-W32"
  seq: number;
  mood: string;
  tags: string[];
  text: string; // plain text (HTML stripped) used for client-side search indexing
  commitTime: string; // ISO timestamp from git, e.g. "2026-08-05T00:36:47+04:30"
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
  {
    rawContent?: () => string;
    compiledContent?: () => string;
    frontmatter?: { mood?: string; tags?: string[] };
  }
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
    const frontmatter = mod.frontmatter ?? {};
    const text = raw
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_`~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    entries.push({
      path,
      slug: filename,
      title: extractTitle(raw, filename),
      html: compiled,
      date,
      weekday,
      week,
      seq,
      mood: frontmatter.mood ?? '',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      text,
      commitTime: (commitTimes as Record<string, string>)[path] ?? '',
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

export interface HeatmapCell {
  date: string;
  count: number;
}

export interface HeatmapWeek {
  cells: (HeatmapCell | null)[]; // null = padding day outside the displayed range
}

export interface YearHeatmap {
  id: string; // "last365" or a calendar year like "2026"
  label: string; // display label for the toggle button
  weeks: HeatmapWeek[];
  monthLabels: { weekIndex: number; label: string }[];
}

export interface Stats {
  totalEntries: number;
  totalDays: number;
  totalWeeks: number;
  currentStreak: number;
  longestStreak: number;
  avgPerActiveDay: number;
  mostActiveWeekday: string;
  heatmapViews: YearHeatmap[]; // [0] is "Last 365 days", followed by one per calendar year (newest first)
}

function addDays(dateStr: string, delta: number): string {
  // Parse and mutate in UTC explicitly — without the "Z" and UTC setters,
  // this shifts by a day whenever the build machine's local timezone has a
  // positive UTC offset (e.g. UTC+4:30), silently corrupting endDate and
  // streak-continuity checks.
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Builds a GitHub-style calendar grid (Sunday-first columns of 7) covering
// [rangeStart, rangeEnd] inclusive, padded out to full weeks with null cells
// so the grid always renders as complete columns.
function buildYearHeatmap(
  id: string,
  label: string,
  rangeStart: string,
  rangeEnd: string,
  countByDate: Map<string, number>
): YearHeatmap {
  const gridStart = new Date(rangeStart + 'T00:00:00Z');
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const gridEnd = new Date(rangeEnd + 'T00:00:00Z');
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const weeks: HeatmapWeek[] = [];
  const monthLabels: { weekIndex: number; label: string }[] = [];
  let lastMonth = -1;
  const cursor = new Date(gridStart);
  let weekIndex = 0;

  while (cursor <= gridEnd) {
    const cells: (HeatmapCell | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const iso = cursor.toISOString().slice(0, 10);
      if (iso >= rangeStart && iso <= rangeEnd) {
        if (cursor.getUTCDate() === 1 && cursor.getUTCMonth() !== lastMonth) {
          lastMonth = cursor.getUTCMonth();
          monthLabels.push({
            weekIndex,
            label: cursor.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
          });
        }
        cells.push({ date: iso, count: countByDate.get(iso) ?? 0 });
      } else {
        cells.push(null);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push({ cells });
    weekIndex++;
  }

  return { id, label, weeks, monthLabels };
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
  const countByDate = new Map(days.map((d) => [d.date, d.entries.length]));

  const heatmapLast365 = buildYearHeatmap('last365', 'Last 365 days', addDays(endDate, -364), endDate, countByDate);

  const years = [...new Set(days.map((d) => d.date.slice(0, 4)))].sort().reverse();
  const heatmapYears = years.map((year) =>
    buildYearHeatmap(year, year, `${year}-01-01`, `${year}-12-31`, countByDate)
  );

  return {
    totalEntries,
    totalDays,
    totalWeeks,
    currentStreak,
    longestStreak,
    avgPerActiveDay,
    mostActiveWeekday,
    heatmapViews: [heatmapLast365, ...heatmapYears],
  };
}
