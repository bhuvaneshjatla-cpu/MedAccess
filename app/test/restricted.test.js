'use strict';
// BR-07 / SC-07: controlled and restricted medicines must be unreachable for every role.
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
const { loadRestrictedList, DEFAULT_FILE } = require('../server/restricted');
const { makeFixtures } = require('./fixtures');

// ---------------------------------------------------------------- the matcher and the list file
test('the shipped list loads, is well formed and has no duplicates', () => {
  const l = loadRestrictedList(DEFAULT_FILE);
  assert.ok(l.ingredients.length > 50);
  const names = l.ingredients.map((i) => i.name);
  assert.equal(new Set(names).size, names.length, 'duplicate names');
  for (const i of l.ingredients) {
    assert.equal(i.name, i.name.toLowerCase().trim());
    assert.ok(i.group, `${i.name} needs a group`);
  }
  assert.match(l.status, /DRAFT/); // honest about its review status
  for (const must of ['tramadol', 'codeine', 'morphine', 'alprazolam', 'diazepam', 'zolpidem', 'ketamine', 'fentanyl'])
    assert.ok(names.includes(must), must);
});

test('matching is whole-word, case-insensitive and catches any part of a combination', () => {
  const l = loadRestrictedList(DEFAULT_FILE);
  assert.deepEqual(l.matches('Tramadol hydrochloride 50 mg oral capsule'), ['tramadol']);
  assert.deepEqual(l.matches('ALPRAZOLAM 0.25 mg oral tablet'), ['alprazolam']);
  assert.deepEqual(l.matches('Codeine phosphate 30 mg and paracetamol 500 mg oral tablet'), ['codeine']);
  assert.deepEqual(l.matches('Paracetamol 325 mg and tramadol hydrochloride 37.5 mg oral tablet'), ['tramadol']);
  assert.deepEqual(l.matches('Hydromorphone hydrochloride 2 mg oral tablet'), ['hydromorphone']); // not "morphine"
  assert.deepEqual(l.matches('Paracetamol 500 mg oral tablet'), []);
  assert.deepEqual(l.matches('Cetirizine 10 mg oral tablet'), []);
  assert.deepEqual(l.matches('Dextromethorphan 15 mg oral syrup'), []); // contains "morphan", not a listed word
  assert.deepEqual(l.matches(null, undefined, ''), []);
  // any of generic / product / brand text counts
  assert.deepEqual(l.reasons({ generic_name: null, product_name: 'Tramadol SR', brand_name: 'X' }), ['tramadol']);
});

test('classification rule: Schedule X is excluded, ordinary Schedule H is not', () => {
  const l = loadRestrictedList(DEFAULT_FILE);
  assert.deepEqual(l.reasons({ generic_name: 'Foo 5 mg oral tablet', classification: 'Schedule X' }), ['classification:Schedule X']);
  assert.deepEqual(l.reasons({ generic_name: 'Foo 5 mg oral tablet', classification: 'Schedule H' }), []);
});

test('fails closed: a missing, unreadable or empty list stops start-up', () => {
  assert.throws(() => loadRestrictedList(path.join(os.tmpdir(), 'does-not-exist-restricted.json')), /Refusing to start/);
  assert.throws(() => loadRestrictedList({ ingredients: [] }), /empty or invalid/);
  const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ma-bad-')), 'bad.json');
  fs.writeFileSync(bad, '{ not json');
  assert.throws(() => loadRestrictedList(bad), /Refusing to start/);
  assert.throws(() => openReference({ cdci: '/none', inventory: '/none', restricted: '/none/restricted.json' }), /Refusing to start/);
});

test('a custom list file is honoured (reviewers can edit it)', () => {
  const l = loadRestrictedList({ version: 'x', ingredients: [{ name: 'Foobarine', group: 'Test' }] });
  assert.deepEqual(l.matches('foobarine 5 mg'), ['foobarine']);
  assert.deepEqual(l.matches('tramadol 50 mg'), []);
});

// ---------------------------------------------------------------- the running app
let server, base, tmp, refs;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-rst-'));
  const { cdciFile, invFile } = makeFixtures(tmp);
  const db = openDb(':memory:');
  seed(db);
  refs = openReference({ cdci: cdciFile, inventory: invFile }); // default shipped list
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
const RESTRICTED_BRANDS = ['B90', 'B91', 'B92', 'B93', 'B95'];

test('restricted brands are removed from the index (5 fixtures: 4 by name, 1 by classification), safe ones remain', () => {
  assert.equal(refs.restrictedBrands.size, 5);
  for (const b of RESTRICTED_BRANDS) assert.ok(refs.restrictedBrands.has(b), b);
  assert.equal(refs.search.brandById('B94')?.brand_name, 'Allerfix 10');
  assert.equal(refs.search.brandById('B90'), null);
});

test('no role can find a restricted brand by search', async () => {
  for (const role of ['patient', 'caregiver', 'pharmacist', 'staff', 'admin', 'doctor']) {
    const t = await login(role);
    for (const term of ['tramadol', 'painfix', 'codeine', 'codepara', 'hydromorphone', 'alprazolam', 'calmwell', 'xfix', 'foobarine']) {
      const r = await call('GET', `/api/catalogue?search=${term}`, { token: t });
      assert.equal(r.data.results.length, 0, `${role} found "${term}"`);
    }
    assert.equal((await call('GET', '/api/catalogue?search=allerfix', { token: t })).data.results.length, 1); // control: safe brand is found
  }
});

test('restricted brands are unreachable by identifier on every route', async () => {
  const patient = await login('patient'), staff = await login('staff'), admin = await login('admin'), pharm = await login('pharmacist');
  assert.equal((await call('GET', '/api/catalogue/B90/availability', { token: patient })).status, 404);
  assert.equal((await call('GET', '/api/catalogue/B90/matches', { token: patient })).status, 404);
  assert.equal((await call('PUT', '/api/availability', { token: staff, body: { brand_identifier: 'B90', pharmacy_id: 'PH1', availability_status: 'Available' } })).status, 404);
  assert.equal((await call('PUT', '/api/prices', { token: staff, body: { brand_identifier: 'B90', pharmacy_id: 'PH1', amount: 10 } })).status, 404);
  assert.equal((await call('POST', '/api/reports', { token: patient, body: { brand_identifier: 'B91', pharmacy_id: 'PH1', report_type: 'Other' } })).status, 404);
  assert.equal((await call('POST', '/api/reminders', { token: patient, body: { brand_identifier: 'B92', reminder_date_time: new Date(Date.now() + 86400e3).toISOString() } })).status, 404);
  assert.equal((await call('PUT', '/api/admin/catalogue/B93/overlay', { token: admin, body: { note: 'x' } })).status, 404);
  assert.equal((await call('POST', '/api/cdci-comparisons', { token: pharm, body: { brand_identifier: 'B90', match_brand_identifier: 'B91' } })).status, 404);
  // the raw demo inventory has a seeded row for B90: it must not leak, by brand or by product
  assert.equal((await call('GET', '/api/demo-inventory?brandIdentifier=B90', { token: patient })).data.count, 0);
  assert.equal((await call('GET', '/api/demo-inventory?productIdentifier=P90', { token: patient })).data.count, 0);
  assert.equal((await call('GET', '/api/demo-inventory?brandIdentifier=B94', { token: patient })).data.count, 1); // control
  // administrators cannot browse them either
  assert.equal((await call('GET', '/api/admin/catalogue?filter=all&search=tramadol', { token: admin })).data.brands.length, 0);
});

test('restricted brands do not appear in administrator statistics or in match lists', async () => {
  const admin = await login('admin'), patient = await login('patient');
  const rep = await call('GET', '/api/admin/reports', { token: admin });
  assert.equal(rep.data.restricted.excluded_brands, 5);
  assert.ok(!rep.data.availability_by_status.some((s) => s.count < 0));
  assert.equal((await call('GET', '/api/catalogue/B1/matches?limit=50', { token: patient })).data.total, 29); // unaffected
});

test('administrators can review what is excluded; other roles cannot', async () => {
  const admin = await login('admin'), pharm = await login('pharmacist');
  assert.equal((await call('GET', '/api/admin/restricted', { token: pharm })).status, 403);
  const r = await call('GET', '/api/admin/restricted', { token: admin });
  assert.equal(r.data.excluded_brands, 5);
  assert.equal(r.data.classifications[0].excluded_brands, 1); // Schedule X fixture
  assert.match(r.data.status, /DRAFT/);
  assert.ok(r.data.version);
  const byName = Object.fromEntries(r.data.rules.map((x) => [x.name, x.excluded_brands]));
  assert.equal(byName.tramadol, 1);
  assert.equal(byName.codeine, 1);
  assert.equal(byName.hydromorphone, 1);
  assert.equal(byName.alprazolam, 1);
  assert.ok(r.data.not_included_pending_review.length > 0);
});

test('administrators cannot add a restricted brand either (list-driven, not a separate blocklist)', async () => {
  const admin = await login('admin');
  const base1 = { brand_name: 'Newbrand', active_ingredient: 'Paracetamol', strength: '500 mg', dosage_form: 'Tablet', pack_size: '10 tablets', manufacturer: 'Acme' };
  const post = (o) => call('POST', '/api/admin/catalogue/custom', { token: admin, body: { ...base1, ...o } });
  assert.equal((await post({ active_ingredient: 'Tramadol' })).status, 400);
  assert.equal((await post({ active_ingredient: 'Midazolam' })).status, 400); // only on the new list
  assert.equal((await post({ brand_name: 'Zolpidem Plus' })).status, 400);
  assert.equal((await post({})).status, 200); // a safe brand is accepted
});
