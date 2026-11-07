'use strict';
const crypto = require('node:crypto');

const SECRET = process.env.MEDACCESS_SECRET || crypto.randomBytes(32).toString('hex'); // per-process if unset
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function issueToken(userId) {
  const body = b64(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }));
  return `${body}.${sign(body)}`;
}

function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

module.exports = { hashPassword, verifyPassword, issueToken, readToken };
