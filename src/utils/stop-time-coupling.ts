/**
 * Arrival/departure coupling for a single stop_time edit.
 *
 * One time entry has to produce a sensible pair: a stop with only an arrival is
 * not what the user meant and is not valid for most feeds. The coupling is
 * asymmetric, because a departure-only edit is how dwell time is expressed:
 *
 * - Arrival edited, departure empty: departure := new arrival.
 * - Arrival edited, departure equal to the old arrival: both move together.
 * - Arrival edited, departure different: the dwell was set on purpose, so the
 *   departure stays, unless the new arrival passes it, in which case the
 *   departure is raised to the new arrival.
 * - Departure edited, arrival empty: arrival := new departure.
 * - Departure edited, arrival present: arrival unchanged.
 *
 * Nothing outside the edited row is touched: a one-row edit stays a one-row
 * edit, and a non-monotonic sequence is still the validator's business.
 */
import { TimeFormatter } from './time-formatter';

export interface CoupledTimes {
  arrival_time: string | null;
  departure_time: string | null;
  /** Seconds the departure moved by, else null. */
  deltaSeconds: number | null;
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
 * @returns Both fields as they should be written, plus the applied delta
 */
export function coupleStopTimes(input: CoupleStopTimesInput): CoupledTimes {
  const { field, newValue } = input;
  const oldArrival = normalize(input.oldArrival);
  const oldDeparture = normalize(input.oldDeparture);

  if (field === 'departure') {
    return {
      arrival_time: oldArrival ?? newValue,
      departure_time: newValue,
      deltaSeconds: null,
    };
  }

  if (!oldDeparture) {
    return {
      arrival_time: newValue,
      departure_time: newValue,
      deltaSeconds: null,
    };
  }

  // Times can exceed 24:00:00, so they are compared in seconds since the
  // start of the service day, never with Date or as strings.
  const oldArrivalSeconds = TimeFormatter.timeToSeconds(oldArrival);
  const newArrivalSeconds = TimeFormatter.timeToSeconds(newValue);
  const oldDepartureSeconds = TimeFormatter.timeToSeconds(oldDeparture);

  if (newArrivalSeconds === null || oldDepartureSeconds === null) {
    // Nothing to compare against: leave the departure where it is.
    return {
      arrival_time: newValue,
      departure_time: oldDeparture,
      deltaSeconds: null,
    };
  }

  // No dwell: arrival and departure are one time and move together.
  if (oldArrivalSeconds === oldDepartureSeconds) {
    return {
      arrival_time: newValue,
      departure_time: newValue,
      deltaSeconds: newArrivalSeconds - oldDepartureSeconds,
    };
  }

  // A set dwell is kept, unless the new arrival passes the departure.
  if (newArrivalSeconds > oldDepartureSeconds) {
    return {
      arrival_time: newValue,
      departure_time: newValue,
      deltaSeconds: newArrivalSeconds - oldDepartureSeconds,
    };
  }

  return {
    arrival_time: newValue,
    departure_time: oldDeparture,
    deltaSeconds: null,
  };
}
