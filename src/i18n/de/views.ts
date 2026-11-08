import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { views as en } from '../en/views';

/** Entity view pages, in German. */
export const views: Translation<typeof en> = {
  'view.agencyNotFound': 'Verkehrsunternehmen nicht gefunden.',
  'view.agencyFailed':
    'Die Angaben zum Verkehrsunternehmen konnten nicht geladen werden.',
  'view.agencyProperties': 'Eigenschaften des Verkehrsunternehmens',
  'view.routes': 'Linien',
  'view.newRoute': '+ Neue Linie',
  'view.noRoutes':
    'Für dieses Verkehrsunternehmen wurden keine Linien gefunden.',
  'view.stopNotFound': 'Haltestelle nicht gefunden.',
  'view.pathwaysOut': 'Ausgehende Wege',
  'view.pathwaysIn': 'Eingehende Wege',
  'view.stopFailed':
    'Die Angaben zur Haltestelle konnten nicht geladen werden.',
  'view.timetables': 'Fahrpläne',
  'view.stopNoTimetable':
    'Diese Haltestelle ist noch in keinem Fahrplan. Um sie hinzuzufügen, öffnen Sie eine Linie und wählen einen Service, oder suchen Sie den Fahrplan in der Fahrplanübersicht.',
  'view.openTimetableBrowser': 'Fahrplanübersicht öffnen',
  'view.viaMore': ' +{count} weitere',
  'view.openRoute': 'Linie öffnen',
  'view.noTransfers':
    'Kein Umstieg nennt diese Haltestelle. Legen Sie einen an, um einen Anschluss zu garantieren, ihm eine Mindestzeit zu geben oder ihn auszuschließen.',
  'view.inSeatNote_one':
    '{count} Umstieg im Fahrzeug (Typ 4 oder 5) nennt diese Haltestelle ebenfalls. Er verbindet zwei Fahrten statt zwei Haltestellen und wird daher im Dialog „Umstiege“ bearbeitet.',
  'view.inSeatNote_other':
    '{count} Umstiege im Fahrzeug (Typ 4 oder 5) nennen diese Haltestelle ebenfalls. Sie verbinden zwei Fahrten statt zwei Haltestellen und werden daher im Dialog „Umstiege“ bearbeitet.',
  'view.transfers': 'Umstiege',
  'view.manageTransfers': 'Alle Umstiege verwalten',
  'view.boardingAreas': 'Einstiegsbereiche',
  'view.entrances': 'Eingänge / Ausgänge',
  'view.platforms': 'Bahnsteige',
  'view.genericNodes': 'Generische Knoten',
  'view.childStops': 'Untergeordnete Haltestellen',
  'view.noChildStops': 'Keine untergeordneten Haltestellen definiert.',
  'view.serviceFailed': 'Die Angaben zum Service konnten nicht geladen werden.',
  'view.alreadyAtStart': 'Bereits am Feed-Beginn',
  'view.noEarlyExceptions':
    'Dieser Service hat keine Zeile in calendar.txt und keine früheren Ausnahmen',
  'view.trimTitle':
    'start_date auf {date} setzen und alle Ausnahmen davor entfernen',
  'view.trimTitleNoRow': 'Alle Ausnahmen davor entfernen',
  'view.alreadyAtEnd': 'Bereits am Feed-Ende',
  'view.noLateExceptions':
    'Dieser Service hat keine Zeile in calendar.txt und keine späteren Ausnahmen',
  'view.extendTitle':
    'end_date auf {date} setzen und alle Ausnahmen danach entfernen',
  'view.extendTitleNoRow': 'Alle Ausnahmen danach entfernen',
  'view.serviceSchedule': 'Verkehrstage',
  'view.trimToStart': 'Auf Feed-Beginn kürzen',
  'view.extendToEnd': 'Bis Feed-Ende verlängern',
  'view.addTimetable': '+ Fahrplan',
  'view.noRoutesUsingService': 'Keine Linie verwendet diesen Service.',
  'view.createTimetable': 'Fahrplan anlegen',
  'view.createTimetableTitle': 'Fahrplan anlegen',
  'view.pathwayNotFound': 'Weg nicht gefunden.',
  'view.pathwayFailed': 'Die Angaben zum Weg konnten nicht geladen werden.',
  'view.from': 'Von',
  'view.to': 'Nach',
  'view.name': 'Name',
  'view.description': 'Beschreibung',
  'view.zoneUnavailable': 'Zonendaten sind nicht verfügbar.',
  'view.zoneMissing': 'Zone {id} ist nicht in locations.geojson.',
  'view.onDemandZone': 'Bedarfszone',
  'view.deleteZone': 'Zone löschen',
  'view.zoneRoutes': 'Linien, die diese Zone bedienen',
  'view.zoneFailed': 'Die Angaben zur Zone konnten nicht geladen werden.',
  'view.details': 'Details',
  'view.zoneNoStopTimes': 'Keine stop_times verweisen auf diese Zone.',
  'view.groupNotFound': 'Ortsgruppe nicht gefunden.',
  'view.locationGroup': 'Ortsgruppe',
  'view.memberStops': 'Zugehörige Haltestellen',
  'view.addMember': '+ Haltestelle hinzufügen...',
  'view.groupRoutes': 'Linien, die diese Gruppe bedienen',
  'view.groupFailed':
    'Die Angaben zur Ortsgruppe konnten nicht geladen werden.',
  'view.noMembers': 'Diese Gruppe enthält noch keine Haltestellen.',
  'view.missingStop': '{id} (fehlt in stops.txt)',
  'view.removeFromGroup': 'Aus der Gruppe entfernen',
  'view.groupNoStopTimes': 'Keine stop_times verweisen auf diese Gruppe.',
  'view.addMemberTitle': 'Haltestelle zur Ortsgruppe hinzufügen',
};
