import { spawnSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';

const result = spawnSync(process.execPath, ['scripts/build-arena.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_ARENA_HOSTED: 'true' },
});
if (result.status !== 0) process.exit(result.status || 1);
copyFileSync('dist/arena/arena.html', 'dist/arena/index.html');
writeFileSync(
  'dist/arena/robots.txt',
  'User-agent: *\nAllow: /\nSitemap: https://jevolution.world/sitemap.xml\n',
);
writeFileSync(
  'dist/arena/sitemap.xml',
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://jevolution.world/</loc></url></urlset>\n',
);
