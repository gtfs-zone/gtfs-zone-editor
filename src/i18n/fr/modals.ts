import type { Translation } from 'gtfs-zone-web-common/i18n/index';
import type { modals as en } from '../en/modals';

/** Fares, feed data and on-demand modals, in French. */
export const modals: Translation<typeof en> = {
  'fares.missingMember': '{id} (absent de {table})',
  'fares.editMembers': 'Modification de {label} dans {table}',
  'fares.specificDates': 'Dates spécifiques',
  'fares.group.Definitions': 'Définitions',
  'fares.group.Rules': 'Règles',
  'fares.group.Geography': 'Géographie',
  'fares.timeframes': 'Plages horaires',
  'fares.timeframesHint':
    "Ajoutez une ligne par intervalle. Les lignes partageant un timeframe_group_id forment un groupe, qu'une règle tarifaire par trajet peut ensuite citer.",
  'fares.riderCategories': 'Catégories de voyageurs',
  'fares.riderCategoriesHint':
    'Ajoutez-en une pour tarifer différemment, par exemple, les seniors ou les étudiants.',
  'fares.media': 'Supports tarifaires',
  'fares.mediaHint':
    "Ajoutez-en un pour décrire le support d'un titre : un ticket papier, une carte de transport, un téléphone.",
  'fares.products': 'Produits tarifaires',
  'fares.productsHint': 'Ajoutez-en un pour donner un prix à un tarif.',
  'fares.legRules': 'Règles tarifaires par trajet',
  'fares.legRulesHint':
    'Ajoutez-en une pour indiquer quel produit tarifaire paie un trajet. Un réseau ou un secteur vide correspond à tout ce que les autres règles ne citent pas.',
  'fares.legJoinRules': 'Règles de jonction de trajets',
  'fares.legJoinRulesHint':
    'Ajoutez-en une pour tarifer deux trajets reliés par une correspondance comme un seul trajet.',
  'fares.legJoinRulesNote':
    "Les champs d'arrêt vont ensemble : renseignez les deux, ou aucun. Seuls les arrêts et les stations peuvent être cités.",
  'fares.transferRules': 'Règles tarifaires de correspondance',
  'fares.transferRulesHint':
    'Ajoutez-en une pour tarifer la correspondance entre deux groupes de trajets.',
  'fares.transferRulesNote':
    "Une règle de correspondance définie de from_leg_group_id vers to_leg_group_id ne s'applique pas dans le sens inverse. Les champs de durée vont ensemble : renseignez les deux, ou aucun.",
  'fares.areas': 'Secteurs',
  'fares.areasHint':
    "Un secteur est le groupe d'arrêts où commence ou finit une règle tarifaire par trajet.",
  'fares.areasNote':
    "Les arrêts rejoignent un secteur ici ou sur la page de l'arrêt. Une station dans un secteur y entraîne ses quais, sauf si un quai est affecté à un secteur propre ; seuls les arrêts cités directement sont listés.",
  'fares.stops': 'Arrêts',
  'fares.andPlatforms': ', et ses quais',
  'fares.networks': 'Réseaux',
  'fares.networksHint':
    "Un réseau est le groupe de lignes auquel s'applique une règle tarifaire par trajet.",
  'fares.networksNote':
    'Les lignes rejoignent un réseau ici ou sur la page de la ligne. Nommer un réseau fait exporter networks.txt et route_networks.txt ; un réseau sans nom est exporté comme une colonne network_id dans routes.txt.',
  'fares.routes': 'Lignes',
  'fares.intro':
    "Fares v2 : les produits qu'un voyageur peut acheter, les règles qui en tirent le prix d'un parcours, et la géographie à laquelle ces règles font référence. Fares v1 ({files}) ne se modifie pas ici : ouvrez ces tables dans la visionneuse de fichiers.",
  'fares.reference': 'Référence GTFS',
  'fares.title': 'Tarifs',
  'attributions.title': 'Attributions',
  'attributions.note':
    "Laissez agency_id, route_id et trip_id vides pour attribuer tout le jeu de données ; en renseigner un limite l'attribution à celui-ci. Au moins un de is_producer, is_operator et is_authority devrait valoir 1.",
  'attributions.hint':
    'Ajoutez-en une pour créditer une organisation pour le jeu de données, ou pour une agence, une ligne ou un voyage de celui-ci.',
  'attributions.oneScope':
    'Un seul de agency_id, route_id ou trip_id peut être renseigné ({found} trouvés)',
  'transfers.title': 'Correspondances',
  'transfers.note':
    "Les lignes sont regroupées par la station de leur arrêt de départ. Les types de correspondance 4 et 5 relient deux voyages du même véhicule et citent des voyages au lieu d'arrêts. Une correspondance depuis une station s'applique à tous ses arrêts enfants.",
  'transfers.tripToTrip': 'Voyage à voyage',
  'transfers.type': 'Type {type}',
  'transfers.rows_one': '{count} ligne',
  'transfers.rows_other': '{count} lignes',
  'transfers.groupsShown': '{shown} groupes sur {total}',
  'transfers.total': '{transfers} dans {groups}',
  'transfers.count_one': '{count} correspondance',
  'transfers.count_other': '{count} correspondances',
  'transfers.groups_one': '{count} groupe',
  'transfers.groups_other': '{count} groupes',
  'transfers.noMatch': 'Aucune station ne correspond à la recherche.',
  'transfers.empty':
    "Aucune correspondance pour l'instant. Ajoutez-en une ci-dessus pour garantir une correspondance, lui donner un temps minimum ou l'interdire.",
  'transfers.new': 'Nouvelle correspondance',
  'transfers.search': 'Rechercher des stations et des arrêts',
  'translations.title': 'Traductions',
  'translations.intro':
    'Les traductions des textes du flux. Choisissez un champ pour traduire ses valeurs par langue, ou ouvrez Toutes les lignes pour les lignes brutes.',
  'translations.matrixNote':
    "Par valeur traduit chaque enregistrement contenant le même texte ; par enregistrement traduit un seul enregistrement et l'emporte sur une traduction par valeur. Les traductions sont enregistrées et exportées, mais pas encore appliquées aux libellés affichés dans l'application.",
  'translations.rawNote':
    "record_id est le premier champ de la clé primaire de la table citée ; il n'est pas vérifié par rapport à cette table, puisque la table citée varie d'une ligne à l'autre.",
  'translations.hint':
    "Ajoutez-en une par valeur traduite. Désignez ce qu'il faut traduire soit par record_id, soit par field_value pour traduire chaque champ contenant exactement cette valeur.",
  'translations.byValue': 'Par valeur',
  'translations.byRecord': 'Par enregistrement',
  'translations.coverage': '{lang} {done} / {total} traduits',
  'translations.search': 'Rechercher du texte',
  'translations.untranslatedOnly': 'Non traduits uniquement',
  'translations.addLanguage': 'Ajouter une langue',
  'translations.searchLanguages': 'Rechercher une langue',
  'translations.allFields': 'Tous les champs',
  'translations.allRows': 'Toutes les lignes',
  'translations.searchAll': 'Rechercher dans toutes les colonnes',
  'translations.more': '{count} de plus, affinez la recherche.',
  'translations.original': 'Original',
  'translations.originalLang': 'Original ({lang})',
  'translations.field': 'Champ',
  'translations.usedBy': 'Utilisé par',
  'translations.record': 'Enregistrement',
  'translations.sameAsFeedLang':
    'Identique à feed_lang : ces traductions remplacent le texte original pour {lang}',
  'translations.newLanguage':
    "Nouvelle langue : elle est conservée dès qu'une de ses cellules est remplie",
  'translations.inherited':
    'Issu de la traduction par valeur ; saisir ici la remplace pour cet enregistrement',
  'translations.overridesTitle':
    "Enregistrements ayant leur propre traduction, qui l'emporte",
  'translations.overrides_one': '{count} remplacement',
  'translations.overrides_other': '{count} remplacements',
  'translations.noValues': "Aucun enregistrement n'a de valeur dans ce champ.",
  'translations.noMatch': 'Aucune ligne ne correspond.',
  'translations.noRow': 'Aucune ligne {key}',
  'translations.exists': 'Une traduction avec ces valeurs de clé existe déjà',
  'translations.forbiddenFeedInfo':
    '{field} est interdit quand table_name vaut feed_info',
  'translations.exclusive':
    "record_id et field_value s'excluent mutuellement : renseignez l'un ou l'autre",
  'translations.eitherRequired': 'record_id ou field_value est obligatoire',
  'translations.subIdNeedsId': 'record_sub_id nécessite record_id',
  'translations.stopTimesSubId':
    'record_sub_id (le stop_sequence) est obligatoire pour traduire stop_times par record_id',
  'flex.zonesHint':
    'Une zone est un secteur où un voyageur peut être pris en charge ou déposé. Les zones arrivent en important un flux avec locations.geojson, ou vous pouvez en tracer une dans geojson.io et la créer ici.',
  'flex.name': 'Nom',
  'flex.geometry': 'Géométrie',
  'flex.newZone': 'Nouvelle zone',
  'flex.zoneNamePlaceholder': 'par ex. Secteur nord',
  'flex.geometryHint':
    'Tracez la zone dans geojson.io, puis Share et collez le lien ici. Une Feature Polygon ou MultiPolygon, ou une FeatureCollection en contenant une, fonctionne aussi.',
  'flex.idRequired': 'location_id est obligatoire.',
  'flex.needsPolygon':
    'Une zone doit être un Polygon ou un MultiPolygon, reçu : {type}.',
  'flex.emptyPolygon':
    "Ce polygone n'a pas de coordonnées. Tracez d'abord la zone.",
  'flex.bookingRules': 'Règles de réservation',
  'flex.bookingRulesHint':
    "Ajoutez-en une pour indiquer combien de temps à l'avance un voyageur doit réserver, et comment. Un stop_time la cite ensuite comme règle de prise en charge ou de dépose.",
  'flex.bookingRulesNote':
    "Les champs de préavis applicables dépendent de booking_type : temps réel (0) n'en prend aucun, le jour même (1) prend une durée en minutes, la veille (2) prend un dernier jour et une heure.",
  'flex.locationGroups': "Groupes d'emplacements",
  'flex.locationGroupsHint':
    "Un groupe d'emplacements est l'ensemble des arrêts où un voyageur peut demander une prise en charge ou une dépose. Ajoutez-en un, puis rattachez-y ses arrêts dans la colonne Arrêts.",
  'flex.locationGroupsNote':
    "Les arrêts rejoignent un groupe d'emplacements ici ou sur la page du groupe. Un location_group_id partage un même espace d'identifiants avec stops.stop_id et l'id de locations.geojson, et ne peut donc entrer en conflit avec aucun des deux.",
  'flex.zones': 'Zones',
  'flex.zonesNote':
    'La liste des zones est en lecture seule ici. Ouvrez une zone pour voir sa géométrie et la modifier dans geojson.io.',
  'flex.group.Booking': 'Réservation',
  'flex.group.Geography': 'Géographie',
  'flex.intro':
    "Service à la demande (GTFS Flex) : les règles de réservation, les groupes d'arrêts desservis et les zones desservies. Un voyage devient à la demande dans ses horaires, en donnant à un stop_time une plage de prise en charge et de dépose au lieu d'une arrivée et d'un départ.",
  'flex.title': 'Transport à la demande',
};
