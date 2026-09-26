import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [command, args, cwd] of [
  ['npx', ['tsc', '--noEmit'], root],
  ['npx', ['tsc', '-p', 'tsconfig.arena.json'], root],
  ['npx', ['tsc', '-b'], path.join(root, 'webview-ui')],
  ['npx', ['vite', 'build', '--config', 'vite.arena.config.ts'], path.join(root, 'webview-ui')],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('[Evolution Arena] Build complete. Run npm run arena.');
