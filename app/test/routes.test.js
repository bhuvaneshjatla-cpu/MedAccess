'use strict';
// Route coverage guard: a scripted scenario that exercises EVERY registered route with valid input and fails on any 500
// (an internal error such as a broken reference inside a handler). It also pins the route table, so moving code between
// modules cannot silently add, drop, reorder or re-protect a route.
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

let server, base, tmp, refs, app;
const hits = new Set();
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-rte-'));
  const { cdciFile, invFile } = makeFixtures(tmp);
  const db = openDb(':memory:');
  seed(db);
  refs = openReference({ cdci: cdciFile, inventory: invFile });
  app = createApp(db, refs);
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); refs.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// call + record which route served it; never allow a 500
async function call(method, p, { token, body, expect } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  assert.notEqual(res.status, 500, `${method} ${p} -> 500 ${JSON.stringify(data)}`);
  if (expect !== undefined) assert.equal(res.status, expect, `${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  const pathname = p.split('?')[0];
  const i = app.routes.findIndex((r) => r.method === method && r.re.test(pathname));
  if (i >= 0 && res.status < 500) hits.add(i);
  return { status: res.status, data };
}
const login = async (role) => (await call('POST', '/api/auth/login', { body: { email: `${role}@demo.medaccess`, password: DEMO_PASSWORD } })).data.token;

test('the route table is pinned (method, pattern, roles, body limit, order)', () => {
  const table = app.routes.map((r) => `${r.method} ${r.re.source} ${r.roles === null ? 'public' : Array.isArray(r.roles) ? r.roles.join('|') : r.roles}${r.maxBody ? ` max=${r.maxBody}` : ''}`);
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.snapshot.json'), 'utf8'));
  assert.deepEqual(table, snapshot, 'route table changed; if intentional, regenerate test/routes.snapshot.json');
  assert.equal(new Set(table).size, table.length, 'duplicate route');
});

test('scenario: every route works end to end with valid input (no 500 anywhere)', async () => {
  const admin = await login('admin'), patient = await login('patient'), pharm = await login('pharmacist'), staff = await login('staff');
  // auth + reference
  await call('GET', '/api/auth/me', { token: patient, expect: 200 });
  await call('GET', '/api/meta', { expect: 200 });
  // catalogue
  await call('GET', '/api/catalogue?search=fixtamol', { token: patient, expect: 200 });
  await call('GET', '/api/demo-inventory?brandIdentifier=B1', { token: patient, expect: 200 });
  // matching + pharmacist verification
  await call('GET', '/api/catalogue/B1/matches', { token: patient, expect: 200 });
  const c1 = (await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B1', match_brand_identifier: 'B2' }, expect: 200 })).data.comparison.comparison_id;
  const c2 = (await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B3', match_brand_identifier: 'B4' }, expect: 200 })).data.comparison.comparison_id;
  await call('GET', '/api/cdci-comparisons', { token: pharm, expect: 200 });
  const myReqs = (await call('GET', '/api/my-comparisons', { token: patient, expect: 200 })).data.comparisons;
  assert.deepEqual(myReqs.map((c) => c.comparison_id).sort(), [c1, c2].sort());
  assert.equal((await call('GET', '/api/my-comparisons', { token: pharm, expect: 200 })).data.comparisons.length, 0);
  await call('GET', `/api/cdci-comparisons/${c1}`, { token: pharm, expect: 200 });
  await call('POST', `/api/cdci-comparisons/${c1}/open`, { token: pharm, expect: 200 });
  await call('POST', `/api/cdci-comparisons/${c1}/comments`, { token: pharm, body: { text: 'checked' }, expect: 200 });
  await call('POST', `/api/cdci-comparisons/${c1}/verify`, { token: pharm, body: {}, expect: 200 });
  await call('POST', `/api/cdci-comparisons/${c2}/open`, { token: pharm, expect: 200 });
  await call('POST', `/api/cdci-comparisons/${c2}/reject`, { token: pharm, body: {}, expect: 200 });
  // availability and price
  await call('GET', '/api/pharmacies', { token: patient, expect: 200 });
  await call('GET', '/api/catalogue/B1/availability', { token: patient, expect: 200 });
  await call('PUT', '/api/availability', { token: staff, body: { brand_identifier: 'B1', pharmacy_id: 'PH1', availability_status: 'Available' }, expect: 200 });
  await call('PUT', '/api/prices', { token: staff, body: { brand_identifier: 'B1', pharmacy_id: 'PH1', amount: 12.5 }, expect: 200 });
  // reports
  const rid = (await call('POST', '/api/reports', { token: patient, body: { brand_identifier: 'B1', pharmacy_id: 'PH1', report_type: 'Other' }, expect: 200 })).data.report.report_id;
  await call('GET', '/api/reports', { token: patient, expect: 200 });
  for (const [action, body] of [['review', {}], ['investigate', {}], ['resolve', { note: 'done' }]]) await call('POST', `/api/reports/${rid}/${action}`, { token: pharm, body, expect: 200 });
  // reminders
  const when = new Date(Date.now() + 86400e3).toISOString();
  const rem = (await call('POST', '/api/reminders', { token: patient, body: { brand_identifier: 'B1', reminder_date_time: when, recurrence: 'Weekly' }, expect: 200 })).data.reminders;
  await call('GET', '/api/reminders', { token: patient, expect: 200 });
  const later = new Date(Date.now() + 3 * 86400e3).toISOString();
  const edited = (await call('PUT', `/api/reminders/${rem[0].reminder_id}`, { token: patient, body: { reminder_date_time: later, recurrence: 'Monthly' }, expect: 200 })).data.reminders[0];
  assert.equal(edited.recurrence, 'Monthly'); assert.equal(edited.reminder_date_time, later); assert.equal(edited.status, 'Scheduled');
  await call('PUT', `/api/reminders/${rem[0].reminder_id}`, { token: patient, body: { recurrence: 'Hourly' }, expect: 400 });
  await call('POST', `/api/reminders/${rem[0].reminder_id}/complete`, { token: patient, expect: 200 });
  await call('POST', `/api/reminders/${rem[0].reminder_id}/cancel`, { token: patient, expect: 200 });
  // user administration
  await call('GET', '/api/admin/users', { token: admin, expect: 200 });
  const uid = (await call('POST', '/api/admin/users', { token: admin, body: { name: 'Route Test', email: 'route@demo.medaccess', password: 'LongEnough1', role: 'Patient' }, expect: 200 })).data.user.user_id;
  await call('PATCH', `/api/admin/users/${uid}`, { token: admin, body: { name: 'Route Tester' }, expect: 200 });
  await call('POST', `/api/admin/users/${uid}/activate`, { token: admin, expect: 200 });
  // catalogue administration (overlay, custom brands, CSV import / export)
  await call('GET', '/api/admin/catalogue', { token: admin, expect: 200 });
  await call('PUT', '/api/admin/catalogue/B5/overlay', { token: admin, body: { note: 'n', pack_size: '10 tablets' }, expect: 200 });
  const mine = (await call('POST', '/api/admin/catalogue/custom', { token: admin, body: { brand_name: 'Routebrand', active_ingredient: 'Zinc', strength: '5 mg', dosage_form: 'Tablet', pack_size: '10 tablets', manufacturer: 'Acme' }, expect: 200 })).data.brand.brand_identifier;
  await call('PUT', `/api/admin/catalogue/custom/${mine}`, { token: admin, body: { brand_name: 'Routebrand', active_ingredient: 'Zinc', strength: '5 mg', dosage_form: 'Tablet', pack_size: '20 tablets', manufacturer: 'Acme' }, expect: 200 });
  const csv = 'brand_identifier,pack_size\nB6,10 tablets\n';
  const prev = (await call('POST', '/api/admin/catalogue/pack-size-import/preview', { token: admin, body: { csv }, expect: 200 })).data;
  await call('POST', '/api/admin/catalogue/pack-size-import', { token: admin, body: { csv, fingerprint: prev.fingerprint }, expect: 200 });
  await call('GET', '/api/admin/catalogue/pack-size-export?ingredient=paracetamol', { token: admin, expect: 200 });
  // reporting, restricted-list review, audit
  await call('GET', '/api/admin/restricted', { token: admin, expect: 200 });
  await call('GET', '/api/admin/reports', { token: admin, expect: 200 });
  await call('GET', '/api/admin/audit', { token: admin, expect: 200 });
  await call('POST', '/api/auth/logout', { token: patient, expect: 200 });

  const missed = app.routes.map((r, i) => (hits.has(i) ? null : `${r.method} ${r.re.source}`)).filter(Boolean);
  assert.deepEqual(missed, [], 'routes not exercised by the scenario');
});

test('unknown paths and wrong methods are handled by the pipeline (404 / 405), static files and errors keep their headers', async () => {
  const t = await login('patient');
  assert.equal((await call('GET', '/api/nope', { token: t })).status, 404);
  assert.equal((await call('DELETE', '/api/catalogue', { token: t })).status, 405);
  const res = await fetch(base + '/api/catalogue?search=fix');
  assert.equal(res.status, 401); // authentication is enforced before the handler
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/')).headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/missing.js')).status, 404);
});
