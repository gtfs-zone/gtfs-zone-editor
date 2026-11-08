import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { map as en } from '../en/map';

/** Map, pathways and GeoJSON exchange, in German. */
export const map: Translation<typeof en> = {
  'map.newStop': 'Neue Haltestelle',
  'map.invalidStop': 'Ungültige Haltestelle',
  'map.stationNotEndpoint':
    'Stationen (location_type=1) können keine Endpunkte eines Weges sein. Wählen Sie einen Bahnsteig, einen Eingang, einen generischen Knoten oder einen Einstiegsbereich.',
  'map.pathwayFrom':
    'Von: {id}. Klicken Sie jetzt auf die zweite Haltestelle, um sie zu verbinden.',
  'map.invalidPathway': 'Ungültiger Weg',
  'map.sameEndpoints':
    'Die beiden Endpunkte müssen verschiedene Haltestellen sein.',
  'map.fromStop': 'Von Haltestelle',
  'map.toStop': 'Nach Haltestelle',
  'map.newPathway': 'Neuer Weg',
  'map.createPathway': 'Weg anlegen',
  'map.pathwayMode': 'Wegart',
  'map.bidirectional': 'In beide Richtungen',
  'map.exitGateOneWay':
    'Ausgangssperren (Modus 7) dürfen nicht in beide Richtungen gehen.',
  'map.clickTwoStops':
    'Klicken Sie auf zwei Haltestellen, um einen Weg zwischen ihnen anzulegen.',
  'map.ok': 'OK',
  'map.coordsFailed':
    'Die Koordinaten der Haltestelle konnten nicht aktualisiert werden: {message}',
  'map.unnamedStop': 'Unbenannte Haltestelle',
  'map.servedBy': '{serves} von {total} Fahrten',
  'map.servedByTitle': 'Bedient von {serves} von {total} Fahrten',
  'map.routeDiagram': 'Linienschema',
  'geo.noId': '(keine ID)',
  'geo.nothing': 'nichts',
  'geo.noPolygon':
    'Kein Polygon für die Zone „{id}“ im GeoJSON. Gefunden: {found}.',
  'geo.noGeometry':
    'Diese Zone hat keine Geometrie. Zeichnen Sie sie in geojson.io oder fügen Sie unten GeoJSON ein.',
  'geo.type': 'Typ',
  'geo.vertices': 'Eckpunkte',
  'geo.bounds': 'Grenzen',
  'geo.zoneGone':
    'Zone {id} ist nicht mehr in locations.geojson. Laden Sie die Seite neu.',
  'geo.zoneUpdated': 'Geometrie der Zone {id} aktualisiert',
  'geo.noFeatureWithId':
    'Kein Feature mit der ID „{id}“ im GeoJSON. Gefunden: {found}.',
  'geo.expectedOne':
    'Ein Feature erwartet, {count} erhalten. Behalten Sie nur das gewünschte.',
  'geo.editorEmpty': 'Der Editor ist leer.',
  'geo.invalidJson': 'Kein gültiges JSON: {message}',
  'geo.noFeaturesArray': 'Die FeatureCollection hat kein features-Array.',
  'geo.expectedFeature':
    'GeoJSON-Feature oder FeatureCollection erwartet, {type} erhalten.',
  'geo.importTitle': 'GeoJSON von URL importieren',
  'geo.importBody':
    'Fügen Sie einen Teilen-Link von geojson.io oder die URL einer GeoJSON-Datei ein. Gespeichert wird erst, wenn Sie auf Speichern klicken.',
  'geo.url': 'URL',
  'geo.useCors': 'CORS-Proxy verwenden',
  'geo.urlRequired': 'Geben Sie eine URL zum Abrufen ein',
  'geo.fetch': 'Abrufen',
  'geo.defaultHint':
    'Um eine Bearbeitung zurückzuholen, nutzen Sie „Share“ in geojson.io und fügen den Link hier ein. geojson.io hält die Daten beim Zeichnen nicht mehr in der Adressleiste.',
  'geo.editIn': 'In geojson.io bearbeiten',
  'geo.importFromUrl': 'Von URL importieren',
  'geo.pastedNoId':
    'Ein eingefügtes Feature hat keine ID. Jede Zone braucht eine `id`, die ihrer location_id entspricht.',
  'geo.duplicateId': 'Doppelte Zonen-ID im eingefügten GeoJSON: {id}',
  'geo.notPolygon':
    'Zone {id} kam mit der Geometrie {type} zurück, erwartet war ein Polygon oder MultiPolygon. Zeichnen Sie die Zone zuerst in geojson.io, dann „Share“ und den Link einfügen.',
  'search.zoneTerms': 'zone bedarfszone bedarf on-demand',
  'search.groupTerms': 'ortsgruppe gruppe location group',
};
