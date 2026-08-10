import assert from "node:assert/strict";
import test from "node:test";
import { profileFor, roadOfPoint, weekdayOf, type HourSample } from "../src/counts.js";

/**
 * Fixed samples, no network and no clock: a green run means the aggregation is right,
 * not that the sensor happened to be healthy this week.
 */

test("veinummeret på et tellepunkt oversettes til meldingenes skrivemåte", () => {
  // The trap this exists for: the counts API writes RV19, the messages API writes R19.
  // Filtering one with the other's notation matches nothing — and nothing reads as
  // "quiet road", which is the same false negative F27 causes on the messages side.
  assert.equal(roadOfPoint("RV19 S1D1 m875", "R"), "R19");
  assert.equal(roadOfPoint("EV6 S23D1 m4020", "E"), "E6");
  assert.equal(roadOfPoint("KV2620 S1D20 m20", "K"), "K2620");
  assert.equal(roadOfPoint("FV27 S2D1 m100", "F"), "F27");
});

test("punkt uten veireferanse gir null, ikke et gjettet veinummer", () => {
  assert.equal(roadOfPoint(undefined, "R"), null);
  assert.equal(roadOfPoint("RV19 S1D1 m875", undefined), null);
  assert.equal(roadOfPoint("uten tall", "R"), null);
});

test("ukedag regnes ut fra datoen, ikke fra maskinens tidssone", () => {
  assert.equal(weekdayOf("2026-08-10"), 1); // mandag
  assert.equal(weekdayOf("2026-08-13"), 4); // torsdag
  assert.equal(weekdayOf("2026-08-16"), 7); // søndag
});

/** Four Thursdays and one Monday at the same hour, so weekday filtering is visible. */
function samples(): HourSample[] {
  const thursdays = ["2026-07-16", "2026-07-23", "2026-07-30", "2026-08-06"];
  const rows: HourSample[] = [];
  for (const [i, date] of thursdays.entries()) {
    rows.push({ date, hour: 8, volume: 1000 + i * 10, coverage: 100 });
    rows.push({ date, hour: 15, volume: 1800 + i * 10, coverage: 100 });
    rows.push({ date, hour: 3, volume: 40, coverage: 100 });
  }
  rows.push({ date: "2026-08-10", hour: 8, volume: 99_999, coverage: 100 });
  return rows;
}

test("profilen bruker bare den ukedagen du spurte om", () => {
  const { hours } = profileFor(samples(), 4);
  const eight = hours.find((h) => h.hour === 8);
  // The Monday outlier is 99 999 vehicles; if it leaked in, the median moves.
  assert.equal(eight?.typical, 1015);
  assert.equal(eight?.samples, 4);
});

test("medianen tåler en enkelt gal uke", () => {
  const withFestival = [...samples(), { date: "2026-08-13", hour: 15, volume: 9000, coverage: 100 }];
  const { hours } = profileFor(withFestival, 4);
  const three = hours.find((h) => h.hour === 15);
  // Mean would be ~3 250 and describe a week that never happens.
  assert.equal(three?.typical, 1820);
});

test("timer med for lav dekning forkastes i stedet for å telle som stille vei", () => {
  const halfDead: HourSample[] = [
    { date: "2026-07-16", hour: 8, volume: 1000, coverage: 100 },
    { date: "2026-07-23", hour: 8, volume: 200, coverage: 20 },
    { date: "2026-07-30", hour: 8, volume: 1020, coverage: 100 },
  ];
  const { hours, discarded } = profileFor(halfDead, 4);
  assert.equal(discarded, 1);
  assert.equal(hours.find((h) => h.hour === 8)?.typical, 1010);
  assert.equal(hours.find((h) => h.hour === 8)?.samples, 2);
});

test("manglende måling teller som forkastet, ikke som null biler", () => {
  const gap: HourSample[] = [
    { date: "2026-07-16", hour: 8, volume: null, coverage: null },
    { date: "2026-07-23", hour: 8, volume: 1000, coverage: 100 },
  ];
  const { hours, discarded } = profileFor(gap, 4);
  assert.equal(discarded, 1);
  assert.equal(hours.find((h) => h.hour === 8)?.typical, 1000);
});

test("ingen målinger gir tom profil, ikke en oppdiktet null", () => {
  const { hours, discarded } = profileFor([], 4);
  assert.deepEqual(hours, []);
  assert.equal(discarded, 0);
});
