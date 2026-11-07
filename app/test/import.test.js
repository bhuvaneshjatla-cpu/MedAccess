'use strict';
// Bulk pack-size import: CSV parsing, row validation, preview-before-save, commit safety, export.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../server/db');
const { seed, DEMO_PASSWORD } = require('../server/seed');
const { createApp } = require('../server/app');
const { openReference } = require('../server/refdata');
const { parseCsv, detectDelimiter, toCsv, csvCell } = require('../server/csv');
const { analyzePackSizeCsv } = require('../server/packImport');
const { makeFixtures } = require('./fixtures');

// ---------------------------------------------------------------- CSV reader/writer
test('csv: plain, quoted, escaped quotes, embedded newline, CRLF, BOM and blank lines', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n').rows, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('﻿a,b\r\n1,2\r\n\r\n').rows, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n').rows[1], ['x, y', 'say "hi"']);
  const nl = parseCsv('a,b\n"line1\nline2",z\nnext,row\n');
  assert.deepEqual(nl.rows[1], ['line1\nline2', 'z']);
  assert.deepEqual(nl.lines, [1, 2, 4]); // physical line numbers survive multi-line fields
  assert.deepEqual(parseCsv('a,b\r1,2').rows, [['a', 'b'], ['1', '2']]); // old Mac line ends
  assert.deepEqual(parseCsv('a,b\n1,\n').rows[1], ['1', '']);
  assert.deepEqual(parseCsv('').rows, []);
});

test('csv: an unterminated quote is reported, not swallowed', () => {
  const r = parseCsv('a,b\n1,"oops\n2,3\n');
  assert.match(r.error, /never closed/);
});

test('csv: delimiter detection (comma, semicolon, tab)', () => {
  assert.equal(detectDelimiter('a,b,c\n'), ',');
  assert.equal(detectDelimiter('a;b;c\n'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n'), '\t');
  assert.equal(detectDelimiter('﻿brand_identifier;pack_size\n'), ';');
  assert.deepEqual(parseCsv('a;b\n1;2\n', ';').rows[1], ['1', '2']);
});

test('csv: writer quotes, and defuses spreadsheet formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell(null), '');
  const text = toCsv([['id', 'name'], ['1', 'a, "b"']]);
  assert.deepEqual(parseCsv(text).rows, [['id', 'name'], ['1', 'a, "b"']]); // round trip
});

// ---------------------------------------------------------------- row validation (pure)
const BRANDS = {
  B1: { brand_name: 'Fixtamol 1', origin: 'CDCI', hidden: 0, pack_size: null },
  B2: { brand_name: 'Fixtamol 2', origin: 'CDCI', hidden: 0, pack_size: '10 tablets' },
  B3: { brand_name: 'Fixtamol 3', origin: 'CDCI', hidden: 1, pack_size: null },
  MA: { brand_name: 'Added', origin: 'MedAccess', hidden: 0, pack_size: '5 tablets' },
};
const ctx = { brandById: (id) => BRANDS[id] ?? null };
const analyze = (csv) => analyzePackSizeCsv(csv, ctx);
const byLine = (a) => Object.fromEntries(a.rows.map((r) => [r.line, r]));

test('validation: classifies add / update / unchanged / invalid with line numbers', () => {
  const a = analyze('brand_identifier,pack_size\nB1,10 tablets\nB2,15 tablets\nB2x,5\nB2,x\n');
  assert.equal(a.fatal, null);
  const r = byLine(a);
  assert.equal(r[2].action, 'add');
  assert.equal(r[3].action, 'update');
  assert.equal(r[3].current, '10 tablets');
  assert.equal(r[4].action, 'invalid'); // unknown id
  assert.match(r[4].errors[0], /Not in the catalogue/);
  assert.match(r[5].errors.join(' '), /Duplicate of line 3/);
  assert.deepEqual(a.totals, { rows: 4, add: 1, update: 1, unchanged: 0, invalid: 2, warnings: 0 });
  assert.equal(analyze('brand_identifier,pack_size\nB2,10 TABLETS\n').rows[0].action, 'unchanged'); // case-insensitive
});

test('validation: header aliases, extra columns reported, semicolon files, whitespace collapsed', () => {
  const a = analyze('﻿Brand ID;Pack Size;Notes\nB1;  10   tablets ;ignored\n');
  assert.equal(a.delimiter, ';');
  assert.deepEqual(a.ignored_columns, ['Notes']);
  assert.equal(a.rows[0].new, '10 tablets');
  assert.equal(a.rows[0].action, 'add');
  assert.equal(analyze('pack_size,brand_identifier\n10 tablets,B1\n').rows[0].action, 'add'); // column order does not matter
});

test('validation: fatal problems stop the import with a clear message', () => {
  assert.match(analyze('').fatal, /empty/);
  assert.match(analyze('brand_identifier,pack_size\n').fatal, /at least one data row/);
  assert.match(analyze('foo,bar\n1,2\n').fatal, /Missing columns: brand_identifier, pack_size/);
  assert.match(analyze('brand_identifier,foo\nB1,2\n').fatal, /Missing column: pack_size/);
  assert.match(analyze('brand_identifier,pack_size\nB1,"unclosed\n').fatal, /never closed/);
  const big = `brand_identifier,pack_size\n${'B1,10 tablets\n'.repeat(5001)}`;
  assert.match(analyze(big).fatal, /Too many rows/);
});

test('validation: bad pack sizes are rejected, odd ones warned', () => {
  const a = analyze(`brand_identifier,pack_size\nB1,\nB2,=SUM(A1)\nB3,${'x'.repeat(61)}\nB1,10 tablets\n`);
  const r = byLine(a);
  assert.match(r[2].errors.join(' '), /pack_size is empty/);
  assert.match(r[3].errors.join(' '), /formula/);
  assert.match(r[4].errors.join(' '), /longer than 60/);
  assert.equal(r[5].action, 'invalid'); // B1 duplicate of line 2 even though line 2 was itself invalid
  const w = analyze('brand_identifier,pack_size\nB1,10\nB2,Strip of ten\nB3,10 tablets\n');
  assert.match(byLine(w)[2].warnings[0], /No unit/);
  assert.match(byLine(w)[3].warnings[0], /No leading count/);
  assert.match(byLine(w)[4].warnings[0], /hidden/); // still importable, but flagged
  assert.equal(byLine(w)[4].action, 'add');
  assert.ok(analyze('brand_identifier,pack_size\nB1,ab\u0007c\n').rows[0].errors.some((e) => /control characters/.test(e)));
});

test('validation: administrator-added brands cannot be changed by import', () => {
  const r = analyze('brand_identifier,pack_size\nMA,10 tablets\n').rows[0];
  assert.equal(r.action, 'invalid');
  assert.match(r.errors[0], /Administrator-added brand/);
});

test('fingerprint ignores line-ending and BOM differences but changes with content', () => {
  const a = analyze('brand_identifier,pack_size\nB1,10 tablets\n').fingerprint;
  assert.equal(analyze('﻿brand_identifier,pack_size\r\nB1,10 tablets\r\n').fingerprint, a);
  assert.notEqual(analyze('brand_identifier,pack_size\nB1,11 tablets\n').fingerprint, a);
});

// ---------------------------------------------------------------- API
let server, base, tmp, refs;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-imp-'));
  const { cdciFile, invFile } = makeFixtures(tmp);
  const db = openDb(':memory:');
  seed(db);
  refs = openReference({ cdci: cdciFile, inventory: invFile });
  server = http.createServer(createApp(db, refs));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); refs.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const login = async (role) => (await call('POST', '/api/auth/login', { body: { email: `${role}@demo.medaccess`, password: DEMO_PASSWORD } })).data.token;
const PREVIEW = '/api/admin/catalogue/pack-size-import/preview';
const COMMIT = '/api/admin/catalogue/pack-size-import';
const packOf = async (token, bid, search) => (await call('GET', `/api/catalogue?search=${search}`, { token })).data.results.find((x) => x.brand_identifier === bid).attributes.pack_size;

test('import endpoints are administrator-only', async () => {
  const csv = 'brand_identifier,pack_size\nB1,10 tablets\n';
  for (const role of ['patient', 'caregiver', 'pharmacist', 'staff', 'doctor']) {
    const t = await login(role);
    assert.equal((await call('POST', PREVIEW, { token: t, body: { csv } })).status, 403, role);
    assert.equal((await call('POST', COMMIT, { token: t, body: { csv } })).status, 403, role);
    assert.equal((await call('GET', '/api/admin/catalogue/pack-size-export?ingredient=paracetamol', { token: t })).status, 403, role);
  }
  assert.equal((await call('POST', PREVIEW, { body: { csv } })).status, 401);
});

test('preview validates everything and saves nothing', async () => {
  const admin = await login('admin'), patient = await login('patient');
  const csv = 'brand_identifier,pack_size\nB10,10 tablets\nB11,15 tablets\nNOPE,5 tablets\nB90,10 capsules\nB11,20 tablets\n';
  const r = await call('POST', PREVIEW, { token: admin, body: { csv } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.totals, { rows: 5, add: 2, update: 0, unchanged: 0, invalid: 3, warnings: 0 });
  const byId = r.data.rows.filter((x) => x.action === 'invalid').map((x) => x.brand_identifier);
  assert.deepEqual(byId, ['NOPE', 'B90', 'B11']); // unknown, restricted (excluded from the catalogue), duplicate
  assert.match(r.data.rows[3].errors[0], /restricted medicine that is excluded/);
  assert.equal(r.data.rows[0].brand_name, 'Fixtamol 10');
  assert.ok(r.data.fingerprint);
  assert.equal(await packOf(patient, 'B10', 'Fixtamol 10'), null); // nothing written
  assert.equal((await call('POST', PREVIEW, { token: admin, body: {} })).status, 400); // csv missing
  assert.equal((await call('POST', PREVIEW, { token: admin, body: { csv: 'a,b\n1,2\n' } })).data.fatal.includes('Missing columns'), true);
});

test('commit: fingerprint must match, only valid rows are applied, hidden/note are preserved, everything is audited', async () => {
  const admin = await login('admin'), patient = await login('patient'), staff = await login('staff');
  await call('PUT', '/api/admin/catalogue/B12/overlay', { token: admin, body: { hidden: true, hidden_reason: 'keep me', note: 'existing note' } });
  const csv = 'brand_identifier,pack_size\nB10,10 tablets\nB12,15 tablets\nNOPE,5\nB90,10 capsules\nMA,1\n';
  const prev = (await call('POST', PREVIEW, { token: admin, body: { csv } })).data;
  assert.deepEqual([prev.totals.add, prev.totals.invalid], [2, 3]);
  // a different file cannot ride on someone else's preview
  assert.equal((await call('POST', COMMIT, { token: admin, body: { csv: `${csv}B13,5 tablets\n`, fingerprint: prev.fingerprint } })).status, 409);
  assert.equal((await call('POST', COMMIT, { token: admin, body: { csv } })).status, 409); // no fingerprint at all
  const done = await call('POST', COMMIT, { token: admin, body: { csv, fingerprint: prev.fingerprint } });
  assert.equal(done.status, 200);
  assert.deepEqual(done.data, { imported: 2, added: 2, updated: 0, unchanged: 0, skipped_invalid: 3 });
  assert.equal(await packOf(patient, 'B10', 'Fixtamol 10'), '10 tablets');
  // the hidden brand keeps its overlay; only the pack size was added
  const b12 = (await call('GET', '/api/admin/catalogue?filter=hidden', { token: admin })).data.brands.find((b) => b.brand_identifier === 'B12');
  assert.equal(b12.hidden, true);
  assert.equal(b12.hidden_reason, 'keep me');
  assert.equal(b12.admin_note, 'existing note');
  assert.equal(b12.attributes.pack_size, '15 tablets');
  // price per unit works straight away for an imported pack size
  await call('PUT', '/api/prices', { token: staff, body: { brand_identifier: 'B10', pharmacy_id: 'PH1', amount: 50 } });
  assert.equal((await call('GET', '/api/catalogue/B10/availability', { token: patient })).data.availability[0].price_per_unit, 5);
  // audit: one entry per brand (with before/after and source) plus a summary
  const audit = (await call('GET', '/api/admin/audit?action=CATALOGUE&limit=200', { token: admin })).data.entries;
  const rows = audit.filter((e) => e.action === 'CATALOGUE_OVERLAY_UPDATED' && JSON.parse(e.details).source === 'csv-import');
  assert.equal(rows.length, 2);
  assert.deepEqual(JSON.parse(rows[0].details).before, { pack_size: null });
  const summary = audit.find((e) => e.action === 'CATALOGUE_PACK_SIZE_IMPORT');
  assert.equal(JSON.parse(summary.details).applied, 2);
  assert.equal(JSON.parse(summary.details).fingerprint, prev.fingerprint);
  // importing the same file again changes nothing and says so
  const again = await call('POST', COMMIT, { token: admin, body: { csv, fingerprint: prev.fingerprint } });
  assert.equal(again.status, 400);
  assert.match(again.data.error, /Nothing to import/);
});

test('commit: updates existing values, skips unchanged rows, refuses a file with only errors', async () => {
  const admin = await login('admin'), patient = await login('patient');
  const csv = 'brand_identifier,pack_size\nB10,10 TABLETS\nB10b,5\nB14,30 tablets\nB1,\n';
  const p1 = (await call('POST', PREVIEW, { token: admin, body: { csv } })).data;
  assert.deepEqual([p1.totals.unchanged, p1.totals.add, p1.totals.invalid], [1, 1, 2]);
  const upd = 'brand_identifier,pack_size\nB10,20 tablets\n';
  const p2 = (await call('POST', PREVIEW, { token: admin, body: { csv: upd } })).data;
  assert.equal(p2.rows[0].action, 'update');
  assert.equal(p2.rows[0].current, '10 tablets');
  const done = await call('POST', COMMIT, { token: admin, body: { csv: upd, fingerprint: p2.fingerprint } });
  assert.deepEqual([done.data.updated, done.data.added], [1, 0]);
  assert.equal(await packOf(patient, 'B10', 'Fixtamol 10'), '20 tablets');
  const bad = 'brand_identifier,pack_size\nNOPE,5\n';
  const pb = (await call('POST', PREVIEW, { token: admin, body: { csv: bad } })).data;
  assert.equal((await call('POST', COMMIT, { token: admin, body: { csv: bad, fingerprint: pb.fingerprint } })).status, 400);
});

test('a large file (over the normal 100 KB body limit) can be previewed', async () => {
  const admin = await login('admin');
  const lines = ['brand_identifier,pack_size'];
  for (let i = 0; i < 4000; i += 1) lines.push(`B${(i % 30) + 1},${100 + i} tablets, some extra column that makes the row long`);
  const csv = lines.join('\n');
  assert.ok(csv.length > 150_000);
  const r = await call('POST', PREVIEW, { token: admin, body: { csv } });
  assert.equal(r.status, 200);
  assert.equal(r.data.totals.rows, 4000);
  assert.ok(r.data.totals.invalid >= 3900); // all but the first occurrence of each of the 30 ids are duplicates
});

test('export: needs criteria, CDCI brands only (no restricted, no administrator-added), fills the import format', async () => {
  const admin = await login('admin');
  assert.equal((await call('GET', '/api/admin/catalogue/pack-size-export', { token: admin })).status, 400);
  const r = await call('GET', '/api/admin/catalogue/pack-size-export?ingredient=paracetamol', { token: admin });
  assert.equal(r.status, 200);
  const rows = parseCsv(r.data.csv).rows;
  assert.deepEqual(rows[0], ['brand_identifier', 'pack_size', 'brand_name', 'generic_name', 'supplier_name']);
  assert.equal(r.data.count, rows.length - 1);
  const ids = rows.slice(1).map((x) => x[0]);
  assert.ok(ids.includes('B1'));
  assert.ok(!ids.includes('B91')); // codeine + paracetamol: restricted
  // "missing only" leaves out brands that already have a pack size
  const missing = parseCsv((await call('GET', '/api/admin/catalogue/pack-size-export?ingredient=paracetamol&missing=1', { token: admin })).data.csv).rows.slice(1).map((x) => x[0]);
  assert.ok(!missing.includes('B10')); // imported earlier in this file
  assert.ok(missing.includes('B1'));
  // round trip: fill the pack_size column and the file previews as all "add"
  const filled = toCsv(parseCsv((await call('GET', '/api/admin/catalogue/pack-size-export?ingredient=paracetamol&missing=1', { token: admin })).data.csv).rows
    .map((row, i) => (i === 0 ? row : [row[0], '10 tablets', ...row.slice(2)])));
  const prev = (await call('POST', PREVIEW, { token: admin, body: { csv: filled } })).data;
  assert.equal(prev.totals.invalid, 0);
  assert.equal(prev.totals.add, prev.totals.rows);
  assert.deepEqual(prev.ignored_columns, ['brand_name', 'generic_name', 'supplier_name']);
});
