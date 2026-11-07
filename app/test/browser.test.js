'use strict';
// Browser-level smoke tests. A real (headless) Chromium-family browser loads the real UI from a real server and signs in through the
// login form. No dependencies: a minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
// Skipped automatically when no Chrome / Edge / Chromium is installed (set MEDACCESS_BROWSER to point at one).
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

const { findBrowser, launchBrowser, sleep } = require('./browser-harness');
const BROWSER = findBrowser();

let server, base, tmp, refs, handle, page, nav = 0;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-brw-'));
  const { cdciFile, invFile } = makeFixtures(tmp);
  const db = openDb(':memory:');
  seed(db);
  refs = openReference({ cdci: cdciFile, inventory: invFile });
  server = http.createServer(createApp(db, refs));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  if (!BROWSER) return;
  handle = await launchBrowser(tmp);
  page = handle.page;
});
test.after(async () => {
  await handle?.close();
  server.close(); refs.close();
  await sleep(100);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* the browser may still hold files on Windows */ }
});

// a fresh signed-out page, then sign in through the real login form
async function loginAs(role) {
  nav += 1;
  // clear any previous session on a neutral same-origin page (a 404 does not boot the app), then open the app signed out
  await page.goto(`${base}/signed-out-${nav}`);
  await page.waitFor("document.readyState === 'complete'", 'the neutral page');
  await page.eval('sessionStorage.clear()');
  await page.goto(`${base}/?run=${nav}#/login`);
  await page.waitFor("!!document.querySelector('#email')", 'the login form');
  await page.eval(`(() => { document.querySelector('#email').value = '${role}@demo.medaccess'; document.querySelector('#pw').value = '${DEMO_PASSWORD}'; document.querySelector('form.login').requestSubmit(); })()`);
  await page.waitFor("(document.querySelector('#whoami')?.textContent || '').length > 0", `${role} to sign in`);
}
const go = async (hash, h1) => { await page.eval(`location.hash = ${JSON.stringify(hash)}`); await page.waitFor(`document.querySelector('#view h1')?.textContent === ${JSON.stringify(h1)}`, `page "${h1}"`); };
const noProblems = () => { assert.deepEqual(page.errors, [], 'JavaScript exceptions or console errors'); assert.deepEqual(page.serverErrors, [], 'server 5xx responses'); };
const opts = { timeout: 60000, skip: BROWSER ? false : 'no Chrome / Edge / Chromium found (set MEDACCESS_BROWSER)' };

test('browser: the app boots as ES modules, shows the login form and rejects a wrong password', opts, async () => {
  page.errors.length = 0;
  await page.goto(`${base}/?boot=1#/login`);
  await page.waitFor("document.querySelector('#view h1')?.textContent === 'Sign in to MedAccess'", 'the sign-in page');
  assert.equal(await page.eval("document.querySelector('#top').hidden"), true); // no navigation before sign-in
  await page.eval("(() => { document.querySelector('#email').value = 'patient@demo.medaccess'; document.querySelector('#pw').value = 'wrong-password'; document.querySelector('form.login').requestSubmit(); })()");
  await page.waitFor("!!document.querySelector('.notice.err') && !document.querySelector('.notice.err').hidden", 'the login error');
  assert.match(await page.eval("document.querySelector('.notice.err').textContent"), /Invalid email or password/);
  assert.equal(await page.eval("document.querySelector('#top').hidden"), true);
  noProblems();
});

test('browser: patient signs in, searches, opens a brand, and cannot open staff or admin pages', opts, async () => {
  page.errors.length = 0;
  await loginAs('patient');
  assert.deepEqual(await page.eval("[...document.querySelectorAll('#nav a')].map((a) => a.textContent)"), ['Search', 'Reminders', 'My requests', 'My reports', 'Project docs']);
  await go('#/catalogue', 'Medicine catalogue');
  await page.eval("(() => { document.querySelector('#cq').value = 'fixtamol 1'; document.querySelector('#view form').requestSubmit(); })()");
  await page.waitFor("document.querySelectorAll('#view .grid button.card').length > 0", 'search results');
  await page.eval("document.querySelector('#view .grid button.card').click()");
  await page.waitFor("document.body.innerText.includes('DEMO DATA') && document.body.innerText.includes('Potential matches')", 'availability and matches');
  await page.waitFor("document.body.innerText.includes('Report a problem')", 'report form');
  assert.ok(!/(^|\n)(null|undefined)(\n|$)/.test(await page.eval('document.querySelector("#view").innerText')), 'no stray null/undefined text nodes in the detail view');
  const text = await page.eval('document.body.innerText');
  assert.match(text, /Report a problem/);
  assert.match(text, /refill reminder/);
  assert.equal(await page.eval("!!document.querySelector('select[aria-label^=\"Availability at\"]')"), false); // no stock editors for patients
  await page.eval("location.hash = '#/admin/users'");
  await page.waitFor("document.body.innerText.includes('does not have access')", 'the access-denied notice');
  noProblems();
});

test('browser: filters work and are kept in the address bar', opts, async () => {
  page.errors.length = 0;
  await loginAs('patient');
  await go('#/catalogue', 'Medicine catalogue');
  await page.eval("(() => { document.querySelector('#cing').value = 'paracetamol'; document.querySelector('#cstr').value = '650'; document.querySelector('#cfrm').value = 'tablet'; document.querySelector('#view form').requestSubmit(); })()");
  await page.waitFor("[...document.querySelectorAll('#view .grid button.card .card-title')].map((e) => e.textContent).join() === 'Feverfix 650'", 'the filtered result');
  assert.match(await page.eval('location.hash'), /ingredient=paracetamol&strength=650&form=tablet/);
  noProblems();
});

test('browser: pharmacist sees the verification queue and stock editors; staff cannot verify', opts, async () => {
  page.errors.length = 0;
  await loginAs('pharmacist');
  await go('#/verification', 'Pharmacist verification');
  await go('#/inventory', 'Update stock and prices');
  await go('#/catalogue?search=fixtamol%201', 'Medicine catalogue');
  await page.waitFor("document.querySelectorAll('#view .grid button.card').length > 0", 'search results');
  await page.eval("document.querySelector('#view .grid button.card').click()");
  await page.waitFor("!!document.querySelector('select[aria-label^=\"Availability at\"]')", 'stock editors');
  await loginAs('staff');
  await page.eval("location.hash = '#/verification'");
  await page.waitFor("document.body.innerText.includes('does not have access')", 'the access-denied notice');
  noProblems();
});

test('browser: administrator walks the admin pages and imports pack sizes from a CSV (preview first, then save)', opts, async () => {
  page.errors.length = 0;
  await loginAs('admin');
  for (const [hash, h1] of [['#/admin/users', 'Users and roles'], ['#/admin/reports', 'Administrative reports'], ['#/admin/audit', 'Audit log'], ['#/admin/catalogue', 'Catalogue administration']]) await go(hash, h1);
  await go('#/admin/reports', 'Administrative reports');
  await page.waitFor("document.body.innerText.includes('brands excluded')", 'the restricted-medicine review card');
  await go('#/admin/catalogue', 'Catalogue administration');
  await page.eval("(() => { const a = document.querySelector('#impcsv'); a.value = 'brand_identifier,pack_size\\nB6,10 tablets\\nNOPE,5 tablets\\n'; a.dispatchEvent(new Event('input')); })()");
  await page.eval("[...document.querySelectorAll('button')].find((b) => b.textContent === 'Preview').click()");
  await page.waitFor("document.body.innerText.includes('New: 1') && document.body.innerText.includes('Rejected: 1')", 'the import preview');
  // nothing is saved until the review box is ticked
  assert.equal(await page.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Save 1')).disabled"), true);
  await page.eval("document.querySelector('#impok').click()");
  assert.equal(await page.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Save 1')).disabled"), false);
  await page.eval("[...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Save 1')).click()");
  await page.waitFor("document.querySelector('#toast').textContent.startsWith('Imported 1 pack size')", 'the import confirmation');
  // a patient now sees the entered pack size with its source
  await loginAs('patient');
  await go('#/catalogue?search=fixtamol%206', 'Medicine catalogue');
  await page.waitFor("document.querySelectorAll('#view .grid button.card').length > 0", 'search results');
  await page.eval("document.querySelector('#view .grid button.card').click()");
  await page.waitFor("document.body.innerText.includes('10 tablets (entered by administrator)')", 'the imported pack size');
  noProblems();
});

test('browser: the layout fits a phone (375 px) without sideways scrolling, and logout returns to sign-in', opts, async () => {
  page.errors.length = 0;
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  try {
    await loginAs('patient');
    await go('#/catalogue?search=fixtamol', 'Medicine catalogue');
    await page.waitFor("document.querySelectorAll('#view .grid button.card').length > 0", 'search results');
    assert.equal(await page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, 'horizontal overflow at 375 px');
    await page.eval("document.querySelector('#logout').click()");
    await page.waitFor("document.querySelector('#view h1')?.textContent === 'Sign in to MedAccess'", 'return to the sign-in page');
    assert.equal(await page.eval("sessionStorage.getItem('ma_token')"), null);
  } finally { await page.send('Emulation.clearDeviceMetricsOverride'); }
  noProblems();
});


// ---------------------------------------------------------------- actions must refresh the list they were taken on
// (regression: three pages once called an un-imported route() after a successful action, so the list silently stayed stale)
const apiInPage = (method, p, body) => page.eval(`fetch(${JSON.stringify(p)}, { method: ${JSON.stringify(method)}, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sessionStorage.getItem('ma_token') }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} }).then((r) => r.json())`);
const clickByLabel = (label) => page.eval(`[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(label)}).click()`);
const hasButton = (label) => page.eval(`[...document.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(label)})`);

test('browser: reminders page refreshes after Mark done and Cancel', opts, async () => {
  page.errors.length = 0;
  await loginAs('patient');
  const when = new Date(Date.now() + 86400e3).toISOString();
  await apiInPage('POST', '/api/reminders', { brand_identifier: 'B1', reminder_date_time: when, recurrence: 'None' });
  await apiInPage('POST', '/api/reminders', { brand_identifier: 'B2', reminder_date_time: when, recurrence: 'None' });
  await go('#/reminders', 'Refill reminders');
  await page.waitFor("document.body.innerText.includes('Fixtamol 1') && document.body.innerText.includes('Fixtamol 2')", 'both reminders');
  await clickByLabel('Mark done: Fixtamol 1');
  await page.waitFor("document.querySelector('#toast').textContent === 'Marked done'", 'the confirmation');
  await page.waitFor("![...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Mark done: Fixtamol 1')", 'the list to refresh');
  assert.equal(await hasButton('Mark done: Fixtamol 1'), false, 'the finished reminder must no longer offer Mark done');
  assert.match(await page.eval("document.querySelector('#view').innerText"), /Completed/);
  await clickByLabel('Cancel reminder: Fixtamol 2');
  await page.waitFor("document.querySelector('#toast').textContent === 'Reminder cancelled'", 'the confirmation');
  await page.waitFor("![...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Cancel reminder: Fixtamol 2')", 'the list to refresh');
  assert.equal(await hasButton('Cancel reminder: Fixtamol 2'), false);
  assert.match(await page.eval("document.querySelector('#view').innerText"), /Cancelled/);
  noProblems();
});

test('browser: reports page refreshes through the review steps', opts, async () => {
  page.errors.length = 0;
  await loginAs('patient');
  const id = (await apiInPage('POST', '/api/reports', { brand_identifier: 'B1', pharmacy_id: 'PH1', report_type: 'Incorrect Price', description: 'refresh test' })).report.report_id;
  await loginAs('pharmacist');
  await go('#/reports', 'Incorrect-information reports');
  await page.waitFor(`document.body.innerText.includes('#${id} · Incorrect Price')`, 'the report');
  await clickByLabel(`Start review of report #${id}`);
  await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Investigate report #${id}')`, 'the list to refresh after Start review');
  assert.equal(await hasButton(`Start review of report #${id}`), false);
  await clickByLabel(`Investigate report #${id}`);
  await page.waitFor(`[...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Resolve report #${id}')`, 'the list to refresh after Investigate');
  noProblems();
});

test('browser: users page refreshes after an account action', opts, async () => {
  page.errors.length = 0;
  await loginAs('admin');
  await apiInPage('POST', '/api/admin/users', { name: 'Refresh Tester', email: 'refresh@demo.medaccess', password: 'LongEnough1', role: 'Patient' });
  await go('#/admin/users', 'Users and roles');
  await page.waitFor("document.body.innerText.includes('Refresh Tester')", 'the new user');
  await clickByLabel('Activate Refresh Tester');
  await page.waitFor("[...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Inactivate Refresh Tester')", 'the list to refresh after Activate');
  assert.equal(await hasButton('Activate Refresh Tester'), false);
  await clickByLabel('Inactivate Refresh Tester');
  await page.waitFor("[...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Reactivate Refresh Tester')", 'the list to refresh after Inactivate');
  noProblems();
});
