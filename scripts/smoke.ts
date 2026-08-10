import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchMessages } from "../src/api.js";
import { fetchPoints } from "../src/counts.js";
import { selectMessages, summarise } from "../src/select.js";

/**
 * End-to-end check against the real API and the real server process.
 *
 * Lives outside `test/` on purpose. It needs the network, and a red build should mean
 * "the code is wrong", not "the wifi is down" — and `node --test <dir>` runs every file
 * in the directory it is given, so a network-dependent file placed there would be swept
 * into the unit-test run.
 *
 * It speaks MCP over stdio to a spawned server rather than importing the tools directly.
 * A unit test that imports a module never finds out whether the command starts at all —
 * and "it works when imported" is exactly how a server ships broken.
 */

const SERVER = fileURLToPath(new URL("../src/index.js", import.meta.url));

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

/** Sends a batch of JSON-RPC requests to a fresh server process and collects replies. */
function callServer(requests: unknown[]): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
    const replies: Record<string, unknown>[] = [];
    let buffer = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Serveren svarte ikke innen 45 s. stderr: ${stderr.slice(0, 500)}`));
    }, 45_000);

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      // One JSON-RPC message per line over stdio.
      for (const line of buffer.split("\n").slice(0, -1)) {
        if (line.trim()) replies.push(JSON.parse(line));
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
      if (replies.length >= requests.length) {
        clearTimeout(timer);
        child.kill();
        resolve(replies);
      }
    });

    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", reject);

    for (const req of requests) child.stdin.write(`${JSON.stringify(req)}\n`);
  });
}

console.log("\n1. Ekte API\n");

const messages = await fetchMessages(0);
check("henter meldinger", messages.length > 0, `${messages.length} meldinger`);

const withRecurrence = messages.filter((m) => m.validityPeriods?.length).length;
check("noen har gjentakelsesregler", withRecurrence > 0, `${withRecurrence} stk`);

// The trap this server exists to close: county roads are stored with an "F" prefix.
// If upstream ever changes that, this is where it surfaces.
const countyRoads = messages.filter((m) =>
  m.location?.roads?.some((r) => r.number?.startsWith("F")),
);
check("fylkesveier lagres med F-prefiks", countyRoads.length > 0, `${countyRoads.length} stk`);

const bareNumber = selectMessages(messages, { roads: ["27"] });
const prefixed = selectMessages(messages, { roads: ["fv27"] });
check(
  "søk på «27» finner minst like mye som «fv27»",
  bareNumber.length >= prefixed.length && prefixed.length >= 0,
  `27 → ${bareNumber.length}, fv27 → ${prefixed.length}`,
);

const municipalityFromDetails = messages.filter(
  (m) => m.locationDescriptionDetails?.fromLocation?.municipality,
).length;
check(
  "kommune finnes i locationDescriptionDetails",
  municipalityFromDetails > messages.length / 2,
  `${municipalityFromDetails}/${messages.length}`,
);

const sample = selectMessages(messages, { minImpact: "large" })[0];
check("kan oppsummere en melding", Boolean(sample && summarise(sample).sted));

// The counts API is a second upstream with its own notation. Both traps below are
// invisible from the messages side, so they have to be checked against live data.
const points = await fetchPoints(0);
check("henter tellepunkter", points.length > 0, `${points.length} punkter`);
check(
  "tellepunkter skriver vei som RV19/EV6, ikke R19/E6",
  points.some((p) => p.road?.startsWith("E")) && points.some((p) => p.road?.startsWith("F")),
  "oversatt til meldingenes skrivemåte",
);
check(
  "punktene bærer kommunenavn",
  points.filter((p) => p.municipality).length > points.length / 2,
  `${points.filter((p) => p.municipality).length}/${points.length}`,
);

console.log("\n2. Serveren som prosess (MCP over stdio)\n");

const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  },
};
const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };
const call = {
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: {
    name: "langs_ruta",
    arguments: {
      // County-based, which is the safe way in when the caller does not know the
      // municipalities — and deliberately capped low to prove truncation is visible.
      fylker: ["Innlandet"],
      vei: ["E6"],
      avreise: "2026-08-10T16:00:00+02:00",
      ankomst: "2026-08-10T22:00:00+02:00",
      maksAntall: 3,
    },
  },
};

const missingArea = {
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: { name: "langs_ruta", arguments: { vei: ["E6"] } },
};

const counts = {
  jsonrpc: "2.0",
  id: 5,
  method: "tools/call",
  params: {
    name: "naar_bor_jeg_kjore",
    arguments: { vei: ["E6"], kommune: ["Moss"], ukedag: "torsdag", uker: 2, maksPunkter: 1 },
  },
};

try {
  const replies = await callServer([init, list, call, missingArea, counts]);

  const listed = replies.find((r) => r.id === 2) as
    | { result?: { tools?: { name: string }[] } }
    | undefined;
  const names = (listed?.result?.tools ?? []).map((t) => t.name).sort();
  check("serveren starter og svarer på tools/list", names.length > 0, names.join(", "));
  check(
    "alle fire verktøyene er registrert",
    ["doctor", "langs_ruta", "naar_bor_jeg_kjore", "trafikkmeldinger"].every((n) =>
      names.includes(n),
    ),
  );

  const called = replies.find((r) => r.id === 3) as
    | { result?: { isError?: boolean; content?: { text?: string }[] } }
    | undefined;
  const text = called?.result?.content?.[0]?.text ?? "";
  check("langs_ruta svarer uten feil", called?.result?.isError !== true, text.slice(0, 120));

  const parsed = text ? JSON.parse(text) : {};
  check("svaret har et reisevindu", Boolean(parsed.reisevindu?.avreise));
  check("svaret oppgir kilde", typeof parsed._kilde === "string");
  check("fylke alene holder for å definere en strekning", parsed.antallPaaRuta > 0);

  // The defect this release fixes: a capped list must never look complete.
  check(
    "avkorting er synlig i svaret",
    parsed.antallSomTrefferDeg <= 3 || typeof parsed.avkortet === "string",
    parsed.avkortet ?? `traff ${parsed.antallSomTrefferDeg}, viste ${parsed.antallVist}`,
  );
  check(
    "antallTreff er FØR avkorting, ikke etter",
    parsed.antallSomTrefferDeg >= parsed.antallVist,
  );

  const refused = replies.find((r) => r.id === 4) as
    | { result?: { isError?: boolean; content?: { text?: string }[] } }
    | undefined;
  check(
    "uten fylker/kommuner avvises kallet med en brukbar beskjed",
    refused?.result?.isError === true &&
      /fylker|kommuner/i.test(refused.result.content?.[0]?.text ?? ""),
  );

  const counted = replies.find((r) => r.id === 5) as
    | { result?: { isError?: boolean; content?: { text?: string }[] } }
    | undefined;
  const countText = counted?.result?.content?.[0]?.text ?? "";
  check("naar_bor_jeg_kjore svarer uten feil", counted?.result?.isError !== true, countText.slice(0, 100));

  const profile = countText ? JSON.parse(countText) : {};
  const point = profile.punkter?.[0];
  check("fant et tellepunkt på E6 i Moss", Boolean(point?.punkt), point?.punkt);
  check("profilen dekker et døgn", Object.keys(point?.typiskPerTime ?? {}).length >= 20);
  // Rush hour is the whole reason this tool exists: if the busiest hour lands at 04,
  // the weekday or the aggregation is wrong, not the traffic.
  check(
    "travleste time er på dagtid",
    point?.toppTime?.time >= 6 && point?.toppTime?.time <= 20,
    `kl. ${point?.toppTime?.time} med ${point?.toppTime?.biler} biler`,
  );

  console.log(`\n   ${parsed.merknad ?? "(ingen merknad)"}`);
} catch (err) {
  check("serveren som prosess", false, (err as Error).message);
}

console.log(failures === 0 ? "\nAlt grønt.\n" : `\n${failures} sjekk(er) feilet.\n`);
process.exit(failures === 0 ? 0 : 1);
