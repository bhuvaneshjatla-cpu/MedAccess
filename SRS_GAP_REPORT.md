# MedAccess — End-to-End Review and SRS Gap Report

Review date: 2026-10-20 · Subject: `app/` (the canonical codebase) · Reference: `docs/MedAccess_SRS.docx`
Companion document: `MEDACCESS_COMPLETE_PROJECT_DOCUMENTATION.md` (see §12.7–12.11, §25–27)

## 1. What was done and what it showed

| Check | Result |
|---|---|
| Automated tests (`npm test`) | **31 / 31 pass at the time of the review**; **42 / 42 after the restricted-medicine fix** (11 new). Breakdown now: 6 API, 6 overlay, 7 reference/matching, 11 parser, 1 migration, 11 restricted. Tests use small fixture databases, not the real CDCI/V2 files. |
| Walk-through of all six roles in the browser | Patient, Caregiver, Pharmacist, Pharmacy Staff, Administrator, Doctor: every nav page rendered without an error notice; forbidden pages (e.g. admin pages as Patient, verification as Staff) showed "Your role does not have access". Every API call during the walk returned 200; the only 401s were `/auth/me` calls with a token left over from a server restart (expected). |
| Role capability check | Matches the use-case diagram: editors for stock/price only for Pharmacist and Pharmacy Staff; reminder form only for Patient/Caregiver; report form for the four reporter roles; match panel for Patient/Caregiver/Pharmacist/Doctor (no "request verification" for Doctor); Doctor has no availability panel; Administrator sees availability but cannot report. |
| Mobile (375 px) | No horizontal page overflow. |
| Defect found and **fixed** | Search result cards were unreadable in dark mode (dark, centred text on a dark card). Fixed in `public/styles.css`; re-checked at 375 px. |
| Defect found, **fixed afterwards** | **BR-07: restricted medicines were searchable by everyone** — fixed the same day (P0 below; master document §12.12). |

**Not verified in this review:** screen-reader use, keyboard-only use, real users (NFR-10/11/12 are judgement calls), performance beyond a single search (~50 ms) and start-up (~4.5 s), behaviour over HTTPS or on a second machine, the `reports` resolve flow in the browser (it uses a browser `prompt()` that automation cannot answer — the API path is covered by tests).

## 2. Remaining gaps, in priority order

### P0 — safety / scope violation — **RESOLVED 2026-10-20**

| # | Gap | Resolution |
|---|---|---|
| G1 | **Controlled / restricted medicines were served to every role** (BR-07, SC-07): 2,471+ of 93,911 CDCI brands matched even a short name list; a patient search for "tramadol" returned results. | **Fixed.** A reviewable list (`app/config/restricted-medicines.json`, 65 substances + a Schedule X rule) is applied when the search index is built; **2,972 brands (3.2 %) are excluded** and no route can return them (404 by id; search, availability, matches, stock/price, reports, reminders, overlay and the raw demo inventory all verified by 11 new tests and on the real catalogue). The server refuses to start without a valid list. Administrator-added brands use the same list. Details: master document §12.12. |
| G1b | **New, follow-up:** the list is an unreviewed **draft**; name-based matching can miss spellings it does not contain; it errs toward exclusion (e.g. phenobarbital, clobazam anti-epileptics hidden); several borderline substances are listed as "not included, pending review". | A pharmacist should review the file (Q-J). The admin *Administrative reports* page shows what each entry removes. |

### P1 — SRS requirements only partly met

| # | Requirement | Gap | Fix |
|---|---|---|---|
| G2 | FR-06 (search by active ingredient, strength and dosage form) | **Closed 2026-10-20.** Separate ingredient / strength / dosage-form filters, combinable with free text (§12.13), plus a reviewable ingredient-synonym list (paracetamol ↔ acetaminophen) found necessary on real data. |
| G3 | FR-07 / FR-16 / BR-04 (pack size, manufacturer; comparison attributes) | **Mostly closed 2026-10-20.** Administrators can enter a pack size on any CDCI brand (source shown); match lists say same / differs / unknown; per-unit price appears when the pack size has a unit count. A **CSV bulk import** with preview-before-save (export a slice, fill `pack_size`, re-import; §12.14) added 2026-10-21. **Residual:** the data is empty until someone supplies it; active ingredient is shown inside the generic description rather than as its own line. |
| G4 | NFR-14 / FR-13 (never present stale data as current) — **Closed 2026-11-07:** demo timestamps re-anchored at start-up (disclosed; opt-out `MEDACCESS_DEMO_REANCHOR=0`). Original note: | All 874 seeded availability and price rows are older than the 7-day threshold (V2 timestamps are fixed at 2026-09-14), so every row shows "Possibly out of date". Behaviour is correct but the demo looks uniformly stale; the 7-day threshold is unapproved. | Approve a threshold (Q11) and re-anchor the demo dataset or show a single dataset-age banner. |
| G5 | FR-37 (administrator reports) | Counts only (users, availability, comparisons, reports, reminders, overlay, stale records). The SRS does not define the reports, so completeness cannot be judged. | Ask for the required reports (Q8). |
| G6 | FR-08 / FR-36 (manage catalogue records) | CDCI entries cannot be edited, only hidden or annotated; only administrator-added brands are fully editable (by design, Q-H). | Accept, or add field-level corrections as overlay values. |
| G7 | FR-32–34 / SD-07 (reminders) — **Modify closed 2026-11-07** (`PUT /api/reminders/:id`); delivery channel still open (Q4). Original note: | No notification is ever sent (a reminder just shows "Due now" when the user visits); **modify reminder** (SD-07) is not implemented. | Decide the notification mechanism (Q4); add edit. |
| G8 | UC-06 (compare prices) | **Largely restored 2026-10-20:** price table per pharmacy sorted by price, lowest demo price per matching brand, and ≈ price per unit where a pack size is known. Still no single side-by-side screen. | Optional dedicated comparison screen. |
| G9 | NFR-18 (modularity) | **Largely closed 2026-10-21.** `server/app.js` (712 lines) is now a 29-line composition root plus a kernel, a request pipeline and ten component modules (17–150 lines each) mirroring the architecture diagram; behaviour verified unchanged (identical route table, route-coverage test, 74/74). The UI `public/app.js` was split into ES modules by page on 2026-10-21 (§12.16). **Residual:** no service layer between handlers and SQL. | Optional service layer. |

### P2 — security and operations

| # | Gap | Notes |
|---|---|---|
| G10 | HTTP only, no TLS; tokens live in `sessionStorage`; no logout revocation (a token stays valid until it expires or the account is deactivated); signing secret is random per start unless `MEDACCESS_SECRET` is set. |
| G11 | Demo accounts and their shared password are in `seed.js` and `README`; no password change or reset, no account self-service. |
| G12 | Login throttling is in memory only (resets on restart). |
| G13 | Audit log is an ordinary table (not tamper-evident); the audit page shows at most 200 rows; no retention policy. |
| G14 | `node:sqlite` is experimental in Node 22; a single SQLite file is not suitable for many concurrent users. |
| G15 | Licence/attribution terms of the CDCI data are unreviewed; the 22 MB catalogue is copied into `Software-Project/database/` (git-ignored in `app/`, but present in the folder). |

### P3 — usability / quality

| # | Gap |
|---|---|
| G16 | **Closed 2026-10-21:** replaced by an accessible modal dialog (`js/dialog.js`, §12.17). |
| G17 | **Partly closed 2026-10-21:** 6 real-browser smoke tests (sign-in, patient, filters, pharmacist/staff, administrator CSV import, phone layout + logout; any JS exception or 5xx fails them). Accessibility audit added (§12.17: 11 checks, light + dark, keyboard traversal, 320 px). Still missing: coverage of every page, visual regression, human screen-reader testing. |
| G18 | **Partly closed 2026-11-07:** requesters now have a *My verification requests* page with live status and pharmacist comment. Remaining: a "request more information" action. Original: A "pending pharmacist review" notification to the requester (AD-03) and a "request more information" action (pharmacist response) do not exist. |
| G19 | Hidden brands remain reachable by direct identifier (existing reminders, reports) by design — document or block new activity on them. |
| G20 | Only 120 of 93,911 catalogue brands have demo inventory; most brand pages show "No pharmacy has reported this brand yet" until staff add data. |
| G21 | UML/ER documents are out of sync with what was built (known conflicts D1–D20 in the master document §8.7; the implementation adds fields the ER lacks). |

## 3. SRS coverage matrix (as built)

Legend: ✅ met · 🟡 partly met · ⛔ not met · ➖ not applicable / not testable here

| Req | Status | Note |
|---|---|---|
| FR-01 authenticate | ✅ | server-side; account status rechecked per request |
| FR-02 role per account | ✅ | |
| FR-03 role restrictions | ✅ | route-level; 403 tests |
| FR-04 verification/admin blocked for others | ✅ | |
| FR-05 search by name | ✅ | |
| FR-06 ingredient/strength/form | ✅ | separate filters + synonyms (G2 closed) |
| FR-07 structured info incl. pack size, manufacturer | 🟡 | pack size by admin overlay (empty until entered); strength parsed (G3) |
| FR-08 admin manages catalogue | 🟡 | overlay; CDCI read-only (G6) |
| FR-09 validate required fields | ✅ | for administrator-added brands |
| FR-10 participating pharmacies | ✅ | synthetic V2 pharmacies |
| FR-11 Available / Low stock / Unavailable | ✅ | |
| FR-12 pharmacy name + location | ✅ | |
| FR-13 last-updated time | ✅ | |
| FR-14 staff update availability | ✅ | |
| FR-15 indicative prices | ✅ | synthetic, labelled |
| FR-16 comparison attributes incl. pack size | 🟡 | same/differs/unknown shown; depends on entered data (G3) |
| FR-17 price source | ✅ | pharmacy + updater + source |
| FR-18 staff update prices | ✅ | |
| FR-19 price update time | ✅ | |
| FR-20 identify potential matches | ✅ | same CDCI generic |
| FR-21 distinguish match states | ✅ | informational / pending / under review / verified / rejected |
| FR-22 verify | ✅ | |
| FR-23 reject | ✅ | |
| FR-24 review comment | ✅ | optional |
| FR-25 reviewer, time, status recorded | ✅ | |
| FR-26 no verified without pharmacist action | ✅ | tests |
| FR-27 safety message | ✅ | shown on matches and verification cards (not asserted by an automated test) |
| FR-28 report incorrect info | ✅ | |
| FR-29 report content | ✅ | brand, pharmacy, type, timestamp |
| FR-30 review/resolve | ✅ | STD-04 flow |
| FR-31 resolution audited | ✅ | |
| FR-32 create reminder | ✅ | |
| FR-33 reminder content | ✅ | |
| FR-34 recurring | ✅ | no modify, no delivery (G7) |
| FR-35 users and roles | ✅ | |
| FR-36 catalogue management | 🟡 | (G6) |
| FR-37 admin reports | 🟡 | (G5) |
| FR-38 audit of major actions | ✅ | |
| FR-39 audit content | ✅ | |
| NFR-01–04 security | ✅ | (see P2 for hardening) |
| NFR-05 prescription data | ➖ | none stored |
| NFR-06 minimal data | ✅ | |
| NFR-07 synthetic data | ✅ | banner + labels |
| NFR-08 no public exposure | ✅ | login required |
| NFR-09 mobile friendly | ✅ | checked at 375 px and 320 px reflow; keyboard, names, contrast audited mechanically (§12.17) |
| NFR-10 plain language | ➖ | needs users |
| NFR-11 states distinguishable | ✅ | text + colour badges |
| NFR-12 minimal entry for pharmacy users | 🟡 | inline editors; not user-tested |
| NFR-13 source + time on stock/price | ✅ | |
| NFR-14 stale not shown as current | ✅ | flag works; demo timestamps re-anchored (G4 closed 2026-11-07); 7-day threshold still to be approved |
| NFR-15 validate catalogue fields | ✅ | |
| NFR-16 changes traceable | ✅ | before/after in audit |
| NFR-17 performance | ➖ | search ≈ 50 ms, start ≈ 4.5 s; no target defined |
| NFR-18 modular structure | ✅ | server split by component (G9) and UI split by page (§12.15, §12.16); no service layer |
| BR-01 match is informational | ✅ | |
| BR-02 only pharmacists verify | ✅ | |
| BR-03 lower price ≠ suitability | ✅ | safety text on match panel |
| BR-04 expose attributes and pack size | 🟡 | shown when entered (G3) |
| BR-05 availability has time/source | ✅ | |
| BR-06 no diagnosis/prescribing | ✅ | banner; no such features |
| BR-07 restricted medicines excluded | ✅ (draft list) | fixed 2026-10-20 (G1); list awaits pharmacist review (G1b) |
| BR-08 no sales/payments/delivery | ✅ | |
| BR-09 no live integration | ✅ | synthetic labelled |
| BR-10 no real patient data | ✅ | |

Totals — FR (39): 34 met, 5 partly (FR-07, 08, 16, 36, 37). NFR (18): 13 met, 2 partly (12, 14), 3 not testable here (05, 10, 17). BR (10): 9 met (BR-07 with a draft list awaiting review), 1 partly (BR-04), 0 not met.

## 4. Decisions needed from you

| # | Question | Recommendation |
|---|---|---|
| Q-I | ~~How to enforce BR-07~~ **Decided: hide from everyone; implemented.** | — |
| Q-J | Who reviews the draft restricted list and decides the borderline substances? | A pharmacist, before any real use |
| Q-C′ | ~~Where should pack size come from?~~ **Decided and implemented: administrator-entered overlay.** | CSV bulk import now built; the open question is who supplies the pack-size data |
| Q-K | Who reviews the draft ingredient-synonym list? | A pharmacist, together with the restricted list |
| Q11 | Staleness threshold, and whether to re-anchor the demo timestamps | Keep 7 days; re-anchor the demo data at start-up |
| Q4 | Reminder notifications | Decide: in-app only, email, or SMS |
| Q8 | Which administrator reports are required | List them |

## 5. Suggested order of work

1. ~~G1 restricted-medicine exclusion~~ done; **pharmacist review of the list (G1b)**. 2. ~~G3/G2 pack-size source and search filters~~ done (§12.13); bulk pack-size import also done (§12.14); next: obtain the pack-size data and have the synonym/restricted lists reviewed. 3. **G4** freshness presentation. 4. ~~G9 modular split~~ done for server and UI (§12.15, §12.16); ~~UI tests~~ 6 browser smoke tests added; remaining: more pages covered, accessibility checks. 5. P2 hardening before any shared deployment.
