import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countiesOf,
  impactRank,
  municipalitiesOf,
  normaliseRoad,
  onAnyRoad,
} from "../src/roads.js";
import { selectMessages } from "../src/select.js";
import type { Message } from "../src/types.js";
import { MESSAGES, byId } from "./fixtures.js";

test("veinummer med kategoribokstav tolkes som skrevet", () => {
  assert.deepEqual(normaliseRoad("E6"), ["E6"]);
  assert.deepEqual(normaliseRoad("e6"), ["E6"]);
  assert.deepEqual(normaliseRoad("fv27"), ["F27"]);
  assert.deepEqual(normaliseRoad("Fv. 27"), ["F27"]);
  assert.deepEqual(normaliseRoad("riksveg 3"), ["R3"]);
});

test("bart tall utvides til alle veiklasser i stedet for å gjette", () => {
  // The regression this whole module exists for: filtering on the literal "27"
  // matched nothing, and an empty result reads exactly like "the road is clear".
  assert.deepEqual(normaliseRoad("27"), ["E27", "R27", "F27", "K27"]);
});

test("søk på «27» finner fylkesveimeldingen som er lagret som F27", () => {
  const hits = selectMessages(MESSAGES, { roads: ["27"] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.id, "FIXTURE.venabygd");
});

test("søk på «fv27» finner den samme", () => {
  const hits = selectMessages(MESSAGES, { roads: ["fv27"] });
  assert.equal(hits[0]?.id, "FIXTURE.venabygd");
});

test("søk på E6 tar ikke med fylkesveien", () => {
  const hits = selectMessages(MESSAGES, { roads: ["E6"] });
  assert.equal(hits.length, 3);
  assert.ok(!hits.some((m) => m.id === "FIXTURE.venabygd"));
});

test("ugyldig veinummer gir ingen treff, ikke alle treff", () => {
  assert.deepEqual(normaliseRoad("motorveien"), []);
  assert.deepEqual(normaliseRoad(""), []);
});

test("tomt veifilter betyr alle veier", () => {
  assert.equal(onAnyRoad(byId("FIXTURE.oyertunnelen"), new Set()), true);
});

test("kommune leses fra locationDescriptionDetails når municipalities er tom", () => {
  // location.municipalities was populated on 2 of 795 real messages; a filter that
  // trusted it alone would drop almost everything.
  const venabygd = byId("FIXTURE.venabygd");
  assert.equal(venabygd.location?.municipalities?.length, 0);
  assert.deepEqual([...municipalitiesOf(venabygd)], ["Ringebu"]);
  assert.deepEqual([...countiesOf(venabygd)], ["Innlandet"]);
});

test("kommunefilter er ufølsomt for store bokstaver, men ikke for æøå", () => {
  assert.equal(selectMessages(MESSAGES, { municipalities: ["ringebu"] }).length, 1);
  assert.equal(selectMessages(MESSAGES, { municipalities: ["RINGEBU"] }).length, 1);
  // "Sør-Fron" and a hypothetical "Sor-Fron" are different places; no folding.
  assert.equal(selectMessages(MESSAGES, { municipalities: ["Sør-Fron"] }).length, 1);
  assert.equal(selectMessages(MESSAGES, { municipalities: ["Sor-Fron"] }).length, 0);
});

test("virkning rangeres slik at det verste kommer først", () => {
  assert.ok(impactRank("very_large") > impactRank("large"));
  assert.ok(impactRank("large") > impactRank("small"));
  assert.ok(impactRank("small") > impactRank("none"));
  assert.ok(impactRank("none") > impactRank("unknown"));
  assert.equal(impactRank(undefined), 0);
});

test("resultatet sorteres verst først", () => {
  const hits = selectMessages(MESSAGES, {});
  assert.equal(hits[0]?.id, "FIXTURE.hundorp");
  assert.equal(hits[1]?.id, "FIXTURE.venabygd");
});

test("minsteVirkning luker bort bagatellene", () => {
  const hits = selectMessages(MESSAGES, { minImpact: "large" });
  assert.deepEqual(
    hits.map((m) => m.id).sort(),
    ["FIXTURE.hundorp", "FIXTURE.venabygd"],
  );
});
