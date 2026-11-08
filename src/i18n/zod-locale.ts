import { z } from 'zod';
import zodFr from 'zod/v4/locales/fr.js';
import zodDe from 'zod/v4/locales/de.js';
import { getLocale } from 'gtfs-zone-web-common/i18n/index';

/** Point Zod's built-in error messages at the active locale. */
export function applyZodLocale(): void {
  const locale = getLocale();
  if (locale === 'fr') {
    z.config(zodFr());
  } else if (locale === 'de') {
    z.config(zodDe());
  }
}
