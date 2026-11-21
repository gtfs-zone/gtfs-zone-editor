import { GTFS_FILES } from '../types/gtfs';

// All 31 supported GTFS filenames, derived from the Zod schema registry.
// This is the authoritative list: never hardcode filenames elsewhere.
export const ALL_GTFS_FILES: readonly string[] = GTFS_FILES.map(
  (f) => f.filename
);
