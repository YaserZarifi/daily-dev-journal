// Runs before dev/build. Your journal automation writes images to
// `<week>/assets/...` but markdown files inside `<week>/<day>/...` reference
// them as `./assets/...`, one level too shallow. Rather than touch your
// journal pipeline, we mirror each week's assets into `public/assets/<week>/`
// so Astro can serve them, and journal.ts rewrites the <img> src to match.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const weekDirs = fs.readdirSync(root).filter((d) => /^\d{4}-W\d{2}$/.test(d));

let copied = 0;
for (const week of weekDirs) {
  const assetsDir = path.join(root, week, 'assets');
  if (!fs.existsSync(assetsDir)) continue;

  const destDir = path.join(root, 'public', 'assets', week);
  fs.mkdirSync(destDir, { recursive: true });

  for (const file of fs.readdirSync(assetsDir)) {
    fs.copyFileSync(path.join(assetsDir, file), path.join(destDir, file));
    copied++;
  }
}

console.log(`[copy-assets] mirrored ${copied} file(s) across ${weekDirs.length} week folder(s) into public/assets/`);
