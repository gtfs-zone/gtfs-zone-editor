import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { load as en } from '../en/load';

/** Boot, load and export flows, in German. */
export const load: Translation<typeof en> = {
  'boot.openingDb': 'Datenbank wird geöffnet...',
  'boot.restoringPatches': 'Änderungen werden wiederhergestellt...',
  'boot.buildingMap': 'Karte wird aufgebaut...',
  'boot.openingFeed': 'Feed wird geöffnet...',
  'boot.restoreContext': 'der Wiederherstellung des gespeicherten Feeds',
  'boot.refreshFailed':
    'Die Navigation konnte nicht aktualisiert werden: {message}',
  'edit.undone': 'Rückgängig gemacht: {label}',
  'edit.redone': 'Wiederhergestellt: {label}',
  'edit.undoFailed': 'Rückgängigmachen fehlgeschlagen: {message}',
  'edit.redoFailed': 'Wiederherstellen fehlgeschlagen: {message}',
  'edit.refreshAfterUndoFailed':
    'Aktualisierung nach Rückgängig/Wiederherstellen fehlgeschlagen: {message}',
  'edit.refreshAfterEditFailed':
    'Aktualisierung nach der Änderung fehlgeschlagen: {message}',
  'help.continueShapes': 'Weiter zu den Linienverläufen',
  'help.continueFares': 'Weiter zu den Tarifen',
  'help.continueOnDemand': 'Weiter zum Bedarfsverkehr',
  'load.linkedFeed': 'Verlinkter Feed',
  'load.linkedOverEdits_one':
    'Dieser Link öffnet einen anderen Feed. Der in diesem Browser gespeicherte Feed hat {count} Änderung, die verloren ginge. Arbeiten Sie mit ihm weiter oder laden Sie den verlinkten Feed.',
  'load.linkedOverEdits_other':
    'Dieser Link öffnet einen anderen Feed. Der in diesem Browser gespeicherte Feed hat {count} Änderungen, die verloren gingen. Arbeiten Sie mit ihm weiter oder laden Sie den verlinkten Feed.',
  'load.replaceTitle': 'Aktuellen Feed ersetzen?',
  'load.replaceBody_one':
    'Der aktuelle Feed hat {count} Änderung. Wenn Sie einen anderen Feed laden, wird sie samt Verlauf zum Rückgängigmachen verworfen. Exportieren Sie zuerst, um eine Kopie zu behalten.',
  'load.replaceBody_other':
    'Der aktuelle Feed hat {count} Änderungen. Wenn Sie einen anderen Feed laden, werden sie samt Verlauf zum Rückgängigmachen verworfen. Exportieren Sie zuerst, um eine Kopie zu behalten.',
  'load.replaceConfirm': 'Verwerfen und ersetzen',
  'load.exportFirst': 'Zuerst exportieren',
  'load.newEmpty': 'Neuer leerer Feed',
  'load.urlErrorTitle': 'Der Feed konnte nicht geladen werden',
  'load.attemptedUrl': 'Versuchte URL: {link}',
  'load.corsHint':
    'Manche Feeds blockieren direkte Anfragen aus dem Browser (CORS). Sie können versuchen, den Link oben zu öffnen, um die Datei herunterzuladen, und sie dann direkt über Laden -> Hochladen hochladen.',
  'load.mapUpdateFailed':
    'Die Karte konnte nicht aktualisiert werden: {message}',
  'load.notZip': 'Bitte laden Sie eine ZIP-Datei mit GTFS-Daten hoch',
  'load.preservingUnknown_one':
    '{count} unbekannte Datei wird für den Export beibehalten: {files}',
  'load.preservingUnknown_other':
    '{count} unbekannte Dateien werden für den Export beibehalten: {files}',
  'load.loadedFile': 'GTFS-Datei erfolgreich geladen: {name}',
  'load.loadedUrl': 'GTFS erfolgreich von URL geladen',
  'load.fileFailed': 'Die GTFS-Datei konnte nicht geladen werden',
  'load.fileFailedReason':
    'Die GTFS-Datei konnte nicht geladen werden: {message}',
  'load.tryAgain': 'Erneut versuchen',
  'load.moreInfo': 'Mehr Informationen',
  'files.required': 'Pflichtdateien',
  'files.optional': 'Optionale Dateien',
  'files.extensions': '{origin}-Dateien',
  'files.addExtension': 'Datei hinzufügen',
  'files.additional': 'Zusätzliche Dateien',
  'files.lines_one': '{count} Zeile',
  'files.lines_other': '{count} Zeilen',
  'load.emptyCreated': 'Neuer leerer GTFS-Feed angelegt.',
  'load.emptyFailed':
    'Der neue GTFS-Feed konnte nicht angelegt werden: {message}',
  'export.versionTitle': 'feed_version hat sich seit dem Import nicht geändert',
  'export.versionBody':
    'Datennutzer unterscheiden anhand von feed_version eine Ausgabe eines Feeds von der nächsten. Setzen Sie vor dem Veröffentlichen eine neue.',
  'export.saveAndExport': 'Speichern und exportieren',
  'export.versionUnchanged':
    'Geben Sie eine neue feed_version ein oder exportieren Sie trotzdem.',
  'export.anyway': 'Trotzdem exportieren',
  'export.noData':
    'Keine GTFS-Daten zum Exportieren. Bitte fügen Sie zuerst Daten hinzu.',
  'export.preparing': 'GTFS-Export wird vorbereitet...',
  'export.done': 'GTFS-Daten erfolgreich exportiert!',
  'export.failed': 'Die GTFS-Daten konnten nicht exportiert werden: {message}',
  'db.contextInit': 'der Initialisierung',
  'db.unknownError': 'Unbekannter Fehler',
  'db.errorDuring': 'Während {context} ist ein Datenbankfehler aufgetreten.',
  'db.stackTrace': 'Stacktrace (für Entwickler)',
  'db.exportClear': 'Exportieren und leeren',
  'db.clearReload': 'Leeren und neu laden',
  'db.errorTitle': 'Datenbankfehler',
  'db.resetTitle': 'Datenbank zurücksetzen',
  'db.resetBody':
    'Dadurch werden alle gespeicherten GTFS-Daten dauerhaft gelöscht. Exportieren Sie wichtige Daten, bevor Sie fortfahren.',
  'db.resetting': 'Datenbank wird zurückgesetzt...',
  'db.resetDone':
    'Datenbank erfolgreich zurückgesetzt. Die Seite wird neu geladen...',
  'db.otherTabsTitle': 'Schließen Sie die anderen Tabs',
  'db.otherTabsBody':
    'Ein anderer GTFS.zone-Tab hat die Datenbank noch geöffnet, daher kann sie nicht zurückgesetzt werden. Schließen Sie alle anderen GTFS.zone-Tabs und laden Sie diese Seite dann neu, um das Zurücksetzen abzuschließen.',
  'db.reload': 'Neu laden',
  'db.resetFailed':
    'Die Datenbank konnte nicht zurückgesetzt werden. Bitte löschen Sie die Browserdaten manuell.',
  'db.noIndexedDb':
    'IndexedDB wird von diesem Browser nicht unterstützt. GTFS.zone benötigt IndexedDB, um zu funktionieren.',
  'db.missingStores_one':
    'In der gespeicherten Datenbank fehlt {count} Tabelle, und sie konnte nicht geleert werden ({outcome}). Schließen Sie alle anderen GTFS.zone-Tabs und laden Sie neu.',
  'db.missingStores_other':
    'In der gespeicherten Datenbank fehlen {count} Tabellen, und sie konnte nicht geleert werden ({outcome}). Schließen Sie alle anderen GTFS.zone-Tabs und laden Sie neu.',
  'tabLock.title': 'Tab nicht aktiv',
  'tabLock.body':
    'Dieser Editor ist in einem anderen Tab geöffnet. Es kann immer nur ein Tab bearbeiten.',
  'tabLock.useHere': 'Hier verwenden',
  'large.title': 'Großer Feed',
  'large.body': '{name} ist groß.',
  'large.wait':
    'Das Laden kann etwa 30 Sekunden dauern. Wenn Sie abbrechen, bleibt der jetzt geladene Feed genau so, wie er ist.',
  'large.loadAnyway': 'Trotzdem laden',
  'parse.busy':
    'Ein anderer Feed wird bereits geladen. Warten Sie, bis er fertig ist, oder brechen Sie ihn zuerst ab.',
  'parse.watchdog':
    'Das Laden des Feeds reagiert nicht mehr (seit {seconds} s kein Fortschritt). Der Feed ist möglicherweise zu groß für diesen Browser.',
  'parse.openingStored': 'Gespeicherter Feed wird geöffnet...',
  'parse.preparing': 'Wird vorbereitet...',
  'parse.readingStored': 'Gespeicherter Feed wird gelesen...',
  'parse.restoringTable': '{table} wird wiederhergestellt...',
  'parse.buildingIndexes': 'Indizes werden aufgebaut...',
  'parse.restoringFiles': 'Dateien werden wiederhergestellt...',
  'parse.complete': 'Fertig!',
  'parse.waitingConfirm': 'Warten auf Bestätigung...',
  'parse.downloading': 'Feed wird heruntergeladen...',
  'parse.readingFile': 'Datei wird gelesen...',
  'parse.saving': 'Feed wird gespeichert...',
  'parse.networkConflict_one':
    'Dieser Feed definiert Netze in networks.txt oder route_networks.txt und setzt zugleich network_id bei {count} Linie in routes.txt. GTFS verbietet beides gleichzeitig, daher werden die Werte von routes.network_id ignoriert und nicht exportiert.',
  'parse.networkConflict_other':
    'Dieser Feed definiert Netze in networks.txt oder route_networks.txt und setzt zugleich network_id bei {count} Linien in routes.txt. GTFS verbietet beides gleichzeitig, daher werden die Werte von routes.network_id ignoriert und nicht exportiert.',
  'parse.noData': 'Keine GTFS-Daten zum Exportieren',
  'dbui.outOfDate': 'Die App ist veraltet',
  'dbui.outOfDateBody':
    'Die gespeicherte Datenbank hat Version {current}, diese Version von GTFS.zone versteht aber nur Version {supported}. Laden Sie die Seite neu, um die aktuelle Version der App zu erhalten.',
  'dbui.updateRequired': 'Datenbank-Update erforderlich',
  'dbui.updateBody':
    'GTFS.zone muss das Schema seiner lokalen Datenbank aktualisieren. Exportieren Sie zuerst Ihren gespeicherten Feed, oder leeren Sie die Datenbank und fahren Sie fort.',
  'dbui.exportContinue': 'Exportieren und fortfahren',
  'dbui.clearContinue': 'Leeren und fortfahren',
  'dbui.otherTabUpdating':
    'Ein anderer GTFS.zone-Tab aktualisiert gerade die Datenbank. Laden Sie diesen Tab neu, um weiterzuarbeiten.',
  'dbui.blockedByTab':
    'Ein anderer GTFS.zone-Tab hat die alte Datenbank noch geöffnet, daher kann sie nicht aktualisiert werden.',
  'dbui.notAnswering':
    'Der Browser antwortet nicht auf die Anfrage, die Datenbank zu öffnen. Möglicherweise wartet ein früheres Zurücksetzen noch auf einen Tab, der nie geschlossen wurde.',
  'dbui.notResponding': 'Die Datenbank reagiert nicht',
  'dbui.closeTabsRetry':
    'Schließen Sie alle anderen GTFS.zone-Tabs und versuchen Sie es erneut. Hilft das nicht, beendet ein Neustart des Browsers die hängende Anfrage.',
  'dbui.retry': 'Erneut versuchen',
  'dbui.continueWithout': 'Ohne Speichern fortfahren',
  'dbui.noDatabase':
    'Ohne Datenbank: Änderungen werden nicht in diesem Browser gespeichert.',
};
