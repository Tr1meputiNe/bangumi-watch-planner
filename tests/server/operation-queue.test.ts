import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepository, type Repository } from '../../src/server/db.js';
import { createOperationQueue } from '../../src/server/operation-queue.js';

describe('durable operation queue', () => {
  let tempDir: string;
  let repository: Repository;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bwp-operations-'));
    repository = createRepository(join(tempDir, 'test.sqlite'));
  });

  afterEach(() => {
    repository.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('retries in order and keeps the last action as the final remote write', async () => {
    const writes: number[] = [];
    let firstAttempts = 0;
    const queue = createOperationQueue({
      repository,
      execute: vi.fn(async (operation) => {
        const payload = JSON.parse(operation.payload) as { type: number };
        if (payload.type === 4 && firstAttempts++ === 0) throw new Error('temporary');
        writes.push(payload.type);
      }),
      delay: async () => undefined
    });

    await queue.enqueue({
      resourceKey: 'subject:501',
      kind: 'set_collection',
      payload: JSON.stringify({ subjectId: 501, type: 4 }),
      rollback: '{}'
    });
    await queue.enqueue({
      resourceKey: 'subject:501',
      kind: 'set_collection',
      payload: JSON.stringify({ subjectId: 501, type: 3 }),
      rollback: '{}'
    });
    await queue.waitForIdle();

    expect(writes).toEqual([4, 3]);
    await expect(repository.countPendingOperations()).resolves.toBe(0);
  });

  it('marks an operation failed and invokes rollback after its retry minute expires', async () => {
    let now = new Date('2026-07-19T04:00:00.000Z');
    const failed = vi.fn(async () => undefined);
    const queue = createOperationQueue({
      repository,
      clock: () => now,
      execute: vi.fn(async () => { throw new Error('offline'); }),
      delay: async () => { now = new Date(now.getTime() + 30_000); },
      onFailed: failed
    });

    const id = await queue.enqueue({
      resourceKey: 'episode:11',
      kind: 'episodes_watched',
      payload: JSON.stringify({ subjectId: 1, episodeIds: [11] }),
      rollback: JSON.stringify({ episodes: [{ id: 11, collectionType: 0 }] })
    });
    await queue.waitForIdle();

    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ id }), 'offline');
    await expect(repository.getNextOperation()).resolves.toBeNull();
    await expect(repository.countPendingOperations()).resolves.toBe(0);
  });

  it('does not repeat a remote write or block the queue when its completion callback fails', async () => {
    const writes: number[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue = createOperationQueue({
      repository,
      execute: vi.fn(async (operation) => {
        writes.push(JSON.parse(operation.payload).subjectId as number);
      }),
      onComplete: vi.fn(async (operation) => {
        if (JSON.parse(operation.payload).subjectId === 501) throw new Error('local callback failed');
      })
    });

    for (const subjectId of [501, 502]) {
      await queue.enqueue({
        resourceKey: `subject:${subjectId}`,
        kind: 'set_collection',
        payload: JSON.stringify({ subjectId, type: 3 }),
        rollback: '{}'
      });
    }
    await queue.waitForIdle();

    expect(writes).toEqual([501, 502]);
    expect(consoleError).toHaveBeenCalledOnce();
    await expect(repository.countPendingOperations()).resolves.toBe(0);
    consoleError.mockRestore();
  });

  it('continues after a failed operation rollback callback throws', async () => {
    const now = new Date('2026-07-19T04:00:00.000Z');
    const expiredId = await repository.enqueueOperation({
      resourceKey: 'subject:501',
      kind: 'set_collection',
      payload: JSON.stringify({ subjectId: 501, type: 4 }),
      rollback: '{}',
      retryUntil: now.toISOString()
    });
    await repository.enqueueOperation({
      resourceKey: 'subject:502',
      kind: 'set_collection',
      payload: JSON.stringify({ subjectId: 502, type: 3 }),
      rollback: '{}',
      retryUntil: new Date(now.getTime() + 60_000).toISOString()
    });
    const writes: number[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const queue = createOperationQueue({
      repository,
      clock: () => now,
      execute: vi.fn(async (operation) => {
        writes.push(JSON.parse(operation.payload).subjectId as number);
      }),
      onFailed: vi.fn(async () => { throw new Error('rollback failed'); })
    });

    queue.start();
    await queue.waitForIdle();

    await expect(repository.getOperation(expiredId)).resolves.toMatchObject({ state: 'failed' });
    expect(writes).toEqual([502]);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
