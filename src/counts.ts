import { TrafficError } from "./types.js";

/**
 * Traffic COUNTS — how many vehicles actually drive past a point, hour by hour.
 *
 * A different Vegvesen service from the messages endpoint in `api.ts`, and the two
 * disagree on notation: a count point writes its road as "RV19 S1D1 m875" while a
 * traffic message writes "R19". Same agency, two spellings — reconciled in `roadOfPoint`
 * so the rest of the server only ever sees one. Filtering count points with the message
 * notation (or the reverse) matches nothing, and nothing reads as "quiet road".
 *
 * What this data is good for: "when should I leave". A point counts every vehicle that
 * passes it, so a typical Thursday profile is a measurement, not a model. What it cannot
 * do: say anything about the road BETWEEN points.
 */

const COUNTS_URL = "https://trafikkdata-api.atlas.vegvesen.no/";

/**
 * The endpoint's hard page size. Asking for more is not a bigger page — `first: 101`
 * fails with an opaque "unknown error", so pagination is mandatory, not an optimisation.
 */
const PAGE = 100;

const TIMEOUT_MS = 30_000;
const CACHE_MS = 24 * 3600_000;

/** Vehicle counts do not move; the catalogue of points barely moves either. */
let pointCache: { fetchedAt: number; points: CountPoint[] } | null = null;

export interface CountPoint {
  id: string;
  name: string;
  /** Road in the messages notation: "E6", "R19", "F27". Null when upstream has none. */
  road: string | null;
  municipality: string | null;
  county: string | null;
  /** How the point is oriented, e.g. "Patterød mot Moss". */
  direction: string | null;
}

/** One hour as upstream measured it, in the point's own local time. */
export interface HourSample {
  /** Local calendar date, "2026-07-27". */
  date: string;
  /** Local hour of day, 0-23. */
  hour: number;
  volume: number | null;
  /** Percent of the hour actually measured. A partly-dead sensor reports a low number. */
  coverage: number | null;
}

/**
 * The road a count point sits on, in the notation the rest of this server uses.
 *
 * `shortForm` is a full position reference — "RV19 S1D1 m875" — whose first token
 * carries a two-letter category ("RV", "EV", "FV", "KV"). The separate `roadCategory`
 * field already holds the single letter, so the digits are all that has to be parsed.
 */
export function roadOfPoint(shortForm: string | undefined, category: string | undefined): string | null {
  if (!shortForm || !category) return null;
  const digits = /^[A-Za-zÆØÅæøå]*(\d+)/.exec(shortForm.trim())?.[1];
  return digits ? `${category.toUpperCase()}${digits}` : null;
}

/**
 * Weekday of a local calendar date, 1 = Monday .. 7 = Sunday.
 *
 * Built from the date STRING rather than from a Date parsed in the machine's timezone:
 * the same hour must land on the same weekday whether this runs in Oslo or in a
 * container set to UTC.
 */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export const WEEKDAYS = [
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
  "søndag",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** One hour of a typical weekday, aggregated across the weeks fetched. */
export interface HourProfile {
  hour: number;
  /** Median across the weeks — one snowstorm or one holiday cannot move it. */
  typical: number;
  /** How many weeks actually contributed. Two is thin; say so rather than hide it. */
  samples: number;
}

export interface Profile {
  hours: HourProfile[];
  /** Hours dropped because the sensor measured too little of them to trust. */
  discarded: number;
}

/**
 * Median volume per hour of day, for one weekday.
 *
 * Median rather than mean because a single closed road, holiday or festival otherwise
 * drags an hour by hundreds of vehicles and the answer stops describing a normal week.
 * Hours the sensor barely measured are discarded rather than averaged in: a 20 %-covered
 * hour reports roughly a fifth of the traffic, which reads as a quiet road.
 */
export function profileFor(samples: HourSample[], weekday: number, minCoverage = 90): Profile {
  const byHour = new Map<number, number[]>();
  let discarded = 0;

  for (const s of samples) {
    if (weekdayOf(s.date) !== weekday) continue;
    if (s.volume === null || (s.coverage ?? 0) < minCoverage) {
      discarded++;
      continue;
    }
    const bucket = byHour.get(s.hour) ?? [];
    bucket.push(s.volume);
    byHour.set(s.hour, bucket);
  }

  const hours = [...byHour.entries()]
    .map(([hour, volumes]) => ({ hour, typical: median(volumes), samples: volumes.length }))
    .sort((a, b) => a.hour - b.hour);

  return { hours, discarded };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

/** Every operational point that counts vehicles. Cached — the catalogue is near-static. */
export async function fetchPoints(maxAgeMs = CACHE_MS): Promise<CountPoint[]> {
  if (pointCache && Date.now() - pointCache.fetchedAt <= maxAgeMs) return pointCache.points;

  const data = await query<{
    trafficRegistrationPoints: {
      id: string;
      name: string;
      location?: {
        county?: { name?: string };
        municipality?: { name?: string };
        roadReference?: { shortForm?: string; roadCategory?: { id?: string } };
      };
      direction?: { from?: string; to?: string };
    }[];
  }>(
    `{ trafficRegistrationPoints(searchQuery: {isOperational: true, trafficType: VEHICLE}) {
        id name
        location { county { name } municipality { name }
                   roadReference { shortForm roadCategory { id } } }
        direction { from to }
      } }`,
  );

  const points = (data.trafficRegistrationPoints ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    road: roadOfPoint(p.location?.roadReference?.shortForm, p.location?.roadReference?.roadCategory?.id),
    municipality: p.location?.municipality?.name ?? null,
    county: p.location?.county?.name ?? null,
    direction:
      p.direction?.from && p.direction?.to ? `${p.direction.from} mot ${p.direction.to}` : null,
  }));

  pointCache = { fetchedAt: Date.now(), points };
  return points;
}

/**
 * Hourly volume for one point, following the cursor to the end of the window.
 *
 * The page cap is a backstop, not a limit anyone should hit: a cursor that stops
 * advancing would otherwise loop until the process is killed.
 */
export async function fetchHours(pointId: string, from: Date, to: Date): Promise<HourSample[]> {
  const expectedPages = Math.ceil((to.getTime() - from.getTime()) / 3600_000 / PAGE);
  const maxPages = expectedPages + 2;

  const samples: HourSample[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const after: string = cursor ? `, after: "${cursor}"` : "";
    const data = await query<{
      trafficData?: {
        volume?: {
          byHour?: {
            pageInfo?: { hasNextPage?: boolean; endCursor?: string };
            edges?: { node?: { from?: string; total?: { coverage?: { percentage?: number }; volumeNumbers?: { volume?: number } } } }[];
          };
        };
      };
    }>(
      `{ trafficData(trafficRegistrationPointId: "${pointId}") { volume {
           byHour(from: "${from.toISOString()}", to: "${to.toISOString()}", first: ${PAGE}${after}) {
             pageInfo { hasNextPage endCursor }
             edges { node { from total { coverage { percentage } volumeNumbers { volume } } } }
           } } } }`,
    );

    const byHour = data.trafficData?.volume?.byHour;
    for (const edge of byHour?.edges ?? []) {
      const stamp = edge.node?.from;
      if (!stamp) continue;
      // "2026-07-27T15:00:00+02:00" — the date and hour are already local to the point,
      // which is what a driver means by "three in the afternoon on a Thursday".
      samples.push({
        date: stamp.slice(0, 10),
        hour: Number(stamp.slice(11, 13)),
        volume: edge.node?.total?.volumeNumbers?.volume ?? null,
        coverage: edge.node?.total?.coverage?.percentage ?? null,
      });
    }

    if (!byHour?.pageInfo?.hasNextPage || !byHour.pageInfo.endCursor) return samples;
    cursor = byHour.pageInfo.endCursor;
  }

  return samples;
}

/** Discards caches, so a test never inherits state from an earlier one. */
export function clearCountsCache(): void {
  pointCache = null;
}

async function query<T>(graphql: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(COUNTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: graphql }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new TrafficError(`Trafikkdata svarte ikke innen ${TIMEOUT_MS / 1000} s.`);
    }
    throw new TrafficError(`Nådde ikke trafikkdata: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new TrafficError(`Trafikkdata ga HTTP ${res.status} ${res.statusText}`, res.status);
  }

  const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  // GraphQL answers 200 with an errors array, so a failed query looks like a success
  // to every check above. Without this, a bad filter would surface as empty data.
  if (body.errors?.length) {
    throw new TrafficError(`Trafikkdata avviste spørringen: ${body.errors[0]?.message ?? "ukjent feil"}`);
  }
  if (!body.data) throw new TrafficError("Trafikkdata svarte uten «data».");
  return body.data;
}
