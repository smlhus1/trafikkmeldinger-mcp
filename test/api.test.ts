import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearCache, fetchMessages } from "../src/api.js";
import { TrafficError } from "../src/types.js";

/**
 * The failure paths, which is where the one real bug so far actually lived: the server
 * shipped asking for `application/json` and got 406 from every call. Unit tests that
 * only cover the happy path would never have said a word about it.
 */

const realFetch = globalThis.fetch;

/**
 * Replaces fetch for one test, recording what the caller asked for.
 *
 * Takes a factory rather than a Response: a body can only be read once, so reusing one
 * instance across two calls fails with "ReadableStream is locked" — a test bug that
 * looks exactly like a caching bug.
 */
function stubFetch(makeResponse: () => Response) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return makeResponse();
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  clearCache();
});

const geoJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/vnd.svv.v1+geo+json;charset=utf-8" },
  });

test("ber om vendor-mediatypen, ikke application/json", async () => {
  // Asking for application/json is answered with 406 by the real endpoint.
  const calls = stubFetch(() => geoJson({ features: [] }));
  await fetchMessages(0);
  const accept = calls[0]?.headers["Accept"] ?? "";
  assert.match(accept, /vnd\.svv/);
  assert.doesNotMatch(accept, /^application\/json/);
});

test("sender X-System-ID, som endepunktet krever", async () => {
  const calls = stubFetch(() => geoJson({ features: [] }));
  await fetchMessages(0);
  assert.ok(calls[0]?.headers["X-System-ID"]);
});

test("406 blir en lesbar feil med statuskoden i behold", async () => {
  stubFetch(
    () =>
      new Response('{"message":"No acceptable representation"}', {
        status: 406,
        statusText: "Not Acceptable",
      }),
  );
  await assert.rejects(
    () => fetchMessages(0),
    (err: TrafficError) => {
      assert.ok(err instanceof TrafficError);
      assert.equal(err.status, 406);
      assert.match(err.message, /406/);
      return true;
    },
  );
});

test("en HTML-feilside med status 200 sier hva som er galt", async () => {
  stubFetch(
    () =>
      new Response("<!doctype html><h1>Gateway Timeout</h1>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  );
  await assert.rejects(
    () => fetchMessages(0),
    (err: TrafficError) => {
      // Not "Unexpected token <", which says nothing about the cause.
      assert.match(err.message, /ikke JSON|innholdstype/i);
      return true;
    },
  );
});

test("manglende «features» meldes som kontraktsbrudd", async () => {
  stubFetch(() => geoJson({ noeHeltAnnet: true }));
  await assert.rejects(() => fetchMessages(0), /features|kontrakt/i);
});

test("meldinger uten id forkastes i stedet for å velte alt nedstrøms", async () => {
  const calls = stubFetch(() =>
    geoJson({
      features: [
        { properties: { id: "A", trafficImpact: "small" } },
        { properties: { trafficImpact: "large" } },
        { properties: null },
      ],
    }),
  );
  const messages = await fetchMessages(0);
  assert.deepEqual(messages.map((m) => m.id), ["A"]);
  assert.equal(calls.length, 1);
});

test("cachen sparer nettverkskall, og tømming tvinger et nytt", async () => {
  const calls = stubFetch(() => geoJson({ features: [{ properties: { id: "A" } }] }));
  await fetchMessages(0);
  await fetchMessages(60_000);
  assert.equal(calls.length, 1, "andre kall skulle truffet cachen");

  clearCache();
  await fetchMessages(60_000);
  assert.equal(calls.length, 2, "etter tømming skulle den gått på nett igjen");
});
