import assert from "node:assert/strict";
import { test } from "node:test";
import { selectMessages } from "../src/select.js";
import { appliesAt, appliesBetween } from "../src/validity.js";
import { MESSAGES, byId } from "./fixtures.js";

/** 10 Aug 2026 is a Monday, 15 Aug a Saturday. Both in CEST (+02:00). */
const MONDAY_NOON = new Date("2026-08-10T12:00:00+02:00");
const MONDAY_EVENING = new Date("2026-08-10T21:00:00+02:00");
const TUESDAY_EARLY = new Date("2026-08-11T03:00:00+02:00");
const SATURDAY_EVENING = new Date("2026-08-15T21:00:00+02:00");

test("nattestengt tunnel gjelder ikke midt på dagen", () => {
  assert.equal(appliesAt(byId("FIXTURE.oyertunnelen"), MONDAY_NOON), false);
});

test("nattestengt tunnel gjelder på mandag kveld", () => {
  assert.equal(appliesAt(byId("FIXTURE.oyertunnelen"), MONDAY_EVENING), true);
});

test("nattestengt tunnel gjelder etter midnatt, som er en egen periode", () => {
  // Upstream splits a 20:00-06:00 closure into two windows so neither crosses midnight.
  // Getting this wrong would report the road open at 03:00.
  assert.equal(appliesAt(byId("FIXTURE.oyertunnelen"), TUESDAY_EARLY), true);
});

test("nattestengt tunnel gjelder ikke lørdag, selv på samme klokkeslett", () => {
  assert.equal(appliesAt(byId("FIXTURE.oyertunnelen"), SATURDAY_EVENING), false);
});

test("isActiveNow er ikke det samme som «gjelder ikke for meg»", () => {
  // The message reports isActiveNow: false, yet it closes the road during an evening
  // drive. Filtering on that flag is what makes an app miss the worst item on the trip.
  const tunnel = byId("FIXTURE.oyertunnelen");
  assert.equal(tunnel.isActiveNow, false);
  assert.equal(appliesAt(tunnel, MONDAY_EVENING), true);
});

test("dagarbeid gjelder i arbeidstiden på hverdag", () => {
  assert.equal(appliesAt(byId("FIXTURE.venabygd"), MONDAY_NOON), true);
  assert.equal(appliesAt(byId("FIXTURE.venabygd"), MONDAY_EVENING), false);
  assert.equal(appliesAt(byId("FIXTURE.venabygd"), SATURDAY_EVENING), false);
});

test("melding uten gjentakelsesregler gjelder sammenhengende", () => {
  const espa = byId("FIXTURE.espa");
  assert.equal(espa.validityPeriods, undefined);
  assert.equal(appliesAt(espa, MONDAY_NOON), true);
  assert.equal(appliesAt(espa, MONDAY_EVENING), true);
  // ...but not before it starts or after it ends.
  assert.equal(appliesAt(espa, new Date("2026-08-09T12:00:00+02:00")), false);
  assert.equal(appliesAt(espa, new Date("2026-08-20T12:00:00+02:00")), false);
});

test("reisevindu fanger en stengning som starter underveis", () => {
  // Leaving at 18:00 and arriving 22:00 means driving into the 20:00 closure.
  const from = new Date("2026-08-10T18:00:00+02:00");
  const to = new Date("2026-08-10T22:00:00+02:00");
  assert.equal(appliesBetween(byId("FIXTURE.oyertunnelen"), from, to), true);
});

test("reisevindu som slutter før stengningen treffer den ikke", () => {
  const from = new Date("2026-08-10T14:00:00+02:00");
  const to = new Date("2026-08-10T19:00:00+02:00");
  assert.equal(appliesBetween(byId("FIXTURE.oyertunnelen"), from, to), false);
});

test("reisevindu tester også sluttidspunktet", () => {
  // A window ending exactly inside the closure must still count; sampling by step
  // alone would step past it.
  const from = new Date("2026-08-10T19:50:00+02:00");
  const to = new Date("2026-08-10T20:05:00+02:00");
  assert.equal(appliesBetween(byId("FIXTURE.oyertunnelen"), from, to), true);
});

test("snudd reisevindu tolkes likt som riktig vei", () => {
  const early = new Date("2026-08-10T18:00:00+02:00");
  const late = new Date("2026-08-10T22:00:00+02:00");
  const tunnel = byId("FIXTURE.oyertunnelen");
  assert.equal(appliesBetween(tunnel, late, early), appliesBetween(tunnel, early, late));
});

test("kveldstur på E6 gjennom Øyer viser tunnelen, dagstur gjør det ikke", () => {
  const route = { roads: ["E6"], municipalities: ["Øyer"] };
  const evening = selectMessages(MESSAGES, {
    ...route,
    from: new Date("2026-08-10T18:00:00+02:00"),
    to: new Date("2026-08-10T22:00:00+02:00"),
  });
  const daytime = selectMessages(MESSAGES, {
    ...route,
    from: new Date("2026-08-10T10:00:00+02:00"),
    to: new Date("2026-08-10T14:00:00+02:00"),
  });
  assert.deepEqual(evening.map((m) => m.id), ["FIXTURE.oyertunnelen"]);
  assert.deepEqual(daytime.map((m) => m.id), []);
});
