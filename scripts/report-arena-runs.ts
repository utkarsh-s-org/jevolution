import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { exportBundle, storedReport } from '../server/src/evolution/evidence.js';
import { ReplayStore } from '../server/src/evolution/replay.js';

// Offline batch reporting of existing executions only. This script cannot call a provider.
async function main() {
  const reportOnly = process.argv.includes('--report-only');
  const [root, output, ...ids] = process.argv.slice(2).filter((arg) => arg !== '--report-only');
  if (!root || !output || !ids.length)
    throw new Error(
      'Usage: tsx scripts/report-arena-runs.ts LOG_DIRECTORY OUTPUT_DIRECTORY RUN_ID...',
    );
  await mkdir(output, { recursive: true });
  const results = [];
  for (const id of ids) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid run ID');
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, `${id}.replay/manifest.json`), 'utf8'),
      );
      const replay = new ReplayStore(root, id);
      replay.frames = manifest.frames;
      const snapshot = replay.get(manifest.frames - 1);
      // The original capture stores the previous frame count in its status. Correct only metadata.
      snapshot.status.replay.frames = manifest.frames;
      const report = await storedReport(root, snapshot);
      await writeFile(path.join(output, `${id}.report.json`), JSON.stringify(report, null, 2));
      if (reportOnly) {
        results.push({ id, status: 'reported', completion: report.completion });
        continue;
      }
      const bundle = await exportBundle(root, snapshot, path.join(output, `${id}.tar.gz`));
      results.push({ id, status: 'exported', bytes: bundle.bytes, completion: report.completion });
    } catch (error) {
      results.push({
        id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await writeFile(path.join(output, 'batch.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
