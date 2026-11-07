'use strict';
// Administrative reports and the restricted-medicine review aid (UC-20; FR-37; BR-07).

module.exports = function register(k) {
  const { ref, q, one, route, ADMIN, nowIso, STALE_HOURS, mergedAvailability } = k;

  // BR-07 review aid: what the restricted-medicines list currently excludes (the list itself is config/restricted-medicines.json).
  route('GET', '/api/admin/restricted', ADMIN, () => {
    const l = ref.restricted, by = ref.search?.restrictedByRule ?? new Map();
    return {
      version: l.version, status: l.status, description: l.description,
      excluded_brands: ref.restrictedBrands.size,
      rules: l.ingredients.map((i) => ({ name: i.name, group: i.group, note: i.note, excluded_brands: by.get(String(i.name).toLowerCase()) ?? 0 })).sort((a, b) => b.excluded_brands - a.excluded_brands || a.name.localeCompare(b.name)),
      classifications: l.classifications.map((c) => ({ ...c, excluded_brands: by.get(`classification:${String(c.value).trim()}`) ?? 0 })), not_included_pending_review: l.notIncluded,
    };
  });

  // UC-20 View Administrative Reports (AD-10)
  route('GET', '/api/admin/reports', ADMIN, () => {
    const count = (sql, ...p) => one(sql, ...p).c;
    const staleCut = new Date(Date.now() - STALE_HOURS * 3600e3).toISOString();
    return {
      generated_at: nowIso(),
      restricted: { excluded_brands: ref.restrictedBrands.size, list_version: ref.restricted.version, list_status: ref.restricted.status },
      users_by_role: q(`SELECT r.role_name AS role, COUNT(u.user_id) AS count FROM roles r LEFT JOIN users u ON u.role_id=r.role_id GROUP BY r.role_id ORDER BY r.role_id`),
      users_by_status: q('SELECT account_status AS status, COUNT(*) AS count FROM users GROUP BY account_status'),
      catalogue: { hidden: ref.search ? ref.search.prepare('SELECT COUNT(*) c FROM cat WHERE hidden = 1').get().c : 0, annotated: ref.search ? ref.search.prepare('SELECT COUNT(*) c FROM cat WHERE admin_note IS NOT NULL').get().c : 0, added: count('SELECT COUNT(*) c FROM custom_brands') },
      availability_by_status: (() => { const m = new Map(); for (const r of mergedAvailability(null)) if (r.availability_status) m.set(r.availability_status, (m.get(r.availability_status) ?? 0) + 1); return [...m].map(([status, count]) => ({ status, count })); })(),
      stale_records: (() => { const rows = mergedAvailability(null); return { availability: rows.filter((r) => r.status_stale).length, prices: rows.filter((r) => r.price_stale && r.price_inr != null).length, threshold_days: STALE_HOURS / 24 }; })(),
      comparisons_by_status: q('SELECT comparison_status AS status, COUNT(*) AS count FROM cdci_comparisons GROUP BY comparison_status'),
      reports_by_status: q('SELECT status, COUNT(*) AS count FROM incorrect_information_reports GROUP BY status'),
      reminders_by_status: q('SELECT status, COUNT(*) AS count FROM refill_reminders GROUP BY status'),
    };
  });
};
