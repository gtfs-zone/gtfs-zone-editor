/**
 * Utility functions for extracting Zod schema descriptions and creating tooltips
 */

import { GTFS_FIELD_SPECS } from '../types/gtfs';

/**
 * Get field description for any GTFS file type.
 *
 * Reads the spec layer directly rather than the Zod schemas: descriptions are
 * verbatim on `GTFS_FIELD_SPECS` for every file, while the derived Zod schemas
 * attach `.describe()` to the inner type and hide it behind the `.optional()`
 * wrapper on optional fields.
 *
 * @param filename - The GTFS filename (e.g., agency.txt, fare_products.txt)
 * @param fieldName - The field name to get description for
 * @returns Field description string
 */
export function getGTFSFieldDescription(
  filename: string,
  fieldName: string
): string {
  return (
    GTFS_FIELD_SPECS[filename]?.[getSchemaFieldName(fieldName)]?.description ??
    ''
  );
}

/**
 * Create a tooltip wrapper with DaisyUI classes
 */
export function createTooltip(content: string, tooltip: string): string {
  if (!tooltip) {
    return content;
  }

  // Escape HTML in tooltip content
  const escapedTooltip = tooltip
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return `<div class="tooltip tooltip-info" data-tip="${escapedTooltip}">${content}</div>`;
}

/**
 * Keep snake_case field names to match GTFS specification.
 * This ensures consistency with the GTFS type generation.
 */
function formatFieldName(fieldName: string): string {
  // Keep snake_case field names to match GTFS specification
  return fieldName;
}

/**
 * Convert GTFS field name to schema field name
 */
export function getSchemaFieldName(gtfsFieldName: string): string {
  return formatFieldName(gtfsFieldName);
}
