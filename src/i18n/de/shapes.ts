import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { shapes as en } from '../en/shapes';

/** Shapes manager, in German. */
export const shapes: Translation<typeof en> = {
  'shapes.feet': '{n} ft',
  'shapes.metres': '{n} m',
  'shapes.within':
    'Höchstens {distance} von der ursprünglichen Linie entfernt.',
  'shapes.noShapesTxt':
    'Keine shapes.txt in diesem Feed, oder sie hat keine Zeilen.',
  'shapes.noUsablePoints':
    'In diesem Feed wurden keine verwendbaren Shape-Punkte gefunden.',
  'shapes.importFromFeed': 'Linienverlauf aus diesem Feed importieren',
  'shapes.search': 'Linienverläufe suchen...',
  'shapes.pts': '{count} Pkt.',
  'shapes.direction': 'Richtung {id}',
  'shapes.titleGtfs': 'Linienverlauf aus GTFS-Feed importieren',
  'shapes.titleGpx': 'Neuer Linienverlauf aus GPX',
  'shapes.titleGeojson': 'Neuer Linienverlauf aus GeoJSON',
  'shapes.errorGtfs': 'GTFS-Fehler',
  'shapes.errorGeojson': 'GeoJSON-Fehler',
  'shapes.errorGpx': 'GPX-Fehler',
  'shapes.ok': 'OK',
  'shapes.addTitle': 'Linienverlauf hinzufügen',
  'shapes.addBody':
    'Laden Sie einen GPX-Track, einen GTFS-Feed oder eine GeoJSON-Datei von der Festplatte, oder fügen Sie eine GeoJSON-Linie (oder einen Teilen-Link von geojson.io) ein.',
  'shapes.chooseFile': 'Datei wählen',
  'shapes.paste': 'GeoJSON oder Link einfügen',
  'shapes.tripsWillChange_one':
    '{count} Fahrt verwendet diesen Linienverlauf und wird geändert.',
  'shapes.tripsWillChange_other':
    '{count} Fahrten verwenden diesen Linienverlauf und werden alle geändert.',
  'shapes.replaceOrCreate': 'Ersetzen oder neu anlegen',
  'shapes.tripUsesShape':
    'Diese Fahrt verwendet bereits den Linienverlauf {id}.',
  'shapes.newLeavesOld':
    'Ein neuer Linienverlauf lässt den alten im Feed, ohne dass diese Fahrt ihn noch verwendet.',
  'shapes.replaceInPlace': 'Linienverlauf {id} direkt ersetzen',
  'shapes.createNew': 'Neuen Linienverlauf anlegen',
  'shapes.pasteHint':
    'Ein LineString-Feature, eine FeatureCollection mit einer Linie oder ein Teilen-Link von geojson.io.',
  'shapes.useLine': 'Diese Linie verwenden',
  'shapes.pastedLabel': 'Eingefügtes GeoJSON ({count} Pkt.)',
  'shapes.fileLabel': '{name} ({count} Pkt.)',
  'shapes.zipLabel': '{name} - Linienverlauf {id} ({count} Pkt.)',
  'shapes.idTaken': 'Der Linienverlauf „{id}“ existiert bereits.',
  'shapes.simplify': 'Vereinfachen',
  'shapes.unknown': 'Unbekannt',
  'shapes.endpoints': '{origin} bis {destination}',
  'shapes.upload': 'Linienverlauf hochladen',
  'shapes.help':
    'Hier verwalten Sie alle Linienverläufe des Feeds. Linienverläufe werden den Fahrten im Fahrplan zugewiesen.',
  'shapes.none': 'Keine Linienverläufe in diesem Feed.',
  'shapes.replaceTip': 'Aus einer Datei oder eingefügtem Inhalt ersetzen',
  'shapes.editGeojsonIo': 'In geojson.io bearbeiten',
  'shapes.simplifyShape': 'Linienverlauf vereinfachen',
  'shapes.deleteShape': 'Linienverlauf löschen',
  'shapes.simplifyAll': 'Alle vereinfachen',
  'shapes.colId': 'Shape-ID',
  'shapes.colPoints': 'Punkte',
  'shapes.colTrips': 'Fahrten',
  'shapes.colRuns': 'Durchläufe',
  'shapes.colTimetables': 'Fahrpläne',
  'shapes.colActions': 'Aktionen',
  'shapes.title': 'Linienverläufe',
  'shapes.deleteBody': 'Linienverlauf {id} und alle seine {points} löschen?',
  'shapes.points_one': '{count} Punkt',
  'shapes.points_other': '{count} Punkte',
  'shapes.labelDelete': 'Linienverlauf {id} löschen',
  'shapes.labelReplace': 'Linienverlauf {id} ersetzen ({count} Pkt.)',
  'shapes.noPoints': 'Linienverlauf {id} hat keine Punkte.',
  'shapes.editTitle': 'Linienverlauf {id} bearbeiten',
  'shapes.geometry': 'Geometrie',
  'shapes.saveGeometry': 'Geometrie speichern',
  'shapes.labelEdit': 'Linienverlauf {id} bearbeiten ({from} -> {to} Pkt.)',
  'shapes.updated': 'Linienverlauf {id} aktualisiert',
  'shapes.tooFew':
    'Linienverlauf {id} hat nur {points}; es gibt nichts zu vereinfachen.',
  'shapes.keeps': 'behält {kept} von {total} Punkten ({removed} entfernt)',
  'shapes.deviation': 'max. Abweichung {max}, durchschnittlich {mean}',
  'shapes.hasPoints': 'Linienverlauf {id} hat {count} Punkte.',
  'shapes.labelSimplify':
    'Linienverlauf {id} vereinfachen ({from} -> {to} Pkt.)',
  'shapes.simplifyAllTitle': 'Alle Linienverläufe vereinfachen',
  'shapes.simplifyUnchanged':
    'Diese Stufe behält alle Punkte, Linienverlauf {id} bleibt also unverändert.',
  'shapes.simplifyAllUnchanged':
    'Diese Stufe behält alle Punkte, kein Linienverlauf wurde also geändert.',
  'shapes.nothingToSimplify':
    'Kein Linienverlauf in diesem Feed hat mehr als zwei Punkte; es gibt nichts zu vereinfachen.',
  'shapes.keepsAcross':
    'behält {kept} von {total} Punkten über {shapes}; größte Abweichung {worst}.',
  'shapes.count_one': '{count} Linienverlauf',
  'shapes.count_other': '{count} Linienverläufe',
  'shapes.totalPoints': '{shapes} mit insgesamt {count} Punkten.',
  'shapes.labelSimplifyAll': '{shapes} vereinfachen ({from} -> {to} Pkt.)',
  'shapes.labelNew': 'Neuer Linienverlauf {id} ({count} Pkt.)',
  'shapes.uploadForTrip': 'Linienverlauf für diese Fahrt hochladen',
  'shapes.labelUpload':
    'Linienverlauf {id} für Fahrt {trip} hochladen ({count} Pkt.)',
};
