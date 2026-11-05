import {
  ROUTE_TYPE_FAMILIES,
  ROUTE_TYPES,
  routeTypeInfo,
  type RouteTypeInfo,
} from 'gtfs-zone-vocab/route-types';
import type { GTFSEnumValue, GTFSFileSpec } from '../types';
import { routesSpec } from '../files/routes';
import type { GTFSSpecExtension } from './types';

const ID = 'google';

const FAMILY_LABELS = new Map(
  ROUTE_TYPE_FAMILIES.map((f) => [f.slug, f.label.en])
);

/** A Google HVT route_type code as an enum value, grouped by its family. */
function hvtValue(rt: RouteTypeInfo): GTFSEnumValue {
  const group = FAMILY_LABELS.get(rt.family);
  if (!group) {
    throw new Error(`[SpecExtensions] ${ID}: no family ${rt.family}`);
  }
  return {
    value: rt.code,
    label: rt.label.en,
    description: rt.examples ?? '',
    group,
  };
}

const HVT_VALUES = ROUTE_TYPES.filter((rt) => rt.source === 'google-hvt').map(
  hvtValue
);

const BASE_ROUTE_TYPES = routesSpec.fields?.find(
  (f) => f.name === 'route_type'
)?.enumValues;
if (!BASE_ROUTE_TYPES) {
  throw new Error(`[SpecExtensions] ${ID}: routes.txt has no route_type enum`);
}

/** A base route_type as a vehicle_type value, labelled as vocab names it. */
function baseVehicleValue(value: GTFSEnumValue): GTFSEnumValue {
  const info = routeTypeInfo(Number(value.value));
  if (!info) {
    throw new Error(
      `[SpecExtensions] ${ID}: route_type ${value.value} not in vocab`
    );
  }
  return { ...value, label: info.label.en };
}

// Shared by ac_availability, wifi_availability and toilet_availability.
const AVAILABILITY_VALUES: GTFSEnumValue[] = [
  { value: 0, label: 'Unknown', description: 'Default.' },
  { value: 1, label: 'Available anywhere, anytime', description: '' },
  { value: 2, label: 'Not available', description: '' },
];

const FILES: GTFSFileSpec[] = [
  {
    filename: 'ticketing_deep_links.txt',
    presence: 'Optional',
    description:
      'Google Transit ticketing extension.<br><br>Deep links used to ticket the trips of an agency or route.',
    fields: [
      {
        name: 'ticketing_deep_link_id',
        type: 'ID',
        presence: 'Required',
        description:
          'Google Transit ticketing extension.<br><br>The `ticketing_deep_link_id` field represents the identifier of the deep link.',
        isPrimaryKey: true,
      },
      {
        name: 'android_intent_uri',
        type: 'URI',
        presence: 'Optional',
        description:
          "Google Transit ticketing extension.<br><br>The `android_intent_uri` field represents the intent URI that's used for deep linking on Android.",
      },
      {
        name: 'ios_universal_link_url',
        type: 'URL',
        presence: 'Optional',
        description:
          "Google Transit ticketing extension.<br><br>The `ios_universal_link_url` field represents the universal link URL that's used for deep linking on iOS.",
      },
      {
        name: 'web_url',
        type: 'URL',
        presence: 'Optional',
        description:
          "Google Transit ticketing extension.<br><br>The `web_url` field represents the URL that's used for deep linking on the web.",
      },
    ],
  },
  {
    filename: 'ticketing_identifiers.txt',
    presence: 'Optional',
    description:
      'Google Transit ticketing extension.<br><br>Default ticketing IDs of stops.',
    fields: [
      {
        name: 'agency_id',
        type: 'ID',
        presence: 'Required',
        description:
          'Google Transit ticketing extension.<br><br>To specify the agency of the stop that the default `ticketing_stop_id` field is defined for, the `agency_id` field contains the ID from the GTFS [`agency.txt`](https://gtfs.org/schedule/reference/#agencytxt) file.',
        foreignKey: [{ file: 'agency.txt', field: 'agency_id' }],
      },
      {
        name: 'stop_id',
        type: 'ID',
        presence: 'Required',
        description:
          'Google Transit ticketing extension.<br><br>To specify the stop that the default `ticketing_stop_id` field is defined for, the `stop_id` field contains the ID from the GTFS [`stops.txt`](https://gtfs.org/schedule/reference/#stopstxt) file.',
        foreignKey: [{ file: 'stops.txt', field: 'stop_id' }],
      },
      {
        name: 'ticketing_stop_id',
        type: 'ID',
        presence: 'Required',
        description:
          'Google Transit ticketing extension.<br><br>The `ticketing_stop_id` field contains the ticketing ID that is applied to the stop. Optionally, an agency qualifies the ID.',
      },
    ],
  },
  {
    filename: 'vehicle_categories.txt',
    presence: 'Optional',
    description:
      'Google Transit extension.<br><br>Vehicle categories that trips are allotted to.',
    fields: [
      {
        name: 'vehicle_category_id',
        type: 'ID',
        presence: 'Required',
        description:
          'Google Transit extension.<br><br>Identifies a vehicle category.',
        isPrimaryKey: true,
      },
      {
        name: 'vehicle_amenity_id',
        type: 'ID',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Identifies a set of amenities available to all passengers in the vehicle category. Alternatively, see `vehicle_category_amenities.txt ` for when different amenity sets are available in the same vehicle category.',
        foreignKey: [
          { file: 'vehicle_amenities.txt', field: 'vehicle_amenity_id' },
        ],
      },
    ],
  },
  {
    filename: 'vehicle_amenities.txt',
    presence: 'Optional',
    description:
      'Google Transit extension.<br><br>Sets of amenities available on board.',
    fields: [
      {
        name: 'vehicle_amenity_id',
        type: 'ID',
        presence: 'Required',
        description:
          'Google Transit extension.<br><br>Identifies a set of amenities.',
        isPrimaryKey: true,
      },
      {
        name: 'ac_availability',
        type: 'Enum',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines if air conditioning is available.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** Available anywhere, anytime.<br>- **`2`.** Not available.',
        enumValues: AVAILABILITY_VALUES,
      },
      {
        name: 'wifi_availability',
        type: 'Enum',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines if Wifi is available onboard.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** Available anywhere, anytime.<br>- **`2`.** Not available.',
        enumValues: AVAILABILITY_VALUES,
      },
      {
        name: 'toilet_availability',
        type: 'Enum',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines if a toilet is available inside the vehicle.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** Available anywhere, anytime.<br>- **`2`.** Not available.',
        enumValues: AVAILABILITY_VALUES,
      },
      {
        name: 'gender_accessibility',
        type: 'Enum',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines if gender restrictions apply.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** No gender restrictions.<br>- **`2`.** Restricted to women only.<br>- **`3`.** Restricted to men only.',
        enumValues: [
          { value: 0, label: 'Unknown', description: 'Default.' },
          { value: 1, label: 'No gender restrictions', description: '' },
          { value: 2, label: 'Restricted to women only', description: '' },
          { value: 3, label: 'Restricted to men only', description: '' },
        ],
      },
      {
        name: 'seat_type',
        type: 'Enum',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines the type of seat.<br><br>Google accepts the following values:<br>- **`0`.** Default. Seat (not foldable, may be reclining).<br>- **`1`.** Fixed bed (cannot be reclined back as seat).<br>- **`2`.** Reclining seat.',
        enumValues: [
          {
            value: 0,
            label: 'Seat',
            description: 'Default. Not foldable, may be reclining.',
          },
          {
            value: 1,
            label: 'Fixed bed',
            description: 'Cannot be reclined back as seat.',
          },
          { value: 2, label: 'Reclining seat', description: '' },
        ],
      },
      {
        name: 'service_class',
        type: 'Enum',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines the class of the seat.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** First class.<br>- **`2`.** Second class.<br>- **`3`.** Third class.<br>- **`4`.** Business.<br>- **`5`.** Premium Economy.<br>- **`6`.** Economy.',
        enumValues: [
          { value: 0, label: 'Unknown', description: 'Default.' },
          { value: 1, label: 'First class', description: '' },
          { value: 2, label: 'Second class', description: '' },
          { value: 3, label: 'Third class', description: '' },
          { value: 4, label: 'Business', description: '' },
          { value: 5, label: 'Premium Economy', description: '' },
          { value: 6, label: 'Economy', description: '' },
        ],
      },
      {
        name: 'service_class_code',
        type: 'String',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines a short form class code (e.g. 1A for Air-Conditioned First Class). This field is a more specific version of the class field, where the classes not available in the class enum can be specified.',
      },
      {
        name: 'seat_plug',
        type: 'Enum',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines if either an electric or usb plug (of any type) is available at the seat.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** Available at all seats.<br>- **`2`.** Not available.',
        enumValues: [
          { value: 0, label: 'Unknown', description: 'Default.' },
          { value: 1, label: 'Available at all seats', description: '' },
          { value: 2, label: 'Not available', description: '' },
        ],
      },
      {
        name: 'row_layout_summary',
        type: 'String',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines the number of seats or beds in one row of the vehicle. Some examples are: "2" (2 seats in a row, but whether they are separated or next to each other is unknown), "1+1" (2 individual seats in a row), "2+2" (4 seats in a row with a separation in the middle).',
      },
      {
        name: 'row_leg_space',
        type: 'Enum',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>Defines if rows have additional leg space.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown / Not applicable.<br>- **`1`.** Standard leg space.<br>- **`2`.** Additional leg space.',
        enumValues: [
          {
            value: 0,
            label: 'Unknown / Not applicable',
            description: 'Default.',
          },
          { value: 1, label: 'Standard leg space', description: '' },
          { value: 2, label: 'Additional leg space', description: '' },
        ],
      },
    ],
  },
  {
    filename: 'vehicle_category_amenities.txt',
    presence: 'Optional',
    description:
      'Google Transit extension.<br><br>Amenity sets of a vehicle category, for categories with more than one.',
    fields: [
      {
        name: 'vehicle_category_id',
        type: 'ID',
        presence: 'Required',
        description:
          'Google Transit extension.<br><br>Identifies the vehicle category. The same vehicle category can have numerous amenity sets by repeating the value of this field in multiple rows. This is typically helpful when a vehicle category has various classes of service.',
        foreignKey: [
          { file: 'vehicle_categories.txt', field: 'vehicle_category_id' },
        ],
      },
      {
        name: 'vehicle_amenity_id',
        type: 'ID',
        presence: 'Required',
        description:
          'Google Transit extension.<br><br>Identifies a set of amenities available to all passengers in the vehicle category.',
        foreignKey: [
          { file: 'vehicle_amenities.txt', field: 'vehicle_amenity_id' },
        ],
      },
    ],
  },
];

// The prose of both the "Unsupported files" and "Ignored fields" sections.
const NOT_USED =
  "Google Transit ingests this data without error but doesn't proactively use the data.";

/** Google Transit additions, checked against reference/google-reference.md. */
export const googleExtension: GTFSSpecExtension = {
  id: ID,
  sourceUrl: 'https://developers.google.com/transit/gtfs/reference',
  revision: '2025-05-15',
  files: FILES,
  fields: [
    {
      file: 'stops.txt',
      spec: {
        name: 'vehicle_type',
        type: 'Integer',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>The `vehicle_type` field specifies the type of vehicles that are used at a stop. This field accepts hierarchical vehicle type (HVT) route types. The HVT values are derived from the European Transport Protocol Experts Group (TPEG) standard.',
        // Values inside an overlay field are not stamped, so the HVT ones
        // carry their origin here.
        enumValues: [
          ...BASE_ROUTE_TYPES.map(baseVehicleValue),
          ...HVT_VALUES.map((v) => ({ ...v, origin: ID })),
        ],
      },
    },
    {
      file: 'agency.txt',
      after: 'agency_fare_url',
      spec: {
        name: 'ticketing_deep_link_id',
        type: 'ID',
        presence: 'Optional',
        description:
          "Google Transit ticketing extension.<br><br>In the [`agency.txt`](https://gtfs.org/schedule/reference/#agencytxt) file, the `ticketing_deep_link_id` field represents the deep link that's used to ticket the trips of this agency.",
        foreignKey: [
          { file: 'ticketing_deep_links.txt', field: 'ticketing_deep_link_id' },
        ],
      },
    },
    {
      file: 'stops.txt',
      after: 'platform_code',
      spec: {
        name: 'signposted_as',
        type: 'Text',
        presence: 'Optional',
        description:
          'Google Transit extension.<br><br>The `signposted_as` field contains the verbatim text written on the signboard for the platform. Examples are "Towards Central" and "East side & Brooklyn."<br><br>The GTFS `platform_code` field and the Transit-supported `signposted_as` field can be set simultaneously.<br><br>Differences between the `platform_code` and `signposted_as` fields include the following:<br>- **Length.** The `platform_code` field usually contains a number or letter like *2* or *C*.<br>- **Language.** The `platform_code` field doesn\'t have a language, but `signposted_as` values can have translations.<br>- **Stability.** The `platform_code` field changes much less often than the `signposted_as` field.',
      },
    },
    {
      file: 'routes.txt',
      after: 'route_url',
      spec: {
        name: 'ticketing_deep_link_id',
        type: 'ID',
        presence: 'Optional',
        description:
          "Google Transit ticketing extension.<br><br>In the [`routes.txt`](https://gtfs.org/schedule/reference/#routestxt) file, the `ticketing_deep_link_id` field represents the deep link that's used to ticket the trips of this route.",
        foreignKey: [
          { file: 'ticketing_deep_links.txt', field: 'ticketing_deep_link_id' },
        ],
      },
    },
    {
      file: 'routes.txt',
      after: 'continuous_drop_off',
      spec: {
        name: 'checkin_duration',
        type: 'Integer',
        presence: 'Optional',
        description:
          "Google Transit extension.<br><br>The `checkin_duration` field specifies how many seconds early a passenger is advised to arrive before the scheduled departure in order to check in and board.<br><br>If the passenger connects to the departure by a transfer, then any defined transfer time overrides the `checkin_duration` value.<br><br>The `checkin_duration` value is only a recommendation that's usually provided by the transit operator. It might not reflect the absolute last possible moment that a passenger can arrive and still board the vehicle.",
      },
    },
    {
      file: 'trips.txt',
      after: 'trip_id',
      spec: {
        name: 'original_trip_id',
        type: 'ID',
        presence: 'Optional',
        description:
          "Google Transit extension.<br><br>If it's present in the [`trips.txt`](https://gtfs.org/schedule/reference/#tripstxt) file, the `original_trip_id` value overrides the `trip_id` value for use by other systems. An example is realtime matching.",
      },
    },
    {
      file: 'trips.txt',
      after: 'direction_id',
      spec: {
        name: 'trip_direction_name',
        type: 'Text',
        presence: 'Optional',
        description:
          "Google Transit extension.<br><br>The `trip_direction_name` field identifies a trip's direction to passengers. The value in this field is stored as the `direction_name` value of each trip.<br><br>If the `stop_direction_name` value in the `stop_times` table changes along the trip, it might override the `trip_direction_name` value.<br><br>Values in the `trip_direction_name` field are case normalized.",
      },
    },
    {
      file: 'trips.txt',
      after: 'trip_direction_name',
      spec: {
        name: 'exceptional',
        type: 'Enum',
        presence: 'Optional',
        description:
          'This field indicates exceptional trips. They operate outside of the regular schedule or are diverted from the usual route due to special events or planned disruptions (such as trackwork, etc).<br><br>Google accepts the following value options:<br>- **`0`.** Regular services<br>- **`1`.** Service exception. For example, services that are added due to special events or services diverted away from the usual route due to planned disruptions.',
        enumValues: [
          { value: 0, label: 'Regular services', description: '' },
          {
            value: 1,
            label: 'Service exception',
            description:
              'For example, services that are added due to special events or services diverted away from the usual route due to planned disruptions.',
          },
        ],
      },
    },
    {
      file: 'trips.txt',
      after: 'cars_allowed',
      spec: {
        name: 'vehicle_category_id',
        type: 'ID',
        presence: 'Optional',
        description:
          "Google Transit extension.<br><br>In the [`trips.txt`](https://gtfs.org/schedule/reference/#tripstxt) file, the `vehicle_category_id` field identifies the vehicle that's allotted to this trip. When this field is in the `trips.txt` file, its value overrides the `vehicle_category_id` value in the [`routes.txt`](https://gtfs.org/schedule/reference/#routestxt) file.",
        foreignKey: [
          { file: 'vehicle_categories.txt', field: 'vehicle_category_id' },
        ],
      },
    },
    {
      file: 'trips.txt',
      after: 'vehicle_category_id',
      spec: {
        name: 'ticketing_trip_id',
        type: 'ID',
        presence: 'Optional',
        description:
          'Google Transit ticketing extension.<br><br>If the `ticketing_trip_id` field is present, its value overrides the `trip_id` field to identify the trip for ticketing with deep links.',
      },
    },
    {
      file: 'trips.txt',
      after: 'ticketing_trip_id',
      spec: {
        name: 'ticketing_type',
        type: 'Enum',
        presence: 'Optional',
        description:
          "Google Transit ticketing extension.<br><br>The [`ticketing_type`](https://developers.google.com/transit/gtfs/reference/google-transit-ticketing-extension#field-definitions) field specifies the type of ticketing that applies to this trip.<br><br>Google Transit accepts the following values:<br>- **`0`.** Default. Available only if the agency or route has a ticketing deep link that's enabled.<br>- **`1`.** Unavailable.",
        enumValues: [
          {
            value: 0,
            label: 'Default',
            description:
              "Available only if the agency or route has a ticketing deep link that's enabled.",
          },
          { value: 1, label: 'Unavailable', description: '' },
        ],
      },
    },
    {
      file: 'stop_times.txt',
      after: 'stop_headsign',
      spec: {
        name: 'stop_direction_name',
        type: 'Text',
        presence: 'Optional',
        description:
          "Google Transit extension.<br><br>The `stop_direction_name` field identifies a trip's direction to passengers. The direction is stored as the `direction_name` value of the departure from this stop.<br><br>If the `stop_direction_name` field is empty, then the Transit-supported `trip_direction_name` field is used instead. If the `trip_direction_name` and `stop_direction_name` fields are both empty, then the transit importer leaves them empty. In that case, partners can use the `stop_headsign` or `trip_headsign` value instead. The values of the `stop_direction_name` field are case normalized.",
      },
    },
    {
      file: 'stop_times.txt',
      after: 'drop_off_booking_rule_id',
      spec: {
        name: 'ticketing_stop_time_id',
        type: 'ID',
        presence: 'Optional',
        description:
          'Google Transit ticketing extension.<br><br>If present in the [`stop_times.txt`](https://gtfs.org/schedule/reference/#stop_timestxt) file, the `ticketing_stop_time_id` field overrides the identifier that represents the stop time for ticketing with deep links.',
      },
    },
    {
      file: 'stop_times.txt',
      after: 'ticketing_stop_time_id',
      spec: {
        name: 'ticketing_type',
        type: 'Enum',
        presence: 'Optional',
        description:
          "Google Transit ticketing extension.<br><br>The `ticketing_type` field specifies the type of ticketing that applies to this stop time.<br><br>Google Transit accepts the following values:<br>- **`Empty`.** Default—as defined by the trip.<br>- **`0`.** Available only if the agency or route has a ticketing deep link that's enabled.<br>- **`1`.** Unavailable.",
        enumValues: [
          {
            value: 0,
            label: 'Available',
            description:
              "Available only if the agency or route has a ticketing deep link that's enabled.",
          },
          { value: 1, label: 'Unavailable', description: '' },
        ],
      },
    },
    {
      file: 'fare_attributes.txt',
      after: 'price',
      spec: {
        name: 'ic_price',
        type: 'Float',
        presence: 'Optional',
        description:
          "This Google Transit extension is available only for partners in Japan.<br><br>The `ic_price` field represents the discounted amount of money to be paid for this fare with a smart card. If no discounts are provided for this fare, or the smart card isn't supported, the `ic_price` field's value needs to be `-1`.",
      },
    },
    {
      file: 'fare_rules.txt',
      after: 'route_id',
      spec: {
        name: 'contains_route_id',
        type: 'ID',
        presence: 'Optional',
        description:
          "Google Transit extension.<br><br>This fare applies only to travel that visits an exact set of routes identified by the `route_id` value in all rows for this combination of the `fare_id`, `origin_id`, and `destination_id` columns.<br><br>If the `contains_route_id` column is missing, or all its values for this fare are null, then the fare isn't restricted in this parameter. If the `contains_route_id` field is given for a fare, then the `route_id` field must be empty.",
        foreignKey: [{ file: 'routes.txt', field: 'route_id' }],
      },
    },
    {
      file: 'translations.txt',
      after: 'language',
      spec: {
        name: 'lang',
        type: 'Language Code',
        presence: 'Optional',
        description:
          "Google Transit extension.<br><br>The `lang` field isn't part of the official GTFS, but Google Transit uses this value when it’s present.<br><br>To specify the translation of a phrase, use the `lang` field. Its value *must not* be empty or `und` (an undefined language).",
      },
    },
    {
      file: 'translations.txt',
      after: 'field_value',
      spec: {
        name: 'trans_id',
        type: 'ID',
        presence: 'Optional',
        description:
          "Google Transit extension.<br><br>The `trans_id` field isn't part of the official GTFS, but Google Transit uses this value when it’s present.<br><br>To specify the ID token of the phrase that the translation is provided for, use the `trans_id` field. Each row of the [`translations.txt`](https://gtfs.org/schedule/reference/#translationstxt) table means that in the language `lang`, the phrase `trans_id` translates to `translation`.",
      },
    },
  ],
  enumValues: [{ file: 'routes.txt', field: 'route_type', values: HVT_VALUES }],
  notes: [
    { file: 'areas.txt', text: NOT_USED },
    { file: 'fare_leg_rules.txt', text: NOT_USED },
    { file: 'fare_products.txt', text: NOT_USED },
    { file: 'fare_transfer_rules.txt', text: NOT_USED },
    { file: 'levels.txt', text: NOT_USED },
    { file: 'stop_areas.txt', text: NOT_USED },
    { file: 'fare_attributes.txt', field: 'payment_method', text: NOT_USED },
    { file: 'feed_info.txt', field: 'default_lang', text: NOT_USED },
    { file: 'feed_info.txt', field: 'feed_publisher_name', text: NOT_USED },
    { file: 'pathways.txt', field: 'max_slope', text: NOT_USED },
    { file: 'routes.txt', field: 'continuous_drop_off', text: NOT_USED },
    { file: 'routes.txt', field: 'continuous_pickup', text: NOT_USED },
    { file: 'routes.txt', field: 'network_id', text: NOT_USED },
    { file: 'routes.txt', field: 'route_desc', text: NOT_USED },
    { file: 'routes.txt', field: 'route_sort_order', text: NOT_USED },
    { file: 'stops.txt', field: 'level_id', text: NOT_USED },
    { file: 'stops.txt', field: 'stop_desc', text: NOT_USED },
    { file: 'stops.txt', field: 'stop_url', text: NOT_USED },
    { file: 'stops.txt', field: 'tts_stop_name', text: NOT_USED },
    { file: 'trips.txt', field: 'bikes_allowed', text: NOT_USED },
    {
      file: 'fare_attributes.txt',
      field: 'transfers',
      text: "Google Transit extension.<br><br>The public GTFS limits values to a range from `0` to `2`. Google Transit accepts values from `0` to `5`.<br><br>Use this field to set the maximum number of allowable transfers with the fare. This doesn't include block transfers, also known as in-seat transfers. If you don't want to set limits on the number of transfers for a fare, leave the `transfers` field empty.",
    },
    {
      file: 'pathways.txt',
      field: 'pathway_mode',
      text: "When the `pathway_mode` field is specified, if it's left empty, Google Transit accepts it and treats it as unknown.",
    },
    {
      file: 'stop_times.txt',
      field: 'arrival_time',
      text: 'Hours are restricted to values from `00` to `99`, which is more than enough for three-day trips.',
    },
    {
      file: 'transfers.txt',
      field: 'transfer_type',
      text: "Values of `4` and `5` aren't supported and are ignored.<br><br>Google Transit supports values of `0`, `1`, `2`, and `3`.",
    },
    {
      file: 'trips.txt',
      field: 'block_id',
      text: 'To learn more, see [Block transfer example](https://developers.google.com/transit/gtfs/examples/block-transfer-example).',
    },
  ],
};
