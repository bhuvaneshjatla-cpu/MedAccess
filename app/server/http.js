'use strict';
// The request pipeline: routing, authentication (FR-01..FR-04), role authorisation, body parsing, JSON errors, static files
// and security headers.
const fs = require('node:fs');
const path = require('node:path');
const { readToken } = require('./auth');
const { ApiError, bad } = require('./util');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function createHandler(k) {
  const { routes, userRow, audit, ALL } = k;


  function readBody(req, limit = 100_000) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new ApiError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const b = JSON.parse(Buffer.concat(chunks).toString()); resolve(b && typeof b === 'object' ? b : {}); }
        catch { reject(bad('Invalid JSON body')); }
      });
      req.on('error', reject);
    });
  }

  const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  };
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SEC_HEADERS, ...headers }); res.end(body); };
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
        if (!r) {
          if (routes.some((x) => x.re.test(url.pathname))) throw new ApiError(405, 'Method not allowed');
          throw new ApiError(404, 'Not found');
        }
        const m = url.pathname.match(r.re);
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        let user = null;
        if (r.roles) { // FR-01..FR-04, NFR-01..03: authenticate then authorise by role
          const tok = readToken((req.headers.authorization || '').replace(/^Bearer /, ''));
          user = tok ? userRow(tok.uid) : null;
          if (!user || user.account_status !== 'Active') throw new ApiError(401, 'Authentication required');
          if (r.roles !== ALL && !r.roles.includes(user.role)) {
            audit(user.user_id, 'ACCESS_DENIED', 'Failure', `${req.method} ${url.pathname}`, { role: user.role });
            throw new ApiError(403, 'Your role is not permitted to perform this operation');
          }
        }
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req, r.maxBody) : {};
        return json(res, 200, await r.handler({ user, params, body, query: url.searchParams }));
      }
      // static files
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'Method not allowed');
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = path.resolve(PUBLIC_DIR, rel);
      if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ApiError(404, 'Not found');
      return send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      if (status === 500) console.error(e);
      if (url.pathname.startsWith('/api/')) return json(res, status, { error: status === 500 ? 'Internal server error' : e.message });
      return send(res, status, status === 404 ? 'Not found' : e.message, { 'Content-Type': 'text/plain' });
    }
  };
}

module.exports = { createHandler };
