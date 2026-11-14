/**
 * Feed validation. Returns no issues until the passes run in the feed worker
 * over the store columns.
 */

/** The offending row, so a message can be traced back to an editable object. */
export interface ValidationEntity {
  /** File the offending row lives in, e.g. "trips.txt". */
  file: string;
  /** Primary key of that row, as produced by generateCompositeKeyFromRecord. */
  id: string;
  /** Field carrying the problem. */
  field: string;
  /** Value of that field. */
  value: string;
}

export interface ValidationMessage {
  level: 'error' | 'warning' | 'info';
  message: string;
  code?: string;
  file?: string;
  line?: number;
  field?: string;
  entity?: ValidationEntity;
}

export interface ValidationResults {
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  info: ValidationMessage[];
  summary: {
    isValid: boolean;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
}

function emptyResults(): ValidationResults {
  return {
    errors: [],
    warnings: [],
    info: [],
    summary: { isValid: true, errorCount: 0, warningCount: 0, infoCount: 0 },
  };
}

export class GTFSValidator {
  async validateFeed(): Promise<ValidationResults> {
    console.log('[GTFSValidator] validation is not available; no issues');
    return emptyResults();
  }
}
