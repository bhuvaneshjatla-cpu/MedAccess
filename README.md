# MedAccess

Pharmacist-supervised medicine availability, price comparison and safe brand-matching platform built on the
Common Drug Codes for India (CDCI).

Software project for **BCSE301L Software Engineering**, Vellore Institute of Technology, Chennai.

| Name | Registration No. |
|---|---|
| Bhuvanesh Jatla | 24BYB1113 |
| Akshit Sitaram | 24BYB1111 |
| Shailesh P | 24BYB1108 |
| Rishabh Sharma | 23BRS1369 |

## Run it (about 1 minute)

1. Install **Node.js 22.13 or newer** from <https://nodejs.org> (no other software or `npm install` is needed).
2. Download this repository (green **Code** button, then **Download ZIP**) and unzip it, or `git clone` it.
3. Open a terminal in the `app` folder and run:

   ```
   npm start
   ```

4. Open <http://localhost:3000> in a browser. The first start takes a few seconds while the catalogue index is built.

To run the 95 automated tests: `npm test` (the browser tests need Microsoft Edge or Google Chrome installed).
To reset all data back to the demo state: `npm run reset-db`, then `npm start` again.

## Demo accounts

All accounts use the password **`Demo@12345`**.

| Role | Email | What to try |
|---|---|---|
| Patient | `patient@demo.medaccess` | Search a medicine (e.g. *losartan*), view availability and prices, view potential matches, request pharmacist verification, *My requests*, reminders, report wrong information |
| Caregiver | `caregiver@demo.medaccess` | Same as patient, on behalf of a family member |
| Pharmacist | `pharmacist@demo.medaccess` | *Verification* queue: start review, verify or reject a comparison with a comment; update stock and price |
| Pharmacy Staff | `staff@demo.medaccess` | Update stock status and price for a pharmacy; review incorrect-information reports |
| Administrator | `admin@demo.medaccess` | Manage users and roles, catalogue overlay (hide/annotate/pack size), reports dashboard, audit log |
| Doctor | `doctor@demo.medaccess` | Read-only catalogue and potential matches (no stock/price access) |

All pharmacy, stock and price data is **synthetic demo data**, not live pharmacy information.

## Repository layout

| Folder | Contents |
|---|---|
| `app/` | The application: `server/` (Node.js API), `public/` (web client), `test/` (95 automated tests), `config/` (restricted-substance and synonym lists) |
| `database/` | Read-only CDCI catalogue and synthetic pharmacy inventory (SQLite) |
| `docs/` | Feasibility study, requirements analysis, SRS, stakeholder questionnaires, UML diagrams |
| `screenshots/` | Screenshots of every role's screens |
| `paper/` | Project report source (LaTeX) and PDF |

More technical detail: [`app/README.md`](app/README.md).
