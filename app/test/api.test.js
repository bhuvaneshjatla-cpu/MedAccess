'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../server/db');
const { seed, DEMO_PASSWORD } = require('../server/seed');
const { createApp } = require('../server/app');
const { openReference } = require('../server/refdata');
const { makeFixtures } = require('./fixtures');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let server, base, tmp, refs;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-api-'));
  const { cdciFile, invFile } = makeFixtures(tmp);
  const db = openDb(':memory:');
  seed(db);
  refs = openReference({ cdci: cdciFile, inventory: invFile });
  server = http.createServer(createApp(db, refs));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); refs.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function login(role) {
  const r = await call('POST', '/api/auth/login', { body: { email: `${role}@demo.medaccess`, password: DEMO_PASSWORD } });
  assert.equal(r.status, 200);
  return r.data.token;
}

test('FR-01: restricted endpoints require authentication', async () => {
  assert.equal((await call('GET', '/api/catalogue?search=fix')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'patient@demo.medaccess', password: 'wrong' } })).status, 401);
});

test('FR-14/18/19: stock & price updates (CDCI brand + pharmacy) are role-restricted, validated, merged over the seed and audited', async () => {
  const patient = await login('patient'), staff = await login('staff'), admin = await login('admin');
  const put = (path, token, body) => call('PUT', path, { token, body });
  const ctxOk = { brand_identifier: 'B1', pharmacy_id: 'PH1' };
  assert.equal((await put('/api/availability', patient, { ...ctxOk, availability_status: 'Available' })).status, 403);
  assert.equal((await put('/api/availability', staff, { ...ctxOk, availability_status: 'Plenty' })).status, 400);
  assert.equal((await put('/api/availability', staff, { brand_identifier: 'NOPE', pharmacy_id: 'PH1', availability_status: 'Available' })).status, 404);
  assert.equal((await put('/api/availability', staff, { brand_identifier: 'B1', pharmacy_id: 'PHX', availability_status: 'Available' })).status, 400);
  // seeded value first
  let av = (await call('GET', '/api/catalogue/B1/availability', { token: patient })).data;
  assert.equal(av.is_synthetic, true);
  assert.equal(av.availability.find((r) => r.pharmacy_id === 'PH1').availability_status, 'Low Stock');
  assert.equal(av.availability.find((r) => r.pharmacy_id === 'PH1').status_source, 'synthetic seed');
  assert.equal(av.availability.find((r) => r.pharmacy_id === 'PH2').status_stale, true);
  // staff update overrides the seed and records who/when
  assert.equal((await put('/api/availability', staff, { ...ctxOk, availability_status: 'Available' })).status, 200);
  assert.equal((await put('/api/prices', staff, { ...ctxOk, amount: -5 })).status, 400);
  assert.equal((await put('/api/prices', staff, { ...ctxOk, amount: 41.55 })).status, 200);
  // a pharmacy with no seeded row can be updated too
  assert.equal((await put('/api/availability', staff, { brand_identifier: 'B1', pharmacy_id: 'PH3', availability_status: 'Low Stock' })).status, 200);
  av = (await call('GET', '/api/catalogue/B1/availability', { token: patient })).data;
  const ph1 = av.availability.find((r) => r.pharmacy_id === 'PH1');
  assert.equal(ph1.availability_status, 'Available');
  assert.equal(ph1.status_updated_by, 'Sam Staff');
  assert.equal(ph1.status_source, 'entered in MedAccess (demo)');
  assert.equal(ph1.status_stale, false);
  assert.equal(ph1.price_inr, 41.55);
  assert.equal(av.availability.find((r) => r.pharmacy_id === 'PH3').price_inr, null);
  assert.equal(av.count, 3);
  const audit = await call('GET', '/api/admin/audit?action=STOCK', { token: admin });
  assert.ok(audit.data.entries.some((e) => e.action === 'STOCK_UPDATED' && e.actor_name === 'Sam Staff' && JSON.parse(e.details).before === 'Low Stock'));
  const pa = await call('GET', '/api/admin/audit?action=PRICE', { token: admin });
  assert.ok(pa.data.entries.some((e) => JSON.parse(e.details).after === 41.55));
});

test('FR-28..31: report lifecycle (CDCI brand + pharmacy) with audit on resolution', async () => {
  const patient = await login('patient'), pharm = await login('pharmacist'), admin = await login('admin');
  const bad = await call('POST', '/api/reports', { token: patient, body: { brand_identifier: 'B1', pharmacy_id: 'PHX', report_type: 'Incorrect Price' } });
  assert.equal(bad.status, 400);
  const r = await call('POST', '/api/reports', { token: patient, body: { brand_identifier: 'B1', pharmacy_id: 'PH1', report_type: 'Incorrect Price', description: 'Shown price is lower than shop price' } });
  const id = r.data.report.report_id;
  assert.equal(r.data.report.brand_name, 'Fixtamol 1');
  assert.equal(r.data.report.pharmacy_name, 'Demo Pharmacy 1');
  assert.equal((await call('POST', `/api/reports/${id}/resolve`, { token: patient, body: { note: 'x' } })).status, 403);
  assert.equal((await call('POST', `/api/reports/${id}/resolve`, { token: pharm, body: { note: 'x' } })).status, 409); // must be reviewed first
  assert.equal((await call('POST', `/api/reports/${id}/review`, { token: pharm })).status, 200);
  assert.equal((await call('POST', `/api/reports/${id}/resolve`, { token: pharm, body: { note: 'x' } })).status, 409); // STD-04: must investigate first
  assert.equal((await call('POST', `/api/reports/${id}/investigate`, { token: pharm })).status, 200);
  assert.equal((await call('POST', `/api/reports/${id}/resolve`, { token: pharm, body: {} })).status, 400);
  assert.equal((await call('POST', `/api/reports/${id}/resolve`, { token: pharm, body: { note: 'Price corrected' } })).data.report.status, 'Resolved');
  const audit = await call('GET', '/api/admin/audit?action=REPORT_RESOLUTION', { token: admin });
  assert.equal(audit.data.entries.length, 1);
  // reporters only see their own reports
  assert.equal((await call('GET', '/api/reports', { token: patient })).data.reports.length, 1);
  assert.equal((await call('GET', '/api/reports', { token: await login('caregiver') })).data.reports.length, 0);
});

test('FR-32..34: reminders (CDCI brand) are private to the owner and support recurrence', async () => {
  const patient = await login('patient'), caregiver = await login('caregiver'), pharm = await login('pharmacist');
  assert.equal((await call('GET', '/api/reminders', { token: pharm })).status, 403);
  const when = new Date(Date.now() + 86400e3).toISOString();
  assert.equal((await call('POST', '/api/reminders', { token: patient, body: { brand_identifier: 'NOPE', reminder_date_time: when } })).status, 404);
  const c = await call('POST', '/api/reminders', { token: patient, body: { brand_identifier: 'B1', reminder_date_time: when, recurrence: 'Weekly' } });
  assert.equal(c.data.reminders.length, 1);
  assert.equal(c.data.reminders[0].brand_name, 'Fixtamol 1');
  assert.equal(c.data.reminders[0].strength, '500 mg');
  assert.equal((await call('GET', '/api/reminders', { token: caregiver })).data.reminders.length, 0);
  assert.equal((await call('POST', '/api/reminders', { token: patient, body: { brand_identifier: 'B1', reminder_date_time: 'nope' } })).status, 400);
  const id = c.data.reminders[0].reminder_id;
  const done = await call('POST', `/api/reminders/${id}/complete`, { token: patient });
  assert.equal(done.data.reminders[0].status, 'Scheduled'); // rescheduled
  assert.ok(new Date(done.data.reminders[0].reminder_date_time) > new Date(when));
});

test('FR-35..39: admin functions and account lifecycle', async () => {
  const admin = await login('admin'), patient = await login('patient');
  assert.equal((await call('GET', '/api/admin/users', { token: patient })).status, 403);
  const u = await call('POST', '/api/admin/users', { token: admin, body: { name: 'New Pat', email: 'new@demo.medaccess', password: 'LongEnough1', role: 'Patient' } });
  const uid = u.data.user.user_id;
  assert.equal(u.data.user.account_status, 'Created');
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'new@demo.medaccess', password: 'LongEnough1' } })).status, 403); // not yet active
  assert.equal((await call('POST', `/api/admin/users/${uid}/activate`, { token: admin })).status, 200);
  const t = (await call('POST', '/api/auth/login', { body: { email: 'new@demo.medaccess', password: 'LongEnough1' } })).data.token;
  assert.equal((await call('GET', '/api/auth/me', { token: t })).status, 200);
  assert.equal((await call('POST', `/api/admin/users/${uid}/deactivate`, { token: admin })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: t })).status, 401); // existing token stops working
  assert.equal((await call('POST', `/api/admin/users/${uid}/reactivate`, { token: admin })).status, 409); // Deactivated is terminal
  assert.equal((await call('POST', `/api/admin/users/${uid}/inactivate`, { token: admin })).status, 409);
  const reports = await call('GET', '/api/admin/reports', { token: admin });
  assert.ok(reports.data.users_by_role.length === 6);
  assert.ok(reports.data.availability_by_status.length >= 1);
  assert.equal(typeof reports.data.stale_records.availability, 'number');
});

test('static files are served with security headers and no path traversal', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/..%2Fserver%2Fauth.js')).status, 404);
});
