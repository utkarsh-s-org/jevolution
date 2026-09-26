import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((f) =>
    /^(core\/src\/evolution\/|server\/src\/evolution\/|webview-ui\/src\/evolution\/|scripts\/.*arena|package(-lock)?\.json|tsconfig)/.test(
      f,
    ),
  );
const files = Object.fromEntries(
  [...new Set(names)]
    .sort()
    .map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]),
);
mkdirSync('dist', { recursive: true });
writeFileSync(
  'dist/arena-provenance.json',
  JSON.stringify(
    {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
      builtAt: new Date().toISOString(),
      files,
      sourceFingerprint: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    },
    null,
    2,
  ),
);
