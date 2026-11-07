'use strict';
// Potential matches and pharmacist verification (UC-07..UC-11; FR-20..FR-27; BR-01..BR-04).

module.exports = function register(k) {
  const { ref, q, one, run, audit, route, ApiError, bad, nowIso, str, requireRef, perUnit, packDiff, brandOr404, brandSummary } = k;

  // ---------- CDCI potential matches and pharmacist verification (FR-20..27, BR-01..04) ----------
  // A potential match is another brand with the SAME CDCI generic identifier (same ingredient, strength and dose form).
  // It is informational only (BR-01): nothing becomes "verified" without an explicit pharmacist action (FR-26).
  const lowestDemoPrice = (brandIds) => {
    const out = new Map();
    if (!ref.inventory || !brandIds.length) return out;
    const rows = ref.inventory.prepare(`SELECT cdci_brand_identifier b, MIN(price_inr) p FROM v_demo_inventory
      WHERE cdci_brand_identifier IN (${brandIds.map(() => '?').join(',')}) GROUP BY 1`).all(...brandIds);
    for (const r of rows) out.set(r.b, r.p);
    return out;
  };
  const pairKey = (x, y) => (x < y ? [x, y] : [y, x]);
  const cmpFor = (x, y) => { const [a, b] = pairKey(x, y); return one('SELECT * FROM cdci_comparisons WHERE brand_a=? AND brand_b=? ORDER BY comparison_id DESC LIMIT 1', a, b); };
  route('GET', '/api/catalogue/:bid/matches', ['Patient', 'Caregiver', 'Pharmacist', 'Doctor'], (ctx) => {
    const idx = requireRef(ref.search, 'CDCI catalogue');
    const base = brandOr404(ctx.params.bid);
    const limit = Math.min(Math.max(parseInt(ctx.query.get('limit'), 10) || 10, 1), 50);
    const offset = Math.max(parseInt(ctx.query.get('offset'), 10) || 0, 0);
    const { total, rows } = idx.matchesFor(base, limit, offset);
    const prices = lowestDemoPrice([base.brand_identifier, ...rows.map((r) => r.brand_identifier)]);
    return {
      selected: { ...brandSummary(base), lowest_demo_price: prices.get(base.brand_identifier) ?? null, lowest_price_per_unit: perUnit(prices.get(base.brand_identifier), base.pack_size) },
      basis: 'Same CDCI generic identifier (ingredient, strength and dosage form as recorded by CDCI). Informational only.',
      total, limit, offset, has_more: offset + rows.length < total,
      matches: rows.map((r) => {
        const c = cmpFor(base.brand_identifier, r.brand_identifier);
        return {
          ...brandSummary(r),
          differences: { brand: r.brand_name !== base.brand_name, supplier: (r.supplier_name || '') !== (base.supplier_name || ''), pack_size: packDiff(base.pack_size, r.pack_size) },
          lowest_demo_price: prices.get(r.brand_identifier) ?? null,
          lowest_price_per_unit: perUnit(prices.get(r.brand_identifier), r.pack_size),
          status: c ? c.comparison_status : 'Informational Match', comparison_id: c?.comparison_id ?? null,
        };
      }),
    };
  });

  const cdciDetail = (c) => {
    const idx = ref.search;
    const side = (bid, snap) => { const b = idx?.brandById(bid); return b ? brandSummary(b) : { brand_identifier: bid, brand_name: snap, unavailable: true }; };
    const comments = q(`SELECT v.*, u.name AS author FROM cdci_comparison_comments v JOIN users u ON u.user_id=v.created_by WHERE v.comparison_id=? ORDER BY v.comment_id`, c.comparison_id);
    const prices = lowestDemoPrice([c.brand_a, c.brand_b]);
    const a = side(c.brand_a, c.snapshot_a), b = side(c.brand_b, c.snapshot_b);
    return {
      ...c, brands: [{ ...a, lowest_demo_price: prices.get(c.brand_a) ?? null }, { ...b, lowest_demo_price: prices.get(c.brand_b) ?? null }], comments,
      verifier_name: c.verified_by ? one('SELECT name FROM users WHERE user_id=?', c.verified_by)?.name : null,
      safety: 'A verified comparison confirms that a pharmacist reviewed these two catalogue entries. It is not a substitution recommendation.',
    };
  };

  route('POST', '/api/cdci-comparisons', ['Patient', 'Caregiver', 'Pharmacist'], (ctx) => {
    const a = brandOr404(ctx.body.brand_identifier), b = brandOr404(ctx.body.match_brand_identifier);
    if (a.brand_identifier === b.brand_identifier || !a.generic_identifier || a.generic_identifier !== b.generic_identifier)
      throw bad('These catalogue entries do not share a CDCI generic identifier');
    const existing = cmpFor(a.brand_identifier, b.brand_identifier);
    if (existing && existing.comparison_status !== 'Rejected') return { comparison: cdciDetail(existing), existing: true };
    const [x, y] = pairKey(a.brand_identifier, b.brand_identifier);
    const nameOf = (id) => (id === a.brand_identifier ? a.brand_name : b.brand_name);
    const id = run(`INSERT INTO cdci_comparisons(brand_a,brand_b,generic_identifier,snapshot_a,snapshot_b,created_at,created_by) VALUES (?,?,?,?,?,?,?)`,
      x, y, a.generic_identifier, nameOf(x), nameOf(y), nowIso(), ctx.user.user_id).lastInsertRowid;
    audit(ctx.user.user_id, 'CDCI_COMPARISON_REQUESTED', 'Success', `cdci-comparison:${id}`, { brands: [x, y], generic: a.generic_identifier });
    return { comparison: cdciDetail(one('SELECT * FROM cdci_comparisons WHERE comparison_id=?', id)) };
  });
  route('GET', '/api/cdci-comparisons', ['Pharmacist'], (ctx) => {
    const st = str(ctx.query.get('status'));
    const rows = st ? q('SELECT * FROM cdci_comparisons WHERE comparison_status=? ORDER BY comparison_id DESC LIMIT 200', st) : q('SELECT * FROM cdci_comparisons ORDER BY comparison_id DESC LIMIT 200');
    return { comparisons: rows.map(cdciDetail) };
  });
  // G18 / AD-03: the requester can follow their own verification requests (pending, under review, decided).
  route('GET', '/api/my-comparisons', ['Patient', 'Caregiver', 'Pharmacist'], (ctx) =>
    ({ comparisons: q('SELECT * FROM cdci_comparisons WHERE created_by=? ORDER BY comparison_id DESC LIMIT 200', ctx.user.user_id).map(cdciDetail) }));
  const cmpOr404 = (id) => { const c = one('SELECT * FROM cdci_comparisons WHERE comparison_id=?', id); if (!c) throw new ApiError(404, 'Comparison not found'); return c; };
  route('GET', '/api/cdci-comparisons/:id', ['Pharmacist', 'Patient', 'Caregiver', 'Doctor'], (ctx) => ({ comparison: cdciDetail(cmpOr404(ctx.params.id)) }));
  function cdciTransition(ctx, from, to, action) {
    const c = cmpOr404(ctx.params.id);
    if (c.comparison_status !== from) throw new ApiError(409, `Comparison is "${c.comparison_status}"; expected "${from}"`);
    const final = to === 'Verified' || to === 'Rejected';
    run('UPDATE cdci_comparisons SET comparison_status=?, verification_date=?, verified_by=? WHERE comparison_id=?', to, final ? nowIso() : null, final ? ctx.user.user_id : null, c.comparison_id);
    const comment = str(ctx.body?.comment, 1000);
    if (final && comment) run('INSERT INTO cdci_comparison_comments(comparison_id,comment_text,created_at,created_by) VALUES (?,?,?,?)', c.comparison_id, comment, nowIso(), ctx.user.user_id);
    audit(ctx.user.user_id, action, 'Success', `cdci-comparison:${c.comparison_id}`, { from, to });
    return { comparison: cdciDetail(cmpOr404(c.comparison_id)) };
  }
  route('POST', '/api/cdci-comparisons/:id/open', ['Pharmacist'], (ctx) => cdciTransition(ctx, 'Pending Review', 'Under Pharmacist Review', 'CDCI_COMPARISON_REVIEW_STARTED'));
  route('POST', '/api/cdci-comparisons/:id/verify', ['Pharmacist'], (ctx) => cdciTransition(ctx, 'Under Pharmacist Review', 'Verified', 'CDCI_COMPARISON_VERIFIED'));
  route('POST', '/api/cdci-comparisons/:id/reject', ['Pharmacist'], (ctx) => cdciTransition(ctx, 'Under Pharmacist Review', 'Rejected', 'CDCI_COMPARISON_REJECTED'));
  route('POST', '/api/cdci-comparisons/:id/comments', ['Pharmacist'], (ctx) => {
    const c = cmpOr404(ctx.params.id);
    const text = str(ctx.body.text, 1000);
    if (!text) throw bad('Comment text is required');
    run('INSERT INTO cdci_comparison_comments(comparison_id,comment_text,created_at,created_by) VALUES (?,?,?,?)', c.comparison_id, text, nowIso(), ctx.user.user_id);
    audit(ctx.user.user_id, 'CDCI_COMPARISON_COMMENT_ADDED', 'Success', `cdci-comparison:${c.comparison_id}`);
    return { comparison: cdciDetail(c) };
  });
};
