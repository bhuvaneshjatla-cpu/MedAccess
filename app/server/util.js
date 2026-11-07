'use strict';
// Small helpers shared by every module.
const STALE_HOURS = 7 * 24; // freshness threshold for NFR-13/14 display (prototype choice)

class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new ApiError(400, m);
const nowIso = () => new Date().toISOString();
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isStale = (iso) => !iso || Date.now() - new Date(iso).getTime() > STALE_HOURS * 3600e3;

module.exports = { STALE_HOURS, ApiError, bad, nowIso, str, isStale };
