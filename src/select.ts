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
  limit?: number;
}

/** The compact shape returned over MCP — the readable half of a 3 kB upstream object. */
export interface Summary {
  id: string;
  sted: string;
  melding: string;
  veier: string[];
  virkning: Impact;
  vegstatus: string;
  gjelderNaa: boolean;
  gjelderPaaReisen?: boolean;
  naarGjelderDen?: string;
  start?: string;
  antattSlutt?: string;
  nesteEndring?: string;
  omkjoeringSkiltet?: boolean;
  iTunnel?: boolean;
  kommuner: string[];
  fylker: string[];
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

  return filter.limit ? hits.slice(0, filter.limit) : hits;
}

/** Strips a message down to what a reader actually needs. */
export function summarise(message: Message, journey?: { from: Date; to: Date }): Summary {
  const regulations = (message.trafficRegulations ?? [])
    .map((r) => r.description)
    .filter((d): d is string => Boolean(d));

  return {
    id: message.id,
    sted: message.descriptionOfLocation ?? "",
    // The pipe is upstream's separator between the event and its consequences.
    melding: (message.descriptionOfTrafficMessage ?? "").split("|").join(" ").trim(),
    veier: roadsOf(message),
    virkning: message.trafficImpact ?? "unknown",
    vegstatus: message.trafficStatus ?? "ukjent",
    gjelderNaa: appliesAt(message, new Date()),
    ...(journey ? { gjelderPaaReisen: appliesBetween(message, journey.from, journey.to) } : {}),
    ...(message.validPeriodText ? { naarGjelderDen: message.validPeriodText } : {}),
    ...(message.startTime ? { start: message.startTime } : {}),
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
    fylker: [...countiesOf(message)],
  };
}
