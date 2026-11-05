# Google extensions fixture

A hand-written minimal feed using the Google Transit additions: extended
route types, the extension fields and the ticketing and vehicle files. It
exists to be loaded by hand and looked at: nothing automated reads it.

```bash
./fixtures/google-extended/build.sh   # writes fixtures/google-extended/dist/google-extended.zip
```

`dist/` is gitignored; the `.txt` sources are the checked-in artifact.

| File                                                                                | What it exercises                                                                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `routes.txt`                                                                        | Extended `route_type` 109, 401, 715, 1200 and 1702; `ticketing_deep_link_id`, `checkin_duration`                       |
| `stops.txt`                                                                         | `vehicle_type` on every stop, `signposted_as` on one                                                                   |
| `trips.txt`                                                                         | `trip_direction_name`, `original_trip_id`, `exceptional`, `vehicle_category_id`, `ticketing_trip_id`, `ticketing_type` |
| `stop_times.txt`                                                                    | `stop_direction_name`, `ticketing_stop_time_id`, `ticketing_type`                                                      |
| `agency.txt`                                                                        | `ticketing_deep_link_id`                                                                                               |
| `ticketing_deep_links.txt`, `ticketing_identifiers.txt`                             | One row each, referenced from agency, routes and stops                                                                 |
| `vehicle_categories.txt`, `vehicle_amenities.txt`, `vehicle_category_amenities.txt` | One category with an amenity set on the category and a second one through the join file                                |

## What to check

- Route pages name the extended types (109 is "Suburban Railway") and raise no
  `UNKNOWN_ROUTE_TYPE` issue.
- The `route_type` picker groups base types first, then families, with a filter.
- Stops show `vehicle_type`; trips and stop_times show the direction fields.
- Files lists the five Google files under "Google Extension Files", tagged,
  and each opens in an editable table. Feed Issues reports no dangling
  reference.
- Export, unzip and diff against these sources: same rows and values.
- A base-only feed (any of `fixtures/flex/`) shows no Google columns, and
  Files lists no Google file until one is added.
