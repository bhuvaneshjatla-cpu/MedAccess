'use strict';
// Shared context ("kernel") handed to every route module: database helpers, audit, the route registry, role constants,
// the reference stores, and the brand / availability helpers. Route modules destructure what they need from it.
const { STALE_HOURS, ApiError, bad, nowIso, str, isStale } = require('./util');
const createBrands = require('./brands');
const createAvailabilityModel = require('./availabilityModel');

function createKernel(db, ref) {
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  function audit(userId, action, result, affected, details) {
    run('INSERT INTO audit_log(user_id,timestamp,action,result,affected_record,details) VALUES (?,?,?,?,?,?)',
      userId ?? null, nowIso(), action, result, affected ?? null, details ? JSON.stringify(details) : null);
  }

  const userRow = (id) => one(`SELECT u.user_id,u.name,u.email,u.contact_information,u.account_status,r.role_name AS role
    FROM users u JOIN roles r ON r.role_id=u.role_id WHERE u.user_id=?`, id);

  // ---------- route table ----------
  const routes = [];
  const route = (method, pattern, roles, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, roles, handler, maxBody: opts.maxBody });
  };
  const ALL = '*'; // any authenticated user
  const READERS = ['Patient', 'Caregiver', 'Pharmacist', 'Pharmacy Staff', 'Administrator'];
  const ADMIN = ['Administrator'];

  const requireRef = (store, name) => { if (!store) throw new ApiError(503, `${name} database is not configured on this server`); return store; };
  const CDCI_SOURCE = 'CDCI Common Drug Codes for India';

  const k = { db, ref, q, one, run, audit, userRow, route, routes, ALL, READERS, ADMIN, ApiError, bad, nowIso, str, isStale, STALE_HOURS, requireRef, CDCI_SOURCE };
  Object.assign(k, createBrands(k));
  Object.assign(k, createAvailabilityModel(k));
  return k;
}

module.exports = { createKernel };
