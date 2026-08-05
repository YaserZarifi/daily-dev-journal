// Runs before dev/build. Walks every Journal-*.md file and records the
// timestamp of the commit that first added it, so the UI can show the
// real commit time instead of just the entry's date.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const weekDirs = fs.readdirSync(root).filter((d) => /^\d{4}-W\d{2}$/.test(d));

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, files);
    else if (/^Journal-.*\.md$/.test(name)) files.push(full);
  }
  return files;
}

const times = {};
for (const week of weekDirs) {
  const weekPath = path.join(root, week);
  if (!fs.statSync(weekPath).isDirectory()) continue;

  for (const file of walk(weekPath)) {
    const key = '/' + path.relative(root, file).split(path.sep).join('/');
    try {
      const log = execSync(`git log --follow --diff-filter=A --format=%aI -- "${file}"`, {
        encoding: 'utf-8',
      }).trim();
      times[key] = log.split('\n').filter(Boolean).pop() || '';
    } catch {
      times[key] = '';
    }
  }
}

fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'data', 'commit-times.json'), JSON.stringify(times, null, 2));
console.log(`[extract-commit-times] wrote ${Object.keys(times).length} commit time(s).`);
