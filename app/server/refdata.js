'use strict';
// Read-only reference stores ported from the Stage 2 package:
//  - CDCI catalogue (NRCeS Common Drug Codes for India): identifiers and names only, no stock or prices.
//  - Inventory V2: SYNTHETIC demo pharmacy inventory keyed by CDCI product identifier.
// Both source files are opened read-only with query_only; the application never writes to them.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { parseGenericName, strengthTokens } = require('./cdciParse');
const { loadRestrictedList } = require('./restricted');
const { loadSynonyms } = require('./synonyms');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'database');

function openReadOnly(file) {
  if (!file || !fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA query_only = ON');
  return db;
}

// A LIKE '%x%' over the joined catalogue view takes ~2 s for 94k rows, so the searchable columns are copied once
// into a private in-memory table with a lower-cased haystack and queried with instr().
function buildSearchIndex(cdci, restricted) {
  if (!cdci) return null;
  const mem = new DatabaseSync(':memory:');
  mem.exec(`CREATE TABLE cat(brand_identifier TEXT, brand_name TEXT, product_identifier TEXT, product_name TEXT,
    generic_identifier TEXT, generic_name TEXT, supplier_identifier TEXT, supplier_name TEXT,
    dosage_form TEXT, strength TEXT, hay TEXT,
    origin TEXT NOT NULL DEFAULT 'CDCI', pack_size TEXT, hidden INTEGER NOT NULL DEFAULT 0, admin_note TEXT,
    ingredients TEXT, strength_tokens TEXT)`);
  const ins = mem.prepare(`INSERT INTO cat(brand_identifier, brand_name, product_identifier, product_name, generic_identifier, generic_name, supplier_identifier, supplier_name, dosage_form, strength, hay, ingredients, strength_tokens) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const parsed = new Map(); // generic_identifier -> parsed attributes (one parse per ~4.6k generics)
  const restrictedIds = new Set(), restrictedByRule = new Map(); // BR-07: brands left out of the index
  mem.exec('BEGIN');
  // Dosage form is structured in CDCI (generic_master."Dose Form" -> drug_form_master); strength is parsed from the name.
  // The classification column is optional in a catalogue export; without it only the name rules apply.
  const hasClass = !!cdci.prepare("SELECT 1 x FROM pragma_table_info('generic_master') WHERE name = 'Classification of Drugs'").get();
  const classCol = hasClass ? 'gm."Classification of Drugs"' : 'NULL';
  for (const r of cdci.prepare(`SELECT cs.brand_identifier, cs.brand_name, cs.product_identifier, cs.product_name, cs.generic_identifier,
      cs.generic_name, cs.supplier_identifier, cs.supplier_name, df."Dose Form" AS dosage_form,
      ${classCol} AS classification
    FROM catalogue_search cs
    LEFT JOIN generic_master gm ON gm."Identifier" = cs.generic_identifier
    LEFT JOIN drug_form_master df ON df."Id" = gm."Dose Form"`).iterate()) {
    // Controlled / restricted medicines are excluded here, once, so no route can ever return them (BR-07).
    const why = restricted.reasons(r);
    if (why.length) {
      restrictedIds.add(r.brand_identifier);
      for (const w of why) restrictedByRule.set(w, (restrictedByRule.get(w) ?? 0) + 1);
      continue;
    }
    let attrs = parsed.get(r.generic_identifier);
    if (!attrs) { attrs = { ...parseGenericName(r.generic_name), dosage_form: r.dosage_form || null }; parsed.set(r.generic_identifier, attrs); }
    const hay = [r.brand_name, r.product_name, r.generic_name, r.supplier_name].map((v) => v ?? '').join(String.fromCharCode(1)).toLowerCase();
    ins.run(r.brand_identifier, r.brand_name, r.product_identifier, r.product_name, r.generic_identifier, r.generic_name, r.supplier_identifier, r.supplier_name, attrs.dosage_form, attrs.strength, hay,
      (attrs.ingredients || r.generic_name || '').toLowerCase(), strengthTokens(attrs.strength));
  }
  mem.exec('CREATE INDEX idx_cat_brand ON cat(brand_identifier); CREATE INDEX idx_cat_generic ON cat(generic_identifier)');
  mem.exec('COMMIT');
  mem.restrictedIds = restrictedIds;
  mem.restrictedByRule = restrictedByRule;
  mem.brandById = (id) => mem.prepare('SELECT * FROM cat WHERE brand_identifier = ?').get(id) ?? null;
  // Other brands sharing the same CDCI generic identifier (same ingredient + strength + dose form).
  mem.matchesFor = (brand, limit, offset) => ({
    total: mem.prepare('SELECT COUNT(*) c FROM cat WHERE generic_identifier = ? AND brand_identifier <> ? AND hidden = 0').get(brand.generic_identifier, brand.brand_identifier).c,
    rows: mem.prepare(`SELECT brand_identifier, brand_name, product_identifier, product_name, supplier_identifier, supplier_name, generic_identifier, generic_name,
        strength, dosage_form, pack_size, origin, hidden, admin_note FROM cat
      WHERE generic_identifier = ? AND brand_identifier <> ? AND hidden = 0 ORDER BY brand_name COLLATE NOCASE, brand_identifier LIMIT ? OFFSET ?`).all(brand.generic_identifier, brand.brand_identifier, limit, offset),
  });
  // Administrator overlay (stored in the application database, mirrored here so search stays a single fast query).
  // pack size is only taken from the overlay for CDCI rows (administrator-added brands carry their own)
  mem.setOverlay = (brandId, hidden, note, packSize) => {
    mem.prepare("UPDATE cat SET hidden = ?, admin_note = ?, pack_size = CASE WHEN origin = 'CDCI' THEN ? ELSE pack_size END WHERE brand_identifier = ?").run(hidden ? 1 : 0, note ?? null, packSize ?? null, brandId);
  };
  mem.genericExists = (id) => !!mem.prepare("SELECT 1 x FROM cat WHERE generic_identifier = ? AND origin = 'CDCI' LIMIT 1").get(id);
  mem.upsertCustom = (c) => {
    const generic = `${c.active_ingredient} ${c.strength} ${c.dosage_form}`;
    const hay = [c.brand_name, c.brand_name, generic, c.manufacturer].join(String.fromCharCode(1)).toLowerCase();
    const exists = mem.prepare('SELECT 1 x FROM cat WHERE brand_identifier = ?').get(c.brand_identifier);
    const vals = [c.brand_name, c.brand_identifier, c.brand_name, c.generic_identifier ?? null, generic, c.brand_identifier, c.manufacturer, c.dosage_form, c.strength, hay, c.pack_size, c.active_ingredient.toLowerCase(), strengthTokens(c.strength)];
    if (exists) mem.prepare(`UPDATE cat SET brand_name=?, product_identifier=?, product_name=?, generic_identifier=?, generic_name=?, supplier_identifier=?, supplier_name=?, dosage_form=?, strength=?, hay=?, pack_size=?, ingredients=?, strength_tokens=? WHERE brand_identifier=?`).run(...vals, c.brand_identifier);
    else mem.prepare(`INSERT INTO cat(brand_name, product_identifier, product_name, generic_identifier, generic_name, supplier_identifier, supplier_name, dosage_form, strength, hay, pack_size, ingredients, strength_tokens, brand_identifier, origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'MedAccess')`).run(...vals, c.brand_identifier);
  };
  mem.attributesFor = (genericId) => { const a = parsed.get(genericId); return a ? { strength: a.strength, dosage_form: a.dosage_form, ingredients: a.ingredients } : null; };
  return mem;
}

function openReference(opts = {}) {
  const cdciPath = opts.cdci ?? process.env.MEDACCESS_CDCI_DB ?? path.join(DEFAULT_DIR, 'cdci_catalogue.db');
  const invPath = opts.inventory ?? process.env.MEDACCESS_INVENTORY_DB ?? path.join(DEFAULT_DIR, 'medaccess_cdci_inventory_v2.db');
  // Fail closed: if the restricted-medicines list cannot be loaded this throws and the server does not start.
  const restricted = loadRestrictedList(opts.restricted);
  const cdci = openReadOnly(cdciPath);
  const search = buildSearchIndex(cdci, restricted), inventory = openReadOnly(invPath);
  const restrictedBrands = search ? search.restrictedIds : new Set();
  // G4 / NFR-14: the V2 seed timestamps are fixed (Sept 2026), so every row would look stale. When reanchorDemo is set, the
  // seed times are shifted at read time so the newest seed row is "now"; the relative spread (and therefore the stale flag
  // on genuinely older rows) is kept. The shift is disclosed in the API (demo_time_shift_days) and the source label.
  let demoShiftMs = 0;
  if (inventory && opts.reanchorDemo) {
    const newest = inventory.prepare('SELECT MAX(last_updated_at) m FROM v_demo_inventory').get()?.m;
    if (newest) demoShiftMs = Math.max(0, Date.now() - new Date(newest).getTime());
  }
  const demoTime = (iso) => (iso && demoShiftMs ? new Date(new Date(iso).getTime() + demoShiftMs).toISOString() : iso);
  const pharmacies = inventory ? inventory.prepare('SELECT pharmacy_id, pharmacy_name, locality, city, district, state FROM pharmacies ORDER BY city, pharmacy_name').all() : [];
  return { cdci, search, inventory, pharmacies, demoTime, demoShiftDays: Math.round(demoShiftMs / 864e5), restricted, restrictedBrands, synonyms: loadSynonyms(opts.synonyms), close() { for (const d of [cdci, search, inventory]) d?.close(); } };
}

module.exports = { openReference };
