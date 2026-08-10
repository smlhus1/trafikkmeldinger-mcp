#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clearCache, fetchMessages } from "./api.js";
import { selectMessages, summarise, type Filter } from "./select.js";
import { IMPACT_LEVELS, TrafficError, type Impact } from "./types.js";

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
      kommune: z.array(z.string()).optional().describe("Kommunenavn, f.eks. [\"Ringebu\", \"Øyer\"]."),
      fylke: z.array(z.string()).optional().describe("Fylkesnavn, f.eks. [\"Innlandet\"]."),
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
        limit: args.maksAntall ?? 40,
      };
      const all = await fetchMessages();
      const hits = selectMessages(all, filter);
      return {
        antall: hits.length,
        antallTotaltINorge: all.length,
        gjelderTidspunkt: at?.toISOString() ?? null,
        meldinger: hits.map((m) => summarise(m)),
      };
    }),
);

server.registerTool(
  "langs_ruta",
  {
    title: "Hva møter jeg på denne bilturen?",
    description:
      "Trafikkmeldinger for en konkret biltur, filtrert på både strekning og når du kjører. " +
      "Oppgi kommunene ruta går gjennom (det er slik strekningen defineres) og gjerne veinumrene. " +
      "Oppgi «avreise» og «ankomst» for å skille det som faktisk treffer deg fra alt som er " +
      "registrert på strekningen — nattestengte tunneler og arbeid som bare gjelder hverdager " +
      "blir da vurdert mot reisetidspunktet ditt, ikke mot «akkurat nå». " +
      "Svaret er sortert med det mest inngripende først.",
    inputSchema: {
      kommuner: z
        .array(z.string())
        .min(1)
        .describe("Kommunene ruta går gjennom, f.eks. [\"Eidsvoll\", \"Stange\", \"Ringebu\"]."),
      vei: z
        .array(z.string())
        .optional()
        .describe("Begrens til disse veiene, f.eks. [\"E6\", \"fv27\"]. Utelat for alle veier i kommunene."),
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
      const from = parseTime(args.avreise, "avreise") ?? new Date();
      const to = parseTime(args.ankomst, "ankomst") ?? new Date(from.getTime() + 6 * 3600_000);
      if (to.getTime() < from.getTime()) {
        throw new TrafficError("«ankomst» er før «avreise».");
      }

      const all = await fetchMessages();
      const onRoute = selectMessages(all, {
        roads: args.vei,
        municipalities: args.kommuner,
        minImpact: args.minsteVirkning as Impact | undefined,
      });
      const during = selectMessages(all, {
        roads: args.vei,
        municipalities: args.kommuner,
        minImpact: args.minsteVirkning as Impact | undefined,
        from,
        to,
        limit: args.maksAntall ?? 50,
      });

      const duringIds = new Set(during.map((m) => m.id));
      return {
        reisevindu: { avreise: from.toISOString(), ankomst: to.toISOString() },
        antallPaaRuta: onRoute.length,
        antallSomTrefferDeg: during.length,
        // Naming the gap explicitly: the difference between these two numbers is the
        // whole point of the tool, and a caller that sees only one of them cannot tell
        // whether a quiet answer means "clear road" or "wrong time filter".
        merknad:
          `${onRoute.length} meldinger er registrert på strekningen; ${during.length} av dem ` +
          `gjelder i reisevinduet ditt.`,
        meldinger: during.map((m) => summarise(m, { from, to })),
        ikkeIReisevinduet: onRoute
          .filter((m) => !duringIds.has(m.id))
          .slice(0, 20)
          .map((m) => ({
            sted: m.descriptionOfLocation ?? "",
            naarGjelderDen: m.validPeriodText ?? m.descriptionOfTrafficMessage ?? "",
          })),
      };
    }),
);

server.registerTool(
  "doctor",
  {
    title: "Svarer Vegvesenet akkurat nå?",
    description:
      "Kaller det ekte endepunktet og rapporterer om det svarer, hvor lang tid det tok og " +
      "hvor mange meldinger som ble hentet. Bruk denne når et av de andre verktøyene " +
      "oppfører seg rart, eller for å se om API-et har endret kontrakt.",
    inputSchema: {},
  },
  async () =>
    run(async () => {
      clearCache();
      const started = Date.now();
      const messages = await fetchMessages(0);
      const withRecurrence = messages.filter((m) => m.validityPeriods?.length).length;
      return {
        status: "ok",
        millisekunder: Date.now() - started,
        antallMeldinger: messages.length,
        medGjentakelsesregler: withRecurrence,
        endepunkt: "traffic-info.atlas.vegvesen.no/traffic-information/messages",
      };
    }),
);

await server.connect(new StdioServerTransport());
