import assert from "node:assert/strict";
import { test } from "node:test";
import { capped, summarise } from "../src/select.js";
import { byId } from "./fixtures.js";

/**
 * The regression guard for the worst defect found in review: a truncated list that
 * reported itself as complete. Same failure class as the F27 trap — an answer that
 * looks whole and is not.
 */

test("en liste som får plass, kappes ikke og sier ingenting", () => {
  const result = capped([1, 2, 3], 10);
  assert.deepEqual(result.vist, [1, 2, 3]);
  assert.equal(result.avkortet, undefined);
});

test("nøyaktig på grensen regnes ikke som avkortet", () => {
  const result = capped([1, 2, 3], 3);
  assert.deepEqual(result.vist, [1, 2, 3]);
  assert.equal(result.avkortet, undefined);
});

test("avkorting sier BÅDE hvor mange som vises og hvor mange som fantes", () => {
  const result = capped(Array.from({ length: 200 }, (_, i) => i), 40);
  assert.equal(result.vist.length, 40);
  assert.ok(result.avkortet, "avkorting skal aldri være stille");
  assert.match(result.avkortet, /40/);
  assert.match(result.avkortet, /200/);
});

test("summarise dropper felter som ikke betaler for seg", () => {
  const felter = Object.keys(summarise(byId("FIXTURE.venabygd")));
  // No tool takes an id as input, and the caller already filtered on county.
  assert.ok(!felter.includes("id"), `id skulle vært droppet, fant: ${felter}`);
  assert.ok(!felter.includes("fylker"), `fylker skulle vært droppet, fant: ${felter}`);
});

test("«når gjelder den» følger med når meldingen IKKE treffer reisen", () => {
  // Driving past at noon on a Monday: the night closure does not apply, so when it
  // does apply is exactly what the caller needs to know.
  const s = summarise(byId("FIXTURE.oyertunnelen"), {
    from: new Date("2026-08-10T11:00:00+02:00"),
    to: new Date("2026-08-10T13:00:00+02:00"),
  });
  assert.equal(s.gjelderPaaReisen, false);
  assert.ok(s.naarGjelderDen, "skal forklare når den gjelder");
});

test("«når gjelder den» utelates når meldingen treffer reisen uansett", () => {
  const s = summarise(byId("FIXTURE.oyertunnelen"), {
    from: new Date("2026-08-10T20:30:00+02:00"),
    to: new Date("2026-08-10T21:30:00+02:00"),
  });
  assert.equal(s.gjelderPaaReisen, true);
  assert.equal(s.naarGjelderDen, undefined);
});

test("uten reisevindu beholdes tidsforklaringen", () => {
  // A plain lookup has no journey to compare against, so the schedule still informs.
  const s = summarise(byId("FIXTURE.oyertunnelen"));
  assert.equal(s.gjelderPaaReisen, undefined);
  assert.ok(s.naarGjelderDen);
});
