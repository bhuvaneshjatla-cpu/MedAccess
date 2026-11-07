'use strict';
// Catalogue administration overlay on the read-only CDCI catalogue (UC-19; FR-08, FR-09, FR-36): hide, annotate, add brands,
// pack-size import / export.
const { analyzePackSizeCsv } = require('../packImport');
const { toCsv } = require('../csv');

module.exports = function register(k) {
  const { db, ref, q, one, run, audit, route, ADMIN, ApiError, bad, nowIso, str, requireRef, attributesOf, catalogueFilter, brandOr404, brandSummary } = k;

  // UC-19 Manage Medicine Catalogue (AD-09, FR-08, FR-09, FR-36) — an administrator OVERLAY on the read-only CDCI catalogue.
  // The CDCI data is never modified. MedAccess stores: hidden flags (+reason), annotations (notes shown to users) and
  // administrator-added brands ("MA-nnnnn") that behave like catalogue entries everywhere (search, availability, reports,
  // reminders, matches). The overlay is mirrored into the in-memory search index at start-up and on every change.
  const overlayRow = (bid) => one(`SELECT o.*, u.name AS updated_by_name FROM catalogue_overlay o LEFT JOIN users u ON u.user_id=o.updated_by WHERE o.brand_identifier=?`, bid);

  function customInput(b) {
    const rec = {
      brand_name: str(b.brand_name, 120), active_ingredient: str(b.active_ingredient, 120), strength: str(b.strength, 60),
      dosage_form: str(b.dosage_form, 60), pack_size: str(b.pack_size, 60), manufacturer: str(b.manufacturer, 120),
    };
    const missing = Object.entries(rec).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw bad(`Required fields missing: ${missing.join(', ')}`); // FR-09
    if (ref.restricted.matches(rec.brand_name, rec.active_ingredient).length) throw bad('Controlled / restricted medicines are outside the MVP scope (BR-07)');
    const gid = str(b.generic_identifier, 100);
    if (gid && !requireRef(ref.search, 'CDCI catalogue').genericExists(gid)) throw bad('Unknown CDCI generic identifier');
    return { ...rec, generic_identifier: gid || null };
  }
  const syncCustom = (id) => { const c = one('SELECT * FROM custom_brands WHERE brand_identifier=?', id); ref.search?.upsertCustom(c); return c; };

  route('GET', '/api/admin/catalogue', ADMIN, (ctx) => {
    const idx = requireRef(ref.search, 'CDCI catalogue');
    const search = str(ctx.query.get('search'), 100).toLowerCase();
    const filter = ['changed', 'hidden', 'annotated', 'custom', 'all'].includes(ctx.query.get('filter')) ? ctx.query.get('filter') : (search ? 'all' : 'changed');
    if (filter === 'all' && search.length < 2) throw bad('Enter at least two characters to search the whole catalogue');
    const limit = Math.min(Math.max(parseInt(ctx.query.get('limit'), 10) || 25, 1), 100);
    const offset = Math.max(parseInt(ctx.query.get('offset'), 10) || 0, 0);
    const cond = { changed: "(hidden = 1 OR admin_note IS NOT NULL OR origin = 'MedAccess' OR pack_size IS NOT NULL)", hidden: 'hidden = 1', annotated: 'admin_note IS NOT NULL', custom: "origin = 'MedAccess'", all: '1 = 1' }[filter];
    const rows = idx.prepare(`SELECT brand_identifier, brand_name, generic_name, supplier_name, origin, hidden, admin_note, strength, dosage_form, pack_size
      FROM cat WHERE ${cond} AND (? = '' OR instr(hay, ?) > 0) ORDER BY brand_name COLLATE NOCASE, brand_identifier LIMIT ? OFFSET ?`).all(search, search, limit + 1, offset);
    return {
      filter, limit, offset, has_more: rows.length > limit,
      brands: rows.slice(0, limit).map((r) => {
        const o = overlayRow(r.brand_identifier);
        return { ...r, hidden: !!r.hidden, hidden_reason: o?.hidden_reason ?? null, updated_by_name: o?.updated_by_name ?? null, updated_at: o?.updated_at ?? null,
          attributes: attributesOf(r.strength, r.dosage_form, r) };
      }),
    };
  });

  route('PUT', '/api/admin/catalogue/:bid/overlay', ADMIN, (ctx) => {
    const b = brandOr404(ctx.params.bid);
    const before = overlayRow(b.brand_identifier);
    if (ctx.body.hidden === undefined && ctx.body.note === undefined && ctx.body.pack_size === undefined) throw bad('Provide hidden, note and/or pack_size');
    if (ctx.body.pack_size !== undefined && b.origin === 'MedAccess') throw bad('Edit the brand itself to change the pack size of an administrator-added brand');
    const hidden = ctx.body.hidden === undefined ? !!before?.hidden : !!ctx.body.hidden;
    const reason = hidden ? (ctx.body.hidden_reason !== undefined ? str(ctx.body.hidden_reason, 300) : (before?.hidden_reason ?? '')) : null;
    if (hidden && !reason) throw bad('A reason is required when hiding a brand');
    const note = ctx.body.note !== undefined ? (str(ctx.body.note, 500) || null) : (before?.note ?? null);
    const pack = ctx.body.pack_size !== undefined ? (str(ctx.body.pack_size, 60) || null) : (before?.pack_size ?? null);
    if (!hidden && !note && !pack) run('DELETE FROM catalogue_overlay WHERE brand_identifier=?', b.brand_identifier);
    else run(`INSERT INTO catalogue_overlay(brand_identifier,hidden,hidden_reason,note,pack_size,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(brand_identifier) DO UPDATE SET hidden=excluded.hidden,hidden_reason=excluded.hidden_reason,note=excluded.note,pack_size=excluded.pack_size,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
      b.brand_identifier, hidden ? 1 : 0, reason, note, pack, ctx.user.user_id, nowIso());
    ref.search.setOverlay(b.brand_identifier, hidden, note, pack);
    audit(ctx.user.user_id, 'CATALOGUE_OVERLAY_UPDATED', 'Success', `cdci:${b.brand_identifier}`,
      { before: before ? { hidden: !!before.hidden, reason: before.hidden_reason, note: before.note, pack_size: before.pack_size } : null, after: { hidden, reason, note, pack_size: pack } });
    return { brand: brandSummary(brandOr404(b.brand_identifier)), overlay: overlayRow(b.brand_identifier) ?? null };
  });

  route('POST', '/api/admin/catalogue/custom', ADMIN, (ctx) => {
    requireRef(ref.search, 'CDCI catalogue');
    const r = customInput(ctx.body);
    const dup = one(`SELECT brand_identifier FROM custom_brands WHERE lower(brand_name)=lower(?) AND lower(strength)=lower(?) AND lower(dosage_form)=lower(?) AND lower(pack_size)=lower(?) AND lower(manufacturer)=lower(?)`,
      r.brand_name, r.strength, r.dosage_form, r.pack_size, r.manufacturer);
    if (dup) throw new ApiError(409, 'A matching administrator-added brand already exists');
    const rowid = run(`INSERT INTO custom_brands(brand_identifier,brand_name,active_ingredient,strength,dosage_form,pack_size,manufacturer,generic_identifier,created_by,created_at)
      VALUES ('pending',?,?,?,?,?,?,?,?,?)`, r.brand_name, r.active_ingredient, r.strength, r.dosage_form, r.pack_size, r.manufacturer, r.generic_identifier, ctx.user.user_id, nowIso()).lastInsertRowid;
    const id = `MA-${String(rowid).padStart(5, '0')}`;
    run('UPDATE custom_brands SET brand_identifier=? WHERE rowid=?', id, rowid);
    syncCustom(id);
    audit(ctx.user.user_id, 'CATALOGUE_CUSTOM_CREATED', 'Success', `cdci:${id}`, r);
    return { brand: brandSummary(brandOr404(id)) };
  });

  route('PUT', '/api/admin/catalogue/custom/:bid', ADMIN, (ctx) => {
    const old = one('SELECT * FROM custom_brands WHERE brand_identifier=?', str(ctx.params.bid, 40));
    if (!old) throw new ApiError(404, 'Administrator-added brand not found (CDCI entries cannot be edited, only hidden or annotated)');
    const r = customInput(ctx.body);
    run(`UPDATE custom_brands SET brand_name=?,active_ingredient=?,strength=?,dosage_form=?,pack_size=?,manufacturer=?,generic_identifier=? WHERE brand_identifier=?`,
      r.brand_name, r.active_ingredient, r.strength, r.dosage_form, r.pack_size, r.manufacturer, r.generic_identifier, old.brand_identifier);
    syncCustom(old.brand_identifier);
    audit(ctx.user.user_id, 'CATALOGUE_CUSTOM_UPDATED', 'Success', `cdci:${old.brand_identifier}`, { before: old, after: r });
    return { brand: brandSummary(brandOr404(old.brand_identifier)) };
  });

  // ---- Bulk pack-size import (administrator, CSV: brand_identifier + pack_size) ----
  // Two steps so nothing is saved blind: PREVIEW validates and classifies every row without writing; COMMIT re-validates the
  // identical file (its fingerprint must match the preview) and applies the valid add/update rows in one transaction.
  const analyzeCsv = (csv) => analyzePackSizeCsv(csv, { brandById: (id) => ref.search.brandById(id) });
  const csvFrom = (body) => { if (typeof body.csv !== 'string') throw bad('Send the file contents as "csv" text'); return body.csv; };
  const BIG = { maxBody: 2_000_000 };

  route('POST', '/api/admin/catalogue/pack-size-import/preview', ADMIN, (ctx) => {
    requireRef(ref.search, 'CDCI catalogue');
    return analyzeCsv(csvFrom(ctx.body));
  }, BIG);

  route('POST', '/api/admin/catalogue/pack-size-import', ADMIN, (ctx) => {
    requireRef(ref.search, 'CDCI catalogue');
    const a = analyzeCsv(csvFrom(ctx.body));
    if (a.fatal) throw bad(a.fatal);
    if (ctx.body.fingerprint !== a.fingerprint) throw new ApiError(409, 'The file differs from the one that was previewed. Preview it again before importing.');
    const todo = a.rows.filter((r) => r.action === 'add' || r.action === 'update');
    if (!todo.length) throw bad('Nothing to import: no new or changed pack sizes in valid rows.');
    const when = nowIso();
    db.exec('BEGIN');
    try {
      for (const r of todo) {
        run(`INSERT INTO catalogue_overlay(brand_identifier,hidden,hidden_reason,note,pack_size,updated_by,updated_at) VALUES (?,0,NULL,NULL,?,?,?)
          ON CONFLICT(brand_identifier) DO UPDATE SET pack_size=excluded.pack_size,updated_by=excluded.updated_by,updated_at=excluded.updated_at`, r.brand_identifier, r.new, ctx.user.user_id, when);
        audit(ctx.user.user_id, 'CATALOGUE_OVERLAY_UPDATED', 'Success', `cdci:${r.brand_identifier}`, { source: 'csv-import', before: { pack_size: r.current }, after: { pack_size: r.new } });
      }
      audit(ctx.user.user_id, 'CATALOGUE_PACK_SIZE_IMPORT', 'Success', 'catalogue', { fingerprint: a.fingerprint, totals: a.totals, applied: todo.length });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    for (const r of todo) { const o = overlayRow(r.brand_identifier); ref.search.setOverlay(r.brand_identifier, !!o.hidden, o.note, o.pack_size); }
    return { imported: todo.length, added: todo.filter((r) => r.action === 'add').length, updated: todo.filter((r) => r.action === 'update').length,
      unchanged: a.totals.unchanged, skipped_invalid: a.totals.invalid };
  }, BIG);

  // Export a filtered slice of the catalogue as rows ready to fill in and re-import (CDCI brands only; max 2,000 rows).
  route('GET', '/api/admin/catalogue/pack-size-export', ADMIN, (ctx) => {
    const idx = requireRef(ref.search, 'CDCI catalogue');
    const { where, args, hasCriteria } = catalogueFilter(ctx.query, true);
    if (!hasCriteria) throw bad('Choose a search, ingredient, strength or dosage form first (the whole catalogue is too large to export).');
    if (ctx.query.get('missing') === '1') where.push('pack_size IS NULL');
    where.push("origin = 'CDCI'");
    const rows = idx.prepare(`SELECT brand_identifier, brand_name, generic_name, supplier_name, pack_size FROM cat WHERE ${where.join(' AND ')}
      ORDER BY brand_name COLLATE NOCASE, brand_identifier LIMIT 2001`).all(...args);
    const truncated = rows.length > 2000;
    const out = rows.slice(0, 2000);
    return { truncated, count: out.length, csv: toCsv([['brand_identifier', 'pack_size', 'brand_name', 'generic_name', 'supplier_name'], ...out.map((r) => [r.brand_identifier, r.pack_size ?? '', r.brand_name, r.generic_name, r.supplier_name])]) };
  });

  // Load the persisted overlay into the in-memory index (runs once when the app is created).
  if (ref.search) {
    for (const c of q('SELECT * FROM custom_brands')) ref.search.upsertCustom(c);
    for (const o of q('SELECT * FROM catalogue_overlay')) ref.search.setOverlay(o.brand_identifier, !!o.hidden, o.note, o.pack_size);
  }
};
