import assert from "node:assert/strict";
import { test } from "node:test";
import { impactRank } from "../src/roads.js";
import { selectMessages } from "../src/select.js";
import { IMPACT_LEVELS } from "../src/types.js";
import { MESSAGES } from "./fixtures.js";

test("rangeringen følger rekkefølgen i IMPACT_LEVELS", () => {
  // The list IS the ranking. This fails if someone reintroduces a second severity
  // table and the two drift apart.
  for (let i = 1; i < IMPACT_LEVELS.length; i++) {
    const lower = IMPACT_LEVELS[i - 1]!;
    const higher = IMPACT_LEVELS[i]!;
    assert.ok(
      impactRank(higher) > impactRank(lower),
      `${higher} skal rangeres over ${lower}`,
    );
  }
});

test("ukjent er lavest, så en ny verdi fra Vegvesenet aldri sorterer øverst", () => {
  assert.equal(impactRank("unknown"), 0);
  assert.equal(impactRank(undefined), 0);
  // A value upstream might add tomorrow must not outrank a closed road.
  assert.equal(impactRank("hypotetisk_ny_verdi" as never), 0);
});

test("hvert nivå kan brukes som minsteVirkning uten å kaste", () => {
  for (const level of IMPACT_LEVELS) {
    const hits = selectMessages(MESSAGES, { minImpact: level });
    assert.ok(Array.isArray(hits), `${level} ga ikke en liste`);
  }
});

test("minsteVirkning slipper gjennom nøyaktig det som er like alvorlig eller verre", () => {
  const all = selectMessages(MESSAGES, {});
  for (const level of IMPACT_LEVELS) {
    const hits = selectMessages(MESSAGES, { minImpact: level });
    const expected = all.filter((m) => impactRank(m.trafficImpact) >= impactRank(level));
    assert.equal(hits.length, expected.length, `feil antall for ${level}`);
  }
});
