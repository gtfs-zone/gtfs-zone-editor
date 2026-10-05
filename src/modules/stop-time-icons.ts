/**
 * Glyphs for the compact timetable cell's icon strip.
 *
 * Only a non-default value of `pickup_type`, `drop_off_type` or `timepoint`
 * gets a glyph. Inline SVG in currentColor, sized by class, in the same style
 * as the icons in gtfs-zone-web-common's modal-utils.
 */

import { escapeHtml } from 'gtfs-zone-web-common/util/escape-html';

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

function arrowUp(size: string): string {
  return `${SVG_OPEN} class="${size}"><path d="M12 20V5M6 11l6-6 6 6" /></svg>`;
}

function arrowDown(size: string): string {
  return `${SVG_OPEN} class="${size}"><path d="M12 4v15M6 13l6 6 6-6" /></svg>`;
}

/** Value 1: not available. */
function circleSlash(size: string): string {
  return `${SVG_OPEN} class="${size}"><circle cx="12" cy="12" r="9" /><path d="M6 18L18 6" /></svg>`;
}

/** Value 2: phone the agency. */
function phone(size: string): string {
  return `${SVG_OPEN} class="${size}"><path d="M6 3h4l2 5-2.5 1.5a12 12 0 005 5L16 12l5 2v4a2 2 0 01-2.2 2A17 17 0 014 5.2 2 2 0 016 3z" /></svg>`;
}

/** Value 3: coordinate with the driver. */
function steeringWheel(size: string): string {
  return `${SVG_OPEN} class="${size}"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3v6M4.5 16.5l5-2.5M19.5 16.5l-5-2.5" /></svg>`;
}

/** timepoint=0: a clock over a tilde. */
function approxClock(size: string): string {
  return `${SVG_OPEN} class="${size}"><circle cx="12" cy="10" r="7" /><path d="M12 6v4l2.5 1.5" /><path d="M5 21c1-1.5 2-1.5 3 0s2 1.5 3 0 2-1.5 3 0 2 1.5 3 0" /></svg>`;
}

/** The marker for "more fields are set on this stop_time". */
export function renderMoreFieldsIcon(size = 'h-3 w-3'): string {
  return `${SVG_OPEN} class="${size}"><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></svg>`;
}

/** The value glyph for a pickup_type / drop_off_type value other than 0. */
function boardingGlyph(value: string, size: string): string {
  switch (value) {
    case '1':
      return circleSlash(size);
    case '2':
      return phone(size);
    case '3':
      return steeringWheel(size);
    default:
      // Not a spec value: show it raw so it stands out.
      return `<span class="font-mono text-[10px] leading-none">${escapeHtml(value)}</span>`;
  }
}

/**
 * The strip glyph for one field's value, or null when the value is the
 * default (empty or 0 for the two types, empty or 1 for timepoint).
 *
 * The two types carry a direction arrow (up for pickup, down for drop-off) in
 * front of the value glyph, since both share the same value glyphs.
 */
export function renderStopTimeFieldIcon(
  field: string,
  value: string,
  size = 'h-3 w-3'
): string | null {
  switch (field) {
    case 'pickup_type':
    case 'drop_off_type': {
      if (value === '' || value === '0') {
        return null;
      }
      const arrow = field === 'pickup_type' ? arrowUp(size) : arrowDown(size);
      return `${arrow}${boardingGlyph(value, size)}`;
    }
    case 'timepoint':
      if (value === '' || value === '1') {
        return null;
      }
      return value === '0'
        ? approxClock(size)
        : `<span class="font-mono text-[10px] leading-none">${escapeHtml(value)}</span>`;
    default:
      throw new Error(`[stop-time-icons] no icon for field '${field}'`);
  }
}
