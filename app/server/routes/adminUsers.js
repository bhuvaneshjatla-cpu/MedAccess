'use strict';
// User and role management (UC-18; FR-35; STD-01 account lifecycle).
const { hashPassword } = require('../auth');

module.exports = function register(k) {
  const { q, one, run, audit, userRow, route, ADMIN, ApiError, bad, str } = k;

  // UC-18 Manage Users and Roles (AD-08, STD-01)
  route('GET', '/api/admin/users', ADMIN, () => ({
    users: q(`SELECT u.user_id,u.name,u.email,u.contact_information,u.account_status,r.role_name AS role FROM users u JOIN roles r ON r.role_id=u.role_id ORDER BY u.user_id`),
    roles: q('SELECT role_name FROM roles ORDER BY role_id').map((r) => r.role_name),
  }));
  route('POST', '/api/admin/users', ADMIN, (ctx) => {
    const name = str(ctx.body.name, 100), email = str(ctx.body.email, 200).toLowerCase(), pw = ctx.body.password;
    const role = one('SELECT role_id FROM roles WHERE role_name=?', str(ctx.body.role, 40));
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Name and a valid email are required');
    if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters');
    if (!role) throw bad('Invalid role');
    if (one('SELECT 1 x FROM users WHERE email=?', email)) throw new ApiError(409, 'A user with that email already exists');
    const id = run("INSERT INTO users(name,email,password_hash,contact_information,account_status,role_id) VALUES (?,?,?,?, 'Created', ?)",
      name, email, hashPassword(pw), str(ctx.body.contact_information, 200), role.role_id).lastInsertRowid;
    audit(ctx.user.user_id, 'USER_CREATED', 'Success', `user:${id}`, { role: ctx.body.role });
    return { user: userRow(id) };
  });
  route('PATCH', '/api/admin/users/:id', ADMIN, (ctx) => {
    const u = userRow(Number(ctx.params.id));
    if (!u) throw new ApiError(404, 'User not found');
    const newRole = ctx.body.role ? one('SELECT role_id FROM roles WHERE role_name=?', str(ctx.body.role, 40)) : null;
    if (ctx.body.role && !newRole) throw bad('Invalid role');
    if (newRole && u.user_id === ctx.user.user_id && ctx.body.role !== 'Administrator') throw bad('You cannot remove your own administrator role');
    const name = ctx.body.name !== undefined ? str(ctx.body.name, 100) : u.name;
    if (!name) throw bad('Name is required');
    run('UPDATE users SET name=?, contact_information=COALESCE(?,contact_information), role_id=COALESCE(?,role_id) WHERE user_id=?',
      name, ctx.body.contact_information !== undefined ? str(ctx.body.contact_information, 200) : null, newRole?.role_id ?? null, u.user_id);
    audit(ctx.user.user_id, 'USER_UPDATED', 'Success', `user:${u.user_id}`, { before: { name: u.name, role: u.role }, after: { name, role: ctx.body.role ?? u.role } });
    return { user: userRow(u.user_id) };
  });
  const ACCOUNT_FLOW = { // STD-01
    activate: { from: ['Created'], to: 'Active' },
    deactivate: { from: ['Active'], to: 'Deactivated' },
    inactivate: { from: ['Active'], to: 'Inactive' },
    reactivate: { from: ['Inactive'], to: 'Active' },
  };
  route('POST', '/api/admin/users/:id/:action', ADMIN, (ctx) => {
    const flow = ACCOUNT_FLOW[ctx.params.action];
    if (!flow) throw new ApiError(404, 'Unknown account action');
    const u = userRow(Number(ctx.params.id));
    if (!u) throw new ApiError(404, 'User not found');
    if (u.user_id === ctx.user.user_id && ctx.params.action !== 'activate') throw bad('You cannot change the status of your own account');
    if (!flow.from.includes(u.account_status)) throw new ApiError(409, `Account is "${u.account_status}"; cannot ${ctx.params.action}`);
    run('UPDATE users SET account_status=? WHERE user_id=?', flow.to, u.user_id);
    audit(ctx.user.user_id, 'USER_STATUS_CHANGED', 'Success', `user:${u.user_id}`, { from: u.account_status, to: flow.to });
    return { user: userRow(u.user_id) };
  });
};
