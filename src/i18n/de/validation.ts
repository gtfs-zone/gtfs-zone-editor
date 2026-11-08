import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { validation as en } from '../en/validation';

/** Validation messages, in German. */
export const validation: Translation<typeof en> = {
  'rule.bothOrNeither':
    '{a} und {b} müssen beide gesetzt oder beide leer gelassen werden',
  'rule.requiredWhen': '{field} ist erforderlich, wenn {condition}',
  'rule.forbiddenWhen': '{field} ist nicht erlaubt, wenn {condition}',
  'rule.wallClock': '{field} muss eine Uhrzeit im Format HH:MM:SS sein',
  'rule.notAfter24': '{field} darf nicht später als 24:00:00 sein',
  'cond.transferType': 'transfer_type {type} ist',
  'cond.transferTypeStops': 'transfer_type leer, 0, 1, 2 oder 3 ist',
  'cond.window': 'ein Abhol-/Absetzfenster definiert ist',
  'cond.times': 'arrival_time oder departure_time definiert ist',
  'cond.defined': '{field} definiert ist',
  'cond.timepoint': 'timepoint=1 ist',
  'flexRule.oneOf':
    'eines von stop_id, location_group_id oder location_id ist erforderlich',
  'flexRule.exclusive':
    '{fields} schließen sich gegenseitig aus: Geben Sie genau eines an',
  'flexRule.and': ' und ',
  'flexRule.windowRequired':
    'ein Abhol-/Absetzfenster ist erforderlich, wenn {field} definiert ist',
  'flexRule.windowForbidden':
    'ein Abhol-/Absetzfenster ist nicht erlaubt, wenn arrival_time oder departure_time definiert ist',
  'flexRule.windowOrder':
    'start_pickup_drop_off_window darf nicht später als end_pickup_drop_off_window sein',
  'flexRule.pickupType':
    'pickup_type muss 1 oder 2 sein, wenn ein Abhol-/Absetzfenster definiert ist',
  'flexRule.dropOffType':
    'drop_off_type muss 1, 2 oder 3 sein, wenn ein Abhol-/Absetzfenster definiert ist',
  'flexRule.continuous':
    '{field} muss 1 oder leer sein, wenn ein Abhol-/Absetzfenster definiert ist',
  'flexRule.firstLast':
    'arrival_time ist für die erste und letzte Haltestelle einer Fahrt erforderlich',
  'flexRule.pickupForbidden':
    'pickup_type={value} ist nicht erlaubt, wenn ein Abhol-/Absetzfenster definiert ist; es muss 1 oder 2 sein',
  'flexRule.pickupEmpty':
    'pickup_type muss 1 oder 2 sein, wenn ein Abhol-/Absetzfenster definiert ist; leer entspricht 0',
  'flexRule.dropOffForbidden':
    'drop_off_type=0 ist nicht erlaubt, wenn ein Abhol-/Absetzfenster definiert ist; es muss 1, 2 oder 3 sein',
  'flexRule.dropOffEmpty':
    'drop_off_type muss 1, 2 oder 3 sein, wenn ein Abhol-/Absetzfenster definiert ist; leer entspricht 0',
  'flexRule.continuousForbidden':
    '{field}={value} ist nicht erlaubt, wenn ein Abhol-/Absetzfenster definiert ist; es muss 1 oder leer sein',
  'booking.requiredFor': '{field} ist für booking_type={type} erforderlich',
  'booking.forbiddenFor': '{field} ist für booking_type={type} nicht erlaubt',
  'booking.startDayMax':
    'prior_notice_start_day ist für booking_type=1 nicht erlaubt, wenn prior_notice_duration_max definiert ist',
  'booking.serviceOnly2':
    'prior_notice_service_id ist nur für booking_type=2 erlaubt, nicht für booking_type={type}',
  'ids.groupTaken':
    'location_group_id „{id}“ wird bereits als {owner} verwendet; die ID muss über stops.txt, locations.geojson und location_groups.txt hinweg eindeutig sein',
  'ids.taken':
    '„{id}“ wird bereits als {owner} verwendet; die ID muss über stops.txt, locations.geojson und location_groups.txt hinweg eindeutig sein.',
  'ids.ownerStop': 'stop_id in stops.txt',
  'ids.ownerZone': 'id in locations.geojson',
  'ids.ownerGroup': 'location_group_id in location_groups.txt',
  'freq.required': '{field} ist erforderlich',
  'freq.invalidTime': '{field} „{value}“ ist keine gültige Uhrzeit',
  'freq.endAfterStart': 'end_time muss später als start_time sein',
  'freq.headway':
    'headway_secs „{value}“ muss eine positive ganze Zahl von Sekunden sein',
  'freq.exactTimes': 'exact_times „{value}“ muss 0, 1 oder leer sein',
  'freq.overlap':
    'Taktzeitraum {period} überschneidet sich mit {other} derselben Fahrt',
  'renameRule.empty': 'Die ID darf nicht leer sein',
  'renameRule.whitespace':
    'Die ID darf nicht mit Leerzeichen beginnen oder enden',
  'renameRule.taken': '{table} hat bereits eine Zeile mit der ID „{id}“',
  'renameRule.unchanged': 'Die ID ist unverändert',
  'value.mustBeNumber': 'Muss eine Zahl sein',
  'value.required': 'Dieses Feld ist erforderlich',
  'value.invalid': 'Ungültiger Wert',
  'value.month': 'Der Monat muss zwischen 01 und 12 liegen',
  'value.day': 'Der Tag muss zwischen 01 und 31 liegen',
  'value.year': 'Das Jahr muss zwischen 1900 und 2200 liegen',
  'value.timeNumbers': 'Die Uhrzeit muss gültige Zahlen enthalten',
  'value.minutes': 'Die Minuten müssen zwischen 00 und 59 liegen',
  'value.seconds': 'Die Sekunden müssen zwischen 00 und 59 liegen',
  'value.hoursNegative': 'Die Stunden dürfen nicht negativ sein',
  'value.validNumber': 'Muss eine gültige Zahl sein',
  'value.validInteger': 'Muss eine gültige ganze Zahl sein',
  'value.integerNoDecimals':
    'Muss eine ganze Zahl sein (ohne Nachkommastellen)',
  'value.languageCode': 'Muss ein gültiger Sprachcode nach IETF BCP 47 sein',
  'value.currencyCode':
    'Muss ein dreistelliger Währungscode nach ISO 4217 sein',
  'value.decimalAmount': 'Muss ein gültiger Dezimalbetrag sein',
  'value.hexColor': 'Muss eine sechsstellige Hexadezimalfarbe sein',
  'value.dateFormat': 'Muss im Format JJJJMMTT sein',
  'value.timeFormat': 'Muss im Format HH:MM:SS sein',
  'value.fieldError': '{field}: {message}',
  'value.url':
    'Muss eine vollständige URL sein, die mit http:// oder https:// beginnt',
  'value.email': 'Muss eine gültige E-Mail-Adresse sein',
  'value.nonNegative': 'Muss 0 oder größer sein',
  'value.positive': 'Muss größer als 0 sein',
  'value.notZero': 'Darf nicht 0 sein',
  'value.unknownType': 'Unbekannter Feldtyp: {type}',
  'value.invalidFormat': 'Ungültiges Format für {type}. {description}',
  'value.min': 'Der Wert muss >= {min} sein',
  'value.max': 'Der Wert muss <= {max} sein',
  'shapeGeo.noGeometry': 'Dieses Feature hat keine Geometrie.',
  'shapeGeo.multiLine':
    'Ein Linienverlauf ist eine einzelne Linie, dieser MultiLineString hat aber {count} Teile. Fügen Sie sie zuerst zu einem einzigen LineString zusammen.',
  'shapeGeo.notLine':
    'Ein Linienverlauf ist eine Linie, dieses Feature ist aber ein {type}. Zeichnen Sie stattdessen einen LineString.',
  'shapeGeo.tooFew':
    'Ein Linienverlauf braucht mindestens zwei Punkte, diese Linie hat {count}.',
  'shapeGeo.badPoint': 'Punkt {n} hat eine nicht numerische Koordinate.',
  'geoIo.decompress':
    'Die Nutzdaten von geojson.io konnten nicht entpackt werden: {message}',
  'geoIo.encoding':
    'Nicht unterstützte Kodierung der geojson.io-Nutzdaten: Präfix „{gz}“ oder „{json}“ erwartet.',
  'geoIo.nothingPasted': 'Nichts eingefügt.',
  'geoIo.notUrl': 'Das lässt sich nicht als URL lesen.',
  'geoIo.noData':
    'Diese geojson.io-URL enthält keinen Parameter `data`. Zeichnen Sie zuerst etwas oder fügen Sie das GeoJSON selbst ein.',
  'geoIo.notCollection': 'GeoJSON-FeatureCollection erwartet, {type} erhalten.',
  'gpx.noPoints': 'Keine Trackpunkte in der GPX-Datei gefunden',
  'gpx.noValidPoints': 'Keine gültigen Trackpunkte in der GPX-Datei gefunden',
  'coords.invalid': 'Ungültige Koordinaten: lat={lat}, lng={lng}',
  'coords.lat':
    'Ungültiger Breitengrad: {lat}. Muss zwischen -90 und 90 liegen',
  'coords.lng':
    'Ungültiger Längengrad: {lng}. Muss zwischen -180 und 180 liegen',
};
