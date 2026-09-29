import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./arena-provenance.mjs', import.meta.url));
test('source snapshots build without Git and preserve source fingerprints', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'arena-provenance-'));
  try {
    for (const name of [
      'core/src/evolution/rules.ts',
      'scripts/build-arena.mjs',
      'package.json',
      'tsconfig.json',
    ]) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), '{}');
    }
    writeFileSync(path.join(root, '.env'), 'PRIVATE_SECRET');
    writeFileSync(path.join(root, '.gitignore'), 'dist/\n.env\n');
    const env = {
      ...process.env,
      VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
      GIT_CEILING_DIRECTORIES: root,
    };
    const build = () => {
      execFileSync(process.execPath, [script], { cwd: root, env });
      return JSON.parse(readFileSync(path.join(root, 'dist/arena-provenance.json'), 'utf8'));
    };
    const snapshot = build();
    assert.equal(snapshot.commit, env.VERCEL_GIT_COMMIT_SHA);
    assert.equal(snapshot.dirty, null);
    assert.equal(Object.keys(snapshot.files).length, 4);
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_SECRET'));
    assert.deepEqual(build().files, snapshot.files);
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '-m',
        'Fixture',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    const checkout = build();
    assert.equal(checkout.sourceFingerprint, snapshot.sourceFingerprint);
    assert.equal(checkout.dirty, false);
    assert.notEqual(checkout.commit, snapshot.commit);
    writeFileSync(path.join(root, 'core/src/evolution/rules.ts'), 'changed');
    assert.equal(build().dirty, true);
    assert.notEqual(build().sourceFingerprint, snapshot.sourceFingerprint);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
