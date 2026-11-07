'use strict';
// Availability and price per brand and pharmacy: seeded demo-inventory rows merged with staff overrides (see routes/availability.js).

module.exports = function createAvailabilityModel(k) {
  const { ref, q, one, bad, str, isStale, requireRef } = k;

  // ---------- Pharmacies, availability, price, reports and reminders — keyed by CDCI BRAND identifier ----------
  // Pharmacies come from the read-only synthetic inventory (V2). V2 itself is never written: staff updates are stored in
  // app-owned override tables (stock_overrides, price_overrides) and merged over the seeded values at read time, newest wins.
  // Prices are integer paise in storage (same unit as V2) and rupees in the API.
  const STATUS_MAP = { in_stock: 'Available', low_stock: 'Low Stock', out_of_stock: 'Unavailable' };
  const pharmaciesOr503 = () => { requireRef(ref.inventory, 'Synthetic inventory'); return ref.pharmacies; };
  const pharmacyOr400 = (id) => {
    const ph = pharmaciesOr503().find((p) => p.pharmacy_id === str(id, 100));
    if (!ph) throw bad('Unknown pharmacy');
    return ph;
  };
  const blankRow = (pharmacyId) => ({ pharmacy_id: pharmacyId, availability_status: null, quantity: null, status_updated_at: null, status_updated_by: null, status_source: null,
    price_inr: null, price_updated_at: null, price_updated_by: null, price_source: null });

  // Merge seeded V2 rows with staff overrides for one brand, or for all brands when bid is null (used by admin reports).
  function mergedAvailability(bid) {
    const rows = new Map();
    const key = (b, p) => `${b}|${p}`;
    if (ref.inventory) {
      const base = bid ? ref.inventory.prepare('SELECT cdci_brand_identifier b, pharmacy_id, quantity_available, stock_status, price_inr, last_updated_at FROM v_demo_inventory WHERE cdci_brand_identifier = ?').all(bid)
        : ref.inventory.prepare('SELECT cdci_brand_identifier b, pharmacy_id, quantity_available, stock_status, price_inr, last_updated_at FROM v_demo_inventory').all();
      const t = ref.demoTime ?? ((x) => x);
      const seedSrc = ref.demoShiftDays ? 'synthetic seed (timestamps re-anchored)' : 'synthetic seed';
      for (const r0 of base.filter((x) => !ref.restrictedBrands.has(x.b))) { const r = { ...r0, last_updated_at: t(r0.last_updated_at) }; rows.set(key(r.b, r.pharmacy_id), { brand_identifier: r.b, ...blankRow(r.pharmacy_id), availability_status: STATUS_MAP[r.stock_status] ?? null, quantity: r.quantity_available,
        status_updated_at: r.last_updated_at, status_source: seedSrc, price_inr: r.price_inr, price_updated_at: r.last_updated_at, price_source: seedSrc }); }
    }
    const ov = (sql, ...p) => q(sql, ...p);
    const where = bid ? 'WHERE s.brand_identifier = ?' : '';
    const args = bid ? [bid] : [];
    for (const o of ov(`SELECT s.*, u.name AS who FROM stock_overrides s LEFT JOIN users u ON u.user_id = s.updated_by ${where}`, ...args)) {
      if (ref.restrictedBrands.has(o.brand_identifier)) continue;
      const k = key(o.brand_identifier, o.pharmacy_id);
      const row = rows.get(k) ?? { brand_identifier: o.brand_identifier, ...blankRow(o.pharmacy_id) };
      Object.assign(row, { availability_status: o.availability_status, quantity: null, status_updated_at: o.last_updated, status_updated_by: o.who, status_source: 'entered in MedAccess (demo)' });
      rows.set(k, row);
    }
    for (const o of ov(`SELECT s.*, u.name AS who FROM price_overrides s LEFT JOIN users u ON u.user_id = s.updated_by ${where}`, ...args)) {
      if (ref.restrictedBrands.has(o.brand_identifier)) continue;
      const k = key(o.brand_identifier, o.pharmacy_id);
      const row = rows.get(k) ?? { brand_identifier: o.brand_identifier, ...blankRow(o.pharmacy_id) };
      Object.assign(row, { price_inr: o.price_inr_paise / 100, price_updated_at: o.last_updated, price_updated_by: o.who, price_source: 'entered in MedAccess (demo)' });
      rows.set(k, row);
    }
    const byId = new Map((ref.pharmacies ?? []).map((p) => [p.pharmacy_id, p]));
    return [...rows.values()].map((r) => {
      const p = byId.get(r.pharmacy_id);
      return { ...r, pharmacy_name: p?.pharmacy_name ?? r.pharmacy_id, area: p ? `${p.locality}, ${p.city}` : null, currency: 'INR',
        status_stale: isStale(r.status_updated_at), price_stale: isStale(r.price_updated_at), is_synthetic: true };
    });
  }

  return { mergedAvailability, pharmaciesOr503, pharmacyOr400 };
};
