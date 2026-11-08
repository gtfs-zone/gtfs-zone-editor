import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { modals as en } from '../en/modals';

/** Fares, feed data and on-demand modals, in German. */
export const modals: Translation<typeof en> = {
  'fares.missingMember': '{id} (fehlt in {table})',
  'fares.editMembers': '{label} in {table} bearbeiten',
  'fares.specificDates': 'Bestimmte Daten',
  'fares.group.Definitions': 'Definitionen',
  'fares.group.Rules': 'Regeln',
  'fares.group.Geography': 'Geografie',
  'fares.timeframes': 'Zeitfenster',
  'fares.timeframesHint':
    'Legen Sie eine Zeile pro Intervall an. Zeilen mit derselben timeframe_group_id bilden eine Gruppe, die eine Tarifregel für Teilstrecken dann nennen kann.',
  'fares.riderCategories': 'Fahrgastkategorien',
  'fares.riderCategoriesHint':
    'Legen Sie eine an, um Tarife zum Beispiel für Senioren oder Studierende unterschiedlich zu bepreisen.',
  'fares.media': 'Fahrtberechtigungsmedien',
  'fares.mediaHint':
    'Legen Sie eines an, um zu beschreiben, worauf ein Tarif getragen wird: ein Papierticket, eine Chipkarte, ein Telefon.',
  'fares.products': 'Tarifprodukte',
  'fares.productsHint':
    'Legen Sie eines an, um einem Tarif einen Preis zu geben.',
  'fares.legRules': 'Tarifregeln für Teilstrecken',
  'fares.legRulesHint':
    'Legen Sie eine an, um festzulegen, welches Tarifprodukt eine Teilstrecke bezahlt. Ein leeres Netz oder ein leerer Bereich passt auf alles, was die anderen Regeln nicht nennen.',
  'fares.legJoinRules': 'Regeln zum Zusammenfassen von Teilstrecken',
  'fares.legJoinRulesHint':
    'Legen Sie eine an, damit zwei Teilstrecken über einen Umstieg hinweg wie eine einzige Teilstrecke bepreist werden.',
  'fares.legJoinRulesNote':
    'Die Haltestellenfelder gehören zusammen: Nennen Sie beide oder keines. Nur Haltestellen und Stationen dürfen genannt werden.',
  'fares.transferRules': 'Tarifregeln für Umstiege',
  'fares.transferRulesHint':
    'Legen Sie eine an, um den Umstieg zwischen zwei Teilstreckengruppen zu bepreisen.',
  'fares.transferRulesNote':
    'Eine Tarifregel für Umstiege von from_leg_group_id nach to_leg_group_id gilt nicht in umgekehrter Richtung. Die Felder für die Dauer gehören zusammen: Setzen Sie beide oder keines.',
  'fares.areas': 'Bereiche',
  'fares.areasHint':
    'Ein Bereich ist die Gruppe von Haltestellen, in der eine Tarifregel für Teilstrecken beginnt oder endet.',
  'fares.areasNote':
    'Haltestellen werden hier oder auf der Seite der Haltestelle einem Bereich zugeordnet. Eine Station in einem Bereich nimmt ihre Bahnsteige mit, sofern ein Bahnsteig nicht einem eigenen Bereich zugeordnet ist; aufgeführt sind nur die direkt genannten Haltestellen.',
  'fares.stops': 'Haltestellen',
  'fares.andPlatforms': ' samt Bahnsteigen',
  'fares.networks': 'Netze',
  'fares.networksHint':
    'Ein Netz ist die Gruppe von Linien, für die eine Tarifregel für Teilstrecken gilt.',
  'fares.networksNote':
    'Linien werden hier oder auf der Seite der Linie einem Netz zugeordnet. Hat ein Netz einen Namen, exportiert der Feed networks.txt und route_networks.txt; ein unbenanntes Netz wird stattdessen als Spalte network_id in routes.txt exportiert.',
  'fares.routes': 'Linien',
  'fares.intro':
    'Fares v2: die Produkte, die Fahrgäste kaufen können, die Regeln, die daraus den Preis einer Reise ergeben, und die Geografie, auf die sich diese Regeln beziehen. Fares v1 ({files}) wird hier nicht bearbeitet: Öffnen Sie diese Tabellen in der Dateiansicht.',
  'fares.reference': 'GTFS-Referenz',
  'fares.title': 'Tarife',
  'attributions.title': 'Quellenangaben',
  'attributions.note':
    'Lassen Sie agency_id, route_id und trip_id leer, um den gesamten Datensatz zu würdigen; ist eines gesetzt, gilt die Quellenangabe nur dafür. Mindestens eines von is_producer, is_operator und is_authority sollte 1 sein.',
  'attributions.hint':
    'Legen Sie eine an, um eine Organisation für den Datensatz oder für ein Verkehrsunternehmen, eine Linie oder eine Fahrt darin zu nennen.',
  'attributions.oneScope':
    'Nur eines von agency_id, route_id oder trip_id darf gesetzt sein (gefunden: {found})',
  'transfers.title': 'Umstiege',
  'transfers.note':
    'Die Zeilen sind nach der Station ihrer Abgangshaltestelle gruppiert. Die Umstiegstypen 4 und 5 verbinden zwei Fahrten desselben Fahrzeugs und nennen Fahrten statt Haltestellen. Ein Umstieg von einer Station gilt für alle ihre untergeordneten Haltestellen.',
  'transfers.tripToTrip': 'Fahrt zu Fahrt',
  'transfers.type': 'Typ {type}',
  'transfers.rows_one': '{count} Zeile',
  'transfers.rows_other': '{count} Zeilen',
  'transfers.groupsShown': '{shown} von {total} Gruppen',
  'transfers.total': '{transfers} in {groups}',
  'transfers.count_one': '{count} Umstieg',
  'transfers.count_other': '{count} Umstiege',
  'transfers.groups_one': '{count} Gruppe',
  'transfers.groups_other': '{count} Gruppen',
  'transfers.noMatch': 'Keine Station passt zur Suche.',
  'transfers.empty':
    'Noch keine Umstiege. Legen Sie oben einen an, um einen Anschluss zu garantieren, ihm eine Mindestzeit zu geben oder ihn auszuschließen.',
  'transfers.new': 'Neuer Umstieg',
  'transfers.search': 'Stationen und Haltestellen suchen',
  'translations.title': 'Übersetzungen',
  'translations.intro':
    'Die Übersetzungen der Texte im Feed. Wählen Sie ein Feld, um seine Werte nach Sprache zu übersetzen, oder öffnen Sie „Alle Zeilen“ für die Rohdaten.',
  'translations.matrixNote':
    '„Nach Wert“ übersetzt jeden Datensatz mit demselben Text; „Nach Datensatz“ übersetzt einen einzelnen Datensatz und hat Vorrang vor einer Übersetzung nach Wert. Übersetzungen werden gespeichert und exportiert, aber noch nicht auf die Beschriftungen in der App angewendet.',
  'translations.rawNote':
    'record_id ist das erste Feld des Primärschlüssels der genannten Tabelle; es wird nicht gegen diese Tabelle geprüft, da die genannte Tabelle von Zeile zu Zeile variiert.',
  'translations.hint':
    'Legen Sie eine pro übersetztem Wert an. Benennen Sie das zu Übersetzende entweder über record_id oder über field_value, um jedes Feld mit genau diesem Wert zu übersetzen.',
  'translations.byValue': 'Nach Wert',
  'translations.byRecord': 'Nach Datensatz',
  'translations.coverage': '{lang} {done} / {total} übersetzt',
  'translations.search': 'Text suchen',
  'translations.untranslatedOnly': 'Nur unübersetzte',
  'translations.addLanguage': 'Sprache hinzufügen',
  'translations.searchLanguages': 'Sprachen suchen',
  'translations.allFields': 'Alle Felder',
  'translations.allRows': 'Alle Zeilen',
  'translations.searchAll': 'Alle Spalten durchsuchen',
  'translations.more': '{count} weitere, verfeinern Sie die Suche.',
  'translations.original': 'Original',
  'translations.originalLang': 'Original ({lang})',
  'translations.field': 'Feld',
  'translations.usedBy': 'Verwendet von',
  'translations.record': 'Datensatz',
  'translations.sameAsFeedLang':
    'Gleich wie feed_lang: Diese Übersetzungen ersetzen den Originaltext für {lang}',
  'translations.newLanguage':
    'Neue Sprache: Sie bleibt erhalten, sobald eine ihrer Zellen ausgefüllt ist',
  'translations.inherited':
    'Aus der Übersetzung nach Wert; eine Eingabe hier ersetzt sie für diesen Datensatz',
  'translations.overridesTitle':
    'Datensätze mit eigener Übersetzung, die Vorrang hat',
  'translations.overrides_one': '{count} Ersetzung',
  'translations.overrides_other': '{count} Ersetzungen',
  'translations.noValues': 'Kein Datensatz hat einen Wert in diesem Feld.',
  'translations.noMatch': 'Keine Zeile passt.',
  'translations.noRow': 'Keine Zeile {key}',
  'translations.languageExists': '{lang} ist bereits eine Spalte',
  'translations.exists':
    'Eine Übersetzung mit diesen Schlüsselwerten existiert bereits',
  'translations.forbiddenFeedInfo':
    '{field} ist nicht erlaubt, wenn table_name feed_info ist',
  'translations.exclusive':
    'record_id und field_value schließen sich gegenseitig aus: Setzen Sie nur eines davon',
  'translations.eitherRequired':
    'Entweder record_id oder field_value ist erforderlich',
  'translations.subIdNeedsId': 'record_sub_id erfordert record_id',
  'translations.stopTimesSubId':
    'record_sub_id (die stop_sequence) ist erforderlich, wenn stop_times über record_id übersetzt werden',
  'flex.zonesHint':
    'Eine Zone ist ein Gebiet, in dem Fahrgäste abgeholt oder abgesetzt werden können. Zonen kommen über den Import eines Feeds mit locations.geojson, oder Sie zeichnen eine in geojson.io und legen sie hier an.',
  'flex.name': 'Name',
  'flex.geometry': 'Geometrie',
  'flex.newZone': 'Neue Zone',
  'flex.zoneNamePlaceholder': 'z. B. Bediengebiet Nord',
  'flex.geometryHint':
    'Zeichnen Sie die Zone in geojson.io, wählen Sie dann „Share“ und fügen Sie den Link hier ein. Ein Polygon- oder MultiPolygon-Feature oder eine FeatureCollection mit einem solchen funktioniert ebenfalls.',
  'flex.idRequired': 'location_id ist erforderlich.',
  'flex.needsPolygon':
    'Eine Zone braucht ein Polygon oder MultiPolygon, {type} erhalten.',
  'flex.emptyPolygon':
    'Dieses Polygon hat keine Koordinaten. Zeichnen Sie zuerst die Zone.',
  'flex.bookingRules': 'Buchungsregeln',
  'flex.bookingRulesHint':
    'Legen Sie eine an, um festzulegen, wie lange im Voraus und auf welchem Weg Fahrgäste buchen müssen. Eine stop_time nennt sie dann als Regel für Abholung oder Absetzen.',
  'flex.bookingRulesNote':
    'Welche Vorlauffelder gelten, hängt von booking_type ab: Echtzeit (0) braucht keine, am selben Tag (1) eine Dauer in Minuten, am Vortag (2) einen letzten Tag und eine Uhrzeit.',
  'flex.locationGroups': 'Ortsgruppen',
  'flex.locationGroupsHint':
    'Eine Ortsgruppe ist die Menge der Haltestellen, an denen Fahrgäste eine Abholung oder ein Absetzen anfordern können. Legen Sie eine an und ordnen Sie dann ihre Haltestellen in der Spalte „Haltestellen“ zu.',
  'flex.locationGroupsNote':
    'Haltestellen werden hier oder auf der Seite der Ortsgruppe zugeordnet. Eine location_group_id teilt sich einen ID-Namensraum mit stops.stop_id und der id in locations.geojson und darf daher mit keiner davon kollidieren.',
  'flex.zones': 'Zonen',
  'flex.zonesNote':
    'Die Zonenliste ist hier schreibgeschützt. Öffnen Sie eine Zone, um ihre Geometrie zu sehen und sie in geojson.io zu bearbeiten.',
  'flex.group.Booking': 'Buchung',
  'flex.group.Geography': 'Geografie',
  'flex.intro':
    'Bedarfsverkehr (GTFS Flex): die Regeln, nach denen Fahrgäste buchen, die Haltestellengruppen, an denen sie bedient werden können, und die Zonen, in denen sie bedient werden können. Eine Fahrt wird im Fahrplan zum Bedarfsverkehr, indem eine stop_time statt Ankunft und Abfahrt ein Abhol- und Absetzfenster erhält.',
  'flex.title': 'Bedarfsverkehr',
};
