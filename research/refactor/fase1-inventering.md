# Fase 1 — Inventering (heat-map)

`trafikkmeldinger-mcp` · 10. august 2026 · alt målt, ingenting gjettet.

---

## Baseline-metrikker

| Metrikk | Verdi | Kommentar |
|---|---|---|
| **Svarstørrelse, `langs_ruta` (typisk rute + 6t vindu)** | 16 180 tegn ≈ **4 500 tokens** | ← hovedmetrikken |
| **Svarstørrelse, `langs_ruta` uten veifilter** | 36 218 tegn ≈ **10 100 tokens** | 50 meldinger |
| **Svarstørrelse, `trafikkmeldinger` uten filter** | 33 309 tegn ≈ **9 300 tokens** | 40 meldinger |
| Tegn per melding | 704 | 14 felt |
| Rutefilter, uten tidsfilter | 2,7 ms | 1 288 meldinger |
| Rutefilter, med 6t reisevindu | 15,5 ms | sampling i `appliesBetween` |
| Nettverkskall (hele Norge) | ~600 ms / 2,4 MB | caches 90 s |
| E2E verktøykall (kald cache) | ~900 ms | |
| Typecheck | 3,7 s · **0 feil** | strict + `noUncheckedIndexedAccess` |
| Tester | **36 grønne** | + røyktest mot ekte API |
| Kildekode | 691 linjer (6 filer) | test 555, scripts 193 |
| Prod-avhengigheter | **2** (`sdk`, `zod`) | |

**Valgt hovedmetrikk: svarstørrelse i tokens.** For en MCP-server er ikke latency
flaskehalsen — hver byte i svaret havner i kallerens kontekstvindu og betales for. 10 000
tokens for ett rutesøk er den dyreste egenskapen serveren har i dag.

---

## 🔴 Rødt — reell verdi å fikse

### R1. Svaret er 2–3× større enn informasjonen i det

Per melding (704 tegn) er de to dyreste feltene nesten samme setning:

```
melding         (151 tegn): "Vegarbeid, vegen er stengt, gyldig mellom 20:00 og 06:00
                             mandag, tirsdag, onsdag og torsdag ... Omkjøring er skiltet."
naarGjelderDen  (116 tegn): "Vegen er stengt mellom 20:00 og 06:00 mandag, tirsdag,
                             onsdag og torsdag fra 10.08.2026 til 14.08.2026."
```

**38 % av hver melding er to formuleringer av det samme.** I tillegg:

- `id` (27 tegn) — **ingen verktøy tar id som input.** Rent ballast for kalleren.
- `start` + `antattSlutt` (54 tegn) som full ISO, mens `naarGjelderDen` sier det samme i
  klartekst.
- `fylker` + `kommuner` gjentas per melding selv når kalleren nettopp filtrerte på dem.

Anslag: 40–50 % reduksjon uten tap av beslutningsgrunnlag.

### R2. Stille avkorting — svaret ser komplett ut når det ikke er det

```ts
const hits = selectMessages(all, filter);   // limit anvendes inne i selectMessages
return { antall: hits.length, ... }         // ← antall er ETTER avkorting
```

Er det 200 treff og `maksAntall` er 40, sier svaret `antall: 40`. **Kalleren har ingen måte
å vite at 160 meldinger ble forkastet.** `ikkeIReisevinduet` kappes tilsvarende til 20 uten
et ord.

Dette er nøyaktig samme feilklasse som F27-fella serveren ble bygget for å lukke: *et svar
som ser fullstendig ut, men ikke er det.* Prosjektets egen standard sier «no silent caps».

### R3. `kommuner` er påkrevd, men kalleren kan ikke vite dem

`langs_ruta` krever kommunelista. Utelater kalleren én kommune, forsvinner meldingene der
**stille** — ingen feil, bare et tynnere svar. Det finnes ingen vei fra «E6 Halden til
Nebbenes» til kommunelista annet enn modellens egen geografikunnskap.

Verktøyet er altså trygt mot feil *format* (F27), men ikke mot ufullstendig *rute*.

---

## 🟡 Gult — verdt å rydde, lav risiko

- **G1.** `langs_ruta` kaller `selectMessages` to ganger over samme 1 288 meldinger, med
  identisk sted-/veifilter og bare ulikt tidsfilter. Én filtrering + partisjonering ville
  vært både enklere å lese og ~halve arbeidet.
- **G2.** `Filter` har to tidsbegreper: `at` (punkt) og `from`/`to` (vindu). Et punkt er et
  null-langt vindu; to begreper er én for mye.
- **G3.** Ingen CI på et offentlig repo — ingen ser om en PR ryker.
- **G4.** `README` dokumenterer ikke svarformatet, så en bruker må lese `select.ts` for å
  vite hva de får.

---

## 🟢 Grønt — bevisste valg, ikke rør

- **Hent hele landet og filtrer lokalt.** Målt: 600 ms / 2,4 MB. Sparer kalleren for å måtte
  kjenne fylkesnummer. Trade-off tatt bevisst.
- **Sampling i `appliesBetween`.** Målt til 15,5 ms — den «smarte» intervall-algebraen ville
  krevd egen testpakke for å bli trodd. Åpenbart slår smart.
- **2 prod-deps, 0 typefeil, 36 tester.** Ingen grunn til å røre.
- **Én liste for virkningsnivåene** (fikset før denne planen).

---

## Hva jeg IKKE fant

Lette etter, fant ikke: sikkerhetshull (ingen secrets, ingen query-konkatenering, input går
kun til lokalt filter), lekkende abstraksjoner mellom lagene, død kode, sirkulære importer,
`any`-lekkasjer utenfor to bevisste MCP-grensecaster.

---

## Forslag til fokus (STOPP 1)

Rangert etter verdi/risiko: **R1 + R2 er samme tema** (hva svaret faktisk sier) og bør tas
sammen. **R3 er den største bruksforbedringen** men også den eneste som grenser mot ny
funksjonalitet — den må avklares: er «hjelp kalleren med å finne kommunene» refactor eller
redesign?

Min anbefaling: R1+R2+G1+G2 som ren refactor (adferd bevart der det teller), R3 løftes til
egen beslutning, G3+G4 som siste opprydding.
