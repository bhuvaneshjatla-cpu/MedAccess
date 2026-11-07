'use strict';
// Pharmacy availability and price (UC-04, UC-05, UC-12, UC-13; FR-10..FR-19): pharmacies, merged availability, staff updates.

module.exports = function register(k) {
  const { run, audit, route, READERS, bad, nowIso, str, perUnit, brandOr404, brandSummary, mergedAvailability, pharmaciesOr503, pharmacyOr400 } = k;

  route('GET', '/api/pharmacies', READERS, () => ({ pharmacies: pharmaciesOr503(), data_label: 'DEMO DATA — FICTIONAL PHARMACIES' }));

  route('GET', '/api/catalogue/:bid/availability', READERS, (ctx) => {
    const b = brandOr404(ctx.params.bid);
    const rows = mergedAvailability(b.brand_identifier).map((r) => ({ ...r, price_per_unit: perUnit(r.price_inr, b.pack_size) })).sort((x, y) => (x.price_inr ?? Infinity) - (y.price_inr ?? Infinity) || x.pharmacy_name.localeCompare(y.pharmacy_name));
    return { brand: brandSummary(b), data_label: 'DEMO DATA — NOT LIVE PHARMACY AVAILABILITY', is_synthetic: true, count: rows.length, availability: rows };
  });

  // UC-12 Update Medicine Stock (AD-04)
  route('PUT', '/api/availability', ['Pharmacist', 'Pharmacy Staff'], (ctx) => {
    const b = brandOr404(ctx.body.brand_identifier);
    const ph = pharmacyOr400(ctx.body.pharmacy_id);
    const status = str(ctx.body.availability_status, 20);
    if (!['Available', 'Low Stock', 'Unavailable'].includes(status)) throw bad('availability_status must be Available, Low Stock or Unavailable');
    const before = mergedAvailability(b.brand_identifier).find((r) => r.pharmacy_id === ph.pharmacy_id)?.availability_status ?? null;
    run(`INSERT INTO stock_overrides(brand_identifier,pharmacy_id,availability_status,last_updated,updated_by) VALUES (?,?,?,?,?)
      ON CONFLICT(brand_identifier,pharmacy_id) DO UPDATE SET availability_status=excluded.availability_status,last_updated=excluded.last_updated,updated_by=excluded.updated_by`,
      b.brand_identifier, ph.pharmacy_id, status, nowIso(), ctx.user.user_id);
    audit(ctx.user.user_id, 'STOCK_UPDATED', 'Success', `cdci:${b.brand_identifier}/pharmacy:${ph.pharmacy_id}`, { before, after: status });
    return { ok: true };
  });

  // UC-13 Update Medicine Price (AD-05, FR-19)
  route('PUT', '/api/prices', ['Pharmacist', 'Pharmacy Staff'], (ctx) => {
    const b = brandOr404(ctx.body.brand_identifier);
    const ph = pharmacyOr400(ctx.body.pharmacy_id);
    const amount = Number(ctx.body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw bad('Price must be a positive number');
    const paise = Math.round(amount * 100);
    const before = mergedAvailability(b.brand_identifier).find((r) => r.pharmacy_id === ph.pharmacy_id)?.price_inr ?? null;
    run(`INSERT INTO price_overrides(brand_identifier,pharmacy_id,price_inr_paise,last_updated,updated_by) VALUES (?,?,?,?,?)
      ON CONFLICT(brand_identifier,pharmacy_id) DO UPDATE SET price_inr_paise=excluded.price_inr_paise,last_updated=excluded.last_updated,updated_by=excluded.updated_by`,
      b.brand_identifier, ph.pharmacy_id, paise, nowIso(), ctx.user.user_id);
    audit(ctx.user.user_id, 'PRICE_UPDATED', 'Success', `cdci:${b.brand_identifier}/pharmacy:${ph.pharmacy_id}`, { before, after: paise / 100 });
    return { ok: true };
  });
};
