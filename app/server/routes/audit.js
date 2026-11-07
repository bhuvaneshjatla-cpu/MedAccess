'use strict';
// Audit log (UC-21; FR-38, FR-39).

module.exports = function register(k) {
  const { q, audit, route, ADMIN, str } = k;

  // UC-21 View Audit Log (FR-38, FR-39)
  route('GET', '/api/admin/audit', ADMIN, (ctx) => {
    const action = str(ctx.query.get('action')), result = str(ctx.query.get('result'));
    const limit = Math.min(Math.max(parseInt(ctx.query.get('limit'), 10) || 100, 1), 500);
    const where = [], p = [];
    if (action) { where.push('a.action LIKE ?'); p.push(`%${action.toUpperCase()}%`); }
    if (result) { where.push('a.result=?'); p.push(result); }
    return { entries: q(`SELECT a.*, u.name AS actor_name, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.user_id=a.user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.audit_log_id DESC LIMIT ${limit}`, ...p) };
  });
};
