import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { timetable as en } from '../en/timetable';

/** Timetables, in German. */
export const timetable: Translation<typeof en> = {
  'tt.route': 'Linie',
  'tt.service': 'Service',
  'tt.direction': 'Richtung',
  'tt.addDirection': 'Richtung hinzufügen',
  'tt.bothDirections':
    'Beide Richtungen existieren bereits: GTFS definiert nur direction_id 0 und 1',
  'tt.brouterTitle': 'In BRouter öffnen',
  'tt.brouterText':
    'Berechnet in BRouter in einem neuen Tab eine Route über die {count} Haltestellen dieser Fahrt, um einen Linienverlauf auf dem Straßen- oder Schienennetz zu zeichnen oder zu prüfen. Am Feed ändert sich nichts.',
  'tt.brouterDisabled':
    'Für „In BRouter öffnen“ braucht diese Fahrt mindestens zwei Haltestellen mit Koordinaten',
  'tt.uploadTitle': 'Linienverlauf für diese Fahrt hochladen',
  'tt.uploadText':
    'Liest eine GPX-Datei oder einen Linienverlauf aus einem GTFS-Feed in neue Zeilen von shapes.txt ein und lässt die shape_id dieser Fahrt darauf verweisen. Lässt sich im Verlauf rückgängig machen.',
  'tt.shapeActions': 'Aktionen für den Linienverlauf',
  'tt.addHeadwayTitle': 'Taktzeitraum zu {trip} hinzufügen',
  'tt.addHeadwayText':
    'Fügt eine Zeile in <code>frequencies.txt</code> hinzu: ein Betriebszeitfenster und die Sekunden zwischen den Abfahrten darin. Die stop_times der Fahrt werden zu einer Vorlage aus Versätzen ab ihrer ersten Abfahrt.',
  'tt.addFrequency': '+ Takt',
  'tt.addPeriod': '+ Zeitraum',
  'tt.frequencyN': 'Takt {n}',
  'tt.deleteHeadwayTitle': 'Diesen Taktzeitraum löschen',
  'tt.deleteHeadwayText':
    'Entfernt die Zeile in <code>frequencies.txt</code> für {trip} um {start}: {period}. Die stop_times der Fahrt bleiben unverändert.',
  'tt.minutes': '{field} - {n} Minuten',
  'tt.seconds': '{field} - {n} Sekunden',
  'tt.emptyEquivalent': '{field} - leer, entspricht 0',
  'tt.frequencyTripTitle': 'Taktbasierte Fahrt',
  'tt.frequencyTripText':
    'Die stop_times unten sind eine Vorlage: Nur ihre Versätze ab der ersten Abfahrt sind von Bedeutung, und in jedem Zeitraum fährt im jeweiligen Takt ein Fahrzeug ab.',
  'tt.deleteTripTitle': 'Fahrt {trip} löschen',
  'tt.deleteTripText':
    'Entfernt die Fahrt und ihre stop_times. Lässt sich im Verlauf rückgängig machen.',
  'tt.outOfOrder':
    'Die stop_times dieser Fahrt sind nicht chronologisch geordnet.',
  'tt.sortTripTitle': 'Fahrt {trip} nach Zeit sortieren',
  'tt.sortTripText':
    'Nummeriert die stop_times dieser Fahrt in chronologischer Reihenfolge neu. Haltestellen können dabei die Spalte im Streifen wechseln. Lässt sich im Verlauf rückgängig machen.',
  'tt.copyTripTitle': 'Fahrt {trip} kopieren',
  'tt.copyTripText':
    'Fragt nach einem Zeitversatz und ob die Reihenfolge der Haltestellen umgekehrt werden soll, und legt dann die Kopie mit einer generierten Fahrt-ID an. Kopiert auch die stop_times und frequencies.',
  'tt.reverseTripTitle': 'Fahrt {trip} umkehren',
  'tt.reverseTripText':
    'Kehrt die stop_times um und nummeriert sie neu; die Zeiten werden gespiegelt, sodass die Fahrt weiterhin vorwärts läuft. Entfernt den Linienverlauf. direction_id bleibt unverändert, Sie sollten es also danach bei der Fahrt anpassen. Lässt sich im Verlauf rückgängig machen.',
  'tt.shiftTripTitle': 'Fahrt {trip} verschieben',
  'tt.shiftTripText':
    'Addiert einen Versatz mit Vorzeichen zu jeder Zeit dieser Fahrt. Die Reihenfolge der Haltestellen bleibt gleich. Lässt sich im Verlauf rückgängig machen.',
  'tt.newTrip': 'Neue Fahrt',
  'tt.stop': 'Haltestelle',
  'tt.tripActions': 'Aktionen für die Fahrt',
  'tt.stopOrder': 'Reihenfolge der Haltestellen',
  'tt.focusStop': 'Diese Haltestelle auf der Karte zeigen',
  'tt.visit': '(Halt {n})',
  'tt.servedBy': 'Bedient von {serves} von {total} Fahrten',
  'tt.stopShowingTitle': '{field} nicht mehr anzeigen',
  'tt.stopShowingText':
    'Entfernt die Unterzeile aus jeder Zelle. Werte, die bereits im Feed stehen, bleiben unberührt, und das Feld erscheint von selbst wieder, sobald eine Zelle einen Wert hat.',
  'tt.changeStop': 'Haltestelle ändern',
  'tt.group': 'Gruppe',
  'tt.zone': 'Zone',
  'tt.openGroup': 'Diese Ortsgruppe öffnen',
  'tt.openZone': 'Diese Zone öffnen',
  'tt.pendingFlex': 'Ausstehende Bedarfszeile',
  'tt.pendingStop': 'Ausstehende Haltestelle',
  'tt.addTripFirst':
    'Legen Sie zuerst eine Fahrt an: Haltezeiten gehören zu einer Fahrt',
  'tt.addStopOrZone': 'Haltestelle oder Zone hinzufügen...',
  'tt.noTripsInDirection':
    'In dieser Richtung hat die Linie noch keine Fahrten. Haltezeiten gehören zu einer Fahrt, legen Sie also eine an, bevor Sie Haltestellen hinzufügen.',
  'tt.addFirstTrip': 'Erste Fahrt anlegen',
  'tt.directionNoTrips': '{name}: Keine Fahrten',
  'tt.error': 'Fehler',
  'tt.noTrips':
    'Dieser Feed hat noch keine Fahrten, daher gibt es keinen Fahrplan.',
  'tt.title': 'Fahrplan',
  'tt.browserTitle': 'Fahrpläne',
  'tt.noAgency': 'Kein Verkehrsunternehmen',
  'tt.noRoutes': 'Keine Linien.',
  'tt.newTimetable': 'Neuer Fahrplan',
  'tt.openTimetable': 'Fahrplan öffnen',
  'tt.feedNoRoutes': 'Dieser Feed hat noch keine Linien.',
  'tt.fromFirstDeparture': '{offset} ab der ersten Abfahrt',
  'tt.addFieldTitle': 'Weiteres Feld aus {file} anzeigen',
  'tt.addFieldText':
    'Wählt ein Feld, das als Unterzeile in jeder Zelle dieser Tabelle erscheint. Es wird erst in den Feed geschrieben, wenn ein Wert eingegeben wird, und verschwindet beim Verlassen des Fahrplans.',
  'tt.noRecord': 'Es gibt keinen Datensatz mit {field} {value}',
  'tt.earlierThanPrevious': 'Früher als die vorherige Haltestelle ({time})',
  'tt.noStopTimeYet': 'noch keine stop_time bei dieser Fahrt',
  'tt.moreFields':
    'Die übrigen Felder aus stop_times.txt für diese Haltestelle bearbeiten',
  'tt.moreFieldsSet':
    'Hier sind weitere Felder aus stop_times.txt gesetzt: Klicken Sie, um sie anzuzeigen und zu bearbeiten',
  'tt.viewCompact': 'Kompakt',
  'tt.viewExplicit': 'Alle Felder',
  'tt.viewMode': 'Ansicht',
  'tt.outbound': 'Hinfahrt',
  'tt.inbound': 'Rückfahrt',
  'tt.directionN': 'Richtung {id}',
  'tt.routeNotFound': 'Linie {id} nicht gefunden',
  'tt.stopMissing':
    'Haltestelle {id} fehlt in stops.txt, wird aber in stop_times.txt verwendet',
  'tt.invalidTime': 'Ungültige Zeit {time}: {reason}',
  'tt.dbLost': 'Verbindung zur Datenbank verloren',
  'sched.offsetError':
    'Der Versatz muss in Minuten mit Vorzeichen, MM:SS oder HH:MM:SS angegeben werden, z. B. -5',
  'sched.offsetLabel': 'Zeitversatz',
  'sched.offsetNote':
    'Minuten mit Vorzeichen, die zu jeder Zeit addiert werden, z. B. <code>-5</code>. <code>MM:SS</code> (<code>1:30</code>) und <code>HH:MM:SS</code> (<code>+01:00:00</code>) funktionieren ebenfalls.',
  'sched.allFieldsShown': 'Alle Felder von stop_times werden bereits angezeigt',
  'sched.addFieldTitle': 'Feld von stop_times hinzufügen',
  'sched.enterWindowTime':
    'Geben Sie eine Zeit für das Abhol-/Absetzfenster ein, z. B. 9:30 oder 09:30:00',
  'sched.enterTime': 'Geben Sie eine Zeit ein, z. B. 9:30 oder 09:30:00',
  'sched.changeStop': 'Haltestelle ändern',
  'sched.addStopOrZone': 'Haltestelle oder Zone hinzufügen',
  'sched.stopNotListed':
    'Haltestelle nicht aufgeführt? Am einfachsten legen Sie zuerst alle Haltestellen einer Linie mit dem Haltestellen-Werkzeug auf der Karte an und fügen sie dann hier hinzu.',
  'sched.manageZones': 'Zonen und Ortsgruppen verwalten...',
  'sched.pickupRule': 'Buchungsregel für die Abholung',
  'sched.dropOffRule': 'Buchungsregel für das Absetzen',
  'sched.manageRules': 'Buchungsregeln verwalten...',
  'sched.selectShape': 'Linienverlauf wählen',
  'sched.manageShapes': 'Linienverläufe verwalten...',
  'sched.replacedShape': 'Linienverlauf {id} ersetzt',
  'sched.uploadedShape': 'Linienverlauf {id} für Fahrt {trip} hochgeladen',
  'sched.zoneSecondary': 'Bedarfszone - {id}',
  'sched.groupSecondary': 'Ortsgruppe - {id}',
  'sched.arrivalAfterDeparture':
    'Ankunft {arrival} liegt nach Abfahrt {departure} an {stop}',
  'sched.labelAddStop': 'Haltestelle {stop} zu Fahrt {trip} hinzufügen',
  'sched.labelClearTime': 'Zeit {type} für {trip}/{stop} leeren',
  'sched.labelSetTime': 'Zeit {type} für {trip}/{stop} auf {time} setzen',
  'sched.addedStop': 'Haltestelle zur Fahrt hinzugefügt',
  'sched.saveTimeFailed': 'Die Zeitänderung konnte nicht gespeichert werden',
  'sched.windowOrder':
    'Der Beginn des Fensters muss vor dem Ende liegen oder ihm entsprechen',
  'sched.saveWindowFailed':
    'Die Änderung des Fensters konnte nicht gespeichert werden',
  'sched.saveFieldFailed': '{field} konnte nicht gespeichert werden',
  'sched.labelAddRef': '{kind} {id} zu Fahrt {trip} hinzufügen',
  'sched.addedFlex': 'Bedarfszeile zur Fahrt hinzugefügt',
  'sched.saveFlexFailed': 'Die Bedarfszeile konnte nicht gespeichert werden',
  'sched.addedRefInherited':
    '{id} zu Fahrt {trip} hinzugefügt (Abholung {pickup}, Absetzen {dropOff} von {from} übernommen)',
  'sched.addedRef': '{id} zu Fahrt {trip} hinzugefügt',
  'sched.labelRemove': '{row} aus Fahrt {trip} entfernen',
  'sched.removed': '{row} aus Fahrt {trip} entfernt',
  'sched.removeFailed': 'Die Zeile konnte nicht aus der Fahrt entfernt werden',
  'sched.emptySameAs0': '- (leer, entspricht 0)',
  'sched.secondsBetween': 'Sekunden zwischen den Abfahrten',
  'sched.labelMoveHeadway': 'Taktzeitraum von {trip} auf {start} verschieben',
  'sched.addHeadwayFailed': 'Der Taktzeitraum konnte nicht hinzugefügt werden',
  'sched.removeHeadwayFailed': 'Der Taktzeitraum konnte nicht entfernt werden',
  'sched.tripPropFailed':
    '{field} für Fahrt {trip} konnte nicht aktualisiert werden',
  'sched.renderFailed': 'Die Fahrplanansicht konnte nicht erzeugt werden',
  'sched.routePickerTitle': 'Linie des Fahrplans',
  'sched.routeNoTrips':
    'Linie {id} hat keine Fahrten und daher keinen Fahrplan.',
  'sched.notOnRoute': 'Noch nicht auf dieser Linie',
  'sched.servicePickerTitle': 'Service des Fahrplans',
  'sched.newService': 'Neuer Service…',
  'sched.noTimetable': 'Kein Fahrplan geladen',
  'sched.newTrip': 'Neue Fahrt',
  'sched.invalidTripId': 'Ungültige Fahrt-ID',
  'sched.tripIdTaken':
    'Diese Fahrt-ID existiert bereits, bitte wählen Sie eine andere',
  'sched.tripIdCheckFailed': 'Die Fahrt-ID konnte nicht geprüft werden',
  'sched.stopNotFound': 'Haltestelle nicht gefunden',
  'sched.refNotFound': 'Verweis nicht gefunden',
  'sched.pendingStop':
    'Haltestelle hinzugefügt. Geben Sie für mindestens eine Fahrt eine Zeit ein, um zu speichern.',
  'sched.pendingFlex':
    'Zeile hinzugefügt. Geben Sie für mindestens eine Fahrt ein Abholfenster ein, um zu speichern.',
  'sched.addRowFailed':
    'Die Zeile konnte nicht zum Fahrplan hinzugefügt werden',
  'sched.noStopTimesForStop':
    'In dieser Richtung verweisen keine Haltezeiten auf diese Haltestelle',
  'sched.labelChangeStop':
    'Haltestelle „{from}“ -> „{to}“ geändert (Linie {route}, Richtung {direction})',
  'sched.changeStopFailed': 'Die Haltestelle konnte nicht geändert werden',
  'sched.alreadySorted': 'Fahrt {trip} ist bereits nach Zeit sortiert',
  'sched.labelSort': 'Fahrt {trip} nach Zeit sortieren',
  'sched.sorted': 'Fahrt {trip} nach Zeit sortiert ({count} Zeilen verschoben)',
  'sched.sortFailed': 'Fahrt {trip} konnte nicht sortiert werden',
  'sched.tooFewToReverse':
    'Fahrt {trip} hat zu wenige Haltestellen zum Umkehren',
  'sched.labelReverse': 'Fahrt {trip} umkehren',
  'sched.reversed': 'Fahrt {trip} umgekehrt',
  'sched.reversedClearedShape':
    'Fahrt {trip} umgekehrt und ihren Linienverlauf entfernt',
  'sched.reverseFailed': 'Fahrt {trip} konnte nicht umgekehrt werden',
  'sched.shiftTitle': 'Fahrt {trip} verschieben',
  'sched.shiftCreate': 'Zeiten verschieben',
  'sched.nothingToShift': 'Bei Fahrt {trip} gibt es nichts zu verschieben',
  'sched.labelShift': 'Fahrt {trip} um {offset} verschieben',
  'sched.shifted': 'Fahrt {trip} um {offset} verschoben',
  'sched.shiftFailed': 'Fahrt {trip} konnte nicht verschoben werden',
  'sched.tripNotFound': 'Fahrt {trip} nicht gefunden',
  'sched.copyTitle': 'Fahrt {trip} kopieren',
  'sched.copyCreate': 'Fahrt kopieren',
  'sched.flipLabel':
    'Reihenfolge der Haltestellen umkehren und Richtung wechseln',
  'sched.flipNote':
    'Spiegelt die Zeiten, sodass die Kopie weiterhin vorwärts läuft. Leert shape_id und shape_dist_traveled.',
  'sched.labelCopy': 'Fahrt {trip} nach {id} kopieren',
  'sched.copied': 'Fahrt {trip} nach {id} kopiert',
  'sched.copiedFlipped':
    'Fahrt {trip} nach {id} kopiert (umgekehrt, Linienverlauf entfernt)',
  'sched.deleteTripLabel': 'Fahrt {trip} löschen',
  'sched.deleteTripTitle': 'Fahrt löschen?',
  'sched.deleteTripBody':
    'Fahrt {trip} löschen? Dies lässt sich nur über Rückgängig umkehren.',
  'sched.deleteTrip': 'Fahrt löschen',
  'sched.tripHasStopTimes': 'Fahrt hat Haltezeiten',
  'sched.tripHasStopTimesBody': 'Fahrt {trip} hat {stopTimes}.',
  'sched.tripCascade':
    'Beim Löschen dieser Fahrt werden auch alle ihre Haltezeiten entfernt (per Rückgängig umkehrbar).',
};
