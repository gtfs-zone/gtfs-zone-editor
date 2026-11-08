import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { en } from './catalog.en';
import { calendar } from './de/calendar';
import { common } from './de/common';
import { fields } from './de/fields';
import { help } from './de/help';
import { issues } from './de/issues';
import { load } from './de/load';
import { map } from './de/map';
import { modals } from './de/modals';
import { pages } from './de/pages';
import { shapes } from './de/shapes';
import { shell } from './de/shell';
import { timetable } from './de/timetable';
import { validation } from './de/validation';
import { views } from './de/views';
import { worker } from './de/worker';

/** edit.gtfs.zone's UI strings, in German. */
export const de: Translation<typeof en> = {
  ...calendar,
  ...common,
  ...fields,
  ...help,
  ...issues,
  ...load,
  ...map,
  ...modals,
  ...pages,
  ...shapes,
  ...shell,
  ...timetable,
  ...validation,
  ...views,
  ...worker,
};
