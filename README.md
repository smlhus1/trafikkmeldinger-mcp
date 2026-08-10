# trafikkmeldinger-mcp

MCP-server for **norsk veitrafikk** — vegarbeid, stengte veier og omkjøringer fra Statens
vegvesen, filtrert på ruta di og **når du faktisk kjører**. Og hvor mange biler som faktisk
kjører der, time for time, så «når bør jeg dra» slutter å være gjetting.

**Ingen API-nøkkel.** Endepunktet er åpent — klon, bygg, kjør.

## Hvorfor ikke bare slå opp på vegvesen.no?

Fordi nettsida og appen svarer på «hva er stengt *nå*». Det er sjelden spørsmålet ditt når du
planlegger en tur.

Et konkret eksempel. En kveldstur nordover E6 gjennom Øyer 10. august 2026:

```
E6 Øyertunnelen i Øyer
  isActiveNow: false          ← klokka er 12, tunnelen er åpen
  stengt 20:00–06:00 mandag–torsdag, 10.–14. august
```

Kjører du forbi klokka 21, er veien stengt. Men meldingen rapporterer `isActiveNow: false`
midt på dagen, så et filter på «aktiv nå» dropper den — og det er den mest inngripende
meldingen på hele turen.

Vegvesenet publiserer heldigvis gjentakelsene som **strukturerte data**, ikke bare som prosa.
Denne serveren tolker dem, slik at du kan spørre om et *framtidig* tidspunkt.

## Tre feller denne serveren lukker

**1. Fylkesveier lagres med kategoribokstav.** Det alle skriver som «fv. 27» eller bare «27»
ligger som `F27`. Et filter på strengen `"27"` gir null treff — og null treff ser nøyaktig ut
som «ingen vegarbeid på strekningen». Det er den farligste feilen denne serveren kan gjøre, så
et bart tall utvides til alle fire veiklassene (`E27`, `R27`, `F27`, `K27`) framfor å gjette.

**2. Kommune ligger ikke der du tror.** Feltet `location.municipalities` er tomt på nesten alle
meldinger — 2 av 1 293 målt 10. august 2026. Kommunen står i `locationDescriptionDetails`. Et
geografisk filter bygget på det strukturerte-utseende feltet alene mister nesten alt.

**3. De to Vegvesen-API-ene skriver veinummer ulikt.** Et tellepunkt oppgir veien sin som
`RV19`, `EV6`, `KV2620`. En trafikkmelding skriver `R19`, `E6`, `K2620`. Samme etat, to
konvensjoner — og filtrerer du tellepunkter med meldingenes skrivemåte, får du null treff.
Serveren oversetter til én skrivemåte i `roadOfPoint`, slik at resten av koden bare ser den ene.

Alle tre er dekket av tester, så en regresjon gir rødt bygg.

## Installasjon

Krever **Node 20 eller nyere**.

```bash
git clone https://github.com/smlhus1/trafikkmeldinger-mcp.git
cd trafikkmeldinger-mcp
npm install
npm run build
```

Legg den til i Claude Code:

```bash
claude mcp add trafikkmeldinger -- node /full/sti/til/trafikkmeldinger-mcp/dist/src/index.js
```

Eller i `.mcp.json`:

```json
{
  "mcpServers": {
    "trafikkmeldinger": {
      "command": "node",
      "args": ["/full/sti/til/trafikkmeldinger-mcp/dist/src/index.js"]
    }
  }
}
```

## Verktøy

### `langs_ruta`

Trafikkmeldinger for en konkret biltur. Definer strekningen med **fylker eller kommuner**, og
gjerne når du kjører.

```jsonc
{
  "fylker": ["Akershus", "Innlandet"],
  "vei": ["E6", "fv27"],
  "avreise": "2026-08-10T16:00:00+02:00",
  "ankomst": "2026-08-10T22:00:00+02:00"
}
```

**Bruk fylker når du er usikker.** Kommuner er mer presist, men utelater du én, forsvinner
meldingene der uten et ord — og fylke kombinert med veinummer treffer nesten like presist.
Feil skal helle mot å vise for mye, ikke for lite.

**Skriv æ, ø og å.** Stedsnavn sammenlignes eksakt (store og små bokstaver spiller ingen rolle,
men bokstavene gjør det): `Sør-Fron` treffer, `Sor-Fron` gir null treff — og null treff ser
nøyaktig ut som en rein vei. Samme gjelder fylker.

Svaret skiller det som **treffer deg** fra det som bare er registrert på strekningen:

```jsonc
{
  "reisevindu": { "avreise": "...", "ankomst": "..." },
  "antallPaaRuta": 19,
  "antallSomTrefferDeg": 13,
  "antallVist": 3,
  "avkortet": "Viser 3 av 13. Øk «maksAntall» eller snevre inn filteret.",
  "merknad": "19 meldinger er registrert på strekningen; 13 av dem gjelder i reisevinduet ditt.",
  "meldinger": [ /* verst først */ ],
  "ikkeIReisevinduet": [ /* med når de faktisk gjelder */ ]
}
```

Alle tallene oppgis med vilje. Ser du bare ett av dem, kan du ikke skille «rein vei» fra «feil
tidsfilter» fra «lista ble kappet».

### Svarformat per melding

```jsonc
{
  "sted": "E6 Strandløkken - Strandlykkja, Stange, Innlandet, retning mot Gardermoen",
  "melding": "Vegarbeid, vegen er stengt. Omkjøring er skiltet.",
  "veier": ["E6"],
  "virkning": "large",          // none | small | large | very_large | unknown
  "vegstatus": "RoadClosed",    // RoadOpen | Regulation | RoadClosed
  "gjelderNaa": false,
  "gjelderPaaReisen": true,     // kun når du har oppgitt et reisevindu
  "naarGjelderDen": "...",      // kun når den IKKE gjelder på reisen din
  "antattSlutt": "2026-08-14T06:00:00+02:00",
  "nesteEndring": "RoadClosed fra 2026-08-10T20:00:00+02:00",
  "omkjoeringSkiltet": true,
  "iTunnel": true,
  "kommuner": ["Stange"]
}
```

Felter utelates når de ikke bærer informasjon. `naarGjelderDen` følger for eksempel bare med
når meldingen *ikke* treffer reisen din — da er «når gjelder den da» hele poenget; treffer den
deg, sier `melding` allerede det du trenger.

### `trafikkmeldinger`

Generelt oppslag på vei, kommune, fylke og hvor mye det påvirker trafikken. Veinummer kan
skrives slik folk snakker: `E6`, `fv27`, `riksveg 3`, eller bare `27`.

Uten `tidspunkt` får du alt som er registrert, også nattarbeid som ikke er aktivt akkurat nå.
Oppgi `tidspunkt` (ISO) for å se kun det som faktisk gjelder da — gjentakelsesreglene tolkes,
så en tunnel stengt 20:00–06:00 dukker opp for kl. 21 og ikke for kl. 12.

### `naar_bor_jeg_kjore`

Typisk trafikkmengde time for time på en gitt ukedag — svarer på **når du bør dra**, ikke på
hva som skjer akkurat nå.

```jsonc
{ "vei": ["E6"], "kommune": ["Moss"], "ukedag": "torsdag", "uker": 4 }
```

Dataene kommer fra tellepunkter: sløyfer og radar i asfalten som teller hver eneste bil som
passerer. Det er en måling, ikke et estimat — men den vet bare noe om selve punktet, ingenting
om veien mellom punktene.

```jsonc
{
  "ukedag": "torsdag",
  "antallPunkterFunnet": 1,
  "punkter": [{
    "punkt": "Storebaug",
    "vei": "E6",
    "sted": "Moss, Østfold",
    "typiskPerTime": { "06": 1398, "07": 1947, /* ... */ "15": 4709, /* ... */ "22": 1132 },
    "toppTime": { "time": 15, "biler": 4709 },
    "roligsteDagtid": { "time": 6, "biler": 1398 },
    "ukerBakTallene": 4
  }]
}
```

Tre valg verdt å vite om:

- **Median, ikke gjennomsnitt.** Én stengt vei, én helligdag eller én festival flytter et
  gjennomsnitt med hundrevis av biler, og da beskriver tallet en uke som aldri skjer.
- **Timer med under 90 % dekning forkastes, ikke skaleres.** En halvdød sensor rapporterer
  omtrent halve trafikken — det ser ut som en stille vei, og det er den farligste løgnen
  denne serveren kan fortelle.
- **`ukerBakTallene` står i svaret.** En median av to uker er en median av to tall. Det skal
  du få vite, ikke gjette.

### `doctor`

Kaller **begge** de ekte endepunktene og rapporterer svartid, antall meldinger, hvor mange som
har gjentakelsesregler, og hvor mange tellepunkter som svarer. Bruk den når noe oppfører seg rart.

## Utvikling

```bash
npm test      # enhetstester mot fast fikstur — ingen nettverk
npm run smoke # mot ekte API + serveren som prosess (krever nett)
npm run bench # måler hva rutefilteret koster på en lang tur (krever nett)
```

Enhetstestene bruker en frosset fikstur slik at et rødt bygg alltid betyr «koden er feil», ikke
«wifi-en er nede». Røyktesten snakker MCP over stdio til en spawnet server — en test som bare
importerer moduler finner aldri ut om kommandoen i det hele tatt starter.

## Om datakildene

Begge er fra **Statens vegvesen**, og ingen av dem krever nøkkel eller registrering.

**Trafikkmeldinger:** `traffic-info.atlas.vegvesen.no/traffic-information/messages` — det samme
endepunktet som Vegvesenets egen trafikk-app bruker. Krever headeren `X-System-ID`.

**Tellepunkter:** `trafikkdata-api.atlas.vegvesen.no` — et GraphQL-API over ~5 900 punkter som
teller kjøretøy (10 000+ hvis du tar med sykkeltellere og punkter som er ute av drift; serveren
filtrerer bort begge).

Fire ting som er lette å snuble i om du kaller endepunktene selv:

- **`Accept: application/json` gir 406.** Innholdstypen er
  `application/vnd.svv.v1+geo+json`, og innholdsforhandlingen er streng.
- **Uten `X-System-ID` får du 400** med en feilmelding som ikke nevner headeren.
- **GraphQL-sider er maks 100.** `first: 101` feiler med «An unknown error occurred» — det er et
  tak, ikke en anbefaling, så paginering er obligatorisk og ikke en optimalisering.
- **Datex-feeden er ikke lenger åpen.**
  `datex-server-get-v3-1.atlas.vegvesen.no` svarer 401 og krever registrering.

Bruk av dataene er underlagt Vegvesenets vilkår:
<https://www.vegvesen.no/om-oss/om-organisasjonen/apne-data/>

Dette prosjektet er ikke tilknyttet eller støttet av Statens vegvesen.

## Lisens

MIT — se [LICENSE](LICENSE).
