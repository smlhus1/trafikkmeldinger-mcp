# trafikkmeldinger-mcp

MCP-server for **norske trafikkmeldinger** — vegarbeid, stengte veier og omkjøringer fra
Statens vegvesen, filtrert på ruta di og **når du faktisk kjører**.

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

## To feller denne serveren lukker

**1. Fylkesveier lagres med kategoribokstav.** Det alle skriver som «fv. 27» eller bare «27»
ligger som `F27`. Et filter på strengen `"27"` gir null treff — og null treff ser nøyaktig ut
som «ingen vegarbeid på strekningen». Det er den farligste feilen denne serveren kan gjøre, så
et bart tall utvides til alle fire veiklassene (`E27`, `R27`, `F27`, `K27`) framfor å gjette.

**2. Kommune ligger ikke der du tror.** Feltet `location.municipalities` er tomt på nesten alle
meldinger (2 av 795 i en stikkprøve 10. august 2026). Kommunen står i
`locationDescriptionDetails`. Et geografisk filter bygget på det strukturerte-utseende feltet
alene mister nesten alt.

Begge er dekket av tester, så en regresjon gir rødt bygg.

## Installasjon

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

Trafikkmeldinger for en konkret biltur. Oppgi kommunene ruta går gjennom, og gjerne når du
kjører.

```jsonc
{
  "kommuner": ["Eidsvoll", "Stange", "Ringsaker", "Lillehammer", "Øyer", "Ringebu"],
  "vei": ["E6", "fv27"],
  "avreise": "2026-08-10T16:00:00+02:00",
  "ankomst": "2026-08-10T22:00:00+02:00"
}
```

Svaret skiller det som **treffer deg** fra det som bare er registrert på strekningen:

```jsonc
{
  "antallPaaRuta": 12,
  "antallSomTrefferDeg": 7,
  "merknad": "12 meldinger er registrert på strekningen; 7 av dem gjelder i reisevinduet ditt.",
  "meldinger": [ /* verst først */ ],
  "ikkeIReisevinduet": [ /* med begrunnelse for hvorfor de ikke gjelder */ ]
}
```

Begge tallene oppgis med vilje. Ser du bare det ene, kan du ikke skille «rein vei» fra «feil
tidsfilter».

### `trafikkmeldinger`

Generelt oppslag på vei, kommune, fylke og hvor mye det påvirker trafikken. Veinummer kan
skrives slik folk snakker: `E6`, `fv27`, `riksveg 3`, eller bare `27`.

### `doctor`

Kaller det ekte endepunktet og rapporterer svartid, antall meldinger og hvor mange som har
gjentakelsesregler. Bruk den når noe oppfører seg rart.

## Utvikling

```bash
npm test     # enhetstester mot fast fikstur — ingen nettverk
npm run smoke # mot ekte API + serveren som prosess (krever nett)
```

Enhetstestene bruker en frosset fikstur slik at et rødt bygg alltid betyr «koden er feil», ikke
«wifi-en er nede». Røyktesten snakker MCP over stdio til en spawnet server — en test som bare
importerer moduler finner aldri ut om kommandoen i det hele tatt starter.

## Om datakilden

Data fra **Statens vegvesen**, hentet fra
`traffic-info.atlas.vegvesen.no/traffic-information/messages` — det samme endepunktet som
Vegvesenets egen trafikk-app bruker. Krever headeren `X-System-ID`, men ingen nøkkel eller
registrering.

To ting som er lette å snuble i om du kaller endepunktet selv:

- **`Accept: application/json` gir 406.** Innholdstypen er
  `application/vnd.svv.v1+geo+json`, og innholdsforhandlingen er streng.
- **Datex-feeden er ikke lenger åpen.**
  `datex-server-get-v3-1.atlas.vegvesen.no` svarer 401 og krever registrering.

Bruk av dataene er underlagt Vegvesenets vilkår:
<https://www.vegvesen.no/om-oss/om-organisasjonen/apne-data/>

Dette prosjektet er ikke tilknyttet eller støttet av Statens vegvesen.

## Lisens

MIT — se [LICENSE](LICENSE).
