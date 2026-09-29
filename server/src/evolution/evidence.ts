import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

import { experimentReport } from '../../../core/src/evolution/reporting.js';
import type { Snapshot, World } from '../../../core/src/evolution/types.js';

export async function hashFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function readInitial(root: string, id: string): Promise<{ world: World } | null> {
  try {
    return JSON.parse(await readFile(path.join(root, `${id}.initial.json`), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

// Streaming scan: a run with many decisions does not require loading the entire JSONL.
export async function auditLog(file: string) {
  const outcomes: Record<string, number> = {};
  const rejected: Record<string, number> = {};
  let observations = 0,
    unreported = 0,
    lines = 0,
    first: string | null = null,
    last: string | null = null;
  const requests = new Set<string>();
  const responses = new Set<string>();
  for await (const line of createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  })) {
    if (!line.trim()) continue;
    const event = JSON.parse(line); // Fail visibly on corrupt/truncated evidence.
    lines++;
    first ??= event.wallTime ?? null;
    last = event.wallTime ?? last;
    if (event.type === 'observation') {
      observations++;
      requests.add(event.id);
    }
    if (['decision', 'error', 'cancelled'].includes(event.type)) {
      responses.add(event.id);
      const outcome = event.outcome ?? event.type;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      if (event.usageMayBeUnreported) unreported++;
      if (outcome === 'invalid') {
        const reason = event.rejectionReason ?? 'reason not recorded by this version';
        rejected[reason] = (rejected[reason] ?? 0) + 1;
      }
    }
  }
  return {
    lines,
    observations,
    outcomes,
    rejected,
    potentiallyUnreportedCalls: unreported,
    requestsWithoutTerminalRecord: [...requests].filter((id) => !responses.has(id)).length,
    firstWallTime: first,
    lastWallTime: last,
    elapsedWallSecondsIncludingPauses:
      first && last ? (Date.parse(last) - Date.parse(first)) / 1000 : null,
  };
}

export async function storedReport(root: string, snapshot: Snapshot) {
  const id = snapshot.status.runId;
  const initial = await readInitial(root, id);
  const report = experimentReport(snapshot, initial?.world);
  let journal = null;
  try {
    journal = await auditLog(path.join(root, `${id}.jsonl`));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  return { ...report, journal };
}

// Only allowlisted run artifacts are packaged: never .env files or process environment.
export async function exportBundle(root: string, snapshot: Snapshot, output: string) {
  const id = snapshot.status.runId;
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid run ID');
  if (snapshot.status.running || Object.values(snapshot.status.inFlight).some(Boolean))
    throw new Error('Pause and wait for pending decisions before exporting a complete bundle.');
  const stage = `${output}.stage`;
  await mkdir(stage, { recursive: false });
  try {
    const report = await storedReport(root, snapshot);
    if (!(await readInitial(root, id)) || !report.journal)
      throw new Error('No recorded run to bundle.');
    const files: string[] = [`${id}.initial.json`, `${id}.jsonl`];
    const replay = `${id}.replay`;
    const manifest = JSON.parse(await readFile(path.join(root, replay, 'manifest.json'), 'utf8'));
    if (snapshot.status.replay.error) throw new Error(snapshot.status.replay.error);
    if (manifest.frames !== snapshot.status.replay.frames)
      throw new Error('Replay frame count mismatch');
    const entries = (await readdir(path.join(root, replay))).filter((f) =>
      /^(\d+\.json\.gz|manifest\.json)$/.test(f),
    );
    for (let i = 0; i < manifest.frames; i += 100)
      if (!entries.includes(`${i}.json.gz`)) throw new Error(`Missing replay chunk ${i}`);
    files.push(...entries.map((f) => `${replay}/${f}`));
    const provenanceFile = `${id}.provenance.json`;
    try {
      await stat(path.join(root, provenanceFile));
      files.push(provenanceFile);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const hashes: Record<string, { sha256: string; bytes: number }> = {};
    for (const file of files) {
      const target = path.join(stage, file);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(root, file), target);
      hashes[file] = { sha256: await hashFile(target), bytes: (await stat(target)).size };
    }
    for (const [name, value] of Object.entries({ 'final.json': snapshot, 'report.json': report })) {
      const file = path.join(stage, name);
      await writeFile(file, JSON.stringify(value));
      hashes[name] = { sha256: await hashFile(file), bytes: (await stat(file)).size };
    }
    const metadata = {
      schemaVersion: 1,
      runId: id,
      exportedAt: new Date().toISOString(),
      files: hashes,
      recordingProvenance: files.includes(provenanceFile) ? provenanceFile : null,
      caveat:
        'Legacy recordings without provenance retain unknown code/prompt fingerprints. Exporting does not retroactively certify them. Contains observations and model returns; no API keys.',
    };
    await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(metadata, null, 2));
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-czf', output, '-C', stage, '.'], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let error = '';
      child.stderr.on('data', (b) => {
        error += b;
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`Archive failed: ${error}`)),
      );
    });
    return { output, bytes: (await stat(output)).size, manifest: metadata, report };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
