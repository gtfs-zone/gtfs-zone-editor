import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { issues as en } from '../en/issues';

/** Feed issues, in German. */
export const issues: Translation<typeof en> = {
  'issues.rows': '{file}: Zeilen {text}',
  'issues.missingRequiredField': 'denen ein Pflichtfeld fehlt',
  'issues.missingRequiredFile': 'ohne Pflichtdatei',
  'issues.routesBadAgency':
    'Linien mit einer agency_id, die nicht in agency.txt steht',
  'issues.badRefField': '{file}: Zeilen mit einem nicht vorhandenen {field}',
  'issues.badRef':
    '{file}: Zeilen, die auf einen nicht vorhandenen Datensatz verweisen',
  'issues.routesBadAgencyNote':
    'Diese Linien erscheinen unter keinem Verkehrsunternehmen, bis agency_id korrigiert ist.',
  'issues.empty': 'ohne Inhalt',
  'issues.duplicateId': 'mit doppelter ID',
  'issues.invalidCoordinate': 'mit ungültiger Koordinate',
  'issues.invalidDate': 'mit ungültigem Datum',
  'issues.invalidTime': 'mit ungültiger Uhrzeit',
  'issues.invalidNumber': 'mit ungültiger Zahl',
  'issues.invalidUrl': 'mit ungültiger URL',
  'issues.invalidCode': '{file}: Zeilen, deren {field} kein gültiger Code ist',
  'issues.value': 'Wert',
  'issues.invalidGeometry': '{file}: Zonen mit ungültiger Geometrie',
  'issues.conditional': 'denen ein bedingt erforderliches Feld fehlt',
  'issues.unknownRouteType': 'mit unbekanntem route_type',
  'issues.unknownLocationType': 'mit unbekanntem location_type',
  'issues.invalidExceptionType': 'mit ungültigem exception_type',
  'issues.invalidArea': 'mit ungültiger Bereichszuordnung',
  'issues.translationUnknownField':
    'mit Übersetzungen eines Feldes, das die Tabelle nicht hat',
  'issues.translationOrphanedRecord':
    'mit Übersetzungen eines nicht vorhandenen Datensatzes',
  'issues.translationOrphanedValue':
    'mit Übersetzungen eines field_value, den keine Zeile mehr enthält',
  'issues.noStopTimes': 'ohne stop_times',
  'issues.deleteTrips': 'Fahrten löschen',
  'issues.deleteTripsConfirm':
    '{trips} ohne stop_times und die zugehörigen Zeilen in frequencies löschen? Ein einziges Rückgängigmachen stellt alles wieder her.',
  'issues.orphaned': 'ohne eigene oder vom Elternobjekt geerbte Koordinaten',
  'issues.orphanedNote':
    'Diese werden nicht auf der Karte gezeichnet. Geben Sie jeder Koordinaten oder eine parent_station, die welche hat.',
  'issues.unpairedFlex': 'mit einem ungepaarten Abhol-/Absetzfenster',
  'issues.unpairedFlexNote':
    'Andere Fahrten der Linie paaren dieses Fenster mit einer zweiten Zeile für die Gegenrichtung.',
  'issues.riderDefault':
    'Tarifprodukte ohne genau eine Standard-Fahrgastkategorie',
  'issues.networkConflict': 'mit widersprüchlicher network_id',
  'issues.missingCalendar': 'ohne Kalenderdatei',
  'issues.inheritedCoords': 'mit vom Elternobjekt geerbten Koordinaten',
  'issues.hiddenWhitespaceField':
    '{file}: Zeilen, deren {field} versteckte Leerzeichen enthält',
  'issues.hiddenWhitespace': 'mit versteckten Leerzeichen in einem Wert',
  'issues.hiddenWhitespaceNote':
    'Ein CSV-Feld in Anführungszeichen hat das Zeilenende verschluckt. Die zusätzlichen Zeichen sind unsichtbar, zählen aber: Eine ID, die sie enthält, passt zu nichts.',
  'issues.fix': 'Beheben',
  'issues.fixConfirm':
    'Versteckte Leerzeichen in {values} entfernen? Ein einziges Rückgängigmachen stellt alles wieder her.',
  'issues.values_one': '{count} Wert',
  'issues.values_other': '{count} Werten',
  'issues.duplicateKey': 'mit demselben Primärschlüssel wie eine andere Zeile',
  'issues.frequencyOverlap': 'mit überlappenden Taktzeiträumen',
  'issues.frequencyEnd': 'deren end_time auf eine Abfahrt fällt',
  'issues.recordTitle': 'Probleme mit diesem Datensatz',
  'issues.danglingRef': '{field} verweist auf „{value}“, das nicht existiert',
  'issues.danglingNote':
    'Wählen Sie unten einen vorhandenen Wert oder legen Sie den Datensatz an, auf den verwiesen wird.',
  'issues.gone': 'Dieses Problem ist bereits behoben',
  'issues.unknownAction': 'Unbekannte Aktion {id}',
  'issues.confirmTitle': '{label}?',
  'issues.title': 'Feed-Probleme',
};
