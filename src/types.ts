/**
 * The subset of Statens vegvesen's traffic-information response this server relies on.
 *
 * Deliberately partial: the upstream payload also carries map icons, geometry and
 * display hints we never read. Typing only what we use means an upstream addition
 * cannot break the build, while a change to a field we DO depend on surfaces as a
 * type error rather than as silently missing output.
 */

/**
 * How much of the road is affected, listed least severe first.
 *
 * The ORDER is the ranking — `impactRank` reads it positionally rather than keeping a
 * second severity table, and the zod enum at the MCP boundary is built from this same
 * array. One list, so a new level from upstream cannot be added in one place and
 * forgotten in another.
 */
export const IMPACT_LEVELS = ["unknown", "none", "small", "large", "very_large"] as const;

export type Impact = (typeof IMPACT_LEVELS)[number];

/** Open, regulated (lights, convoy, short closures), or shut. */
export type RoadStatus = "RoadOpen" | "Regulation" | "RoadClosed";

export interface Place {
  road?: string;
  name?: string;
  municipality?: string;
  county?: string;
}

/**
 * A recurring window, e.g. "20:00-06:00 Mon-Thu between 10 and 14 August".
 *
 * Present on fewer than half the messages (314 of 795 sampled 2026-08-10); when
 * absent, the message applies continuously between `startTime` and
 * `estimatedEndTime`. Interpreted in `validity.ts`.
 */
export interface ValidityPeriod {
  startOfPeriod?: string;
  endOfPeriod?: string;
  /** Lowercase English day names, e.g. "monday". Absent or empty means every day. */
  applicableDays?: string[];
  /** Local wall-clock windows. Never observed crossing midnight — upstream splits them. */
  timeOfDay?: { startTimeOfPeriod?: string; endTimeOfPeriod?: string }[];
}

export interface Message {
  id: string;
  type?: string;
  descriptionOfLocation?: string;
  descriptionOfTrafficMessage?: string;
  validPeriodText?: string;
  activityStatus?: "active" | "future" | "inactive" | "overdue";
  isActiveNow?: boolean;
  trafficImpact?: Impact;
  trafficStatus?: RoadStatus;
  nextTrafficStatus?: { trafficStatus?: RoadStatus; nextChangeTime?: string };
  trafficEvent?: { trafficEventDescription?: string; trafficEventType?: string };
  trafficRegulations?: { description?: string; type?: string }[];
  startTime?: string;
  estimatedEndTime?: string;
  updatedTime?: string;
  hasAlternativeRoute?: boolean;
  /** Recurrence rules. Absent on most messages — see `ValidityPeriod`. */
  validityPeriods?: ValidityPeriod[];
  /**
   * In practice the ONLY reliable source of municipality — `location.municipalities`
   * was populated on 2 of 795 messages sampled. See `municipalitiesOf` in `roads.ts`.
   */
  locationDescriptionDetails?: { fromLocation?: Place; toLocation?: Place };
  location?: {
    isInTunnel?: boolean;
    isOnBridge?: boolean;
    isOnPass?: boolean;
    counties?: { name?: string; code?: number }[];
    municipalities?: { name?: string }[];
    /** `number` carries the category letter: "E6", "R3", "F27", "K123". */
    roads?: { name?: string; number?: string; category?: string }[];
  };
}

export interface MessagesResponse {
  type: string;
  features: { properties: Message }[];
}

/** Error whose message is meant to be read by the model, not just logged. */
export class TrafficError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "TrafficError";
  }
}
