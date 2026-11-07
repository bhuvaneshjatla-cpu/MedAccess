'use strict';
// Medicine catalogue (UC-02, UC-03; FR-05..FR-09): search with ingredient / strength / dosage-form filters, and the raw synthetic demo inventory.

module.exports = function register(k) {
  const { ref, one, route, ALL, READERS, bad, str, isStale, requireRef, CDCI_SOURCE, attributesOf, catalogueFilter } = k;

  // Reference terminology only: no stock, no prices, no equivalence claim.
  route('GET', '/api/catalogue', ALL, (ctx) => {
    const idx = requireRef(ref.search, 'CDCI catalogue');
    const limit = Math.min(Math.max(parseInt(ctx.query.get('limit'), 10) || 25, 1), 100);
    const offset = Math.max(parseInt(ctx.query.get('offset'), 10) || 0, 0);
    const { where, args, hasCriteria } = catalogueFilter(ctx.query, ctx.user.role === 'Administrator');
    if (!hasCriteria) return { results: [], limit, offset, message: 'Enter a name, or an active ingredient, strength or dosage form, to search.' };
    const rows = idx.prepare(`SELECT brand_identifier, brand_name, product_identifier, product_name,
        generic_identifier, generic_name, supplier_identifier, supplier_name, dosage_form, strength, pack_size, origin, hidden, admin_note
      FROM cat WHERE ${where.join(' AND ')}
      ORDER BY brand_name COLLATE NOCASE, product_name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...args, limit + 1, offset);
    const more = rows.length > limit;
    return { results: rows.slice(0, limit).map(({ dosage_form, strength, pack_size, ...r }) => ({ ...r, hidden: !!r.hidden, source: r.origin === 'MedAccess' ? 'Added by a MedAccess administrator' : CDCI_SOURCE, informational_only: true, attributes: attributesOf(strength, dosage_form, { origin: r.origin, pack_size }) })), limit, offset, has_more: more,
      notice: 'Catalogue entries are reference terminology. They do not show stock or prices and do not establish that two products are interchangeable.' };
  });

  // SYNTHETIC demo inventory (BR-09, NFR-07). Never live availability. Preferred key: the CDCI brand identifier, which
  // names one exact presentation (one generic = one strength and dose form). A CDCI "product" is a brand family that can span
  // several strengths, so productIdentifier is accepted but may return rows with different strengths.
  route('GET', '/api/demo-inventory', READERS, (ctx) => {
    const inv = requireRef(ref.inventory, 'Synthetic inventory');
    const brand = str(ctx.query.get('brandIdentifier'), 100), product = str(ctx.query.get('productIdentifier'), 100);
    if (!brand && !product) throw bad('A CDCI brandIdentifier (preferred) or productIdentifier is required');
    const col = brand ? 'cdci_brand_identifier' : 'cdci_product_identifier';
    const results = inv.prepare(`SELECT inventory_item_id, pharmacy_id, pharmacy_name, locality, city, district, state,
        cdci_product_identifier, cdci_brand_identifier, cdci_generic_identifier, product_name, brand_name, generic_name, strength, dosage_form, pack_size,
        quantity_available, stock_status, price_inr, last_updated_at, data_origin, is_synthetic, catalogue_match_status
      FROM v_demo_inventory WHERE ${col} = ? ORDER BY price_inr ASC, pharmacy_name COLLATE NOCASE`).all(brand || product)
      .filter((r) => !ref.restrictedBrands.has(r.cdci_brand_identifier))
      .map(({ strength: _s, dosage_form: _d, pack_size: _p, ...r }) => {
        const a = ref.search?.attributesFor(r.cdci_generic_identifier);
        const t = ref.demoTime ? ref.demoTime(r.last_updated_at) : r.last_updated_at;
        return { ...r, last_updated_at: t, currency: 'INR', stale: isStale(t), attributes: attributesOf(a?.strength, a?.dosage_form) };
      }); // V2 stores INR only (price_inr_paise); the view has no currency column
    return { data_label: 'DEMO DATA — NOT LIVE PHARMACY AVAILABILITY', is_synthetic: true, demo_time_shift_days: ref.demoShiftDays ?? 0, brand_identifier: brand || null, product_identifier: product || null, count: results.length, results };
  });
};
