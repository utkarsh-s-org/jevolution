import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

// Fail before replacing the working site if its server credentials are missing.
// Local checks use mocked provider transports and need no real credentials.
if (process.env.VERCEL === '1') {
  for (const name of ['TYPESAFE_API_KEY', 'ANTHROPIC_API_KEY', 'ARENA_ACCESS_CODE']) {
    if (!process.env[name]?.trim()) throw new Error(`Missing server environment variable: ${name}`);
  }
  if (process.env.ARENA_ACCESS_CODE.length < 24)
    throw new Error('ARENA_ACCESS_CODE must contain at least 24 characters.');
}

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
  'core/src/evolution/mechanics.test.ts',
  'server/src/evolution/modular.test.ts',
  'core/src/evolution/wolves.test.ts',
  'core/src/evolution/mapEditor.test.ts',
  'core/src/evolution/predatorPrey.test.ts',
  'server/src/evolution/hosted.test.ts',
]);

// This includes TypeScript checks for api/, server/, core/, and the browser UI.
run(['scripts/build-arena-public.mjs']);

// Official SDK lifecycle checks replay recorded requests, without model API calls.
run(['scripts/verify-a2a-recorded.mjs']);

const assets = readdirSync('dist/arena/assets');
if (!assets.some((name) => /^hosted\.worker-.*\.js$/.test(name)))
  throw new Error('Hosted simulation worker is missing from the build.');
if (!readFileSync('dist/arena/index.html', 'utf8').includes('type="module"'))
  throw new Error('The website entry point has no application module.');

// Refuse a deployment that accidentally puts server credentials in public assets.
const secrets = Object.entries(process.env)
  .filter(([name, value]) => (name.endsWith('_API_KEY') || name === 'ARENA_ACCESS_CODE') && value)
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
