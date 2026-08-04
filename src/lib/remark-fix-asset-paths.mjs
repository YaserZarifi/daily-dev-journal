// Your journal automation writes markdown images as `./assets/img.jpg`, but the
// physical file lives one directory higher, at `<week>/assets/img.jpg` (copied by
// scripts/copy-assets.mjs into `public/assets/<week>/img.jpg`). Astro treats local
// relative image paths as build-time imports and fails if the file isn't exactly
// there, so we rewrite the URL to an absolute `/assets/<week>/...` path *before*
// Astro's markdown pipeline tries to resolve it — absolute paths are left alone and
// served straight from `public/` at runtime instead of being imported.
import { visit } from 'unist-util-visit';

const WEEK_RE = /[\\/](\d{4}-W\d{2})[\\/]/;

export default function remarkFixAssetPaths({ base = '' } = {}) {
  const prefix = base.replace(/\/$/, ''); // e.g. "/daily-dev-journal" or ""

  return (tree, file) => {
    const match = (file.history[0] || file.path || '').match(WEEK_RE);
    if (!match) return;
    const week = match[1];

    visit(tree, 'image', (node) => {
      if (/^\.?\/?assets\//.test(node.url)) {
        const filename = node.url.split('/').pop();
        node.url = `${prefix}/assets/${week}/${filename}`;
      }
    });
  };
}
