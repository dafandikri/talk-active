# Talk-Active — booth and event-day runbook

Date: **Friday, 14 August 2026**. Location: Fasilkom UI canteen for the booth; Innovation Forum and pitching use Ruang Sidang A.409. This document turns the official schedule into named, testable actions. Blank evidence fields are intentional: do not mark them complete until a person witnesses the real action.

## Recommended staffing split

The official rule requires at least 50% of a five-person team at the Innovation Forum. Use **three at the forum and two at the booth** from 09.00–11.00.

| Surface | Recommended members | Primary role | Backup role |
|---|---|---|---|
| Innovation Forum | Sultan Ibnu Mansiz | team lead and main presenter | final pitch opening/closing |
| Innovation Forum | Farrel Athalla Muljawan | problem, market, and impact answers | demo narration |
| Innovation Forum | Erdafa Andikri | product and technical answers | operator handoff |
| Booth | Ivan Jehuda Angi | visitor host and 30-second explanation | live demo |
| Booth | Abhiseka Susanto | phone onboarding, queue, and kiosk reset | QR/print replenishment |

The team must confirm or edit this split. After the forum ends at 11.00, all available members return to the booth until exhibition visits end at 12.00.

Confirmed by: ____________________  Date/time: ____________________

## Hard schedule

| Time | Action | Evidence to keep |
|---|---|---|
| 06.30 | All five arrive or report directly to the lead | timestamped team photo |
| 06.30–07.30 | Check room, power, display connection, mobile signal, and booth location | setup checklist below |
| 07.30–08.15 | Build booth; place QR card and one-pagers; open booth display | wide booth photo |
| 08.15–08.35 | Full online demo, then full Wi-Fi-off localhost demo | witnessed run log |
| 08.35–08.50 | Three-phone QR test and one stranger test | device/test log |
| 08.50 | Freeze booth state; no new product changes | lead initials |
| 09.00–11.00 | Three members at forum; two members continuously staff booth | staffing photo/log |
| 09.00–12.00 | Run visitor loop and reset after every completed attempt | visitor tally |
| 12.00–13.00 | Break; charge devices; restock print | battery/stock check |
| 13.00–13.25 | All on-site members attend pitching briefing | attendance note |
| 13.25 onward | Follow the submitted-deck operator workflow and hard stop | pitch witness log |

## Physical packing checklist

Pack on 13 August; reopen and verify every bag before leaving on 14 August.

- [ ] Demo laptop with the green submission state and local dependencies installed
- [ ] Laptop charger
- [ ] HDMI cable
- [ ] USB-C to HDMI adapter
- [ ] Power strip and extension lead
- [ ] Phone hotspot with charger or power bank
- [ ] At least one second phone for QR testing and recovery
- [ ] Mouse and clicker, if used during rehearsal
- [ ] Two printed A5 QR cards from `output/pdf/Talk-Active_Booth_QR_Card_A5.pdf`
- [ ] At least 30 A4 one-pagers from `output/pdf/Talk-Active_Booth_One-Pager_A4.pdf`
- [ ] One rigid holder or backing board for the QR card
- [ ] Tape, binder clips, scissors, and markers
- [ ] Water and tissues for booth staff
- [ ] Formal clothing and formal shoes checked against the official dress rule

Packed by: ____________________  Witness: ____________________  Time: ____________________

## Display setup

1. Connect the venue display at 1920×1080 or another 16:9 resolution.
2. Open `/booth.html` in full-screen mode. The production target is `https://talk-active-id.vercel.app/booth.html`; the offline target is `http://127.0.0.1:4173/booth.html`.
3. Keep the demo workspace in a separate pinned tab at `/`.
4. Disable notifications, sleep, screen saver, automatic updates, and browser password prompts.
5. Set browser zoom to 100%; do not zoom to hide clipping.
6. Stand two metres away. The visitor must be able to read “Bring the rubric” and identify the QR without explanation.

Two-metre check: [ ] pass  [ ] fail  Witness: ____________________

## Offline laptop setup

Run this before leaving home and again at the venue:

```sh
pnpm install --offline
pnpm check
pnpm dev
```

Then turn Wi-Fi off physically and complete: home → rubric → practice → analyse → evidence → defend → save → reload → reset. The semantic badge may visibly fall back; that is expected. Do not claim the offline path used the API.

| Run | Wi-Fi physically off | Full loop completed | Reset under 1s | Console clean | Witness |
|---|---|---|---|---|---|
| Home rehearsal |  |  |  |  |  |
| Venue rehearsal |  |  |  |  |  |

## Visitor flow — 90 seconds

1. **Hook, 0–10s:** “Do you have one criterion a judge will score?”
2. **Frame, 10–20s:** “Talk-Active checks whether your answer makes that evidence explicit. It is not a confidence score.”
3. **Try, 20–55s:** Visitor scans the QR or uses the booth laptop, opens the seed project, and pastes or dictates one answer.
4. **Reveal, 55–70s:** Point to the exact quoted span or the explicit missing cues.
5. **Defend, 70–85s:** Open the hardest likely judge question.
6. **Handover, 85–90s:** Offer the one-pager, then use **Reset demo workspace** before the next visitor.

Never let a visitor inherit the previous visitor’s transcript or progress.

## Three booth talk tracks

### 15 seconds

“Bring the evaluator’s rubric and one rehearsal. Talk-Active shows the exact sentence supporting each criterion—or what evidence is still missing—then asks the hardest likely judge question.”

### 30 seconds

“Students often rehearse the whole pitch but cannot see which rubric criterion is still unsupported. Talk-Active keeps the real rubric attached to one attempt, cites the student’s exact words, and turns the weakest criterion into the next Q&A drill. It measures evidence coverage, not confidence or speaking ability.”

### 90 seconds

Use the visitor flow above. Do not add pricing, market size, or architecture unless the visitor asks; those details compete with the product’s single differentiating moment.

## Failure recovery

| Failure | Say | Do |
|---|---|---|
| Venue Wi-Fi unavailable | “The network-assisted mapper is unavailable, so the visible deterministic fallback is handling this attempt.” | switch to localhost; complete the same loop |
| Semantic call exceeds the live budget | “We cap waiting time because a prompt answer is less valuable than a usable rehearsal.” | let fallback render; continue |
| Production alias unavailable | “We have the exact submission state running locally.” | use bookmarked localhost tab |
| QR will not scan | “You can open the same public URL shown below the code.” | use the printed URL or booth laptop |
| Previous visitor data remains | Do not narrate it. | press **Reset demo workspace**, confirm, restart |
| Display disconnects | “The product remains available on your phone.” | move visitor to QR while reconnecting |

## Three-phone QR test

Test the **physical print**, not only the SVG or screen. Test the A5 card at approximately one metre and the A4 one-pager at normal hand distance.

| Device/browser | A5 at 1m | A4 in hand | Opens correct HTTPS URL | Product usable at 390px | Tester |
|---|---|---|---|---|---|
| Phone 1 |  |  |  |  |  |
| Phone 2 |  |  |  |  |  |
| Phone 3 |  |  |  |  |  |

## Stranger test

Give the visitor no verbal help for the first minute.

- [ ] Visitor can explain “rubric → attempt → cited evidence → question” after reading the display/one-pager
- [ ] Visitor opens the public product from the QR
- [ ] Visitor completes one practice session on their own phone
- [ ] Visitor identifies why the quoted sentence is shown
- [ ] Visitor understands the result is not a confidence or ability score

Visitor initials: __________  Device: __________  Duration: __________  Observed by: __________

## Evidence capture before opening

Keep these files outside the public deployment and add their paths to `docs/finals-readiness.json` only after they exist:

- booth-wide photo showing official identity, display, A5 QR card, and one-pagers;
- close photo proving the printed QR and URL are legible;
- three-phone QR log;
- stranger-test log;
- Wi-Fi-off demo witness log;
- staffing photo showing the two booth members while three attend the forum.
