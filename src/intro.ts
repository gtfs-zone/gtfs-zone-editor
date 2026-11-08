/**
 * The intro copy for the active locale. `intro.html` is also inlined into the
 * static page by `vite.config.js`, so it is what renders without JS.
 */

import { getLocale, type Locale } from 'gtfs-zone-web-common/i18n/index';
import introEn from './intro.html?raw';
import introFr from './intro.fr.html?raw';
import introDe from './intro.de.html?raw';

const INTRO: Record<Locale, string> = { en: introEn, fr: introFr, de: introDe };

export function introHtml(): string {
  return INTRO[getLocale()];
}
