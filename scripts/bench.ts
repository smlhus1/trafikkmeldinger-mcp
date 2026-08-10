import { fetchMessages } from "../src/api.js";
import { selectMessages } from "../src/select.js";

/**
 * Measures the route filter on a long, realistic journey.
 *
 * `appliesBetween` samples the travel window per message, so cost scales with
 * messages x steps. This exists to find out whether that is actually cheap before
 * anyone optimises it on a hunch.
 */

const messages = await fetchMessages(0);
console.log(`meldinger i datasettet: ${messages.length}`);

// Halden -> Venabu: a long route, and a 6-hour window (24 sampling steps).
const KOMMUNER = [
  "Halden", "Sarpsborg", "Moss", "Vestby", "Ås", "Nordre Follo", "Oslo",
  "Lillestrøm", "Ullensaker", "Eidsvoll", "Stange", "Hamar", "Ringsaker",
  "Lillehammer", "Øyer", "Ringebu",
];

for (const label of ["uten tidsfilter", "med 6-timers reisevindu"]) {
  const filter =
    label === "uten tidsfilter"
      ? { roads: ["E6", "fv27"], municipalities: KOMMUNER }
      : {
          roads: ["E6", "fv27"],
          municipalities: KOMMUNER,
          from: new Date("2026-08-10T16:00:00+02:00"),
          to: new Date("2026-08-10T22:00:00+02:00"),
        };

  const started = process.hrtime.bigint();
  let hits = 0;
  const RUNS = 20;
  for (let i = 0; i < RUNS; i++) hits = selectMessages(messages, filter).length;
  const ms = Number(process.hrtime.bigint() - started) / 1e6 / RUNS;

  console.log(`${label.padEnd(26)} ${ms.toFixed(1)} ms/kall  (${hits} treff)`);
}
