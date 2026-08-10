#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clearCache, fetchMessages } from "./api.js";
import {
  WEEKDAYS,
  clearCountsCache,
  fetchHours,
  fetchPoints,
  profileFor,
  weekdayOf,
} from "./counts.js";
import { normalisePlace, normaliseRoad } from "./roads.js";
import { capped, placeOf, selectMessages, summarise, type Filter } from "./select.js";
import { IMPACT_LEVELS, TrafficError, type Impact } from "./types.js";
import { appliesBetween } from "./validity.js";

/**
 * trafikkmeldinger-mcp — Norwegian road traffic messages, filtered to a journey.
 *
 * The value here is not fetching the data; it is answering "does this affect MY trip?"
 * Two things upstream make that answerable, and both are easy to get wrong:
 *
 *   - Recurrences are structured (`validityPeriods`), so a tunnel closed 20:00-06:00 can
 *     be evaluated against a departure time instead of against "is it closed right now".
 *   - Road numbers carry a category letter — "27" is stored as "F27" — so the obvious
 *     filter returns nothing and nothing reads as "the road is clear".
 *
 * See `validity.ts` and `roads.ts` respectively.
 */

const ATTRIBUTION = "Statens vegvesen. Vilkår: https://www.vegvesen.no/om-oss/om-organisasjonen/apne-data/";

const server = new McpServer({ name: "trafikkmeldinger", version: "0.1.0" });

/** Parses a user-supplied timestamp, failing loudly rather than silently meaning "now". */
function parseTime(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new TrafficError(
      `«${field}» må være et tidspunkt på ISO-format, f.eks. 2026-08-10T18:30 eller ` +
        `2026-08-10T18:30:00+02:00. Fikk: ${value}`,
    );
  }
  return new Date(ms);
}

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ...(payload as object), _kilde: ATTRIBUTION }, null, 2),
      },
    ],
  };
}

/** One place where a thrown error becomes a message the model can act on. */
async function run(fn: () => Promise<unknown>) {
  try {
    return textResult(await fn());
  } catch (err) {
    const message =
      err instanceof TrafficError ? err.message : `Uventet feil: ${(err as Error).message}`;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

server.registerTool(
  "trafikkmeldinger",
  {
    title: "Trafikkmeldinger for et område eller en vei",
    description:
      "Henter vegarbeid, stengte veier, ulykker og andre trafikkmeldinger fra Statens vegvesen, " +
      "med filter på vei, kommune, fylke og hvor mye det påvirker trafikken. " +
      "Veinummer kan skrives slik folk snakker: «E6», «fv27», «riksveg 3» eller bare «27». " +
      "Uten «tidspunkt» får du alt som er registrert, også nattarbeid som ikke er aktivt akkurat nå — " +
      "oppgi «tidspunkt» for å se kun det som faktisk gjelder da. " +
      "Skal du planlegge en biltur, bruk heller verktøyet «langs_ruta».",
    inputSchema: {
      vei: z
        .array(z.string())
        .optional()
        .describe("Veinummer, f.eks. [\"E6\", \"fv27\"]. Bare tall matcher alle veiklasser."),
      kommune: z
        .array(z.string())
        .optional()
        .describe("Kommunenavn med æøå, f.eks. [\"Ringebu\", \"Øyer\"]. «Oyer» gir null treff."),
      fylke: z.array(z.string()).optional().describe("Fylkesnavn med æøå, f.eks. [\"Innlandet\"]."),
      minsteVirkning: z
        .enum(IMPACT_LEVELS)
        .optional()
        .describe("Utelat alt som påvirker trafikken mindre enn dette. «large» = merkbar forsinkelse."),
      tidspunkt: z
        .string()
        .optional()
        .describe("ISO-tidspunkt. Filtrerer til meldinger som faktisk gjelder da."),
      maksAntall: z.number().int().positive().max(200).optional().describe("Standard 40."),
    },
  },
  async (args) =>
    run(async () => {
      const at = parseTime(args.tidspunkt, "tidspunkt");
      const filter: Filter = {
        roads: args.vei,
        municipalities: args.kommune,
        counties: args.fylke,
        minImpact: args.minsteVirkning as Impact | undefined,
        at,
      };
      const all = await fetchMessages();
      const hits = selectMessages(all, filter);
      const { vist, avkortet } = capped(hits, args.maksAntall ?? 40);
      return {
        antallTreff: hits.length,
        antallVist: vist.length,
        ...(avkortet ? { avkortet } : {}),
        gjelderTidspunkt: at?.toISOString() ?? null,
        meldinger: vist.map((m) => summarise(m)),
      };
    }),
);

server.registerTool(
  "langs_ruta",
  {
    title: "Hva møter jeg på denne bilturen?",
    description:
      "Trafikkmeldinger for en konkret biltur, filtrert på både strekning og når du kjører. " +
      "Definer strekningen med «fylker» ELLER «kommuner» (minst én av dem), og helst «vei». " +
      "**Er du usikker på hvilke kommuner ruta går gjennom, bruk fylker** — en glemt kommune " +
      "fjerner meldingene der uten å si fra, mens fylke + vei treffer nesten like presist. " +
      "Oppgi «avreise» og «ankomst» for å skille det som faktisk treffer deg fra alt som er " +
      "registrert på strekningen — nattestengte tunneler og arbeid som bare gjelder hverdager " +
      "blir da vurdert mot reisetidspunktet ditt, ikke mot «akkurat nå». " +
      "Svaret er sortert med det mest inngripende først.",
    inputSchema: {
      fylker: z
        .array(z.string())
        .optional()
        .describe(
          "Fylkene ruta går gjennom, f.eks. [\"Østfold\", \"Akershus\", \"Oslo\", \"Innlandet\"]. " +
            "Tryggest når du ikke kjenner kommunene. Skriv æøå — «Ostfold» gir null treff.",
        ),
      kommuner: z
        .array(z.string())
        .optional()
        .describe(
          "Kommunene ruta går gjennom, f.eks. [\"Eidsvoll\", \"Stange\", \"Ringebu\"]. " +
            "Mer presist enn fylker, men utelater du én, mister du meldingene der. " +
            "Skriv æøå — «Oyer» gir null treff.",
        ),
      vei: z
        .array(z.string())
        .optional()
        .describe("Begrens til disse veiene, f.eks. [\"E6\", \"fv27\"]. Utelat for alle veier på strekningen."),
      avreise: z.string().optional().describe("ISO-tidspunkt for når du starter. Standard: nå."),
      ankomst: z
        .string()
        .optional()
        .describe("ISO-tidspunkt for når du er framme. Standard: 6 timer etter avreise."),
      minsteVirkning: z
        .enum(IMPACT_LEVELS)
        .optional()
        .describe("Utelat bagateller. Standard: ta med alt."),
      maksAntall: z.number().int().positive().max(200).optional().describe("Standard 50."),
    },
  },
  async (args) =>
    run(async () => {
      if (!args.fylker?.length && !args.kommuner?.length) {
        throw new TrafficError(
          "Oppgi «fylker» eller «kommuner» for å definere strekningen. Er du usikker på " +
            "kommunene, bruk fylker — f.eks. fylker: [\"Innlandet\"], vei: [\"E6\"].",
        );
      }

      const from = parseTime(args.avreise, "avreise") ?? new Date();
      const to = parseTime(args.ankomst, "ankomst") ?? new Date(from.getTime() + 6 * 3600_000);
      if (to.getTime() < from.getTime()) {
        throw new TrafficError("«ankomst» er før «avreise».");
      }

      const all = await fetchMessages();
      // One pass over the place/road filter, then partition by time. Two passes did the
      // same geographic work twice and made the two lists able to disagree.
      const onRoute = selectMessages(all, {
        roads: args.vei,
        municipalities: args.kommuner,
        counties: args.fylker,
        minImpact: args.minsteVirkning as Impact | undefined,
      });
      const during = onRoute.filter((m) => appliesBetween(m, from, to));
      const outside = onRoute.filter((m) => !appliesBetween(m, from, to));

      const { vist, avkortet } = capped(during, args.maksAntall ?? 50);
      const utenfor = capped(outside, 20);

      return {
        reisevindu: { avreise: from.toISOString(), ankomst: to.toISOString() },
        // Naming the gap explicitly: the difference between these two numbers is the
        // whole point of the tool, and a caller that sees only one of them cannot tell
        // whether a quiet answer means "clear road" or "wrong time filter".
        antallPaaRuta: onRoute.length,
        antallSomTrefferDeg: during.length,
        antallVist: vist.length,
        ...(avkortet ? { avkortet } : {}),
        merknad:
          `${onRoute.length} meldinger er registrert på strekningen; ${during.length} av dem ` +
          `gjelder i reisevinduet ditt.`,
        meldinger: vist.map((m) => summarise(m, { from, to })),
        ikkeIReisevinduet: utenfor.vist.map((m) => ({
          sted: placeOf(m),
          naarGjelderDen: m.validPeriodText ?? m.descriptionOfTrafficMessage ?? "",
        })),
        ...(utenfor.avkortet ? { ikkeIReisevinduetAvkortet: utenfor.avkortet } : {}),
      };
    }),
);

/** Today's date where the traffic is, not where the process happens to run. */
function todayInOslo(): string {
  // sv-SE formats as YYYY-MM-DD, which is what `weekdayOf` parses.
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(new Date());
}

server.registerTool(
  "naar_bor_jeg_kjore",
  {
    title: "Når er det stille på denne veien?",
    description:
      "Typisk trafikkmengde time for time på en gitt ukedag, målt av Vegvesenets tellepunkter — " +
      "sløyfer i asfalten som teller hver bil som passerer. Svarer på «når bør jeg dra» og " +
      "«hvor mye sparer jeg på å vente en time», ikke på hva som skjer akkurat nå. " +
      "Tallene er medianer over flere uker, så én stengt vei eller én helligdag flytter dem ikke. " +
      "Merk: et tellepunkt vet alt om sitt eget punkt og ingenting om veien mellom punktene. " +
      "Skal du vite om det er vegarbeid eller stengt vei, bruk «langs_ruta».",
    inputSchema: {
      vei: z
        .array(z.string())
        .optional()
        .describe("Veinummer, f.eks. [\"E6\"]. Bare tall matcher alle veiklasser."),
      kommune: z
        .array(z.string())
        .optional()
        .describe("Kommunenavn med æøå, f.eks. [\"Moss\"]. «Oyer» gir null treff."),
      fylke: z.array(z.string()).optional().describe("Fylkesnavn med æøå, f.eks. [\"Østfold\"]."),
      ukedag: z
        .enum(WEEKDAYS)
        .optional()
        .describe("Hvilken ukedag du planlegger å kjøre. Standard: i dag."),
      uker: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe("Hvor mange uker historikk medianen bygger på. Standard 4."),
      maksPunkter: z.number().int().positive().max(5).optional().describe("Standard 3."),
    },
  },
  async (args) =>
    run(async () => {
      const roads = new Set((args.vei ?? []).flatMap(normaliseRoad).map((r) => r.toUpperCase()));
      const municipalities = new Set((args.kommune ?? []).map(normalisePlace));
      const counties = new Set((args.fylke ?? []).map(normalisePlace));
      if (!roads.size && !municipalities.size && !counties.size) {
        throw new TrafficError(
          "Oppgi «vei», «kommune» eller «fylke» — ellers ville svaret vært hele Norge.",
        );
      }

      const points = (await fetchPoints()).filter(
        (p) =>
          (!roads.size || (p.road !== null && roads.has(p.road))) &&
          (!municipalities.size ||
            (p.municipality !== null && municipalities.has(normalisePlace(p.municipality)))) &&
          (!counties.size || (p.county !== null && counties.has(normalisePlace(p.county)))),
      );

      const weekdayName = args.ukedag ?? WEEKDAYS[weekdayOf(todayInOslo()) - 1]!;
      const weekday = WEEKDAYS.indexOf(weekdayName) + 1;
      const weeks = args.uker ?? 4;
      const to = new Date();
      const from = new Date(to.getTime() - weeks * 7 * 24 * 3600_000);

      const { vist, avkortet } = capped(points, args.maksPunkter ?? 3);

      const målt = await Promise.all(
        vist.map(async (point) => {
          const { hours, discarded } = profileFor(await fetchHours(point.id, from, to), weekday);
          const sted = [point.municipality, point.county].filter(Boolean).join(", ");
          const base = {
            punkt: point.name,
            ...(point.road ? { vei: point.road } : {}),
            ...(sted ? { sted } : {}),
            ...(point.direction ? { retning: point.direction } : {}),
          };

          if (hours.length === 0) {
            return { ...base, merknad: `Ingen brukbare målinger på ${weekdayName} i perioden.` };
          }

          const busiest = hours.reduce((a, b) => (b.typical > a.typical ? b : a));
          // Daytime only: 04:00 is always the quietest hour and never the advice
          // anyone was asking for.
          const daytime = hours.filter((h) => h.hour >= 6 && h.hour <= 21);
          const calmest = daytime.length
            ? daytime.reduce((a, b) => (b.typical < a.typical ? b : a))
            : null;

          return {
            ...base,
            typiskPerTime: Object.fromEntries(
              hours.map((h) => [String(h.hour).padStart(2, "0"), h.typical]),
            ),
            toppTime: { time: busiest.hour, biler: busiest.typical },
            ...(calmest ? { roligsteDagtid: { time: calmest.hour, biler: calmest.typical } } : {}),
            // A median of two weeks is a median of two numbers; say so rather than
            // let a thin sample look like a measured fact.
            ukerBakTallene: Math.max(...hours.map((h) => h.samples)),
            ...(discarded ? { forkastedeTimer: discarded } : {}),
          };
        }),
      );

      return {
        ukedag: weekdayName,
        basertPaa: { uker: weeks, fra: from.toISOString(), til: to.toISOString() },
        antallPunkterFunnet: points.length,
        antallVist: vist.length,
        ...(avkortet ? { avkortet } : {}),
        merknad:
          "Tall er biler per time, median over ukene i perioden. Timer der sensoren målte " +
          "under 90 % av tiden er forkastet, ikke skalert.",
        punkter: målt,
      };
    }),
);

server.registerTool(
  "doctor",
  {
    title: "Svarer Vegvesenet akkurat nå?",
    description:
      "Kaller begge de ekte endepunktene — trafikkmeldinger og tellepunkter — og rapporterer " +
      "om de svarer, hvor lang tid det tok og hvor mye som ble hentet. Bruk denne når et av " +
      "de andre verktøyene oppfører seg rart, eller for å se om et API har endret kontrakt.",
    inputSchema: {},
  },
  async () =>
    run(async () => {
      clearCache();
      clearCountsCache();

      const startedMessages = Date.now();
      const messages = await fetchMessages(0);
      const messageMs = Date.now() - startedMessages;

      const startedPoints = Date.now();
      const points = await fetchPoints(0);
      const pointMs = Date.now() - startedPoints;

      return {
        status: "ok",
        meldinger: {
          millisekunder: messageMs,
          antall: messages.length,
          medGjentakelsesregler: messages.filter((m) => m.validityPeriods?.length).length,
          endepunkt: "traffic-info.atlas.vegvesen.no/traffic-information/messages",
        },
        tellepunkter: {
          millisekunder: pointMs,
          antall: points.length,
          medVeinummer: points.filter((p) => p.road).length,
          endepunkt: "trafikkdata-api.atlas.vegvesen.no",
        },
      };
    }),
);

await server.connect(new StdioServerTransport());
