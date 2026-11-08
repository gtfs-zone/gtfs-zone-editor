import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { pages as en } from '../en/pages';

/** Home and entity pages, in German. */
export const pages: Translation<typeof en> = {
  'page.readOnly':
    'Dieser Feed ist schreibgeschützt geöffnet und kann daher nicht korrigiert werden',
  'page.loadFailed':
    'Der Inhalt konnte nicht geladen werden. Bitte versuchen Sie es erneut.',
  'page.cleanFeed':
    'Alles in Ordnung? Exportieren und veröffentlichen Sie Ihren Feed.',
  'page.publishingGuide': 'Anleitung zur Veröffentlichung',
  'page.noPatchManager': 'Kein Patch-Manager verfügbar',
  'page.trimAllTitle':
    'start_date jedes Service auf {date} setzen und alle Ausnahmen davor entfernen',
  'page.extendAllTitle':
    'end_date jedes Service auf {date} setzen und alle Ausnahmen danach entfernen',
  'page.noFeedStart': 'feed_info hat kein feed_start_date',
  'page.noFeedEnd': 'feed_info hat kein feed_end_date',
  'page.feedIssues': 'Feed-Probleme',
  'page.agencies': 'Verkehrsunternehmen',
  'page.newAgency': '+ Neues Verkehrsunternehmen',
  'page.noAgencies': 'Keine Verkehrsunternehmen in den GTFS-Daten gefunden.',
  'page.services': 'Services',
  'page.trimAll': 'Alle auf Feed-Beginn kürzen',
  'page.extendAll': 'Alle bis Feed-Ende verlängern',
  'page.newService': '+ Neuer Service',
  'page.noServices': 'Keine Services in den GTFS-Daten gefunden.',
  'page.feedInfo': 'Feed-Informationen',
  'page.timetable': 'Fahrplan',
  'page.addTimetable': 'Fahrplan hinzufügen für Service:',
  'page.noServicesYet': 'Noch keine Services: Legen Sie zuerst einen an',
  'page.chooseService': 'Service wählen...',
  'page.newServiceOption': 'Neuer Service…',
  'page.timetables': 'Fahrpläne',
  'page.noServicesFound': 'Keine Services gefunden.',
  'page.createOne': 'Einen anlegen',
  'page.noTimetables':
    'Noch keine Fahrpläne. Wählen Sie oben einen Service, um einen anzulegen.',
  'page.network': 'Netz',
  'page.notInNetwork': 'In keinem Netz',
  'page.selectNetwork': 'Netz wählen',
  'page.createNetwork': '+ Neues Netz anlegen...',
  'page.newNetwork': 'Neues Netz',
  'page.networkNote':
    'Wenn Sie ein Netz benennen, exportiert der Feed networks.txt und route_networks.txt statt einer Spalte network_id in routes.txt.',
  'page.newAgencyTitle': 'Neues Verkehrsunternehmen',
  'page.newRouteTitle': 'Neue Linie',
  'page.alreadyAtBound': 'Alle Services liegen bereits an dieser Grenze',
  'page.serviceAtBound': 'Dieser Service liegt bereits an dieser Grenze',
  'page.trimmed': '{services} gekürzt',
  'page.extended': '{services} verlängert',
  'page.trimmedRemoved': '{services} gekürzt, {exceptions} entfernt',
  'page.extendedRemoved': '{services} verlängert, {exceptions} entfernt',
  'page.deleteRouteTitle': 'Linie löschen?',
  'page.deleteRouteEmpty':
    'Diese Linie hat keine Fahrten. Möchten Sie sie wirklich löschen?',
  'page.routeHasTrips': 'Linie hat Fahrten',
  'page.routeHasTripsBody': 'Diese Linie hat {trips} und {stopTimes}.',
  'page.routeCascade':
    'Beim Löschen dieser Linie werden auch alle ihre Fahrten und stop_times gelöscht (per Rückgängig umkehrbar). Oder brechen Sie ab, um sie zu behalten.',
  'page.deleteServiceTitle': 'Service löschen?',
  'page.deleteServiceEmpty':
    'Dieser Service hat keine Fahrten und keine Kalenderdaten. Möchten Sie ihn wirklich löschen?',
  'page.serviceHasDependents': 'Service hat abhängige Daten',
  'page.serviceHasBody': 'Dieser Service hat {parts}.',
  'page.serviceCascade':
    'Beim Löschen dieses Service werden auch alle seine Fahrten, stop_times und calendar_dates gelöscht (per Rückgängig umkehrbar). Oder brechen Sie ab, um ihn zu behalten.',
  'page.deleteAgencyTitle': 'Verkehrsunternehmen löschen?',
  'page.deleteAgencyEmpty':
    'Dieses Verkehrsunternehmen hat keine Linien. Möchten Sie es wirklich löschen?',
  'page.agencyHasRoutes': 'Verkehrsunternehmen hat Linien',
  'page.agencyHasBody':
    'Dieses Verkehrsunternehmen hat {routes}, {trips} und {stopTimes}.',
  'page.agencyCascade':
    'Beim Löschen dieses Verkehrsunternehmens werden auch alle seine Linien, Fahrten und stop_times gelöscht (per Rückgängig umkehrbar). Oder brechen Sie ab, um es zu behalten.',
  'page.stopHasVisits': 'Haltestelle hat geplante Halte',
  'page.stopReferenced':
    'Auf diese Haltestelle verweisen {stopTimes} in {trips}:',
  'page.stopCascade':
    'Sie können die Haltestelle samt all ihren stop_times löschen (per Rückgängig umkehrbar) oder abbrechen.',
  'page.zoneHasPickups': 'Zone hat geplante Abholungen',
  'page.zoneReferenced': 'Auf diese Zone verweisen {stopTimes} in {trips}:',
  'page.zoneCascade':
    'Sie können die Zone samt all ihren stop_times löschen (per Rückgängig umkehrbar) oder abbrechen.',
};
