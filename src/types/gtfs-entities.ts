/**
 * GTFS Entity Type Definitions
 *
 * Entity types for all GTFS files. Defined as Record<string, any> because the
 * Zod schemas are built dynamically at runtime from the hand-authored spec, so
 * TypeScript cannot infer specific field shapes statically. Runtime validation
 * is handled by the derived Zod schemas in GTFSSchemas.
 */

// Common base type for all GTFS records (fields are strings/numbers/booleans from CSV)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GTFSEntityRecord = Record<string, any>;

// Core GTFS entities (required files)
export type Agency = GTFSEntityRecord;
export type Stops = GTFSEntityRecord;
export type Routes = GTFSEntityRecord;
export type Trips = GTFSEntityRecord;
export type StopTimes = GTFSEntityRecord;
export type Calendar = GTFSEntityRecord;
export type CalendarDates = GTFSEntityRecord;

// Optional GTFS entities
export type Shapes = GTFSEntityRecord;
export type Pathways = GTFSEntityRecord;
