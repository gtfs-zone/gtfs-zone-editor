# GTFS Implementation Status

Tracks which GTFS Schedule files are supported in the GTFS.zone UI. Spec version: **2026-04-27**.

UI support levels:
- **Full**: dedicated view, editor or map visualization beyond the generic table viewer
- **Partial**: generic table viewer (Files) with field descriptions, validation, and foreign key awareness; no dedicated view
- **None**: no editing or visualization support

| File | File Presence | UI Support | Notes |
|------|---------------|------------|-------|
| `agency.txt` | Required | Full | Dedicated agency view with inline editing and related routes list |
| `stops.txt` | Required | Full | Map pin visualization, stop clustering, dedicated stop detail panel |
| `routes.txt` | Required | Full | Map route line rendering, color-coded by `route_color`, route detail panel |
| `trips.txt` | Required | Full | Schedule/timetable view, direction filtering |
| `stop_times.txt` | Required | Full | Timetable grid with arrival/departure times per trip |
| `calendar.txt` | Conditionally Required | Full | Service view with weekly pattern editor (Mon-Sun toggles) |
| `calendar_dates.txt` | Conditionally Required | Full | Exception date editing within the service view |
| `shapes.txt` | Optional | Full | Route shape polylines rendered on map, simplification, geojson.io round trip |
| `feed_info.txt` | Conditionally Required | Full | Dedicated inline-editable properties panel on the home page |
| `frequencies.txt` | Optional | Full | Headway periods edited per trip in the timetable |
| `transfers.txt` | Optional | Full | Drawn as edges from the focused stop on the map, listed on the stop page, edited in the Transfers modal grouped by from-stop station |
| `pathways.txt` | Optional | Full | Drawn on the map inside an expanded station, created from the map, own pathway page |
| `levels.txt` | Conditionally Required | Full | Levels editor with the stops on each level |
| `fare_attributes.txt` | Optional | Partial | Fares v1: table viewer only |
| `fare_rules.txt` | Optional | Partial | Fares v1: table viewer only |
| `fare_media.txt` | Optional | Full | Fares v2 editor |
| `fare_products.txt` | Optional | Full | Fares v2 editor; `amount` shown in the row's currency |
| `fare_leg_rules.txt` | Optional | Full | Fares v2 editor with pickers for every referenced table |
| `fare_leg_join_rules.txt` | Optional | Full | Fares v2 editor |
| `fare_transfer_rules.txt` | Optional | Full | Fares v2 editor |
| `timeframes.txt` | Optional | Full | Fares v2 editor |
| `rider_categories.txt` | Optional | Full | Fares v2 editor |
| `areas.txt` | Optional | Full | Fares v2 editor, with the stops in each area |
| `stop_areas.txt` | Optional | Full | Edited from the stop page; platforms inherit their station's areas |
| `networks.txt` | Conditionally Forbidden | Full | Fares v2 editor; canonical in-app form, see [architecture.md](architecture.md#networks) |
| `route_networks.txt` | Conditionally Forbidden | Full | Assigned from the route page; canonical in-app form |
| `location_groups.txt` | Optional | Full | On-demand editor, own location group page with members and routes, members shown on the map |
| `location_group_stops.txt` | Optional | Full | Members edited on the location group page and in the on-demand editor |
| `booking_rules.txt` | Optional | Full | On-demand editor; assigned from the timetable |
| `translations.txt` | Optional | Full | Translations modal: a matrix per table and field with a column per language, plus the raw rows; ID renames carry over, orphans are flagged in Feed Issues; not yet applied to displayed labels |
| `attributions.txt` | Optional | Full | Attributions modal |
| `locations.geojson` | Optional | Full | Zones on the map, own zone page, geometry edited through a geojson.io round trip |

## Google extensions

Google Transit additions from the [reference](https://developers.google.com/transit/gtfs/reference), layered on the base spec as an overlay (`src/gtfs-spec/extensions/google.ts`). Overlay files are listed in Files only when the feed has rows in them or the user adds them, tagged "Google extension", and open in the editable table (add, edit, delete rows). Overlay fields show on entity pages only when the feed uses them, with a Google badge.

| Item | Presence | UI Support | Notes |
|------|----------|------------|-------|
| `ticketing_deep_links.txt` | Optional | Partial | Files table; `agency.ticketing_deep_link_id` and `routes.ticketing_deep_link_id` reference it |
| `ticketing_identifiers.txt` | Optional | Partial | Files table; keyed on `agency_id` + `stop_id` |
| `vehicle_categories.txt` | Optional | Partial | Files table; `trips.vehicle_category_id` references it |
| `vehicle_amenities.txt` | Optional | Partial | Files table |
| `vehicle_category_amenities.txt` | Optional | Partial | Files table; keyed on `vehicle_category_id` + `vehicle_amenity_id` |
| `routes.route_type` extended codes | Required | Full | HVT codes 100-1702 from `gtfs-zone-vocab`, grouped by family in the picker |
| `stops.vehicle_type` | Optional | Partial | Route type picker, shown when the feed uses it |
| `stops.signposted_as` | Optional | Partial | Entity field |
| `agency.ticketing_deep_link_id` | Optional | Partial | Entity field, foreign key |
| `routes.ticketing_deep_link_id`, `routes.checkin_duration` | Optional | Partial | Entity fields |
| `trips.original_trip_id`, `trips.trip_direction_name`, `trips.exceptional`, `trips.vehicle_category_id`, `trips.ticketing_trip_id`, `trips.ticketing_type` | Optional | Partial | Entity fields |
| `stop_times.stop_direction_name`, `stop_times.ticketing_stop_time_id`, `stop_times.ticketing_type` | Optional | Partial | Timetable fields |
| `fare_attributes.ic_price` | Optional | Partial | Files table |
| `fare_rules.contains_route_id` | Optional | Partial | Files table, foreign key to routes |
| `translations.lang`, `translations.trans_id` | Optional | Partial | Raw translation rows |
| Behavior notes | - | Partial | Google's ignored fields, unsupported files and different interpretations shown as notes on the field or file |
