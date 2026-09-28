import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

// Public runs use visitor credentials, never project-funded keys.
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(
  '[Deploy] Checking simulation rules, replay, provider adapters, and API access controls.',
);
run([
  '--import',
  'tsx',
  '--test',
  'core/src/evolution/experiments.test.ts',
  'core/src/evolution/mechanics.test.ts',
  'server/src/evolution/modular.test.ts',
  'core/src/evolution/wolves.test.ts',
  'core/src/evolution/mapEditor.test.ts',
  'core/src/evolution/predatorPrey.test.ts',
  'server/src/evolution/hosted.test.ts',
  'server/src/evolution/accountKeyVault.test.ts',
  'server/src/evolution/savedRuns.test.ts',
  'server/src/evolution/sampleRun.test.ts',
]);

// This includes TypeScript checks for api/, server/, core/, and the browser UI.
run(['scripts/build-arena-public.mjs']);

const assets = readdirSync('dist/arena/assets');
if (!assets.some((name) => /^hosted\.worker-.*\.js$/.test(name)))
  throw new Error('Hosted simulation worker is missing from the build.');
if (!readFileSync('dist/arena/index.html', 'utf8').includes('type="module"'))
  throw new Error('The website entry point has no application module.');

// Refuse a deployment that accidentally puts server credentials in public assets.
const secrets = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      (name.endsWith('_API_KEY') ||
        name === 'ARENA_ACCESS_CODE' ||
        name === 'ACCOUNT_KEY_ENCRYPTION_SECRET') &&
      value,
  )
  .map(([, value]) => value);
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) scan(filename);
    else {
      const bytes = readFileSync(filename);
      if (secrets.some((secret) => bytes.includes(secret)))
        throw new Error(`Server credential found in public build artifact: ${filename}`);
    }
  }
}
scan('dist/arena');
console.log('[Deploy] Checks passed. Vercel packages api/arena/*.ts alongside the UI and worker.');
