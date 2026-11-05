export type GTFSPresence =
  | 'Required'
  | 'Optional'
  | 'Conditionally Required'
  | 'Conditionally Forbidden'
  | 'Recommended';

export interface GTFSEnumValue {
  value: number | string;
  label: string;
  description: string;
  /** Overlay id (e.g. 'google') when the value comes from a spec extension. */
  origin?: string;
  /** Picker group heading for the value. */
  group?: string;
}

/** A behavior note from a spec extension, shown alongside the description. */
export interface GTFSSpecNote {
  origin: string;
  text: string;
}

export interface GTFSForeignKeyTarget {
  file: string;
  field: string;
}

export interface GTFSFieldSpec {
  name: string;
  /** Verbatim reference type string, including the compound "Foreign ID referencing `x.y`" forms. */
  type: string;
  presence: GTFSPresence;
  presenceCondition?: string;
  description: string;
  isPrimaryKey?: boolean;
  allowEmpty?: boolean;
  /** A few fields legitimately reference more than one table, hence the array. */
  foreignKey?: GTFSForeignKeyTarget[];
  enumValues?: GTFSEnumValue[];
  /** Overlay id when the field comes from a spec extension. */
  origin?: string;
  notes?: GTFSSpecNote[];
}

export interface GTFSFileSpec {
  filename: string;
  format?: 'csv' | 'geojson';
  presence: GTFSPresence;
  presenceCondition?: string;
  description: string;
  fields?: GTFSFieldSpec[];
  /** Overlay id when the file comes from a spec extension. */
  origin?: string;
  notes?: GTFSSpecNote[];
}

export interface GTFSSpec {
  specVersion: string;
  files: GTFSFileSpec[];
}
