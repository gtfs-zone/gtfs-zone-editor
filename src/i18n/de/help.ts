import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { help as en } from '../en/help';

/** Guide pages, in German. */
export const help: Translation<typeof en> = {
  'help.welcome.label': 'Willkommen',
  'help.welcome.title': 'GTFS-Feed laden, bearbeiten und exportieren',
  'help.intro':
    'edit.gtfs.zone ist ein browserbasierter Editor für GTFS-Fahrplandaten. Alle Daten bleiben in Ihrem Browser. Kein Server, kein Konto nötig.',
  'help.welcome.load': 'Feed laden',
  'help.welcome.loadText': 'Von einer URL oder aus einer lokalen Datei.',
  'help.welcome.edit': 'Jede Tabelle bearbeiten',
  'help.welcome.editText':
    'Verkehrsunternehmen, Linien, Haltestellen, Fahrten und jede andere Datei.',
  'help.welcome.place': 'Haltestellen auf der Karte setzen',
  'help.welcome.placeText':
    'Haltestellen direkt auf der Karte hinzufügen und platzieren.',
  'help.welcome.check': 'Feed prüfen',
  'help.welcome.checkText':
    'Laufende Validierung gegen die GTFS-Spezifikation.',
  'help.welcome.export': 'ZIP exportieren',
  'help.welcome.exportText':
    'Laden Sie einen veröffentlichungsfertigen GTFS-Feed herunter.',
  'help.welcome.hover':
    'Fahren Sie mit der Maus über eine Eigenschaft, um ihre GTFS-Beschreibung zu sehen; klicken Sie auf den Namen der Eigenschaft, um die offizielle GTFS-Referenz zu öffnen.',
  'help.welcome.start': 'Los geht’s!',
  'help.new.label': 'Einen neuen Feed erstellen',
  'help.new.title': 'Einen Feed von Grund auf aufbauen',
  'help.new.lede':
    'Jedes Objekt unten verweist auf das darüber; wenn Sie in dieser Reihenfolge vorgehen, bleibt alles verbunden.',
  'help.new.start': 'Mit dem Bearbeiten beginnen',
  'help.new.feedInfo': 'Feed-Informationen ausfüllen',
  'help.new.agency': 'Verkehrsunternehmen hinzufügen',
  'help.new.services': 'Einige Services hinzufügen',
  'help.new.servicesText': 'Die Tage, an denen der Service verkehrt.',
  'help.new.routes': 'Linien unter dem Verkehrsunternehmen hinzufügen',
  'help.new.trip': 'Eine Linie mit einem Service verbinden',
  'help.new.tripText': 'Dazu legen Sie eine Fahrt an.',
  'help.new.stopTimes': 'Haltestellen und Zeiten hinzufügen',
  'help.new.stopTimesText': 'Füllen Sie die Haltezeiten dieser Fahrt aus.',
  'help.specReference': 'Referenz der Spezifikation: {links}.',
  'help.spec.feedInfo': 'Feed-Informationen',
  'help.spec.agencies': 'Verkehrsunternehmen',
  'help.spec.calendar': 'Kalender',
  'help.spec.routes': 'Linien',
  'help.spec.trips': 'Fahrten',
  'help.spec.stopTimes': 'Haltezeiten',
  'help.spec.shapes': 'Linienverläufe',
  'help.spec.fareProducts': 'Tarifprodukte',
  'help.spec.fareMedia': 'Fahrtberechtigungsmedien',
  'help.spec.fareLegRules': 'Tarifregeln für Teilstrecken',
  'help.spec.locations': 'Zonen',
  'help.spec.bookingRules': 'Buchungsregeln',
  'help.spec.locationGroups': 'Ortsgruppen',
  'help.revisit':
    'Sie können dies jederzeit über das Menü „Anleitung“ erneut aufrufen.',
  'help.shapes.label': 'Linienverläufe',
  'help.shapes.title': 'Linienverläufe erstellen',
  'help.shapes.lede':
    'Ein Linienverlauf ist der Weg, dem ein Fahrzeug auf der Karte folgt. Er ist unabhängig von der Abfolge der Haltestellen einer Fahrt.',
  'help.shapes.stops': 'Zuerst die Haltestellen setzen',
  'help.shapes.stopsText':
    'Bringen Sie die Haltestellen Ihrer Linie an die richtigen Stellen.',
  'help.shapes.brouter': 'Den Weg in BRouter planen',
  'help.shapes.brouterText':
    'Öffnen Sie eine Fahrt im Fahrplan dieser Linie und klicken Sie auf „In BRouter öffnen“.',
  'help.shapes.gpx': 'Als GPX exportieren',
  'help.shapes.gpxText':
    'Exportieren Sie den geplanten Weg aus BRouter als GPX-Datei.',
  'help.shapes.import': 'Den Linienverlauf importieren',
  'help.shapes.importText':
    'Importieren Sie diese GPX-Datei hier in der Verwaltung der Linienverläufe. Dieselbe Schaltfläche nimmt auch einen GTFS-Feed an, um einen Linienverlauf aus einem bestehenden Feed zu übernehmen.',
  'help.shapes.link': 'Den Linienverlauf verknüpfen',
  'help.shapes.linkText':
    'Verknüpfen Sie den importierten Linienverlauf mit Ihren Fahrten.',
  'help.fares.label': 'Tarife',
  'help.fares.title': 'Tarife in Ihrem GTFS-Feed angeben',
  'help.fares.lede':
    'Dieser Editor verwendet GTFS-Fares V2. Einige Objekte beschreiben gemeinsam, was Fahrgäste bezahlen.',
  'help.fares.products': 'Tarifprodukte definieren',
  'help.fares.productsText':
    'Das, was Fahrgäste kaufen können, etwa eine Einzelfahrt oder eine Tageskarte.',
  'help.fares.media':
    'Fahrtberechtigungsmedien und Fahrgastkategorien definieren',
  'help.fares.mediaText':
    'Worauf ein Produkt getragen wird (z. B. eine Karte, Bargeld, eine App) und wer dazu berechtigt ist (z. B. Erwachsene, Senioren, Studierende).',
  'help.fares.legs': 'Tarifregeln für Teilstrecken hinzufügen',
  'help.fares.legsText':
    'Wenden Sie Ihre Tarifprodukte auf bestimmte Teilstrecken einer Reise an.',
  'help.onDemand.label': 'Bedarfsverkehr',
  'help.onDemand.title': 'Bedarfsverkehr beschreiben (GTFS Flex)',
  'help.onDemand.lede':
    'Bedarfsverkehr ist ein Angebot, das Fahrgäste buchen, statt es zu einer festen Zeit zu erreichen. GTFS Flex beschreibt ihn mit einigen Bausteinen, die an eine gewöhnliche Fahrt anschließen.',
  'help.onDemand.zone': 'Eine Zone ist ein Gebiet, keine Haltestelle',
  'help.onDemand.zoneText':
    'Ein auf der Karte gezeichnetes Polygon, innerhalb dessen Fahrgäste überall abgeholt oder abgesetzt werden können. Zonen stehen in locations.geojson, nicht in stops.txt.',
  'help.onDemand.group': 'Eine Ortsgruppe ist eine Menge von Haltestellen',
  'help.onDemand.groupText':
    'Bedient das Angebot eine Handvoll benannter Haltestellen statt eines ganzen Gebiets, fassen Sie diese Haltestellen zu einer Gruppe zusammen, statt eine Zone zu zeichnen.',
  'help.onDemand.booking': 'Eine Buchungsregel sagt, wie gebucht wird',
  'help.onDemand.bookingText':
    'Wie lange im Voraus Fahrgäste anrufen oder tippen müssen, und wo. In Echtzeit, am selben Tag oder bis zu einer Frist an einem Vortag.',
  'help.onDemand.stopTime': 'Eine stop_time verbindet sie mit einer Fahrt',
  'help.onDemand.stopTimeText':
    'Geben Sie einer stop_time statt Ankunft und Abfahrt ein Abhol- und Absetzfenster, lassen Sie sie auf eine Zone oder Ortsgruppe verweisen und nennen Sie die Buchungsregel, die sie verwendet.',
  'help.about.subject': 'Feedback zu edit.gtfs.zone',
  'help.about.sibling':
    'einen GTFS-Realtime-Feed auf einer Live-Karte verfolgen',
  'help.mapKey.label': 'Legende',
  'help.mapKey.title': 'Die Kartensymbole lesen',
  'help.mapKey.unlocated': 'Knoten ohne Standort',
  'help.mapKey.pathways': 'Wege',
  'help.publish.label': 'Ihren Feed veröffentlichen',
  'help.publish.title': 'Ihren Feed veröffentlichen',
  'help.publish.lede':
    'Ein GTFS-Feed ist erst nützlich, wenn Fahrgäste und ihre Apps ihn erreichen können. Mit wenigen Schritten wird aus der gerade exportierten Datei ein veröffentlichter Feed.',
  'help.publish.validator': 'Mit dem {link} validieren',
  'help.publish.validatorLink': 'offiziellen GTFS-Validator',
  'help.publish.validatorText': 'Findet alles, was dieser Editor nicht prüft.',
  'help.publish.license': 'Die Lizenz des Quell-Feeds beibehalten',
  'help.publish.licenseText':
    'Wenn Sie vom Feed eines anderen ausgegangen sind, gilt dessen Lizenz weiterhin für das, was Sie veröffentlichen. Nennen Sie die Quelle in attributions.txt.',
  'help.publish.host': 'Das ZIP unter einer stabilen URL bereitstellen',
  'help.publish.hostText':
    'An einem Ort, der sich nicht ändert, damit Apps immer die neueste Version abrufen können.',
  'help.publish.register': 'Registrieren, damit Apps Ihren Feed finden',
  'help.publish.registerText':
    'Tragen Sie ihn in {mdb} und {atlas} ein und reichen Sie ihn bei {google} ein.',
  'help.publish.realtime': 'Ihre Fahrzeuge mit {link} verfolgen',
  'help.publish.realtimeText':
    'Ist der Fahrplan veröffentlicht, sind Live-Fahrzeugpositionen, Fahrtaktualisierungen und Störungsmeldungen der nächste Schritt.',
  'help.publish.footnote':
    'Sie können dies jederzeit über das Menü „Anleitung“ erneut aufrufen. {link} beschreibt den gesamten Ablauf.',
  'help.publish.footnoteLink': 'Veröffentlichen auf gtfs.org',
};
