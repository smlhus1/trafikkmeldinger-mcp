import {
  countiesOf,
  impactRank,
  matchesAnyPlace,
  municipalitiesOf,
  normalisePlace,
  normaliseRoad,
  onAnyRoad,
  roadsOf,
} from "./roads.js";
import { appliesAt, appliesBetween } from "./validity.js";
import type { Impact, Message } from "./types.js";

/** Everything a caller can narrow on. Every field is optional; omitting one widens. */
export interface Filter {
  /** Free-form road numbers as a human writes them: "E6", "fv27", "27". */
  roads?: string[];
  municipalities?: string[];
  counties?: string[];
  minImpact?: Impact;
  /** Keep only messages in force at this instant. */
  at?: Date;
  /** Keep only messages in force at some point within this window. */
  from?: Date;
  to?: Date;
}
// No `limit` here on purpose. Filtering and presentation are separate jobs, and when
// the cap lived in here the caller could only see the post-slice count — a truncated
// answer that reported itself as complete. Callers now slice, and say that they did.

/**
 * The compact shape returned over MCP.
 *
 * Every byte here lands in the caller's context window, so a field has to earn its
 * place. Measured on 2026-08-10, the old shape cost ~704 characters per message and
 * about 10 000 tokens for a wide route query. Three things were paying nothing:
 *
 *   - `id`, which no tool accepts as input — 27 characters of pure ballast.
 *   - `fylker`, which the caller filtered on and already knows.
 *   - `naarGjelderDen`, which restates in prose what `melding` mostly already says.
 *     Kept ONLY where it carries information the caller does not have: when the
 *     message does NOT apply during their journey, "when does it then" is the point.
 */
export interface Summary {
  sted: string;
  melding: string;
  veier: string[];
  virkning: Impact;
  vegstatus: string;
  gjelderNaa: boolean;
  gjelderPaaReisen?: boolean;
  naarGjelderDen?: string;
  antattSlutt?: string;
  nesteEndring?: string;
  omkjoeringSkiltet?: boolean;
  iTunnel?: boolean;
  kommuner: string[];
}

/**
 * Filter, then sort worst-first.
 *
 * Ordering is part of the contract, not a detail: a caller that takes the top five of an
 * arbitrary order gets five resurfacing jobs and misses the closed tunnel.
 */
export function selectMessages(messages: Message[], filter: Filter): Message[] {
  const roads = new Set(
    (filter.roads ?? []).flatMap((r) => normaliseRoad(r)).map((r) => r.toUpperCase()),
  );
  const municipalities = new Set((filter.municipalities ?? []).map(normalisePlace));
  const counties = new Set((filter.counties ?? []).map(normalisePlace));
  const floor = filter.minImpact ? impactRank(filter.minImpact) : null;

  const hits = messages.filter((m) => {
    if (!onAnyRoad(m, roads)) return false;
    if (!matchesAnyPlace(municipalitiesOf(m), municipalities)) return false;
    if (!matchesAnyPlace(countiesOf(m), counties)) return false;
    if (floor !== null && impactRank(m.trafficImpact) < floor) return false;
    if (filter.at && !appliesAt(m, filter.at)) return false;
    if (filter.from && filter.to && !appliesBetween(m, filter.from, filter.to)) return false;
    return true;
  });

  hits.sort((a, b) => {
    const byImpact = impactRank(b.trafficImpact) - impactRank(a.trafficImpact);
    if (byImpact !== 0) return byImpact;
    // A closed road outranks a regulated one at equal impact.
    const closed = (m: Message) => (m.trafficStatus === "RoadClosed" ? 1 : 0);
    const byStatus = closed(b) - closed(a);
    if (byStatus !== 0) return byStatus;
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });

  return hits;
}

/**
 * Cuts a list to size and says so.
 *
 * Exists so no caller can report a truncated list as a complete one — the whole point
 * of taking `limit` out of `Filter`.
 */
export function capped<T>(items: T[], limit: number): { vist: T[]; avkortet?: string } {
  if (items.length <= limit) return { vist: items };
  return {
    vist: items.slice(0, limit),
    avkortet: `Viser ${limit} av ${items.length}. Øk «maksAntall» eller snevre inn filteret.`,
  };
}

/**
 * Where the message is, preferring upstream's shorter rendering.
 *
 * `descriptionOfLocation` repeats the municipality and county once per endpoint
 * ("E6 X i Stange, Innlandet - E6 Y i Stange, Innlandet"); the simple form states them
 * once. Shorter and easier to read, so it is the default with the long form as fallback.
 */
export function placeOf(message: Message): string {
  return (
    message.locationDescriptionDetails?.simpleLocationDescription ??
    message.descriptionOfLocation ??
    ""
  );
}

/** Strips a message down to what a reader actually needs to decide something. */
export function summarise(message: Message, journey?: { from: Date; to: Date }): Summary {
  const regulations = (message.trafficRegulations ?? [])
    .map((r) => r.description)
    .filter((d): d is string => Boolean(d));

  const appliesOnJourney = journey
    ? appliesBetween(message, journey.from, journey.to)
    : undefined;

  // Prose about WHEN only helps when the answer is not already "while you drive past".
  const needsSchedule = appliesOnJourney !== true;

  return {
    sted: placeOf(message),
    // The pipe is upstream's separator between the event and its consequences.
    melding: (message.descriptionOfTrafficMessage ?? "").split("|").join(" ").trim(),
    veier: roadsOf(message),
    virkning: message.trafficImpact ?? "unknown",
    vegstatus: message.trafficStatus ?? "ukjent",
    gjelderNaa: appliesAt(message, new Date()),
    ...(appliesOnJourney !== undefined ? { gjelderPaaReisen: appliesOnJourney } : {}),
    ...(needsSchedule && message.validPeriodText
      ? { naarGjelderDen: message.validPeriodText }
      : {}),
    ...(message.estimatedEndTime ? { antattSlutt: message.estimatedEndTime } : {}),
    ...(message.nextTrafficStatus?.nextChangeTime
      ? {
          nesteEndring: `${message.nextTrafficStatus.trafficStatus ?? "endring"} fra ${message.nextTrafficStatus.nextChangeTime}`,
        }
      : {}),
    ...(regulations.some((r) => /omkj/i.test(r)) || message.hasAlternativeRoute
      ? { omkjoeringSkiltet: true }
      : {}),
    ...(message.location?.isInTunnel ? { iTunnel: true } : {}),
    kommuner: [...municipalitiesOf(message)],
  };
}
