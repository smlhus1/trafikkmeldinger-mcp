import { TrafficError, type Message, type MessagesResponse } from "./types.js";

/**
 * The only module that talks to the network.
 *
 * Two decisions worth knowing about:
 *
 * 1. We fetch the WHOLE country in one call and filter locally. The endpoint accepts a
 *    `countyNumber` filter, but using it would force every caller to know which counties
 *    a route crosses — the exact knowledge they came here to avoid needing. The full
 *    payload is ~2.4 MB and arrives in well under a second, so the trade is one larger
 *    request against a much smaller API surface.
 *
 * 2. `X-System-ID` is required. The value is not validated upstream, but omitting the
 *    header yields a 400 whose message explains nothing about the real cause.
 */

// The endpoint serves `application/vnd.svv.v1+geo+json`, and content negotiation is
// strict: `Accept: application/json` is answered with 406 Not Acceptable, and so is
// `application/geo+json`. Asking for the vendor type with a wildcard fallback is what
// actually works — do not "tidy" this back to application/json.
const ACCEPT = "application/vnd.svv.v1+geo+json, */*";

const MESSAGES_URL = "https://traffic-info.atlas.vegvesen.no/traffic-information/messages";

const SYSTEM_ID = "trafikkmeldinger-mcp";
const USER_AGENT = "trafikkmeldinger-mcp (+https://github.com/smlhus1/trafikkmeldinger-mcp)";

const TIMEOUT_MS = 30_000;

/** Roadworks do not change by the second, and one route lookup makes several passes. */
const CACHE_MS = 90_000;

/** A 2.4 MB payload is normal; ten times that means something upstream changed. */
const MAX_BYTES = 32 * 1024 * 1024;

let cache: { fetchedAt: number; messages: Message[] } | null = null;

/**
 * Every active and planned traffic message in Norway.
 *
 * @param maxAgeMs Accept a cached copy up to this old. Pass 0 to force a fresh call.
 */
export async function fetchMessages(maxAgeMs = CACHE_MS): Promise<Message[]> {
  if (cache && Date.now() - cache.fetchedAt <= maxAgeMs) return cache.messages;

  const body = await fetchJson(`${MESSAGES_URL}?lang=no`);

  if (!Array.isArray(body.features)) {
    throw new TrafficError(
      "Svaret fra Vegvesenet manglet feltet «features». API-et kan ha endret kontrakt.",
    );
  }

  // An id is what makes a message addressable and de-duplicable; one without it is
  // unusable downstream, so drop it here rather than guarding at every call site.
  const messages = body.features
    .map((f) => f.properties)
    .filter((m): m is Message => Boolean(m?.id));

  cache = { fetchedAt: Date.now(), messages };
  return messages;
}

/** Discards the cache, so a test never inherits state from an earlier one. */
export function clearCache(): void {
  cache = null;
}

async function fetchJson(url: string): Promise<MessagesResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "X-System-ID": SYSTEM_ID,
        "User-Agent": USER_AGENT,
        Accept: ACCEPT,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new TrafficError(`Vegvesenet svarte ikke innen ${TIMEOUT_MS / 1000} s.`);
    }
    throw new TrafficError(`Nådde ikke Vegvesenet: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new TrafficError(
      `Vegvesenet ga HTTP ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
      res.status,
    );
  }

  // Checked before parsing: an HTML error page parsed as JSON produces
  // "Unexpected token <", which says nothing about what actually went wrong.
  const contentType = res.headers.get("content-type") ?? "";
  if (!/json/i.test(contentType)) {
    throw new TrafficError(
      `Vegvesenet svarte med «${contentType || "ukjent type"}», ikke JSON. ` +
        "Endepunktet kan ha endret innholdstype.",
    );
  }

  const text = await readCapped(res);
  try {
    return JSON.parse(text) as MessagesResponse;
  } catch {
    throw new TrafficError(`Vegvesenet ga ugyldig JSON (${text.length} tegn lest).`);
  }
}

/** Streams the body so a runaway response cannot exhaust memory before we notice. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new TrafficError(`Svaret oversteg ${MAX_BYTES / 1024 / 1024} MB og ble avbrutt.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
