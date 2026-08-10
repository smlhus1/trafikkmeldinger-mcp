import type { Message, ValidityPeriod } from "./types.js";

/**
 * Answering "does this apply when *I* drive past?" — the thing neither the website
 * nor the app will tell you about a trip you have not taken yet.
 *
 * Vegvesenet publishes recurrences as structured data (`validityPeriods`), not only as
 * the prose in `descriptionOfTrafficMessage`. That is what makes this answerable: a
 * tunnel closed 20:00-06:00 Mon-Thu reports `isActiveNow: false` at noon, and a filter
 * built on that flag would quietly drop the single most disruptive item on an evening
 * drive.
 */

const OSLO = "Europe/Oslo";

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** Sampling step when testing a travel window rather than an instant. */
const STEP_MS = 15 * 60_000;

/** Guards against a caller passing a year-long window and asking for 35 000 samples. */
const MAX_STEPS = 400;

/**
 * Wall-clock day and time in Norway, which is what a recurrence like "20:00-06:00
 * Monday" actually means — regardless of the offset the timestamp was written with.
 */
function osloParts(at: Date): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OSLO,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday").toLowerCase();
  const time = `${get("hour")}:${get("minute")}:${get("second")}`;
  return { day: weekday, time };
}

/** Strips the offset suffix: "20:00:00+02:00" -> "20:00:00". */
function wallClock(value: string | undefined): string | null {
  const match = /^(\d{2}:\d{2}(?::\d{2})?)/.exec(value ?? "");
  if (!match?.[1]) return null;
  return match[1].length === 5 ? `${match[1]}:00` : match[1];
}

function withinPeriod(period: ValidityPeriod, at: Date): boolean {
  const start = period.startOfPeriod ? Date.parse(period.startOfPeriod) : null;
  const end = period.endOfPeriod ? Date.parse(period.endOfPeriod) : null;
  const t = at.getTime();
  if (start !== null && Number.isFinite(start) && t < start) return false;
  if (end !== null && Number.isFinite(end) && t > end) return false;

  const { day, time } = osloParts(at);

  const days = period.applicableDays ?? [];
  if (days.length > 0 && !days.some((d) => d.toLowerCase() === day)) return false;

  const windows = period.timeOfDay ?? [];
  if (windows.length === 0) return true;

  return windows.some((w) => {
    const from = wallClock(w.startTimeOfPeriod);
    const to = wallClock(w.endTimeOfPeriod);
    if (!from || !to) return true; // An unparseable window is treated as all day.
    // Upstream splits windows at midnight, so a plain string compare is sufficient.
    return time >= from && time <= to;
  });
}

/** True if the message is in force at that exact instant. */
export function appliesAt(message: Message, at: Date): boolean {
  const periods = message.validityPeriods;

  if (!periods || periods.length === 0) {
    // No recurrence: in force continuously between start and estimated end.
    const start = message.startTime ? Date.parse(message.startTime) : null;
    const end = message.estimatedEndTime ? Date.parse(message.estimatedEndTime) : null;
    const t = at.getTime();
    if (start !== null && Number.isFinite(start) && t < start) return false;
    if (end !== null && Number.isFinite(end) && t > end) return false;
    return true;
  }

  return periods.some((p) => withinPeriod(p, at));
}

/**
 * True if the message is in force at any point during the window.
 *
 * Samples the window rather than doing interval algebra over the recurrence rules.
 * Travel windows are hours, the step is 15 minutes, and the obvious version is one
 * anyone can check by reading it — the clever version would need its own test suite
 * to be trusted. Sampling can only miss a window shorter than the step, and upstream
 * publishes these in whole hours.
 */
export function appliesBetween(message: Message, from: Date, to: Date): boolean {
  if (to.getTime() < from.getTime()) return appliesBetween(message, to, from);

  const span = to.getTime() - from.getTime();
  const step = Math.max(STEP_MS, Math.ceil(span / MAX_STEPS));

  for (let t = from.getTime(); t < to.getTime(); t += step) {
    if (appliesAt(message, new Date(t))) return true;
  }
  // The end instant is always tested, so a window ending inside a closure still counts.
  return appliesAt(message, to);
}
