// @ts-check
import { defineConfig } from 'astro/config';
import remarkFixAssetPaths from './src/lib/remark-fix-asset-paths.mjs';

const base = '/daily-dev-journal';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages project site: https://YaserZarifi.github.io/daily-dev-journal/
  site: 'https://YaserZarifi.github.io',
  base,
  markdown: {
    remarkPlugins: [[remarkFixAssetPaths, { base }]],
  },
});
