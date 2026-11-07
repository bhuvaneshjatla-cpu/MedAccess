/* Page chrome: role-based navigation, header, banner; session set/clear; logout button. */
import { $, h, view } from './ui.js';
import { session, api } from './session.js';

// ---------- session / nav ----------
export const NAV = {
  Patient: [['Search', '#/catalogue'], ['Reminders', '#/reminders'], ['My requests', '#/my-requests'], ['My reports', '#/reports'], ['Project docs', '#/docs']],
  Caregiver: [['Search', '#/catalogue'], ['Reminders', '#/reminders'], ['My requests', '#/my-requests'], ['My reports', '#/reports'], ['Project docs', '#/docs']],
  Pharmacist: [['Search', '#/catalogue'], ['Verification', '#/verification'], ['Inventory', '#/inventory'], ['Reports', '#/reports'], ['Project docs', '#/docs']],
  'Pharmacy Staff': [['Search', '#/catalogue'], ['Inventory', '#/inventory'], ['Reports', '#/reports'], ['Project docs', '#/docs']],
  Administrator: [['Search', '#/catalogue'], ['Users', '#/admin/users'], ['Catalogue admin', '#/admin/catalogue'], ['Admin reports', '#/admin/reports'], ['Audit log', '#/admin/audit'], ['Reports', '#/reports'], ['Project docs', '#/docs']],
  Doctor: [['Search', '#/catalogue'], ['Project docs', '#/docs']],
};

export function setSession(t, u) {
  session.token = t; session.user = u;
  try { t ? sessionStorage.setItem('ma_token', t) : sessionStorage.removeItem('ma_token'); } catch { /* ignore */ }
  renderChrome();
}
export function renderChrome() {
  $('#top').hidden = !session.user; $('#banner').hidden = !session.user;
  if (!session.user) return;
  $('#whoami').textContent = `${session.user.name} · ${session.user.role}`;
  const cur = location.hash.split('?')[0];
  $('#nav').replaceChildren(...(NAV[session.user.role] || []).map(([t, href]) =>
    h('a', { href, 'aria-current': cur === href || (href !== '#/search' && cur.startsWith(href)) ? 'page' : false }, t)));
}

export function initShell() {
  // the skip link must only move focus: following its #view href would change the hash, which the router treats as an unknown page
  $('.skip')?.addEventListener('click', (e) => { e.preventDefault(); view.focus(); });
  $('#logout').addEventListener('click', async () => { try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ } setSession(null, null); location.hash = '#/login'; });
}
