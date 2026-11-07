'use strict';
// FR-06: search by active ingredient, strength and dosage form (separate filters, combinable with free text).
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
const { strengthTokens, strengthNeedles } = require('../server/cdciParse');
const { makeFixtures } = require('./fixtures');
const { loadSynonyms } = require('../server/synonyms');
const SYN_FILE = path.join(__dirname, '..', 'config', 'ingredient-synonyms.json');

test('strength tokens and needles: a bare number matches only the numeric part of a component', () => {
  assert.equal(strengthTokens('4 mg + 500 mg'), ' 4mg 500mg n:4 n:500 ');
  assert.equal(strengthTokens('30 mg/5 mL + 50 mg/5 mL'), ' 30mg/5ml 50mg/5ml n:30 n:50 ');
  assert.equal(strengthTokens('12,5 mg'), ' 12,5mg n:12.5 ');
  assert.equal(strengthTokens(null), '  ');
  assert.deepEqual(strengthNeedles('500'), [' n:500 ']);
  assert.deepEqual(strengthNeedles('500 MG'), [' 500mg ']);
  assert.deepEqual(strengthNeedles('30 mg/5 mL + 50'), [' 30mg/5ml ', ' n:50 ']);
  assert.deepEqual(strengthNeedles(''), []);
  // "50" must not match "500mg" or "150mg"
  assert.ok(!strengthTokens('500 mg').includes(' n:50 '));
  assert.ok(!strengthTokens('150 mg').includes(' n:50 '));
});

let server, base, tmp, refs;
test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-flt-'));
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
const ids = (r) => r.data.results.map((x) => x.brand_identifier);

test('filters: active ingredient', async () => {
  const t = await login('patient');
  assert.equal((await call('GET', '/api/catalogue?ingredient=paracetamol&limit=100', { token: t })).data.results.length, 31); // 30 paracetamol + 1 acetaminophen (synonym)
  assert.deepEqual(ids(await call('GET', '/api/catalogue?ingredient=guaifenesin', { token: t })), ['B96']);
  assert.deepEqual(ids(await call('GET', '/api/catalogue?ingredient=AMBROXOL', { token: t })), ['B96']); // case-insensitive
  assert.equal((await call('GET', '/api/catalogue?ingredient=nothingthere', { token: t })).data.results.length, 0);
});

test('filters: strength by number, by number+unit and by combination component', async () => {
  const t = await login('patient');
  const f = (q) => call('GET', `/api/catalogue?limit=100&${q}`, { token: t });
  assert.equal((await f('strength=500')).data.results.length, 30);
  assert.equal((await f('strength=500%20mg')).data.results.length, 30);
  assert.equal((await f('strength=500mg')).data.results.length, 30);
  assert.deepEqual(ids(await f('strength=50')), ['B96']);        // "50" is B96's 50 mg/5 mL, NOT the 500 mg brands
  assert.equal((await f('strength=5')).data.results.length, 0);   // no partial-number matches
  assert.deepEqual(ids(await f('strength=10')), ['B94']);
  assert.deepEqual(ids(await f('strength=30%20mg%2F5%20mL')), ['B96']);
  assert.deepEqual(ids(await f('strength=30%2B50')), ['B96']);    // both components required
  assert.equal((await f('strength=500%2B10')).data.results.length, 0);
});

test('filters: dosage form', async () => {
  const t = await login('patient');
  assert.equal((await call('GET', '/api/catalogue?form=tablet&limit=100', { token: t })).data.results.length, 32); // 30 paracetamol + 1 cetirizine + 1 acetaminophen
  assert.deepEqual(ids(await call('GET', '/api/catalogue?form=oral%20solution', { token: t })), ['B96']);
  assert.equal((await call('GET', '/api/catalogue?form=syrup', { token: t })).data.results.length, 0); // CDCI form text is "Oral solution"
});

test('filters combine with each other and with the free-text search', async () => {
  const t = await login('patient');
  const f = (q) => call('GET', `/api/catalogue?limit=100&${q}`, { token: t });
  assert.equal((await f('ingredient=paracetamol&strength=10')).data.results.length, 0);
  assert.deepEqual(ids(await f('ingredient=cetirizine&strength=10&form=tablet')), ['B94']);
  assert.equal((await f('search=fixtamol&strength=500')).data.results.length, 30);
  assert.equal((await f('search=fixtamol&form=solution')).data.results.length, 0);
  assert.deepEqual(ids(await f('search=coughease&ingredient=ambroxol&strength=30&form=solution')), ['B96']);
});

test('at least one real criterion is required; one-character text alone is not enough', async () => {
  const t = await login('patient');
  for (const q of ['', '?search=a', '?ingredient=p', '?strength=', '?form=t']) {
    const r = await call('GET', `/api/catalogue${q}`, { token: t });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.results, []);
    assert.match(r.data.message, /Enter a name/);
  }
});

test('filters respect the overlay and the restricted list; administrator-added brands are filterable', async () => {
  const admin = await login('admin'), patient = await login('patient');
  assert.equal((await call('GET', '/api/catalogue?ingredient=tramadol', { token: patient })).data.results.length, 0); // restricted
  await call('PUT', '/api/admin/catalogue/B94/overlay', { token: admin, body: { hidden: true, hidden_reason: 'test' } });
  assert.equal((await call('GET', '/api/catalogue?ingredient=cetirizine', { token: patient })).data.results.length, 0); // hidden from users
  assert.equal((await call('GET', '/api/catalogue?ingredient=cetirizine', { token: admin })).data.results.length, 1); // admin still sees it
  const made = await call('POST', '/api/admin/catalogue/custom', { token: admin, body: { brand_name: 'Zincwell', active_ingredient: 'Zinc sulfate', strength: '250 mg', dosage_form: 'Dispersible tablet', pack_size: '10 tablets', manufacturer: 'Acme' } });
  assert.equal(made.status, 200);
  const id = made.data.brand.brand_identifier;
  assert.deepEqual(ids(await call('GET', '/api/catalogue?ingredient=zinc&strength=250&form=dispersible', { token: patient })), [id]);
  assert.equal((await call('GET', '/api/catalogue?ingredient=zinc&strength=25', { token: patient })).data.results.length, 0); // 25 is not 250
});

test('synonyms: the shipped file is well formed', () => {
  const raw = JSON.parse(fs.readFileSync(SYN_FILE, 'utf8'));
  const names = raw.groups.flat().map((n) => n.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'a name appears in two groups');
  for (const g of raw.groups) assert.ok(g.length >= 2, `group too small: ${g}`);
  assert.match(raw.status, /DRAFT/);
  const syn = loadSynonyms(SYN_FILE);
  assert.deepEqual(syn.expand('Paracetamol').sort(), ['acetaminophen', 'paracetamol']);
  assert.deepEqual(syn.expand(' ACETAMINOPHEN ').sort(), ['acetaminophen', 'paracetamol']);
  assert.deepEqual(syn.expand('cetirizine'), ['cetirizine']); // unknown names are left alone
  assert.deepEqual(syn.expand('paracetamol 500'), ['paracetamol 500']); // only a whole known name expands
  assert.deepEqual(syn.expand(''), ['']);
});

test('synonyms never hide the restricted list: no synonym is a restricted substance or reaches one', () => {
  const { loadRestrictedList, DEFAULT_FILE } = require('../server/restricted');
  const r = loadRestrictedList(DEFAULT_FILE);
  for (const name of loadSynonyms(SYN_FILE).groups.flat()) assert.deepEqual(r.matches(name), [], `${name} is restricted`);
});

test('a missing or invalid synonyms file is not fatal (search convenience only)', () => {
  const warn = console.warn; let warned = 0; console.warn = () => { warned += 1; };
  try {
    const syn = loadSynonyms(path.join(os.tmpdir(), 'no-such-synonyms.json'));
    assert.deepEqual(syn.expand('paracetamol'), ['paracetamol']);
    assert.equal(warned, 1);
  } finally { console.warn = warn; }
});

test('synonyms in search: paracetamol finds acetaminophen products and vice versa', async () => {
  const t = await login('patient');
  const f = (q) => call('GET', `/api/catalogue?limit=100&${q}`, { token: t });
  const viaParacetamol = ids(await f('ingredient=paracetamol')).sort();
  const viaAcetaminophen = ids(await f('ingredient=acetaminophen')).sort();
  assert.equal(viaParacetamol.length, 31);
  assert.deepEqual(viaParacetamol, viaAcetaminophen);
  assert.ok(viaParacetamol.includes('B97'));
  assert.deepEqual(ids(await f('ingredient=paracetamol&strength=650')), ['B97']);
  assert.deepEqual(ids(await f('ingredient=paracetamol&strength=650&form=tablet')), ['B97']);
  // free text: a single known name expands too; a multi-word phrase does not
  assert.ok(ids(await f('search=paracetamol')).includes('B97'));
  assert.ok(!ids(await f('search=paracetamol%20500')).includes('B97'));
  // restricted combinations stay hidden whichever name is used
  assert.ok(!ids(await f('ingredient=acetaminophen')).includes('B91')); // codeine + paracetamol fixture
});
