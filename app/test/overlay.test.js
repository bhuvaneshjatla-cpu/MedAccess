'use strict';
// Administrator overlay on the read-only CDCI catalogue: hide, annotate and add brands.
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
const { makeFixtures } = require('./fixtures');

let server, base, tmp, refs, db, files;
async function start(dbHandle) {
  refs = openReference({ cdci: files.cdciFile, inventory: files.invFile });
  server = http.createServer(createApp(dbHandle, refs));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-ovl-'));
  files = makeFixtures(tmp);
  db = openDb(':memory:');
  seed(db);
  await start(db);
});
test.after(() => { server.close(); refs.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const login = async (role) => (await call('POST', '/api/auth/login', { body: { email: `${role}@demo.medaccess`, password: DEMO_PASSWORD } })).data.token;
const names = (r) => r.data.results.map((x) => x.brand_identifier);

test('overlay endpoints are administrator-only', async () => {
  const pharm = await login('pharmacist');
  assert.equal((await call('GET', '/api/admin/catalogue', { token: pharm })).status, 403);
  assert.equal((await call('PUT', '/api/admin/catalogue/B1/overlay', { token: pharm, body: { note: 'x' } })).status, 403);
  assert.equal((await call('POST', '/api/admin/catalogue/custom', { token: pharm, body: {} })).status, 403);
});

test('annotate: note shows to users, can be cleared, CDCI data is untouched, audited', async () => {
  const admin = await login('admin'), patient = await login('patient');
  assert.equal((await call('PUT', '/api/admin/catalogue/B1/overlay', { token: admin, body: {} })).status, 400);
  assert.equal((await call('PUT', '/api/admin/catalogue/NOPE/overlay', { token: admin, body: { note: 'x' } })).status, 404);
  const r = await call('PUT', '/api/admin/catalogue/B2/overlay', { token: admin, body: { note: 'Supplier recalled lot 7 in 2026' } });
  assert.equal(r.data.brand.admin_note, 'Supplier recalled lot 7 in 2026');
  const s = await call('GET', '/api/catalogue?search=Fixtamol 2', { token: patient });
  assert.equal(s.data.results.find((x) => x.brand_identifier === 'B2').admin_note, 'Supplier recalled lot 7 in 2026');
  assert.equal(s.data.results.find((x) => x.brand_identifier === 'B2').brand_name, 'Fixtamol 2'); // CDCI name unchanged
  assert.equal((await call('PUT', '/api/admin/catalogue/B2/overlay', { token: admin, body: { note: '' } })).data.brand.admin_note, null);
  assert.equal((await call('GET', '/api/admin/catalogue?filter=annotated', { token: admin })).data.brands.length, 0);
  const audit = await call('GET', '/api/admin/audit?action=CATALOGUE_OVERLAY', { token: admin });
  assert.ok(audit.data.entries.some((e) => JSON.parse(e.details).after.note === 'Supplier recalled lot 7 in 2026'));
});

test('hide: removed from search and matches for users, still visible to administrators, reversible, reason required', async () => {
  const admin = await login('admin'), patient = await login('patient');
  assert.equal((await call('PUT', '/api/admin/catalogue/B3/overlay', { token: admin, body: { hidden: true } })).status, 400); // reason required
  const h = await call('PUT', '/api/admin/catalogue/B3/overlay', { token: admin, body: { hidden: true, hidden_reason: 'Withdrawn from market' } });
  assert.equal(h.data.brand.hidden, true);
  assert.equal(h.data.overlay.hidden_reason, 'Withdrawn from market');
  assert.ok(!names(await call('GET', '/api/catalogue?search=fixtamol&limit=50', { token: patient })).includes('B3'));
  assert.ok(names(await call('GET', '/api/catalogue?search=fixtamol&limit=50', { token: admin })).includes('B3'));
  const m = await call('GET', '/api/catalogue/B1/matches?limit=50', { token: patient });
  assert.equal(m.data.total, 28); // 29 minus the hidden brand
  assert.ok(!m.data.matches.some((x) => x.brand_identifier === 'B3'));
  assert.equal((await call('GET', '/api/admin/catalogue?filter=hidden', { token: admin })).data.brands[0].hidden_reason, 'Withdrawn from market');
  // reversible
  await call('PUT', '/api/admin/catalogue/B3/overlay', { token: admin, body: { hidden: false } });
  assert.ok(names(await call('GET', '/api/catalogue?search=fixtamol&limit=50', { token: patient })).includes('B3'));
  assert.equal((await call('GET', '/api/catalogue/B1/matches', { token: patient })).data.total, 29);
});

test('add a brand: FR-09 validation, BR-07, duplicates, works in search / availability / reports / reminders', async () => {
  const admin = await login('admin'), patient = await login('patient'), staff = await login('staff');
  const post = (body) => call('POST', '/api/admin/catalogue/custom', { token: admin, body });
  assert.equal((await post({ brand_name: 'Only Name' })).status, 400);
  const restricted = { brand_name: 'Tramadol 50', active_ingredient: 'Tramadol', strength: '50 mg', dosage_form: 'Capsule', pack_size: '10 capsules', manufacturer: 'Z' };
  assert.equal((await post(restricted)).status, 400);
  const ok = { brand_name: 'Localtamol 500', active_ingredient: 'Paracetamol', strength: '500 mg', dosage_form: 'Tablet', pack_size: '10 tablets', manufacturer: 'Local Pharma' };
  assert.equal((await post({ ...ok, generic_identifier: 'NOPE' })).status, 400);
  const created = await post({ ...ok, generic_identifier: 'G1' });
  assert.equal(created.status, 200);
  const id = created.data.brand.brand_identifier;
  assert.match(id, /^MA-[0-9]{5}$/);
  assert.equal(created.data.brand.origin, 'MedAccess');
  assert.equal(created.data.brand.attributes.pack_size, '10 tablets');
  assert.equal(created.data.brand.attributes.pack_size_basis, 'entered by administrator');
  assert.equal((await post({ ...ok, generic_identifier: 'G1' })).status, 409);
  // behaves like any catalogue entry
  const s = await call('GET', '/api/catalogue?search=localtamol', { token: patient });
  assert.equal(s.data.results[0].brand_identifier, id);
  assert.equal(s.data.results[0].source, 'Added by a MedAccess administrator');
  assert.equal((await call('PUT', '/api/availability', { token: staff, body: { brand_identifier: id, pharmacy_id: 'PH1', availability_status: 'Available' } })).status, 200);
  assert.equal((await call('GET', `/api/catalogue/${id}/availability`, { token: patient })).data.count, 1);
  assert.equal((await call('POST', '/api/reports', { token: patient, body: { brand_identifier: id, pharmacy_id: 'PH1', report_type: 'Other' } })).status, 200);
  const rem = await call('POST', '/api/reminders', { token: patient, body: { brand_identifier: id, reminder_date_time: new Date(Date.now() + 86400e3).toISOString() } });
  assert.equal(rem.data.reminders.at(-1).brand_name, 'Localtamol 500');
  // shares the CDCI generic G1 -> appears as an informational match for a CDCI brand with the same generic
  const m = await call('GET', '/api/catalogue/B1/matches?limit=50', { token: patient });
  assert.ok(m.data.matches.some((x) => x.brand_identifier === id));
  // edit; CDCI entries cannot be edited
  const e = await call('PUT', `/api/admin/catalogue/custom/${id}`, { token: admin, body: { ...ok, pack_size: '15 tablets', generic_identifier: 'G1' } });
  assert.equal(e.data.brand.attributes.pack_size, '15 tablets');
  assert.equal((await call('PUT', '/api/admin/catalogue/custom/B1', { token: admin, body: ok })).status, 404);
  assert.equal((await call('GET', '/api/admin/catalogue?filter=custom', { token: admin })).data.brands.length, 1);
  const audit = await call('GET', '/api/admin/audit?action=CATALOGUE_CUSTOM', { token: admin });
  assert.ok(audit.data.entries.some((x) => x.action === 'CATALOGUE_CUSTOM_CREATED'));
  assert.ok(audit.data.entries.some((x) => x.action === 'CATALOGUE_CUSTOM_UPDATED'));
});

test('admin list needs a search term to browse the whole catalogue', async () => {
  const admin = await login('admin');
  assert.equal((await call('GET', '/api/admin/catalogue?filter=all', { token: admin })).status, 400);
  const r = await call('GET', '/api/admin/catalogue?search=fixtamol&limit=5', { token: admin });
  assert.equal(r.data.brands.length, 5);
  assert.equal(r.data.has_more, true);
});

test('pack size overlay on a CDCI brand: entered by admin, shown everywhere, drives comparisons and price per unit', async () => {
  const admin = await login('admin'), patient = await login('patient'), staff = await login('staff');
  const put = (bid, body) => call('PUT', `/api/admin/catalogue/${bid}/overlay`, { token: admin, body });
  // before: CDCI records no pack size
  const before = (await call('GET', '/api/catalogue?search=Fixtamol 1', { token: patient })).data.results.find((x) => x.brand_identifier === 'B1');
  assert.equal(before.attributes.pack_size, null);
  assert.match(before.attributes.pack_size_basis, /CDCI has no pack size/);
  assert.equal((await call('GET', '/api/catalogue/B1/matches?limit=1', { token: patient })).data.matches[0].differences.pack_size, 'unknown (not recorded)');
  // set
  const r = await put('B1', { pack_size: '10 tablets' });
  assert.equal(r.data.brand.attributes.pack_size, '10 tablets');
  assert.equal(r.data.brand.attributes.pack_size_basis, 'entered by administrator');
  const after = (await call('GET', '/api/catalogue?search=Fixtamol 1', { token: patient })).data.results.find((x) => x.brand_identifier === 'B1');
  assert.equal(after.attributes.pack_size, '10 tablets'); // visible to users in search
  // comparison with a match: unknown until both are known, then same / differs
  await put('B2', { pack_size: '15 tablets' });
  const find = async (bid) => (await call('GET', '/api/catalogue/B1/matches?limit=50', { token: patient })).data.matches.find((x) => x.brand_identifier === bid);
  assert.equal((await find('B2')).differences.pack_size, 'differs (10 tablets vs 15 tablets)');
  await put('B2', { pack_size: '10 Tablets' });
  assert.equal((await find('B2')).differences.pack_size, 'same (10 tablets)'); // case-insensitive
  assert.equal((await find('B3')).differences.pack_size, 'unknown (not recorded)');
  // approximate price per unit appears once a pack size with a unit count is known
  await call('PUT', '/api/prices', { token: staff, body: { brand_identifier: 'B1', pharmacy_id: 'PH1', amount: 50 } });
  const av = (await call('GET', '/api/catalogue/B1/availability', { token: patient })).data;
  assert.equal(av.availability.find((x) => x.pharmacy_id === 'PH1').price_per_unit, 5);
  assert.equal(av.availability.find((x) => x.pharmacy_id === 'PH2').price_per_unit, 3); // seeded 30 / 10
  assert.equal((await call('GET', '/api/catalogue/B2/availability', { token: patient })).data.availability.length, 0);
  // a pack size without a leading count gives no per-unit price (never guessed)
  await put('B2', { pack_size: 'Strip' });
  await call('PUT', '/api/prices', { token: staff, body: { brand_identifier: 'B2', pharmacy_id: 'PH1', amount: 20 } });
  assert.equal((await call('GET', '/api/catalogue/B2/availability', { token: patient })).data.availability[0].price_per_unit, null);
  // validation and guards
  assert.equal((await put('B1', {})).status, 400);
  assert.equal((await call('PUT', '/api/admin/catalogue/B1/overlay', { token: staff, body: { pack_size: '5' } })).status, 403);
  // clear: overlay row disappears when nothing is left
  await put('B2', { pack_size: '' });
  assert.equal((await call('GET', '/api/admin/catalogue?filter=changed&limit=100', { token: admin })).data.brands.some((b) => b.brand_identifier === 'B2'), false);
  // administrator-added brands keep their own pack size: it must be edited on the brand itself
  const made = await call('POST', '/api/admin/catalogue/custom', { token: admin, body: { brand_name: 'Packtest', active_ingredient: 'Zinc', strength: '5 mg', dosage_form: 'Tablet', pack_size: '30 tablets', manufacturer: 'Acme' } });
  assert.equal((await put(made.data.brand.brand_identifier, { pack_size: '60 tablets' })).status, 400);
  // audited with before/after
  const audit = await call('GET', '/api/admin/audit?action=CATALOGUE_OVERLAY&limit=200', { token: admin });
  assert.ok(audit.data.entries.some((e) => { const d = JSON.parse(e.details); return d.after.pack_size === '10 tablets'; }));
});

test('the overlay survives a restart (reloaded from the application database)', async () => {
  const admin = await login('admin');
  await call('PUT', '/api/admin/catalogue/B5/overlay', { token: admin, body: { hidden: true, hidden_reason: 'Restart check', note: 'kept', pack_size: '12 capsules' } });
  server.close(); refs.close();
  await start(db); // same application database, fresh in-memory index
  const admin2 = await login('admin'), patient = await login('patient');
  assert.ok(!names(await call('GET', '/api/catalogue?search=fixtamol&limit=50', { token: patient })).includes('B5'));
  const hit = (await call('GET', '/api/catalogue?search=fixtamol&limit=50', { token: admin2 })).data.results.find((x) => x.brand_identifier === 'B5');
  assert.equal(hit.hidden, true);
  assert.equal(hit.admin_note, 'kept');
  assert.equal(hit.attributes.pack_size, '12 capsules'); // pack size survives the restart too
  assert.equal((await call('GET', '/api/catalogue?search=Fixtamol 1', { token: admin2 })).data.results.find((x) => x.brand_identifier === 'B1').attributes.pack_size, '10 tablets');
  assert.ok((await call('GET', '/api/admin/catalogue?filter=custom', { token: admin2 })).data.brands.some((b) => b.brand_name === 'Localtamol 500'));
});
