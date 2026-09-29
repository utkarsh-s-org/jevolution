import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
// Vercel builds a source snapshot without .git. Hash the same source scope there.
function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}
const sourcePattern =
  /^(core\/src\/evolution\/|server\/src\/evolution\/|webview-ui\/src\/evolution\/|scripts\/.*arena|package(-lock)?\.json|tsconfig)/;
function sourceSnapshot(directory = '.') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(entry.name))
      return [];
    const name = directory === '.' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return [
        'core',
        'core/src',
        'core/src/evolution',
        'server',
        'server/src',
        'server/src/evolution',
        'webview-ui',
        'webview-ui/src',
        'webview-ui/src/evolution',
        'scripts',
      ].includes(name) || /^(core|server|webview-ui)\/src\/evolution\//.test(name)
        ? sourceSnapshot(name)
        : [];
    }
    return entry.isFile() && sourcePattern.test(name) ? [name] : [];
  });
}
const commit = git(['rev-parse', 'HEAD']);
const tracked = commit
  ? git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  : null;
const names =
  tracked === null ? sourceSnapshot() : tracked.split('\0').filter((f) => sourcePattern.test(f));
const status = commit ? git(['status', '--porcelain']) : null;
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
      commit: commit || process.env.VERCEL_GIT_COMMIT_SHA || null,
      dirty: status === null ? null : Boolean(status),
      builtAt: new Date().toISOString(),
      files,
      sourceFingerprint: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
    },
    null,
    2,
  ),
);
