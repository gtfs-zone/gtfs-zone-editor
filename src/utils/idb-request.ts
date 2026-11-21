/**
 * IndexedDB request helpers.
 *
 * An IndexedDB request can sit unanswered forever: one queued behind a blocked
 * version-change operation fires no event at all, not success, not error, not
 * even blocked. Anything on the boot path that waits on a raw request goes
 * through here so a wedged database surfaces instead of hanging.
 */
import { CONFIG } from '../config';

/**
 * Resolve with the promise's value, or reject when it has not settled in
 * `ms`. For writes, where a stall or a quota error must reach the caller.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  what: string,
  ms: number = CONFIG.DB_REQUEST_TIMEOUT_MS
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[idb] ${what} did not finish within ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * Delete a database, reporting what actually happened.
 *
 * `blocked` is not success: the request stays queued until every connection to
 * the database closes, and until then it stalls every later request on that
 * database. Callers must keep the user in the loop rather than reload into a
 * wedge.
 */
export function deleteDatabaseWithTimeout(
  name: string,
  ms: number = CONFIG.DB_REQUEST_TIMEOUT_MS
): Promise<'deleted' | 'blocked' | 'error'> {
  return new Promise((resolve) => {
    let blocked = false;
    let settled = false;
    const finish = (outcome: 'deleted' | 'blocked' | 'error') => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => finish('deleted');
    req.onerror = () => {
      console.error('[idb] deleteDatabase failed:', req.error);
      finish('error');
    };
    req.onblocked = () => {
      blocked = true;
      console.warn(
        '[idb] deleteDatabase blocked: another connection is still open'
      );
    };
    // A blocked delete completes on its own once the last connection closes, so
    // the request is deliberately left running; only the wait ends here.
    setTimeout(() => finish(blocked ? 'blocked' : 'error'), ms);
  });
}
