'use strict';
// Tests for the read-only CDCI catalogue and synthetic inventory endpoints, using small fixture databases.
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

let server, base, tmp, refs;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-ref-'));
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
async function login(role) {
  return (await call('POST', '/api/auth/login', { body: { email: `${role}@demo.medaccess`, password: DEMO_PASSWORD } })).data.token;
}

test('catalogue and demo inventory require authentication', async () => {
  assert.equal((await call('GET', '/api/catalogue?search=fix')).status, 401);
  assert.equal((await call('GET', '/api/demo-inventory?brandIdentifier=B1')).status, 401);
});

test('CDCI search: min length, case-insensitive, pagination, literal % handling, informational flag', async () => {
  const t = await login('patient');
  assert.deepEqual((await call('GET', '/api/catalogue?search=a', { token: t })).data.results, []);
  const r = await call('GET', '/api/catalogue?search=FIXTAMOL&limit=10', { token: t });
  assert.equal(r.data.results.length, 10);
  assert.equal(r.data.has_more, true);
  assert.equal(r.data.results[0].informational_only, true);
  assert.equal(r.data.results[0].attributes.strength, '500 mg');
  assert.equal(r.data.results[0].attributes.dosage_form, 'Oral tablet');
  assert.equal(r.data.results[0].attributes.pack_size_basis.startsWith('not recorded'), true);
  const p3 = await call('GET', '/api/catalogue?search=fixtamol&limit=10&offset=20', { token: t });
  assert.equal(p3.data.results.length, 10);
  assert.equal(p3.data.has_more, false);
  assert.equal((await call('GET', '/api/catalogue?search=100%25', { token: t })).data.results.length, 1); // % is literal
  assert.equal((await call('GET', '/api/catalogue?search=%25%25', { token: t })).data.results.length, 0);
});

test('demo inventory is labelled synthetic, flags stale rows, exact-id only, role-limited', async () => {
  const t = await login('patient'), doctor = await login('doctor');
  const r = await call('GET', '/api/demo-inventory?brandIdentifier=B1', { token: t });
  assert.equal(r.data.is_synthetic, true);
  assert.match(r.data.data_label, /NOT LIVE PHARMACY AVAILABILITY/);
  assert.equal(r.data.count, 2);
  assert.equal(r.data.results[0].price_inr, 30); // ordered by price ascending
  assert.equal(r.data.results[0].stale, true);
  assert.equal(r.data.results[1].stale, false);
  // parsed attributes come from the CDCI generic (strength parsed from name, form from drug-form master, no pack size)
  assert.equal(r.data.results[0].attributes.strength, '500 mg');
  assert.equal(r.data.results[0].attributes.dosage_form, 'Oral tablet');
  assert.equal(r.data.results[0].attributes.pack_size, null);
  assert.match(r.data.results[0].attributes.strength_basis, /unverified/);
  assert.equal((await call('GET', '/api/demo-inventory?brandIdentifier=B', { token: t })).data.count, 0); // no prefix matching
  assert.equal((await call('GET', '/api/demo-inventory', { token: t })).status, 400);
  assert.equal((await call('GET', '/api/demo-inventory?brandIdentifier=B1', { token: doctor })).status, 403);
});

test('demo inventory still accepts the product identifier', async () => {
  const t = await login('patient');
  assert.equal((await call('GET', '/api/demo-inventory?productIdentifier=P1', { token: t })).data.count, 2);
});

test('potential matches: same CDCI generic only, informational, differences and paging shown', async () => {
  const patient = await login('patient'), doctor = await login('doctor'), staff = await login('staff');
  const r = await call('GET', '/api/catalogue/B1/matches?limit=5', { token: patient });
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 29); // B2..B30 share generic G1; B99 does not
  assert.equal(r.data.matches.length, 5);
  assert.equal(r.data.has_more, true);
  assert.ok(r.data.matches.every((m) => m.status === 'Informational Match' && m.generic_identifier === 'G1'));
  assert.equal(r.data.matches[0].differences.brand, true);
  assert.equal(r.data.matches[0].differences.supplier, false); // same fixture supplier
  assert.match(r.data.matches[0].differences.pack_size, /not recorded/);
  assert.equal(r.data.selected.attributes.strength, '500 mg');
  assert.equal(r.data.selected.lowest_demo_price, 30);
  assert.equal((await call('GET', '/api/catalogue/B99/matches', { token: patient })).data.total, 0);
  assert.equal((await call('GET', '/api/catalogue/B1/matches', { token: doctor })).status, 200);
  assert.equal((await call('GET', '/api/catalogue/B1/matches', { token: staff })).status, 403);
  assert.equal((await call('GET', '/api/catalogue/NOPE/matches', { token: patient })).status, 404);
});

test('CDCI comparison: nothing is verified without an explicit pharmacist action', async () => {
  const patient = await login('patient'), pharm = await login('pharmacist'), admin = await login('admin');
  // different generics cannot be compared
  assert.equal((await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B1', match_brand_identifier: 'B99' } })).status, 400);
  assert.equal((await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B1', match_brand_identifier: 'B1' } })).status, 400);
  const req = await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B2', match_brand_identifier: 'B1' } });
  const id = req.data.comparison.comparison_id;
  assert.equal(req.data.comparison.comparison_status, 'Pending Review');
  assert.equal(req.data.comparison.brand_a, 'B1'); // pair stored in canonical order
  // asking again returns the same open comparison
  const again = await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B1', match_brand_identifier: 'B2' } });
  assert.equal(again.data.existing, true);
  assert.equal(again.data.comparison.comparison_id, id);
  // the match list now reflects the status, but still not "verified"
  const m = await call('GET', '/api/catalogue/B1/matches?limit=50', { token: patient });
  assert.equal(m.data.matches.find((x) => x.brand_identifier === 'B2').status, 'Pending Review');
  // role and order guards
  assert.equal((await call('POST', `/api/cdci-comparisons/${id}/open`, { token: patient })).status, 403);
  assert.equal((await call('POST', `/api/cdci-comparisons/${id}/verify`, { token: pharm })).status, 409);
  assert.equal((await call('POST', `/api/cdci-comparisons/${id}/open`, { token: pharm })).status, 200);
  const v = await call('POST', `/api/cdci-comparisons/${id}/verify`, { token: pharm, body: { comment: 'Same generic; reviewed.' } });
  assert.equal(v.data.comparison.comparison_status, 'Verified');
  assert.equal(v.data.comparison.verifier_name, 'Priya Pharmacist');
  assert.equal(v.data.comparison.comments.length, 1);
  assert.match(v.data.comparison.safety, /not a substitution recommendation/);
  // verified comparisons are returned, not duplicated, and cannot be re-decided
  assert.equal((await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B1', match_brand_identifier: 'B2' } })).data.existing, true);
  assert.equal((await call('POST', `/api/cdci-comparisons/${id}/reject`, { token: pharm })).status, 409);
  // rejection path + re-request after rejection
  const r2 = await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B3', match_brand_identifier: 'B4' } });
  const id2 = r2.data.comparison.comparison_id;
  await call('POST', `/api/cdci-comparisons/${id2}/open`, { token: pharm });
  assert.equal((await call('POST', `/api/cdci-comparisons/${id2}/reject`, { token: pharm, body: { comment: 'Not suitable' } })).data.comparison.comparison_status, 'Rejected');
  const r3 = await call('POST', '/api/cdci-comparisons', { token: patient, body: { brand_identifier: 'B3', match_brand_identifier: 'B4' } });
  assert.notEqual(r3.data.comparison.comparison_id, id2);
  assert.equal(r3.data.comparison.comparison_status, 'Pending Review');
  // pharmacist queue + audit trail
  const q = await call('GET', '/api/cdci-comparisons?status=Pending%20Review', { token: pharm });
  assert.ok(q.data.comparisons.some((c) => c.comparison_id === r3.data.comparison.comparison_id));
  assert.equal((await call('GET', '/api/cdci-comparisons', { token: patient })).status, 403);
  const audit = await call('GET', '/api/admin/audit?action=CDCI_COMPARISON', { token: admin });
  for (const a of ['CDCI_COMPARISON_REQUESTED', 'CDCI_COMPARISON_REVIEW_STARTED', 'CDCI_COMPARISON_VERIFIED', 'CDCI_COMPARISON_REJECTED'])
    assert.ok(audit.data.entries.some((e) => e.action === a), a);
});

test('missing reference databases give 503, not a crash', async () => {
  const db = openDb(':memory:'); seed(db);
  const s = http.createServer(createApp(db, openReference({ cdci: path.join(tmp, 'none.db'), inventory: path.join(tmp, 'none2.db') })));
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${s.address().port}`;
  const tok = (await (await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'patient@demo.medaccess', password: DEMO_PASSWORD }) })).json()).token;
  const r = await fetch(b + '/api/catalogue?search=abc', { headers: { Authorization: `Bearer ${tok}` } });
  assert.equal(r.status, 503);
  s.close();
});

test('demo timestamps can be re-anchored to now (G4): relative spread kept, disclosed, off by default', () => {
  const { cdciFile, invFile } = makeFixtures(fs.mkdtempSync(path.join(os.tmpdir(), 'ma-anchor-')));
  const plain = openReference({ cdci: cdciFile, inventory: invFile });
  const shifted = openReference({ cdci: cdciFile, inventory: invFile, reanchorDemo: true });
  try {
    assert.equal(plain.demoShiftDays, 0);
    assert.equal(plain.demoTime('2026-01-01T00:00:00.000Z'), '2026-01-01T00:00:00.000Z');
    const rows = shifted.inventory.prepare('SELECT last_updated_at t FROM v_demo_inventory').all().map((r) => r.t).sort();
    const newest = new Date(shifted.demoTime(rows.at(-1))).getTime();
    assert.ok(Math.abs(Date.now() - newest) < 60e3, 'newest seed row is re-anchored to about now');
    const span = (a, b) => new Date(b).getTime() - new Date(a).getTime();
    assert.equal(span(shifted.demoTime(rows[0]), shifted.demoTime(rows.at(-1))), span(rows[0], rows.at(-1)), 'relative spread is unchanged');
  } finally { plain.close(); shifted.close(); }
});
