'use strict';
// Incorrect-information reports (UC-14, UC-15; FR-28..FR-31).

module.exports = function register(k) {
  const { q, one, run, audit, route, READERS, ApiError, bad, nowIso, str, brandOr404, pharmacyOr400 } = k;

  const REPORT_SELECT = `SELECT r.*, u.name AS reporter_name, rv.name AS resolver_name
    FROM incorrect_information_reports r
    JOIN users u ON u.user_id=r.reported_by LEFT JOIN users rv ON rv.user_id=r.resolved_by`;


  // UC-14 Report Incorrect Information (AD-06). Names are snapshotted because the reference data is read-only and may change.
  route('POST', '/api/reports', ['Patient', 'Caregiver', 'Pharmacist', 'Pharmacy Staff'], (ctx) => {
    const b = brandOr404(ctx.body.brand_identifier);
    const ph = pharmacyOr400(ctx.body.pharmacy_id);
    const type = str(ctx.body.report_type, 40);
    if (!['Incorrect Price', 'Incorrect Availability', 'Other'].includes(type)) throw bad('Invalid issue type');
    const id = run(`INSERT INTO incorrect_information_reports(reported_by,brand_identifier,brand_name,pharmacy_id,pharmacy_name,report_type,description,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      ctx.user.user_id, b.brand_identifier, b.brand_name, ph.pharmacy_id, ph.pharmacy_name, type, str(ctx.body.description, 1000), nowIso()).lastInsertRowid;
    audit(ctx.user.user_id, 'REPORT_SUBMITTED', 'Success', `report:${id}`, { type, brand: b.brand_identifier, pharmacy: ph.pharmacy_id });
    return { report: one(`${REPORT_SELECT} WHERE r.report_id=?`, id) };
  });
  // UC-15 list: reviewers see all; reporters see their own
  route('GET', '/api/reports', READERS, (ctx) => {
    const reviewer = ['Pharmacist', 'Pharmacy Staff', 'Administrator'].includes(ctx.user.role);
    const mine = ctx.query.get('mine') === '1' || !reviewer;
    const rows = mine ? q(`${REPORT_SELECT} WHERE r.reported_by=? ORDER BY r.report_id DESC`, ctx.user.user_id)
      : q(`${REPORT_SELECT} ORDER BY r.report_id DESC`);
    return { reports: rows, can_review: reviewer };
  });
  const REPORT_FLOW = { // STD-04
    review: { from: ['Submitted'], to: 'Under Review' },
    investigate: { from: ['Under Review'], to: 'Investigating' },
    resolve: { from: ['Investigating'], to: 'Resolved' },
    reject: { from: ['Investigating'], to: 'Rejected' },
  };
  route('POST', '/api/reports/:id/:action', ['Pharmacist', 'Pharmacy Staff', 'Administrator'], (ctx) => {
    const flow = REPORT_FLOW[ctx.params.action];
    if (!flow) throw new ApiError(404, 'Unknown report action');
    const r = one('SELECT * FROM incorrect_information_reports WHERE report_id=?', ctx.params.id);
    if (!r) throw new ApiError(404, 'Report not found');
    if (!flow.from.includes(r.status)) throw new ApiError(409, `Report is "${r.status}"; cannot ${ctx.params.action}`);
    const final = flow.to === 'Resolved' || flow.to === 'Rejected';
    const note = str(ctx.body.note, 1000);
    if (final && !note) throw bad('A resolution note is required');
    run('UPDATE incorrect_information_reports SET status=?, resolution_note=COALESCE(?,resolution_note), resolved_by=?, resolved_at=? WHERE report_id=?',
      flow.to, final ? note : null, final ? ctx.user.user_id : r.resolved_by, final ? nowIso() : r.resolved_at, r.report_id);
    audit(ctx.user.user_id, final ? 'REPORT_RESOLUTION' : 'REPORT_STATUS_CHANGE', 'Success', `report:${r.report_id}`, { from: r.status, to: flow.to, note: final ? note : undefined });
    return { report: one(`${REPORT_SELECT} WHERE r.report_id=?`, r.report_id) };
  });
};
