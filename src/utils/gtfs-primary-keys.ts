/**
 * Row key strings for the store, over web-common's GTFS_PRIMARY_KEYS.
 */

import { getGTFSPrimaryKey } from 'gtfs-zone-web-common/gtfs/spec/primary-keys';
import { normalizeAgencyId } from './agency-helpers';

/**
 * Generate a composite key string from a record
 */
export function generateCompositeKeyFromRecord(
  tableName: string,
  record: Record<string, unknown>
): string {
  const config = getGTFSPrimaryKey(tableName);

  if (!config) {
    throw new Error(`Unknown GTFS table: ${tableName}`);
  }

  if (config.type === 'natural') {
    const field = config.fields[0];
    const value = record[field];
    // agency_id is only required with multiple agencies; an empty one keys the
    // feed's single agency as ''.
    if (tableName === 'agency') {
      return normalizeAgencyId(value as string | undefined);
    }
    if (value === undefined || value === null || value === '') {
      throw new Error(
        `Missing required primary key field '${field}' for table '${tableName}'`
      );
    }
    return String(value);
  }

  if (config.type === 'composite') {
    const keyParts = config.fields.map((field) => {
      const value = record[field];
      return value !== undefined && value !== null ? String(value) : '';
    });
    return keyParts.join(':');
  }

  if (config.type === 'all_fields') {
    // For tables that use all fields as primary key, sort field names for consistency
    const fields = Object.keys(record).sort();
    const keyParts = fields.map((field) => {
      const value = record[field];
      return `${field}=${String(value)}`;
    });
    return keyParts.join('&');
  }

  if (config.type === 'none') {
    // Single row tables like feed_info use a fixed key
    return tableName;
  }

  throw new Error(
    `Unsupported primary key type '${config.type}' for table '${tableName}'`
  );
}
