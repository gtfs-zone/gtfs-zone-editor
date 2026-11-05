<!--
Source: https://developers.google.com/transit/gtfs/reference
Page revision: Last updated 2025-05-15 UTC
Fetched: 2026-11-05
License: CC-BY-4.0, Copyright Google LLC
-->

# Google Transit differences from the official GTFS Schedule

This page is up to date with the official specification as of December 21, 2022. Updates past that date aren't supported.

## Unsupported files

Google Transit ingests this data without error but doesn't proactively use the data.

| File Name |
|-----------|
| `areas.txt` |
| `fare_leg_rules.txt` |
| `fare_products.txt` |
| `fare_transfer_rules.txt` |
| `levels.txt` |
| `stop_areas.txt` |

## Ignored fields

Google Transit ingests this data without error but doesn't proactively use the data.

| File Name | Field Name | Type |
|-----------|------------|------|
| `fare_attributes.txt` | `payment_method` | Enum |
| `feed_info.txt` | `default_lang` | Language code |
| `feed_info.txt` | `feed_publisher_name` | Text |
| `pathways.txt` | `max_slope` | Float |
| `routes.txt` | `continuous_drop_off` | Enum |
| `routes.txt` | `continuous_pickup` | Enum |
| `routes.txt` | `network_id` | ID |
| `routes.txt` | `route_desc` | Text |
| `routes.txt` | `route_sort_order` | Non-negative integer |
| `stops.txt` | `level_id` | ID |
| `stops.txt` | `stop_desc` | Text |
| `stops.txt` | `stop_url` | URL |
| `stops.txt` | `tts_stop_name` | Text |
| `trips.txt` | `bikes_allowed` | Enum |

## Different interpretation

| File Name | Field Name | Type | Presence | Description |
|-----------|------------|------|----------|-------------|
| `fare_attributes.txt` | `transfers` | Enum | Required | Google Transit extension.<br><br>The public GTFS limits values to a range from `0` to `2`. Google Transit accepts values from `0` to `5`.<br><br>Use this field to set the maximum number of allowable transfers with the fare. This doesn't include block transfers, also known as in-seat transfers. If you don't want to set limits on the number of transfers for a fare, leave the `transfers` field empty. |
| `pathways.txt` | `pathway_mode` | Enum | Optional | When the `pathway_mode` field is specified, if it's left empty, Google Transit accepts it and treats it as unknown. |
| `stop_times.txt` | `arrival_time` | Time | Conditionally required | Hours are restricted to values from `00` to `99`, which is more than enough for three-day trips. |
| `transfers.txt` | `transfer_type` | Enum | Required | Values of `4` and `5` aren't supported and are ignored.<br><br>Google Transit supports values of `0`, `1`, `2`, and `3`. |
| `trips.txt` | `block_id` | ID | Optional | To learn more, see [Block transfer example](https://developers.google.com/transit/gtfs/examples/block-transfer-example). |

## Extensions

### fare_attributes.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `ic_price` | Float | Optional | This Google Transit extension is available only for partners in Japan.<br><br>The `ic_price` field represents the discounted amount of money to be paid for this fare with a smart card. If no discounts are provided for this fare, or the smart card isn't supported, the `ic_price` field's value needs to be `-1`. |

### fare_rules.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `contains_route_id` | ID | Optional | Google Transit extension.<br><br>This fare applies only to travel that visits an exact set of routes identified by the `route_id` value in all rows for this combination of the `fare_id`, `origin_id`, and `destination_id` columns.<br><br>If the `contains_route_id` column is missing, or all its values for this fare are null, then the fare isn't restricted in this parameter. If the `contains_route_id` field is given for a fare, then the `route_id` field must be empty. |

### routes.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `checkin_duration` | Integer | Optional | Google Transit extension.<br><br>The `checkin_duration` field specifies how many seconds early a passenger is advised to arrive before the scheduled departure in order to check in and board.<br><br>If the passenger connects to the departure by a transfer, then any defined transfer time overrides the `checkin_duration` value.<br><br>The `checkin_duration` value is only a recommendation that's usually provided by the transit operator. It might not reflect the absolute last possible moment that a passenger can arrive and still board the vehicle. |
| `route_type` | Enum | Required | Google Transit extension.<br><br>To learn how Google Transit extends the GTFS‑accepted `route_type` value options, see [Extended GTFS route types](https://developers.google.com/transit/gtfs/reference/extended-route-types). |
| `ticketing_deep_link_id` | ID | Optional | Google Transit ticketing extension.<br><br>In the [`routes.txt`](https://gtfs.org/schedule/reference/#routestxt) file, the `ticketing_deep_link_id` field represents the deep link that's used to ticket the trips of this route. |

### stop_times.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `stop_direction_name` | Text | Optional | Google Transit extension.<br><br>The `stop_direction_name` field identifies a trip's direction to passengers. The direction is stored as the `direction_name` value of the departure from this stop.<br><br>If the `stop_direction_name` field is empty, then the Transit-supported `trip_direction_name` field is used instead. If the `trip_direction_name` and `stop_direction_name` fields are both empty, then the transit importer leaves them empty. In that case, partners can use the `stop_headsign` or `trip_headsign` value instead. The values of the `stop_direction_name` field are case normalized. |
| `ticketing_stop_time_id` | ID | Optional | Google Transit ticketing extension.<br><br>If present in the [`stop_times.txt`](https://gtfs.org/schedule/reference/#stop_timestxt) file, the `ticketing_stop_time_id` field overrides the identifier that represents the stop time for ticketing with deep links. |
| `ticketing_type` | Enum | Optional | Google Transit ticketing extension.<br><br>The `ticketing_type` field specifies the type of ticketing that applies to this stop time.<br><br>Google Transit accepts the following values:<br>- **`Empty`.** Default—as defined by the trip.<br>- **`0`.** Available only if the agency or route has a ticketing deep link that's enabled.<br>- **`1`.** Unavailable. |

### stops.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `signposted_as` | Text | Optional | Google Transit extension.<br><br>The `signposted_as` field contains the verbatim text written on the signboard for the platform. Examples are "Towards Central" and "East side & Brooklyn."<br><br>The GTFS `platform_code` field and the Transit-supported `signposted_as` field can be set simultaneously.<br><br>Differences between the `platform_code` and `signposted_as` fields include the following:<br>- **Length.** The `platform_code` field usually contains a number or letter like *2* or *C*.<br>- **Language.** The `platform_code` field doesn't have a language, but `signposted_as` values can have translations.<br>- **Stability.** The `platform_code` field changes much less often than the `signposted_as` field. |
| `vehicle_type` | Integer | Optional | Google Transit extension.<br><br>The `vehicle_type` field specifies the type of vehicles that are used at a stop. This field accepts hierarchical vehicle type (HVT) route types. The HVT values are derived from the European Transport Protocol Experts Group (TPEG) standard. |

### agency.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `ticketing_deep_link_id` | ID | Optional | Google Transit ticketing extension.<br><br>In the [`agency.txt`](https://gtfs.org/schedule/reference/#agencytxt) file, the `ticketing_deep_link_id` field represents the deep link that's used to ticket the trips of this agency. |

### ticketing_deep_links.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `android_intent_uri` | URI | Optional | Google Transit ticketing extension.<br><br>The `android_intent_uri` field represents the intent URI that's used for deep linking on Android. |
| `ios_universal_link_url` | URL | Optional | Google Transit ticketing extension.<br><br>The `ios_universal_link_url` field represents the universal link URL that's used for deep linking on iOS. |
| `ticketing_deep_link_id` | ID | Required | Google Transit ticketing extension.<br><br>The `ticketing_deep_link_id` field represents the identifier of the deep link. |
| `web_url` | URL | Optional | Google Transit ticketing extension.<br><br>The `web_url` field represents the URL that's used for deep linking on the web. |

### ticketing_identifiers.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `agency_id` | ID | Required | Google Transit ticketing extension.<br><br>To specify the agency of the stop that the default `ticketing_stop_id` field is defined for, the `agency_id` field contains the ID from the GTFS [`agency.txt`](https://gtfs.org/schedule/reference/#agencytxt) file. |
| `stop_id` | ID | Required | Google Transit ticketing extension.<br><br>To specify the stop that the default `ticketing_stop_id` field is defined for, the `stop_id` field contains the ID from the GTFS [`stops.txt`](https://gtfs.org/schedule/reference/#stopstxt) file. |
| `ticketing_stop_id` | ID | Required | Google Transit ticketing extension.<br><br>The `ticketing_stop_id` field contains the ticketing ID that is applied to the stop. Optionally, an agency qualifies the ID. |

### trips.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `exceptional` | Enum | Optional | This field indicates exceptional trips. They operate outside of the regular schedule or are diverted from the usual route due to special events or planned disruptions (such as trackwork, etc).<br><br>Google accepts the following value options:<br>- **`0`.** Regular services<br>- **`1`.** Service exception. For example, services that are added due to special events or services diverted away from the usual route due to planned disruptions. |
| `ticketing_trip_id` | ID | Optional | Google Transit ticketing extension.<br><br>If the `ticketing_trip_id` field is present, its value overrides the `trip_id` field to identify the trip for ticketing with deep links. |
| `ticketing_type` | Enum | Optional | Google Transit ticketing extension.<br><br>The [`ticketing_type`](https://developers.google.com/transit/gtfs/reference/google-transit-ticketing-extension#field-definitions) field specifies the type of ticketing that applies to this trip.<br><br>Google Transit accepts the following values:<br>- **`0`.** Default. Available only if the agency or route has a ticketing deep link that's enabled.<br>- **`1`.** Unavailable. |
| `original_trip_id` | ID | Optional | Google Transit extension.<br><br>If it's present in the [`trips.txt`](https://gtfs.org/schedule/reference/#tripstxt) file, the `original_trip_id` value overrides the `trip_id` value for use by other systems. An example is realtime matching. |
| `trip_direction_name` | Text | Optional | Google Transit extension.<br><br>The `trip_direction_name` field identifies a trip's direction to passengers. The value in this field is stored as the `direction_name` value of each trip.<br><br>If the `stop_direction_name` value in the `stop_times` table changes along the trip, it might override the `trip_direction_name` value.<br><br>Values in the `trip_direction_name` field are case normalized. |
| `vehicle_category_id` | ID | Optional | Google Transit extension.<br><br>In the [`trips.txt`](https://gtfs.org/schedule/reference/#tripstxt) file, the `vehicle_category_id` field identifies the vehicle that's allotted to this trip. When this field is in the `trips.txt` file, its value overrides the `vehicle_category_id` value in the [`routes.txt`](https://gtfs.org/schedule/reference/#routestxt) file. |

### translations.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `lang` | Language Code | Optional | Google Transit extension.<br><br>The `lang` field isn't part of the official GTFS, but Google Transit uses this value when it’s present.<br><br>To specify the translation of a phrase, use the `lang` field. Its value *must not* be empty or `und` (an undefined language). |
| `trans_id` | ID | Optional | Google Transit extension.<br><br>The `trans_id` field isn't part of the official GTFS, but Google Transit uses this value when it’s present.<br><br>To specify the ID token of the phrase that the translation is provided for, use the `trans_id` field. Each row of the [`translations.txt`](https://gtfs.org/schedule/reference/#translationstxt) table means that in the language `lang`, the phrase `trans_id` translates to `translation`. |

### vehicle_categories.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `vehicle_category_id` | ID | Required | Google Transit extension.<br><br>Identifies a vehicle category. |
| `vehicle_amenity_id` | ID | Optional | Google Transit extension.<br><br>Identifies a set of amenities available to all passengers in the vehicle category. Alternatively, see `vehicle_category_amenities.txt ` for when different amenity sets are available in the same vehicle category. |

### vehicle_amenities.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `vehicle_amenity_id` | ID | Required | Google Transit extension.<br><br>Identifies a set of amenities. |
| `ac_availability` | Enum | Optional | Google Transit extension.<br><br>Defines if air conditioning is available.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** Available anywhere, anytime.<br>- **`2`.** Not available. |
| `wifi_availability` | Enum | Optional | Google Transit extension.<br><br>Defines if Wifi is available onboard.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** Available anywhere, anytime.<br>- **`2`.** Not available. |
| `toilet_availability` | Enum | Optional | Google Transit extension.<br><br>Defines if a toilet is available inside the vehicle.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** Available anywhere, anytime.<br>- **`2`.** Not available. |
| `gender_accessibility` | Enum | Optional | Google Transit extension.<br><br>Defines if gender restrictions apply.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** No gender restrictions.<br>- **`2`.** Restricted to women only.<br>- **`3`.** Restricted to men only. |
| `seat_type` | Enum | Optional | Google Transit extension.<br><br>Defines the type of seat.<br><br>Google accepts the following values:<br>- **`0`.** Default. Seat (not foldable, may be reclining).<br>- **`1`.** Fixed bed (cannot be reclined back as seat).<br>- **`2`.** Reclining seat. |
| `service_class` | Enum | Optional | Google Transit extension.<br><br>Defines the class of the seat.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** First class.<br>- **`2`.** Second class.<br>- **`3`.** Third class.<br>- **`4`.** Business.<br>- **`5`.** Premium Economy.<br>- **`6`.** Economy. |
| `service_class_code` | String | Optional | Google Transit extension.<br><br>Defines a short form class code (e.g. 1A for Air-Conditioned First Class). This field is a more specific version of the class field, where the classes not available in the class enum can be specified. |
| `seat_plug` | Enum | Optional | Google Transit extension.<br><br>Defines if either an electric or usb plug (of any type) is available at the seat.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown.<br>- **`1`.** Available at all seats.<br>- **`2`.** Not available. |
| `row_layout_summary` | String | Optional | Google Transit extension.<br><br>Defines the number of seats or beds in one row of the vehicle. Some examples are: "2" (2 seats in a row, but whether they are separated or next to each other is unknown), "1+1" (2 individual seats in a row), "2+2" (4 seats in a row with a separation in the middle). |
| `row_leg_space` | Enum | Optional | Google Transit extension.<br><br>Defines if rows have additional leg space.<br><br>Google accepts the following values:<br>- **`0`.** Default. Unknown / Not applicable.<br>- **`1`.** Standard leg space.<br>- **`2`.** Additional leg space. |

### vehicle_category_amenities.txt

| Field Name | Type | Presence | Description |
|------------|------|----------|-------------|
| `vehicle_category_id` | ID | Required | Google Transit extension.<br><br>Identifies the vehicle category. The same vehicle category can have numerous amenity sets by repeating the value of this field in multiple rows. This is typically helpful when a vehicle category has various classes of service. |
| `vehicle_amenity_id` | ID | Required | Google Transit extension.<br><br>Identifies a set of amenities available to all passengers in the vehicle category. |
