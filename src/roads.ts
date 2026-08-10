import { IMPACT_LEVELS, type Impact, type Message } from "./types.js";

/**
 * Turning what a human types into what the upstream data actually contains.
 *
 * This module exists because of one specific trap. Vegvesenet encodes a road number
 * with its category letter: "E6", but "F27" for what everyone writes as "fv. 27" or
 * just "27". Filtering on the literal string "27" returns nothing — and nothing looks
 * exactly like "no roadworks on that stretch". That false negative is the most
 * dangerous output this server could produce, so the ambiguity is resolved here once.
 */

const CATEGORIES = ["E", "R", "F", "K"] as const;

/**
 * Severity as a number, so callers can ask for "large and worse" without knowing the
 * order. Derived from `IMPACT_LEVELS` rather than restating it — an unknown value from
 * upstream sorts lowest instead of throwing.
 */
export function impactRank(impact: Impact | undefined): number {
  const index = IMPACT_LEVELS.indexOf(impact ?? "unknown");
  return index === -1 ? 0 : index;
}

/**
 * Every road number the input could plausibly mean, in upstream's notation.
 *
 * A bare number is genuinely ambiguous — "27" is a valid county, national and European
 * road number — so it expands to all four categories rather than guessing the most
 * common one. Over-matching shows the user a message about a road they are not on;
 * under-matching tells them a road is clear when it is not. Only one of those is safe.
 *
 * @example normaliseRoad("fv27") // ["F27"]
 * @example normaliseRoad("27")   // ["E27", "R27", "F27", "K27"]
 */
export function normaliseRoad(input: string): string[] {
  const match = /^\s*([a-zæøåA-ZÆØÅ.\s]*?)\s*(\d+)\s*$/.exec(input);
  if (!match) return [];

  const [, rawPrefix = "", digits] = match;
  const letter = rawPrefix.trim().toUpperCase().replace(/[.\s]/g, "").charAt(0);

  if (!letter) return CATEGORIES.map((c) => `${c}${digits}`);

  // "EV"/"europaveg" -> E, "FV"/"fylkesveg" -> F, "RV"/"riksveg" -> R, "KV" -> K.
  const category = (CATEGORIES as readonly string[]).includes(letter) ? letter : null;
  return category ? [`${category}${digits}`] : [];
}

/** True if the message concerns any of the given roads (already normalised). */
export function onAnyRoad(message: Message, roads: Set<string>): boolean {
  if (roads.size === 0) return true;
  for (const road of message.location?.roads ?? []) {
    if (road.number && roads.has(road.number.toUpperCase())) return true;
  }
  return false;
}

/** The road numbers a message concerns, for display. */
export function roadsOf(message: Message): string[] {
  const seen = new Set<string>();
  for (const road of message.location?.roads ?? []) {
    if (road.number) seen.add(road.number.toUpperCase());
  }
  return [...seen];
}

/**
 * Every municipality a message touches.
 *
 * Reads `locationDescriptionDetails` as the primary source, not `location.municipalities`:
 * the latter was populated on 2 of 795 messages sampled on 2026-08-10. A filter built on
 * the structured-looking field alone silently drops almost everything.
 */
export function municipalitiesOf(message: Message): Set<string> {
  const names = new Set<string>();
  for (const m of message.location?.municipalities ?? []) {
    if (m.name) names.add(m.name);
  }
  const details = message.locationDescriptionDetails;
  for (const place of [details?.fromLocation, details?.toLocation]) {
    if (place?.municipality) names.add(place.municipality);
  }
  return names;
}

/** The counties a message touches, by name. */
export function countiesOf(message: Message): Set<string> {
  const names = new Set<string>();
  for (const c of message.location?.counties ?? []) {
    if (c.name) names.add(c.name);
  }
  const details = message.locationDescriptionDetails;
  for (const place of [details?.fromLocation, details?.toLocation]) {
    if (place?.county) names.add(place.county);
  }
  return names;
}

/**
 * Case- and whitespace-insensitive place matching, preserving æ/ø/å.
 *
 * Deliberately not accent-folding: "Våler" and "Valer" are different places in
 * Norway, and collapsing them would introduce exactly the kind of wrong-place hit
 * this server is meant to avoid.
 */
export function normalisePlace(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function matchesAnyPlace(actual: Set<string>, wanted: Set<string>): boolean {
  if (wanted.size === 0) return true;
  for (const name of actual) {
    if (wanted.has(normalisePlace(name))) return true;
  }
  return false;
}
