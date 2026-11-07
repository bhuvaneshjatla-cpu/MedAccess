'use strict';
// Authentication (UC-01, AD-01, FR-01..FR-04): login with throttling, current user, logout, and the project reference data.
const { verifyPassword, issueToken } = require('../auth');
const { META } = require('../meta');

module.exports = function register(k) {
  const { one, audit, userRow, route, ALL, ApiError, str } = k;

  const failures = new Map(); // email -> {n, until}  (basic login throttling)

  // UC-01 Authenticate User (AD-01)
  route('POST', '/api/auth/login', null, (ctx) => {
    const email = str(ctx.body.email, 200).toLowerCase();
    const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
    const f = failures.get(email);
    if (f && f.until > Date.now()) throw new ApiError(429, 'Too many failed attempts. Try again later.');
    const u = one('SELECT * FROM users WHERE email=?', email);
    const ok = u && verifyPassword(password, u.password_hash);
    if (!ok) {
      const n = (f?.n || 0) + 1;
      failures.set(email, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      audit(u?.user_id, 'LOGIN', 'Failure', email, { reason: 'invalid credentials' });
      throw new ApiError(401, 'Invalid email or password');
    }
    failures.delete(email);
    if (u.account_status !== 'Active') {
      audit(u.user_id, 'LOGIN', 'Failure', email, { reason: `account ${u.account_status}` });
      throw new ApiError(403, `Account is ${u.account_status.toLowerCase()}; contact an administrator`);
    }
    audit(u.user_id, 'LOGIN', 'Success', email);
    return { token: issueToken(u.user_id), user: userRow(u.user_id) };
  });
  route('GET', '/api/auth/me', ALL, (ctx) => ({ user: ctx.user }));
  route('POST', '/api/auth/logout', ALL, (ctx) => { audit(ctx.user.user_id, 'LOGOUT', 'Success', ctx.user.email); return { ok: true }; });
  route('GET', '/api/meta', null, () => META);
};
