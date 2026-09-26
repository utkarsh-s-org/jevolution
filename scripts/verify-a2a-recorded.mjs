// Replay actual recorded requests and receipts through real SDK servers. No model API calls.
import assert from 'node:assert/strict';
import { TaskState } from '@a2a-js/sdk';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { A2ATransport } = require('../dist/arena-server/server/src/evolution/a2aTransport.js');
const fixture = JSON.parse(
  readFileSync(
    new URL('../server/src/evolution/fixtures/a2a-recorded-tasks.json', import.meta.url),
  ),
);
const incoming = new Map();
const wires = [];
const errors = [];
const transport = new A2ATransport(
  (event, worker) => {
    if (event.type === 'incoming') incoming.set(event.request.requestId, { ...event, worker });
    if (event.type === 'wire') wires.push(event.payload);
    if (event.type === 'transport-error') errors.push(event.message);
  },
  (error) => errors.push(error),
);
async function until(check) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error('Recorded protocol replay timed out');
}
async function send(recorded) {
  const task = { ...recorded, state: 'sending', protocolTaskId: undefined, receipt: undefined };
  assert.notEqual(transport.owner(task.requester), transport.owner(task.helper));
  await transport.deliver(task);
  await until(() => incoming.has(task.id));
  const event = incoming.get(task.id);
  assert.equal(event.worker, transport.owner(task.helper));
  assert.equal(event.request.runId, fixture.provenance.runId);
  task.protocolTaskId = event.taskId;
  return task;
}
async function stateIs(task, state) {
  await until(async () => (await transport.inspect(task)).status.state === state);
}
try {
  await transport.start();
  assert.equal(transport.endpoints.length, 2);
  assert.notEqual(transport.endpoints[0].url, transport.endpoints[1].url);
  for (const { url } of transport.endpoints)
    assert.equal((await fetch(url + '/.well-known/agent-card.json')).status, 401);

  const completed = fixture.tasks.find((task) => task.state === 'completed');
  const first = await send(completed);
  await stateIs(first, TaskState.TASK_STATE_SUBMITTED); // A2A 1.0 SUBMITTED, from SDK-generated enum.
  assert.equal((await transport.inspect(first)).artifacts.length, 0);
  first.state = 'working';
  transport.update(first);
  await stateIs(first, TaskState.TASK_STATE_WORKING);
  assert.equal((await transport.inspect(first)).artifacts.length, 0);
  Object.assign(first, { state: 'completed', receipt: completed.receipt });
  transport.update(first);
  await stateIs(first, TaskState.TASK_STATE_COMPLETED);
  const receipt = (await transport.inspect(first)).artifacts[0].parts[0].content.value;
  assert.deepEqual(receipt, {
    ...completed.receipt,
    requestId: completed.id,
    runId: completed.runId,
    requester: completed.requester,
    helper: completed.helper,
  });
  await until(() => wires.some((event) => event.artifactUpdate?.taskId === first.protocolTaskId));

  // Retry the exact recorded request: no second inbox entry or delivery commitment.
  const duplicate = await transport.deliver(first);
  const duplicateId = duplicate.value.task.id;
  assert.notEqual(duplicateId, first.protocolTaskId);
  await stateIs({ ...first, protocolTaskId: duplicateId }, TaskState.TASK_STATE_REJECTED); // REJECTED
  assert.equal(incoming.size, 1);

  const canceled = await send(fixture.tasks.find((task) => task.state === 'canceled'));
  await stateIs(canceled, TaskState.TASK_STATE_SUBMITTED);
  await transport.cancel(canceled);
  await stateIs(canceled, TaskState.TASK_STATE_CANCELED);
  // A delayed repeat of its recorded submission must not revive a canceled task.
  canceled.state = 'submitted';
  transport.update(canceled);
  await stateIs(canceled, TaskState.TASK_STATE_CANCELED);
  assert.equal((await transport.inspect(canceled)).artifacts.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        sourceRun: fixture.provenance.runId,
        checks: [
          'two processes',
          'authenticated discovery',
          'cross-process request',
          'submitted and working are not completed',
          'recorded receipt over SSE and GetTask',
          'duplicate suppression',
          'CancelTask',
          'late update cannot revive cancellation',
        ],
        modelCalls: 0,
      },
      null,
      2,
    ),
  );
} finally {
  transport.dispose();
}
