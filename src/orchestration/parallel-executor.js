/**
 * parallel-executor.js — Concurrent task runner for AI Council v6
 *
 * Runs async tasks with:
 *   - concurrency limit (semaphore)
 *   - staggered start times (so AI sites don't get hammered simultaneously)
 *   - per-task retries with configurable delay
 *   - per-task timeout (Promise.race)
 *   - cancellation support
 *
 * Task shape:  { id: string, fn: () => Promise<any> }
 * Progress cb: (evt) => void
 *   evt.status: 'started' | 'retrying' | 'failed'
 *   evt.id, evt.attempt, evt.error
 *
 * Returns: [{ id, result? } | { id, error? }]
 *   Order matches the input tasks array.
 */

'use strict';

class ParallelExecutor {
  constructor({
    concurrency  = 3,
    staggerMs    = 500,
    retries      = 1,
    retryDelayMs = 2000,
    timeoutMs    = 90000,
  } = {}) {
    this.concurrency  = concurrency;
    this.staggerMs    = staggerMs;
    this.retries      = retries;
    this.retryDelayMs = retryDelayMs;
    this.timeoutMs    = timeoutMs;
  }

  /**
   * @param {Array<{id: string, fn: () => Promise}>} tasks
   * @param {Function|null} onProgress
   * @param {Function}      isCancelled  — () => boolean
   * @returns {Promise<Array<{id, result?, error?}>>}
   */
  async run(tasks, onProgress = null, isCancelled = () => false) {
    if (!tasks.length) return [];

    const emit    = (evt) => { try { onProgress && onProgress(evt); } catch {} };
    const results = new Array(tasks.length).fill(null);
    const sem     = new _Semaphore(this.concurrency);

    const promises = tasks.map((task, idx) => async () => {
      // Stagger: task[i] starts i * staggerMs after task[0]
      if (idx > 0 && this.staggerMs > 0) {
        await _sleep(idx * this.staggerMs);
      }

      if (isCancelled()) {
        results[idx] = { id: task.id, error: 'Cancelled' };
        return;
      }

      await sem.acquire();
      try {
        if (isCancelled()) {
          results[idx] = { id: task.id, error: 'Cancelled' };
          return;
        }

        emit({ status: 'started', id: task.id });

        let lastErr = null;
        for (let attempt = 0; attempt <= this.retries; attempt++) {
          if (isCancelled()) break;

          if (attempt > 0) {
            emit({ status: 'retrying', id: task.id, attempt });
            await _sleep(this.retryDelayMs);
            if (isCancelled()) break;
          }

          try {
            const result = await _withTimeout(task.fn(), this.timeoutMs, task.id);
            results[idx] = { id: task.id, result };
            return; // success — exit retry loop
          } catch (err) {
            lastErr = err;
          }
        }

        // All attempts exhausted
        const errMsg = lastErr?.message || 'Unknown error';
        emit({ status: 'failed', id: task.id, error: errMsg });
        results[idx] = { id: task.id, error: errMsg };

      } finally {
        sem.release();
      }
    });

    await Promise.all(promises.map(fn => fn()));
    return results.filter(Boolean);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────

class _Semaphore {
  constructor(n) {
    this._available = n;
    this._queue     = [];
  }

  acquire() {
    if (this._available > 0) {
      this._available--;
      return Promise.resolve();
    }
    return new Promise(resolve => this._queue.push(resolve));
  }

  release() {
    if (this._queue.length) {
      const next = this._queue.shift();
      next();
    } else {
      this._available++;
    }
  }
}

function _withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = ParallelExecutor;
