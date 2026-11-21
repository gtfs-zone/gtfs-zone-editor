import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { calendar as en } from '../en/calendar';

/** Service calendar, in German. */
export const calendar: Translation<typeof en> = {
  'svc.loadFailed': 'Der Service-Editor konnte nicht geladen werden',
  'svc.dayFailed': '{day} konnte nicht aktualisiert werden',
  'svc.addExceptionFailed': 'Die Ausnahme konnte nicht hinzugefügt werden',
  'svc.weeklyPattern': 'Wochentage',
  'svc.dateRange': 'Zeitraum',
  'svc.exceptions': 'Service-Ausnahmen',
  'svc.renameNeedsRow':
    'Nur ein Service mit einer Zeile in calendar.txt kann umbenannt werden. Aktivieren Sie einen Wochentag, um eine anzulegen.',
  'svc.noCalendarRow':
    'Dieser Service hat keine Zeile in calendar.txt und damit keinen Zeitraum. Seine Daten stammen aus den Ausnahmen unten. Aktivieren Sie einen Wochentag, um eine anzulegen.',
  'svc.exceptionsUnavailable':
    'Ausnahmen können erst bearbeitet werden, wenn der Änderungsverlauf bereit ist.',
  'svc.added': 'Service hinzugefügt',
  'svc.removed': 'Service entfernt',
  'svc.noAdded': 'Kein Datum fügt Service zusätzlich zu den Wochentagen hinzu.',
  'svc.noRemoved': 'Kein Datum entfernt Service von den Wochentagen.',
  'svc.enterDate': 'Geben Sie ein Datum im Format JJJJMMTT ein',
  'svc.setRangeFirst': 'Legen Sie zuerst ein Start- und Enddatum fest',
  'svc.holidaysInRange_one':
    '{count} bundesweiter Feiertag fällt in diesen Zeitraum',
  'svc.holidaysInRange_other':
    '{count} bundesweite Feiertage fallen in diesen Zeitraum',
  'svc.excludeHolidays': 'US-Bundesfeiertage ausschließen',
  'svc.setRangeBeforeHolidays':
    'Legen Sie ein Start- und Enddatum fest, bevor Sie Feiertage ausschließen',
  'svc.includeHolidaysLabel': 'US-Bundesfeiertage einbeziehen',
  'svc.excludeHolidaysLabel': 'US-Bundesfeiertage ausschließen',
  'svc.holidaysFailed': 'Die Bundesfeiertage konnten nicht aktualisiert werden',
  'timeline.noData': 'Keine Servicedaten verfügbar',
  'timeline.noDates': 'Keine Datumsangaben verfügbar',
  'timeline.addedOn': 'Hinzugefügt am {date}',
  'timeline.removedOn': 'Entfernt am {date}',
  'timeline.editService': 'Service {id} bearbeiten',
  'timeline.clickRow': 'Klicken Sie auf die Zeile, um den Service zu öffnen',
  'timeline.truncated':
    'Der Zeitraum ist länger als 3 Jahre: Die Anzeige ist gekürzt.',
  'timeline.hint':
    'Wählen Sie einen Service, um seine Fahrpläne anzuzeigen, oder bearbeiten Sie den Service selbst über den Stift.',
  'timeline.trips': 'Fahrten',
  'cal.feedStart': 'Startdatum des Feeds',
  'cal.feedEnd': 'Enddatum des Feeds',
  'cal.title': 'Servicekalender',
  'cal.monthGrid': 'Monatsansicht',
  'cal.timeline': 'Zeitleiste',
  'newSvc.title': 'Neuer Service',
  'newSvc.idHasExceptions':
    'calendar_dates enthält bereits Ausnahmen für den Service „{id}“',
  'newSvc.needsDates': 'Ein Service braucht ein Start- und ein Enddatum.',
  'newSvc.endBeforeStart': 'Das Enddatum liegt vor dem Startdatum.',
  'newSvc.created': 'Service {id} angelegt',
};
