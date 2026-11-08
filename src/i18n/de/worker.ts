import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { worker as en } from '../en/worker';

/** Import worker progress and errors, in German. */
export const worker: Translation<typeof en> = {
  'worker.downloadingOf': 'Feed wird heruntergeladen, {loaded} von {total}',
  'worker.downloadingBytes': 'Feed wird heruntergeladen, {loaded}',
  'worker.opening': '{path} wird geöffnet...',
  'worker.extracting': 'ZIP-Datei wird entpackt...',
  'worker.processing': '{file} wird verarbeitet...',
  'worker.finalizing': 'Wird abgeschlossen...',
  'worker.noEntry': 'Das Archiv enthält keinen Eintrag „{path}“.',
  'worker.noEntryFound':
    'Das Archiv enthält keinen Eintrag „{path}“, sondern {found}.',
};
