'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../server/db');

test('reports and reminders keyed by local medicine ids are preserved as legacy_ tables, not dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-mig-'));
  const file = path.join(dir, 'old.db');
  // an "old" database as produced by earlier builds of this app
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE incorrect_information_reports (report_id INTEGER PRIMARY KEY, reported_by INTEGER, medicine_id INTEGER, pharmacy_id INTEGER, report_type TEXT, description TEXT, status TEXT, created_at TEXT);
    CREATE TABLE refill_reminders (reminder_id INTEGER PRIMARY KEY, user_id INTEGER, medicine_id INTEGER, reminder_date_time TEXT, recurrence TEXT, status TEXT, created_at TEXT);
    INSERT INTO incorrect_information_reports VALUES (1, 1, 7, 2, 'Incorrect Price', 'old report', 'Submitted', '2026-10-01T00:00:00Z');
    INSERT INTO refill_reminders VALUES (1, 1, 7, '2026-11-01T00:00:00Z', 'None', 'Scheduled', '2026-10-01T00:00:00Z');`);
  old.close();

  const db = openDb(file);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM legacy_incorrect_information_reports').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM legacy_refill_reminders').get().c, 1);
  // new brand-keyed tables exist and are empty
  assert.equal(db.prepare('SELECT COUNT(*) c FROM incorrect_information_reports').get().c, 0);
  assert.ok(db.prepare("SELECT 1 x FROM pragma_table_info('incorrect_information_reports') WHERE name='brand_identifier'").get());
  assert.ok(db.prepare("SELECT 1 x FROM pragma_table_info('refill_reminders') WHERE name='brand_identifier'").get());
  db.close();
  // opening again must not rename the new tables
  const again = openDb(file);
  assert.equal(again.prepare('SELECT COUNT(*) c FROM legacy_refill_reminders').get().c, 1);
  again.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an existing catalogue_overlay table gains the pack_size column without losing rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-mig2-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE catalogue_overlay (brand_identifier TEXT PRIMARY KEY, hidden INTEGER NOT NULL DEFAULT 0, hidden_reason TEXT, note TEXT, updated_by INTEGER, updated_at TEXT NOT NULL);
    INSERT INTO catalogue_overlay VALUES ('B1', 0, NULL, 'old note', NULL, '2026-10-01T00:00:00Z');`);
  old.close();
  const db = openDb(file);
  assert.ok(db.prepare("SELECT 1 x FROM pragma_table_info('catalogue_overlay') WHERE name='pack_size'").get());
  const row = db.prepare('SELECT note, pack_size FROM catalogue_overlay WHERE brand_identifier = ?').get('B1');
  assert.equal(row.note, 'old note');
  assert.equal(row.pack_size, null);
  db.close();
  openDb(file).close(); // idempotent: opening again must not try to add the column twice
  fs.rmSync(dir, { recursive: true, force: true });
});
