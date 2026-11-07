# MedAccess prototype

Pharmacist-supervised medicine availability, price-comparison and information assistant, built from the
documents in `../docs` (SRS, requirements analysis, StarUML use-case / ER / state / sequence / activity /
architecture diagrams).

- **Stack:** Node.js >= 22.13, zero npm dependencies. Built-in `node:http` and `node:sqlite`; vanilla-JS single-page UI.
- **Run:** `npm start` then open <http://localhost:3000>. The SQLite file is created in `data/` and seeded on first start.
- **Test:** `npm test` (95 tests: RBAC, verification workflow, audit, validation, state transitions, CDCI catalogue, synthetic inventory, catalogue links, strength parser, CDCI match finder).
- **Reset data:** `npm run reset-db`, then start again.
- Config (all optional): `PORT` (default 3000), `MEDACCESS_DB` (SQLite path), `MEDACCESS_SECRET` (token signing key; random per start if unset, so sessions end on restart), `MEDACCESS_CDCI_DB` (default `../database/cdci_catalogue.db`), `MEDACCESS_INVENTORY_DB` (default `../database/medaccess_cdci_inventory_v2.db`).

## CDCI catalogue and synthetic Inventory V2 (ported from the Stage 2 package)

Two **read-only** SQLite files in `../database/` (copied from `MedAccess_CDCI_Integration_Stage2_V2_COMPLETE.zip`; review the CDCI licence before redistributing). If a file is missing the related endpoints return 503 and the rest of the app still works. Startup takes a few seconds because the catalogue search index is built in memory (searches then take ~50 ms instead of ~2 s).

| Endpoint | Roles | Purpose |
|---|---|---|
| `GET /api/catalogue?search&limit&offset` | any | CDCI names/identifiers only; `has_more` for paging |
| `GET /api/demo-inventory?brandIdentifier=` | Patient, Caregiver, Pharmacist, Staff, Admin | **Synthetic** inventory for one exact CDCI product id; labelled `DEMO DATA`, rows older than 7 days flagged `stale` |
| `GET/POST/DELETE /api/catalogue/:bid/link` | read: any; write: Pharmacist, Administrator | Manual, reviewed link CDCI **brand** -> local medicine (note required, audited). Never automatic; not an equivalence decision |
| `GET /api/catalogue/:bid/matches?limit&offset` | Patient, Caregiver, Pharmacist, Doctor | Potential matches = other CDCI brands with the **same generic identifier** (same ingredient, strength, dose form). Informational only; shows brand/supplier differences, unknown pack size and synthetic demo price |
| `POST /api/cdci-comparisons` | Patient, Caregiver, Pharmacist | Request pharmacist verification of a matching pair |
| `GET /api/cdci-comparisons[?status]`, `GET /:id` | Pharmacist; detail also Patient, Caregiver, Doctor | Pharmacist queue / detail |
| `POST /api/cdci-comparisons/:id/{open,verify,reject,comments}` | Pharmacist | Start review, verify, reject, comment. Nothing is verified without this explicit action |

UI: **CDCI catalogue** page (`#/catalogue`) with a *Potential matches* panel, and a *CDCI catalogue comparisons* section on the **Verification** page. A verified comparison means a pharmacist reviewed those two catalogue entries; it is not a substitution recommendation and does not cover pack size. Attributes: dosage form comes from CDCI's structured form master; **strength is parsed from the generic name (unverified, labelled as such)**; **pack size is not recorded** (CDCI has none), so demo prices are not a like-for-like comparison. Other data limits: only 120 of 72,133 products have demo inventory, and V2 timestamps are fixed at September 2026 so they show as old.

The Stage 2 `GET /api/demo-inventory` selects a `currency` column that the V2 view does not have (it would return 500 as written); this port omits it and reports `INR`.

## Demo accounts (synthetic, local only)

All seeded accounts use the password `Demo@12345`:
`patient@`, `caregiver@`, `pharmacist@`, `staff@`, `admin@`, `doctor@` + `demo.medaccess`.
Change or remove them before any non-local use (see `server/seed.js`).

## How it maps to the documents

The in-app **Project docs** page lists every use case with its screen and API. Summary:

| Area | UCs | SRS | UML source |
|---|---|---|---|
| Authentication, RBAC | UC-01 | FR-01–04, NFR-01–03 | AD-01, STD-01 |
| Search, details | UC-02, 03 | FR-05–09 | AD-02 |
| Availability, prices, comparison | UC-04–06 | FR-10–19 | STD-06 |
| Potential match, pharmacist verification | UC-07–11 | FR-20–27, BR-01–04 | AD-03, STD-02, STD-03 |
| Stock / price updates | UC-12, 13 | FR-14, 18, 19 | AD-04, AD-05 |
| Incorrect-information reports | UC-14, 15 | FR-28–31 | AD-06, STD-04 |
| Refill reminders (recurring optional) | UC-16, 17 | FR-32–34 | AD-07, STD-05 |
| Users/roles, catalogue, reports, audit | UC-18–21 | FR-35–39, NFR-04, 16 | AD-08, 09, 10 |

Data model follows `MedAccess_ER_Diagram.mdj`. Columns the ER diagram lacks but the SRS requires are marked `SRS-ADD` in `server/db.js`
(e.g. `medicine_id`/`pharmacy_id` on reports per FR-29, `medicine_id` on reminders per FR-33, reviewer on comparisons per FR-25).

## Design decisions and interpretations (please confirm)

1. **Login required for everything** (UC-01 is a cross-cutting precondition); no anonymous search.
2. **Search/details are open to all roles**, not only Patient/Caregiver as drawn in the use-case diagram, because pharmacy users need them to find items to update. Availability/price views exclude the Doctor role (not associated in the diagram).
3. **Potential matches are computed**, not stored: same active ingredient + strength + dosage form. A comparison record is created only when someone requests verification (starts `Pending Review`). The ER entities `POTENTIAL_MEDICINE_MATCH(_MEDICINE)` are therefore not materialised.
4. **Verify/reject require "Start review" first** (STD-03: Pending Review → Under Pharmacist Review → Verified/Rejected). Pharmacists decide; nothing becomes verified automatically (FR-26).
5. **Staleness threshold = 7 days** (prototype choice) for the "Possibly out of date" label (NFR-14). Not specified in the SRS.
6. **Reminders** are stored and shown in-app; "Triggered" is computed when the due time passes. No SMS/email delivery (the SRS fixes no mechanism).
7. **Report review** is open to Pharmacist, Pharmacy Staff and Administrator (UC-15); the "if authorized" qualifier is treated as role-based.
8. **Restricted medicines (BR-07)** are blocked in the catalogue by a small name blocklist in `server/app.js`; a real control list needs a proper source.
9. Prices are stored in rupees (INR) as decimals; the SRS does not fix currency or unit.

10. **State machines follow the StarUML STD diagrams strictly**: reports must be *Investigating* before Resolve/Reject (STD-04); only *Active* accounts can be deactivated (STD-01). Reminders are more lenient than STD-05 (a Scheduled reminder can be marked done or a Triggered one cancelled).
11. **Reminder "modify"** (SD-07) is implemented: `PUT /api/reminders/:id` changes date/time and recurrence of an open reminder (audited with before/after) and puts it back to *Scheduled*.

## Security notes

Scrypt password hashing, HMAC-signed 8-hour tokens (account status re-checked on every request, so deactivation is immediate),
login throttling after 5 failures, parameterised SQL only, CSP + nosniff + frame-deny headers, audit trail for logins, denied access and all data changes.
Not production-ready: no HTTPS termination, no CSRF concerns because auth is a bearer header, no persistent rate limiting, no password reset flow.

## Layout

```
server/  app.js            composition root (registers the component modules, returns the request handler)
         kernel.js         shared context: db helpers, audit, route registry, roles, reference stores
         http.js           request pipeline: routing, auth + roles, body reader, errors, static files, headers
         util.js brands.js availabilityModel.js   shared helpers and models
         routes/           one module per component: auth, catalogue, matching, availability, reports, reminders,
                           adminUsers, adminCatalogue, adminReports, audit
         db.js refdata.js restricted.js synonyms.js cdciParse.js csv.js packImport.js auth.js meta.js seed.js index.js reset.js
public/  index.html  styles.css  main.js (entry, ES modules)
         js/ui.js session.js shell.js router.js dialog.js a11y.js   shared helpers, state + API client, navigation, hash router
         js/pages/         one module per page (login, catalogue, availabilityPanel, verification, inventory, reports,
                           reminders, adminUsers, adminCatalogue, adminReports, adminAudit, docs)
config/  restricted-medicines.json  ingredient-synonyms.json
test/    api / reference / matching / overlay / restricted / filters / import / migration / parse / routes / browser tests
```

To add an endpoint: put it in the component module it belongs to (`server/routes/<component>.js`, `route(method, path, roles, handler)`), then run `npm test`. `test/routes.test.js` pins the route table in `test/routes.snapshot.json` (regenerate it when you add a route on purpose) and its scenario must be extended to exercise the new route.


## Brand-keyed workflows (2026-10-20)

Stock, price, reports and reminders are keyed by **CDCI brand identifier** and (for stock/price/reports) a pharmacy from the synthetic inventory.
The V2 inventory is read-only; staff updates are stored in `stock_overrides` / `price_overrides` and merged over the seed (newest wins, who/when/source shown).
`GET /api/catalogue/:brandId/availability` returns the merged view; `PUT /api/availability` and `PUT /api/prices` take `{brand_identifier, pharmacy_id, ...}`.
Old reports/reminders that used local medicine ids are kept as `legacy_*` tables on first start. Still using the local tables (not yet retired): legacy search page (`#/legacy/search`), local comparisons, administrator "Legacy catalogue", and `catalogue_links`.


## Catalogue overlay and local-table retirement (2026-10-20)

The CDCI catalogue is read-only, so administrators manage it through an **overlay** stored by MedAccess (`Catalogue admin` page): **hide** brands (reason required; hidden from everyone but administrators in search and matches), **annotate** them (a note shown to users), and **add** brands CDCI does not list (`MA-nnnnn`, all six attributes incl. pack size). Endpoints: `GET /api/admin/catalogue`, `PUT /api/admin/catalogue/:bid/overlay`, `POST /api/admin/catalogue/custom`, `PUT /api/admin/catalogue/custom/:bid`. Every change is audited.

The local `medicines`, `pharmacies`, `pharmacy_availability`, `prices`, local comparison and `catalogue_links` tables, routes and pages are **gone**. Existing databases are not modified: their old tables remain in the file, unused, and can be dropped manually after review.


## Restricted medicines (BR-07)

Controlled, narcotic and psychotropic substances are excluded from the catalogue for **every role**, including administrators. The list is `config/restricted-medicines.json` (**draft, pending pharmacist review**): each substance is matched as a whole word against the CDCI generic, product and brand names, plus an optional CDCI classification rule. Excluded brands are left out of the search index when the server starts (about 3 % of the catalogue), so no screen or API route can reach them. The server **refuses to start** if the list is missing or invalid. Administrators can see what the list removes on *Administrative reports* (`GET /api/admin/restricted`). To change the list, edit the file and restart. Override the location with `MEDACCESS_RESTRICTED_LIST`.


## Pack size and search filters (2026-10-20)

- **Pack size:** CDCI records none, so administrators can enter one per CDCI brand (*Catalogue admin* → Edit → Pack size). It is shown with its source; match lists say *same / differs / unknown*; an approximate **price per unit** appears when the pack size starts with a count ("10 tablets"). Nothing is guessed.
- **Filters:** `GET /api/catalogue?search=&ingredient=&strength=&form=` (any combination, at least one real criterion). `strength` accepts `500`, `500 mg`, `30 mg/5 mL`, `30+50`; a bare number matches only the numeric part of a component (`50` finds 50 mg/5 mL, not 500 mg). `form` is a substring of the CDCI dosage form ("tablet", "oral solution", "injection").
- **Synonyms:** `config/ingredient-synonyms.json` (draft, pharmacist review pending) makes a known name also find its synonyms (paracetamol ↔ acetaminophen). Search convenience only; fail-open. Override the path with `MEDACCESS_SYNONYMS`.


## Bulk pack-size import (2026-10-21)

*Catalogue admin* → **Bulk import pack sizes (CSV)**: download the template or export the brands matching your search, fill in `pack_size`, load the file, **Preview** every row (New / Changes value / No change / Rejected, with reasons and warnings), tick the review box, then **Save**. Nothing is written by the preview; the save re-validates the identical file (fingerprint) and applies the valid rows in one transaction. Rows cannot clear a value; administrator-added brands are excluded; an existing hide/note on a brand is kept. Endpoints (Administrator only): `POST /api/admin/catalogue/pack-size-import/preview`, `POST /api/admin/catalogue/pack-size-import`, `GET /api/admin/catalogue/pack-size-export?search=…[&missing=1]`. Every change is audited per brand plus one summary entry. Limits: 5,000 rows and 2 MB per file.


## Front end and browser tests (2026-10-21)

The UI is plain ES modules served as static files (no build step, no framework); `public/main.js` is the entry. `npm test` also runs **6 real-browser smoke tests** (`test/browser.test.js`): a headless Edge / Chrome / Chromium is driven through the DevTools protocol (no dependencies), signs in through the real login form and walks the main flows; any uncaught JavaScript error, `console.error` or HTTP 5xx fails the test. The browser is auto-detected; set `MEDACCESS_BROWSER` to a browser executable to override. If none is installed these tests are skipped, not failed.

## Accessibility checks

`test/a11y.test.js` (11 tests, part of `npm test`) audits each role's screens in light and dark themes for names, headings, landmarks, table headers, keyboard reachability, target size and contrast, and exercises Tab order, the skip link and the resolution dialog. Mechanical only: it does not replace testing with a screen reader or with users.


## Completion pass (2026-11-07)

- **Reminder modify (SD-07, G7):** *Edit* on each open reminder; `PUT /api/reminders/:id`.
- **My verification requests (AD-03, G18):** Patients, Caregivers and Pharmacists see the status and the pharmacist's comment on every comparison they requested (`GET /api/my-comparisons`, page `#/my-requests`).
- **Demo freshness (G4, NFR-14):** the V2 seed timestamps are fixed in September 2026, so at start-up they are shifted so the newest seed row is "now" (relative spread kept, so genuinely older rows are still flagged *Possibly out of date*). The source label reads "synthetic seed (timestamps re-anchored)". Set `MEDACCESS_DEMO_REANCHOR=0` to keep the original times.
