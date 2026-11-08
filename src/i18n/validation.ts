import { defineCatalog } from 'gtfs-zone-web-common/i18n/index';
import { validation as en } from './en/validation';
import { validation as fr } from './fr/validation';
import { validation as de } from './de/validation';

/**
 * Translator over the validation strings alone, for the schema layer: the
 * import worker builds the schemas too, and should not bundle every catalog.
 */
export const tv = defineCatalog(en, { fr, de });
