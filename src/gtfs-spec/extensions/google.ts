import {
  ROUTE_TYPE_FAMILIES,
  ROUTE_TYPES,
  routeTypeInfo,
  type RouteTypeInfo,
} from 'gtfs-zone-vocab/route-types';
import type { GTFSEnumValue } from '../types';
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

/** Google Transit additions, checked against reference/google-reference.md. */
export const googleExtension: GTFSSpecExtension = {
  id: ID,
  sourceUrl: 'https://developers.google.com/transit/gtfs/reference',
  revision: '2025-05-15',
  files: [],
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
  ],
  enumValues: [{ file: 'routes.txt', field: 'route_type', values: HVT_VALUES }],
  notes: [],
};
