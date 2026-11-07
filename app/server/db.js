'use strict';
// Physical schema derived from docs/uml-diagrams/MedAccess_ER_Diagram.mdj (ER-01).
// Additions required by the SRS but absent from ER-01 are marked "SRS-ADD".
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  role_id INTEGER PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,                 -- SRS-ADD: login identifier (AD-01)
  password_hash TEXT NOT NULL,                -- SRS-ADD: authentication information (SRS 7.1)
  contact_information TEXT,
  account_status TEXT NOT NULL DEFAULT 'Created'
    CHECK (account_status IN ('Created','Active','Inactive','Deactivated')),  -- STD-01
  role_id INTEGER NOT NULL REFERENCES roles(role_id)
);

-- Administrator overlay on the read-only CDCI catalogue (UC-19): hide, annotate and add brands. CDCI data is never modified.
CREATE TABLE IF NOT EXISTS catalogue_overlay (
  brand_identifier TEXT PRIMARY KEY,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
  hidden_reason TEXT,
  note TEXT,                                      -- annotation shown to users
  pack_size TEXT,                                 -- administrator-entered pack size for a CDCI brand (CDCI records none)
  updated_by INTEGER REFERENCES users(user_id),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_brands (        -- administrator-added brands, identifier MA-nnnnn (FR-08/09)
  brand_identifier TEXT PRIMARY KEY,
  brand_name TEXT NOT NULL,
  active_ingredient TEXT NOT NULL,
  strength TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  pack_size TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  generic_identifier TEXT,                        -- optional CDCI generic, enables matches
  created_by INTEGER REFERENCES users(user_id),
  created_at TEXT NOT NULL
);

-- Pharmacist-verified comparisons between two CDCI brands that share a generic identifier (STD-03 states).
CREATE TABLE IF NOT EXISTS cdci_comparisons (
  comparison_id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_a TEXT NOT NULL,                        -- lexicographically smaller brand_identifier
  brand_b TEXT NOT NULL,
  generic_identifier TEXT NOT NULL,
  snapshot_a TEXT NOT NULL,                     -- brand names when requested (reference data is read-only and may change)
  snapshot_b TEXT NOT NULL,
  comparison_status TEXT NOT NULL DEFAULT 'Pending Review'
    CHECK (comparison_status IN ('Pending Review','Under Pharmacist Review','Verified','Rejected')),
  created_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(user_id),
  verification_date TEXT,
  verified_by INTEGER REFERENCES users(user_id),
  CHECK (brand_a < brand_b)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cdci_cmp_active ON cdci_comparisons(brand_a, brand_b)
  WHERE comparison_status IN ('Pending Review','Under Pharmacist Review','Verified');

CREATE TABLE IF NOT EXISTS cdci_comparison_comments (
  comment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id INTEGER NOT NULL REFERENCES cdci_comparisons(comparison_id),
  comment_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS incorrect_information_reports (
  report_id INTEGER PRIMARY KEY AUTOINCREMENT,
  reported_by INTEGER NOT NULL REFERENCES users(user_id),
  brand_identifier TEXT NOT NULL,                 -- FR-29 relevant medicine (CDCI brand)
  brand_name TEXT NOT NULL,
  pharmacy_id TEXT NOT NULL,                      -- FR-29 relevant pharmacy (inventory V2 pharmacy id)
  pharmacy_name TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('Incorrect Price','Incorrect Availability','Other')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'Submitted'
    CHECK (status IN ('Submitted','Under Review','Investigating','Resolved','Rejected')),  -- STD-04
  created_at TEXT NOT NULL,
  resolution_note TEXT,
  resolved_by INTEGER REFERENCES users(user_id),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS refill_reminders (
  reminder_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(user_id),
  brand_identifier TEXT NOT NULL,                 -- FR-33 relevant medicine (CDCI brand)
  brand_name TEXT NOT NULL,
  reminder_date_time TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'None' CHECK (recurrence IN ('None','Daily','Weekly','Monthly')), -- FR-34
  status TEXT NOT NULL DEFAULT 'Scheduled'
    CHECK (status IN ('Scheduled','Triggered','Completed','Cancelled')),  -- STD-05
  created_at TEXT NOT NULL
);

-- Staff updates to the READ-ONLY synthetic inventory (V2). Merged over the seeded values at read time; newest wins.
CREATE TABLE IF NOT EXISTS stock_overrides (
  brand_identifier TEXT NOT NULL,
  pharmacy_id TEXT NOT NULL,
  availability_status TEXT NOT NULL CHECK (availability_status IN ('Available','Low Stock','Unavailable')),  -- STD-06
  last_updated TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(user_id),
  PRIMARY KEY (brand_identifier, pharmacy_id)
);
CREATE TABLE IF NOT EXISTS price_overrides (
  brand_identifier TEXT NOT NULL,
  pharmacy_id TEXT NOT NULL,
  price_inr_paise INTEGER NOT NULL CHECK (price_inr_paise > 0),    -- same unit as inventory V2
  last_updated TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(user_id),
  PRIMARY KEY (brand_identifier, pharmacy_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  audit_log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(user_id),
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  affected_record TEXT,
  details TEXT                                    -- SRS-ADD: before/after (NFR-16)
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp);
`;

function openDb(file) {
  const target = file || process.env.MEDACCESS_DB || path.join(__dirname, '..', 'data', 'medaccess.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  // Reports and reminders used to reference local medicine ids. Keep that data (never silently drop it) under a legacy_ name.
  for (const [table, legacy] of [['incorrect_information_reports', 'legacy_incorrect_information_reports'], ['refill_reminders', 'legacy_refill_reminders']]) {
    try {
      if (db.prepare(`SELECT 1 x FROM pragma_table_info('${table}') WHERE name='medicine_id'`).get()) db.exec(`ALTER TABLE ${table} RENAME TO ${legacy}`);
    } catch { /* table may not exist yet */ }
  }
  db.exec(SCHEMA);
  // catalogue_overlay gained pack_size after its first release
  if (!db.prepare("SELECT 1 x FROM pragma_table_info('catalogue_overlay') WHERE name='pack_size'").get()) db.exec('ALTER TABLE catalogue_overlay ADD COLUMN pack_size TEXT');
  return db;
}

module.exports = { openDb };
