import type { Repository } from './db.js';
import type { PendingOperation, PendingOperationKind } from './types.js';

type QueueInput = {
  resourceKey: string;
  kind: PendingOperationKind;
  payload: string;
  rollback: string;
};

type OperationQueueDeps = {
  repository: Pick<Repository,
    | 'enqueueOperation'
    | 'getNextOperation'
    | 'markOperationAttempt'
    | 'rescheduleOperation'
    | 'retryOperation'
    | 'completeOperation'
    | 'failOperation'>;
  execute(operation: PendingOperation): Promise<void>;
  onComplete?(operation: PendingOperation): Promise<void> | void;
  onFailed?(operation: PendingOperation, error: string): Promise<void> | void;
  clock?: () => Date;
  delay?: (milliseconds: number) => Promise<void>;
};

export function createOperationQueue({
  repository,
  execute,
  onComplete,
  onFailed,
  clock = () => new Date(),
  delay = wait
}: OperationQueueDeps) {
  let running: Promise<void> | null = null;
  let rerun = false;

  function kick(): void {
    if (running) {
      rerun = true;
      return;
    }
    running = processOperations().finally(() => {
      running = null;
      if (rerun) {
        rerun = false;
        kick();
      }
    });
    void running.catch(() => undefined);
  }

  async function processOperations(): Promise<void> {
    for (let operation = await repository.getNextOperation(); operation; operation = await repository.getNextOperation()) {
      const now = clock();
      if (now.toISOString() >= operation.retryUntil) {
        await permanentlyFail(operation, operation.lastError ?? '操作重试超时');
        continue;
      }

      await repository.markOperationAttempt(operation.id, now.toISOString());
      try {
        await execute(operation);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (clock().toISOString() >= operation.retryUntil) {
          await permanentlyFail(operation, message);
          continue;
        }
        await repository.rescheduleOperation(operation.id, message, clock().toISOString());
        await delay(Math.min(5_000, 500 * 2 ** Math.min(operation.attempts, 3)));
        continue;
      }

      await repository.completeOperation(operation.id);
      try {
        await onComplete?.(operation);
      } catch (error) {
        console.error('Operation completion callback failed', error);
      }
    }
  }

  async function permanentlyFail(operation: PendingOperation, message: string): Promise<void> {
    const now = clock().toISOString();
    await repository.failOperation(operation.id, message, now);
    try {
      await onFailed?.(operation, message);
    } catch (error) {
      console.error('Operation failure callback failed', error);
    }
  }

  return {
    async enqueue(input: QueueInput, applyLocal?: () => Promise<void>): Promise<number> {
      const id = await repository.enqueueOperation({
        ...input,
        retryUntil: new Date(clock().getTime() + 60_000).toISOString()
      });
      try {
        await applyLocal?.();
      } catch (error) {
        await repository.completeOperation(id);
        throw error;
      }
      kick();
      return id;
    },

    start(): void {
      kick();
    },

    async retry(id: number): Promise<void> {
      const now = clock();
      await repository.retryOperation(id, new Date(now.getTime() + 60_000).toISOString(), now.toISOString());
      kick();
    },

    async waitForIdle(): Promise<void> {
      while (running) await running;
    }
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
