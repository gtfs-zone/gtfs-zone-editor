/**
 * The storage-full error message, raised in the worker and matched on the
 * main thread. Worker errors cross as messages, so the message is the marker.
 */
export const QUOTA_MESSAGE =
  'The browser has no room left to store this feed. Delete feeds you no longer need, free up disk space or remove site data, then try again.';
