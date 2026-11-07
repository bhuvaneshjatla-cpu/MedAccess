'use strict';
// Accessibility tests in a real browser: an automated WCAG 2.2 AA audit of every page in light and dark mode, keyboard-only use,
// focus handling, the resolution dialog, titles and reflow. Skipped when no Chromium-family browser is installed.
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
const { AUDIT_SOURCE, contrastRatio, relativeLuminance } = require('./a11y-audit');

const BROWSER = findBrowser();
const opts = { timeout: 120000, skip: BROWSER ? false : 'no Chrome / Edge / Chromium found (set MEDACCESS_BROWSER)' };

// ---------------------------------------------------------------- contrast maths (pure, runs without a browser)
test('contrast maths matches the WCAG reference values', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(2), '21.00');
  assert.equal(contrastRatio([255, 255, 255], [255, 255, 255]).toFixed(2), '1.00');
  assert.equal(contrastRatio([119, 119, 119], [255, 255, 255]).toFixed(2), '4.48'); // #777 on white: the classic just-below-AA grey
  assert.equal(contrastRatio([118, 118, 118], [255, 255, 255]).toFixed(2), '4.54'); // #767676 passes
  assert.ok(Math.abs(relativeLuminance([255, 255, 255]) - 1) < 1e-9);
});

// ---------------------------------------------------------------- app + browser
let server, base, tmp, refs, handle, page, nav = 0;
const tokens = {};
async function api(method, p, { role, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  assert.ok(res.status < 400, `${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-a11y-'));
  const { cdciFile, invFile } = makeFixtures(tmp);
  const db = openDb(':memory:');
  seed(db);
  refs = openReference({ cdci: cdciFile, inventory: invFile });
  server = http.createServer(createApp(db, refs));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const role of ['patient', 'pharmacist', 'admin']) tokens[role] = (await api('POST', '/api/auth/login', { body: { email: `${role}@demo.medaccess`, password: DEMO_PASSWORD } })).token;
  // data so that every kind of screen has realistic content: a pending and an in-review comparison, reports at each step, a reminder, an override
  const c1 = (await api('POST', '/api/cdci-comparisons', { role: 'patient', body: { brand_identifier: 'B1', match_brand_identifier: 'B2' } })).comparison.comparison_id;
  const c2 = (await api('POST', '/api/cdci-comparisons', { role: 'patient', body: { brand_identifier: 'B3', match_brand_identifier: 'B4' } })).comparison.comparison_id;
  await api('POST', `/api/cdci-comparisons/${c2}/open`, { role: 'pharmacist', body: {} });
  void c1;
  for (const type of ['Incorrect Price', 'Incorrect Availability']) await api('POST', '/api/reports', { role: 'patient', body: { brand_identifier: 'B1', pharmacy_id: 'PH1', report_type: type, description: 'shown price differs' } });
  await api('POST', '/api/reports/2/review', { role: 'pharmacist', body: {} });
  await api('POST', '/api/reports/2/investigate', { role: 'pharmacist', body: {} });
  await api('POST', '/api/reminders', { role: 'patient', body: { brand_identifier: 'B1', reminder_date_time: new Date(Date.now() + 86400e3).toISOString(), recurrence: 'Weekly' } });
  await api('PUT', '/api/admin/catalogue/B5/overlay', { role: 'admin', body: { note: 'Check the supplier batch', pack_size: '10 tablets' } });
  if (!BROWSER) return;
  handle = await launchBrowser(tmp);
  page = handle.page;
});
test.after(async () => {
  await handle?.close();
  server.close(); refs.close();
  await sleep(100);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function loginAs(role) {
  nav += 1;
  await page.goto(`${base}/signed-out-${nav}`);
  await page.waitFor("document.readyState === 'complete'", 'the neutral page');
  await page.eval('sessionStorage.clear()');
  await page.goto(`${base}/?run=${nav}#/login`);
  await page.waitFor("!!document.querySelector('#email')", 'the login form');
  await page.eval(`(() => { document.querySelector('#email').value = '${role}@demo.medaccess'; document.querySelector('#pw').value = '${DEMO_PASSWORD}'; document.querySelector('form.login').requestSubmit(); })()`);
  await page.waitFor("(document.querySelector('#whoami')?.textContent || '').length > 0", `${role} to sign in`);
}
const go = async (hash, h1) => { await page.eval(`location.hash = ${JSON.stringify(hash)}`); await page.waitFor(`document.querySelector('#view h1')?.textContent === ${JSON.stringify(h1)}`, `page "${h1}"`); await sleep(250); };
const click = (text) => page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)}).click()`);

// run the audit in both colour schemes; returns "scheme | page | problem" lines
async function auditBoth(label) {
  const out = [];
  for (const scheme of ['light', 'dark']) {
    await page.scheme(scheme);
    await sleep(120);
    for (const p of await page.eval(AUDIT_SOURCE)) out.push(`[${scheme}] ${label} :: ${p}`);
  }
  await page.scheme('light');
  return out;
}
const report = (problems) => problems.join('\n');

// each step opens a screen in a realistic state and audits it
const SCREENS = {
  login: async () => { nav += 1; await page.goto(`${base}/signed-out-${nav}`); await page.eval('sessionStorage.clear()'); await page.goto(`${base}/?run=${nav}#/login`); await page.waitFor("!!document.querySelector('#email')", 'login'); },
  patient: [
    ['catalogue results', async () => { await go('#/catalogue?search=fixtamol', 'Medicine catalogue'); await page.waitFor("document.querySelectorAll('#view .grid button.card').length > 0", 'results'); }],
    ['catalogue filters', async () => { await go('#/catalogue?ingredient=paracetamol&strength=500&form=tablet', 'Medicine catalogue'); await page.waitFor("document.querySelectorAll('#view .grid button.card').length > 0", 'results'); }],
    ['brand detail', async () => { await go('#/catalogue?search=fixtamol%201', 'Medicine catalogue'); await page.waitFor("document.querySelectorAll('#view .grid button.card').length > 0", 'results'); await page.eval("document.querySelector('#view .grid button.card').click()"); await page.waitFor("document.body.innerText.includes('Potential matches') && document.body.innerText.includes('DEMO DATA')", 'detail'); await sleep(300); }],
    ['reminders', async () => { await go('#/reminders', 'Refill reminders'); }],
    ['my-requests', async () => { await go('#/my-requests', 'My verification requests'); }],
    ['my reports', async () => { await go('#/reports', 'My reports'); }],
    ['project docs', async () => { await go('#/docs', 'Project documentation map'); }],
  ],
  pharmacist: [
    ['verification queue', async () => { await go('#/verification', 'Pharmacist verification'); await page.eval("(() => { const f = document.querySelector('#vf'); f.value = ''; f.dispatchEvent(new Event('change')); })()"); await sleep(500); }],
    ['inventory brand', async () => { await go('#/inventory', 'Update stock and prices'); await page.eval("(() => { document.querySelector('#iq').value = 'fixtamol 1'; document.querySelector('#view form').requestSubmit(); })()"); await page.waitFor("document.querySelectorAll('#view .grid button.card').length > 0", 'results'); await page.eval("document.querySelector('#view .grid button.card').click()"); await page.waitFor("!!document.querySelector('select[aria-label^=\"Availability at\"]')", 'editors'); await sleep(300); }],
    ['reports to review', async () => { await go('#/reports', 'Incorrect-information reports'); }],
  ],
  admin: [
    ['users', async () => { await go('#/admin/users', 'Users and roles'); }],
    ['catalogue admin', async () => { await go('#/admin/catalogue', 'Catalogue administration'); }],
    ['catalogue admin import preview + edit', async () => {
      await go('#/admin/catalogue', 'Catalogue administration');
      await page.eval("(() => { const a = document.querySelector('#impcsv'); a.value = 'brand_identifier,pack_size\\nB6,10 tablets\\nNOPE,5\\nB7,10\\n'; a.dispatchEvent(new Event('input')); })()");
      await click('Preview'); await page.waitFor("document.body.innerText.includes('Rejected: 1')", 'preview');
      await click('Edit'); await page.waitFor("!!document.querySelector('#en')", 'edit form'); await sleep(200);
    }],
    ['admin reports', async () => { await go('#/admin/reports', 'Administrative reports'); await page.waitFor("document.body.innerText.includes('brands excluded')", 'restricted card'); }],
    ['audit log', async () => { await go('#/admin/audit', 'Audit log'); await page.waitFor("document.querySelectorAll('#view tbody tr').length > 0", 'rows'); }],
  ],
};

test('a11y audit: sign-in page', opts, async () => {
  await SCREENS.login();
  assert.equal(report(await auditBoth('login')), '');
});

for (const role of ['patient', 'pharmacist', 'admin']) {
  test(`a11y audit: ${role} screens, light and dark`, opts, async () => {
    await loginAs(role);
    const problems = [];
    for (const [label, open] of SCREENS[role]) { await open(); problems.push(...await auditBoth(`${role}/${label}`)); }
    assert.equal(report(problems), '');
  });
}

// ---------------------------------------------------------------- the audit itself must be able to fail
// (the app's Content-Security-Policy blocks inline style="" attributes, so injected test elements are styled through the DOM API)
const INJECT = `(() => {
  const d = document.createElement('div'); d.id = 'inject';
  const add = (tag, css, text, attrs = {}) => { const e = document.createElement(tag); Object.assign(e.style, css); if (text) e.textContent = text; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); d.append(e); return e; };
  add('button', {}, '', { id: 'nb' });
  add('input', {}, '', { id: 'nl' });
  add('div', { color: '#aaa', background: '#fff', fontSize: '16px' }, 'low contrast');
  add('h4', {}, 'skipped heading level');
  add('table').innerHTML = '<tr><td>x</td></tr>';
  add('button', { width: '10px', height: '10px', padding: '0' }, 't', { id: 'tiny' });
  add('button', {}, 'Same name'); add('button', {}, 'Same name');
  add('span', {}, '', { id: 'dup' }); add('span', {}, '', { id: 'dup' });
  const sc = add('div', { width: '50px', overflowX: 'auto' }, '', { tabindex: '-1' });
  const inner = document.createElement('div'); inner.style.width = '300px'; inner.textContent = 'wide'; sc.append(inner);
  document.body.append(d);
})()`;

test('audit self-test: injected violations are detected (a clean audit is only meaningful if the audit can fail)', opts, async () => {
  await SCREENS.login();
  await page.scheme('light');
  await page.eval(INJECT);
  const problems = (await page.eval(AUDIT_SOURCE)).join('\n');
  for (const rule of ['name:', 'contrast:', 'heading-order:', 'table-name:', 'target-size:', 'ambiguous-name:', 'duplicate-id:', 'scrollable-region:'])
    assert.ok(problems.includes(rule), `audit did not report "${rule}"; got:\n${problems}`);
  // dark mode: contrast is judged on the dark theme's computed colours
  await page.eval("(() => { const d = document.querySelector('#inject'); d.replaceChildren(); const e = document.createElement('div'); e.textContent = 'dark low contrast'; e.style.color = '#222'; e.style.background = '#111'; d.append(e); })()");
  await page.scheme('dark');
  assert.ok((await page.eval(AUDIT_SOURCE)).join('\n').includes('contrast:'), 'dark-mode contrast failure not detected');
  await page.scheme('light');
  // while the same page without the injected elements is clean
  await page.eval("document.querySelector('#inject').remove()");
  assert.deepEqual(await page.eval(AUDIT_SOURCE), []);
});

// ---------------------------------------------------------------- keyboard and focus
// Presses Tab through the whole page with real key events and records every stop.
async function tabThrough(limit = 120) {
  await page.eval(`(() => {
    window.__seen = []; window.__noRing = [];
    const name = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || e.id || e.tagName).toString().trim().slice(0, 40);
    document.addEventListener('focusin', (ev) => {
      const e = ev.target; if (e === document.body) return;
      window.__seen.push({ el: e, name: e.tagName.toLowerCase() + ':' + name(e) });
      const cs = getComputedStyle(e);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
      if (!ring) window.__noRing.push(e.tagName.toLowerCase() + ':' + name(e));
    }, true);
  })()`);
  const expected = await page.eval(`(() => {
    const closed = (e) => { const d = e.closest('details:not([open])'); return !!d && e.parentElement !== d; }; // content of a collapsed <details>; its <summary> is still a stop
    const ok = (e) => !e.disabled && e.tabIndex >= 0 && !e.closest('[hidden]') && !closed(e) && getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0;
    window.__expected = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]')].filter(ok);
    return window.__expected.length;
  })()`);
  let presses = 0;
  for (; presses < limit; presses += 1) {
    await page.press('Tab');
    const done = await page.eval('(window.__seen.length > 1 && window.__seen[window.__seen.length - 1].el === window.__seen[0].el) || document.activeElement === document.body');
    if (done) { presses += 1; break; }
  }
  const missed = await page.eval("window.__expected.filter((e) => !window.__seen.some((s) => s.el === e)).map((e) => e.tagName.toLowerCase() + ':' + (e.getAttribute('aria-label') || e.innerText || e.id || '').toString().trim().slice(0, 40))");
  return { expected, presses, missed, stops: await page.eval('window.__seen.map((s) => s.name)'), noRing: await page.eval('window.__noRing') };
}
// a fresh load of the current URL (focus and the sequential-navigation starting point reset to the top of the document)
async function reloadAndWait(cond, what) { await page.send('Page.reload'); await sleep(200); await page.waitFor(cond, what); await sleep(300); }

test('keyboard: Tab starts at the skip link, reaches every control, always shows focus, and never traps', opts, async () => {
  await loginAs('patient');
  await go('#/catalogue?search=fixtamol', 'Medicine catalogue');
  await reloadAndWait("document.querySelectorAll('#view .grid button.card').length > 0", 'results after reload');
  const r = await tabThrough();
  assert.match(r.stops[0], /skip to content/i, 'the first Tab stop must be the skip link');
  assert.deepEqual(r.missed, [], 'controls the keyboard never reached');
  assert.deepEqual(r.noRing, [], 'focused controls with no visible focus indicator');
  assert.ok(r.presses < r.expected + 10, `Tab went round ${r.presses} times for ${r.expected} controls: a keyboard trap?`);
  assert.ok(r.expected > 10, 'the page should have many controls (sanity)');
});

test('keyboard: the skip link jumps to the content without leaving the page, and Space / Enter operate cards', opts, async () => {
  await loginAs('patient');
  await go('#/catalogue?search=fixtamol', 'Medicine catalogue');
  await reloadAndWait("document.querySelectorAll('#view .grid button.card').length > 0", 'results after reload');
  const hashBefore = await page.eval('location.hash');
  await page.press('Tab');
  assert.equal(await page.eval('document.activeElement.className'), 'skip');
  await page.press('Enter');
  assert.equal(await page.eval('document.activeElement.id'), 'view', 'the skip link must move focus to the main content');
  assert.equal(await page.eval('location.hash'), hashBefore, 'the skip link must not navigate the single-page app elsewhere');
  assert.equal(await page.eval("document.querySelector('#view h1').textContent"), 'Medicine catalogue');
  // a result card is a real <button>: Space opens it, and focus follows to the revealed heading
  await page.eval("document.querySelector('#view .grid button.card').focus()");
  await page.press('Space');
  await page.waitFor("document.body.innerText.includes('Potential matches')", 'detail opened with the keyboard');
  assert.equal(await page.eval('document.activeElement.tagName'), 'H2', 'focus must move to the new heading');
  assert.match(await page.eval('document.activeElement.textContent'), /Fixtamol/);
});

test('focus and titles: navigation lands on the content; every screen has its own title', opts, async () => {
  await loginAs('pharmacist');
  const titles = [];
  for (const [hash, h1] of [['#/catalogue', 'Medicine catalogue'], ['#/verification', 'Pharmacist verification'], ['#/inventory', 'Update stock and prices'], ['#/reports', 'Incorrect-information reports'], ['#/docs', 'Project documentation map']]) {
    await go(hash, h1);
    // focus moves to #view once the page's async render settles; wait for it rather than snapshot one instant (flaky under load)
    await page.waitFor("document.activeElement.id === 'view'", `focus after navigating to ${hash}`);
    titles.push(await page.eval('document.title'));
    assert.equal(titles.at(-1), `${h1} — MedAccess`);
  }
  assert.equal(new Set(titles).size, titles.length, 'titles must be distinct');
  await SCREENS.login();
  assert.equal(await page.eval('document.title'), 'Sign in to MedAccess — MedAccess');
});

test('dialog: the resolution dialog is keyboard-operable, modal, labelled, validated and returns focus (replaces window.prompt)', opts, async () => {
  await loginAs('pharmacist');
  await go('#/reports', 'Incorrect-information reports');
  const resolve = "[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Resolve report #2')";
  await page.waitFor(`!!${resolve}`, 'the Resolve button for report #2');
  // window.prompt still exists in the browser; the app must no longer use it
  await page.eval('window.__prompted = 0; window.prompt = () => { window.__prompted += 1; return "x"; }');

  // open with the keyboard
  await page.eval(`${resolve}.focus()`);
  await page.press('Enter');
  await page.waitFor("!!document.querySelector('dialog[open]')", 'the dialog');
  assert.equal(await page.eval("document.querySelector('dialog').matches(':modal')"), true, 'the dialog must be modal (page behind inert)');
  assert.equal(await page.eval("document.getElementById(document.querySelector('dialog').getAttribute('aria-labelledby')).textContent"), 'Resolve report #2');
  assert.equal(await page.eval("document.activeElement.tagName + ':' + document.activeElement.labels[0].textContent"), 'TEXTAREA:Resolution note', 'focus starts in the field, which is labelled');
  assert.equal(await page.eval('window.__prompted'), 0, 'window.prompt must not be used');

  // Tab and Shift+Tab stay inside the dialog
  for (let i = 0; i < 6; i += 1) { await page.press('Tab'); assert.equal(await page.eval("!!document.activeElement.closest('dialog')"), true, `Tab ${i + 1} left the dialog`); }
  for (let i = 0; i < 6; i += 1) { await page.press('Tab', { shift: true }); assert.equal(await page.eval("!!document.activeElement.closest('dialog')"), true, `Shift+Tab ${i + 1} left the dialog`); }

  // Escape cancels: nothing changes and focus returns to the button that opened it
  await page.press('Escape');
  await page.waitFor("!document.querySelector('dialog')", 'the dialog to close');
  assert.equal(await page.eval(`document.activeElement === ${resolve}`), true, 'focus must return to the opener');
  assert.match(await page.eval('document.querySelector("#view").innerText'), /Investigating/);

  // empty submit: the error is announced, the dialog stays open, focus goes back to the field
  await page.press('Enter');
  await page.waitFor("!!document.querySelector('dialog[open]')", 'the dialog again');
  await page.eval("[...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Resolve report').focus()");
  await page.press('Enter');
  await page.waitFor("!document.querySelector('dialog .notice.err').hidden", 'the validation message');
  assert.equal(await page.eval("document.querySelector('dialog .notice.err').getAttribute('role')"), 'alert');
  assert.match(await page.eval("document.querySelector('dialog .notice.err').textContent"), /Resolution note is required/);
  assert.equal(await page.eval("document.activeElement.tagName + ':' + document.activeElement.getAttribute('aria-invalid')"), 'TEXTAREA:true');
  assert.equal(await page.eval("!!document.querySelector('dialog[open]')"), true);

  // a real note resolves the report, and focus lands on the page content (the opener was re-rendered away)
  await page.type('Price corrected with the pharmacy');
  await page.eval("[...document.querySelectorAll('dialog button')].find((b) => b.textContent === 'Resolve report').focus()");
  await page.press('Enter');
  await page.waitFor("!document.querySelector('dialog') && document.querySelector('#view').innerText.includes('Price corrected with the pharmacy')", 'the report to be resolved');
  assert.equal(await page.eval("!!document.activeElement.closest('#view') || document.activeElement.id === 'view'"), true);
  assert.equal(await page.eval('window.__prompted'), 0);
  assert.deepEqual(page.errors, []);
});

test('reflow: nothing needs sideways scrolling at 320 px (WCAG 1.4.10); tables scroll inside their own region', opts, async () => {
  await page.viewport(320);
  try {
    await loginAs('admin');
    for (const [hash, h1] of [['#/catalogue?search=fixtamol', 'Medicine catalogue'], ['#/admin/catalogue', 'Catalogue administration'], ['#/admin/audit', 'Audit log'], ['#/docs', 'Project documentation map']]) {
      await go(hash, h1);
      await sleep(400);
      assert.equal(await page.eval('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, `${hash} overflows the page at 320 px`);
    }
    // a wide table became a focusable, named, scrollable region
    assert.equal(await page.eval("[...document.querySelectorAll('.table-wrap')].filter((w) => w.scrollWidth > w.clientWidth + 1).every((w) => w.tabIndex === 0 && w.getAttribute('role') === 'region' && !!w.getAttribute('aria-label'))"), true);
    assert.deepEqual((await page.eval(AUDIT_SOURCE)).filter((p) => p.startsWith('scrollable-region')), []);
  } finally { await page.resetViewport(); }
});
