import type { GTFSEnumValue, GTFSFieldSpec, GTFSFileSpec } from '../types';

/** A field added to an existing file, inserted after `after` or appended. */
export interface GTFSExtensionField {
  file: string;
  after?: string;
  spec: GTFSFieldSpec;
}

/** Values appended to an existing enum field. */
export interface GTFSExtensionEnumValues {
  file: string;
  field: string;
  values: GTFSEnumValue[];
}

/** A behavior note on a field, or on the whole file when `field` is omitted. */
export interface GTFSExtensionNote {
  file: string;
  field?: string;
  text: string;
}

/**
 * Additions layered on top of the verbatim base spec. `applyExtensions` stamps
 * `origin: id` on every top-level item it adds.
 */
export interface GTFSSpecExtension {
  id: string;
  sourceUrl: string;
  revision: string;
  files: GTFSFileSpec[];
  fields: GTFSExtensionField[];
  enumValues: GTFSExtensionEnumValues[];
  notes: GTFSExtensionNote[];
}
