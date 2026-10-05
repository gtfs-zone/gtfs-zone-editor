/**
 * Arrival/departure coupling for a single stop_time edit.
 *
 * Spreadsheet rule, the same for both fields: the typed field gets the new
 * value, and the partner field keeps its value. The one exception is an empty
 * partner, which gets the typed time, since a stop with only one of the two
 * times is not valid for most feeds.
 *
 * Nothing outside the edited row is touched, and arrival > departure is the
 * caller's to reject.
 */

export interface CoupledTimes {
  arrival_time: string | null;
  departure_time: string | null;
}

export interface CoupleStopTimesInput {
  field: 'arrival' | 'departure';
  oldArrival: string | null | undefined;
  oldDeparture: string | null | undefined;
  /** The casted HH:MM:SS value the user typed. Never empty. */
  newValue: string;
}

/** Empty string and null both mean "no time" in a stored row. */
function normalize(time: string | null | undefined): string | null {
  const trimmed = time?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Compute the arrival/departure pair a single time edit should write.
 *
 * @param input - The edited field, the row's stored times, and the new value
 * @returns Both fields as they should be written
 */
export function coupleStopTimes(input: CoupleStopTimesInput): CoupledTimes {
  const { field, newValue } = input;
  if (field === 'arrival') {
    return {
      arrival_time: newValue,
      departure_time: normalize(input.oldDeparture) ?? newValue,
    };
  }
  return {
    arrival_time: normalize(input.oldArrival) ?? newValue,
    departure_time: newValue,
  };
}
