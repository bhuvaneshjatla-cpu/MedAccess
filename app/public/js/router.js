/* Hash router: maps a hash to a page, enforces login and role access, renders loading / error states. */
import { h, mount, empty, view } from './ui.js';
import { session, api } from './session.js';
import { renderChrome } from './shell.js';
import { pageLogin } from './pages/login.js';
import { pageCatalogue } from './pages/catalogue.js';
import { pageVerification } from './pages/verification.js';
import { pageInventory } from './pages/inventory.js';
import { pageReports } from './pages/reports.js';
import { pageReminders } from './pages/reminders.js';
import { pageAdminUsers } from './pages/adminUsers.js';
import { pageAdminCatalogue } from './pages/adminCatalogue.js';
import { pageAdminReports } from './pages/adminReports.js';
import { pageAdminAudit } from './pages/adminAudit.js';
import { pageDocs } from './pages/docs.js';
import { pageMyRequests } from './pages/myRequests.js';

// ---------- router ----------
let firstRender = true;
const routes = [
  [/^#\/login$/, pageLogin, null],
  [/^#\/search(?:\?(.*))?$/, pageCatalogue, ['*']],
  [/^#\/catalogue(?:\?(.*))?$/, pageCatalogue, ['*']],
  [/^#\/verification$/, pageVerification, ['Pharmacist']],
  [/^#\/inventory$/, pageInventory, ['Pharmacist', 'Pharmacy Staff']],
  [/^#\/reports$/, pageReports, ['Patient', 'Caregiver', 'Pharmacist', 'Pharmacy Staff', 'Administrator']],
  [/^#\/reminders$/, pageReminders, ['Patient', 'Caregiver']],
  [/^#\/my-requests$/, pageMyRequests, ['Patient', 'Caregiver', 'Pharmacist']],
  [/^#\/admin\/users$/, pageAdminUsers, ['Administrator']],
  [/^#\/admin\/catalogue$/, pageAdminCatalogue, ['Administrator']],
  [/^#\/admin\/reports$/, pageAdminReports, ['Administrator']],
  [/^#\/admin\/audit$/, pageAdminAudit, ['Administrator']],
  [/^#\/docs$/, pageDocs, ['*']],
];
export async function route() {
  const hash = location.hash || '#/search';
  if (!session.user && session.token) { try { session.user = (await api('/auth/me')).user; } catch { session.token = null; } }
  renderChrome();
  const hit = routes.map(([re, fn, roles]) => [hash.match(re), fn, roles]).find(([m]) => m);
  if (!hit) { location.hash = '#/search'; return; }
  const [m, fn, roles] = hit;
  if (roles && !session.user) { location.hash = '#/login'; return; }
  if (roles && !roles.includes('*') && !roles.includes(session.user.role)) { mount(h('div', { class: 'notice err' }, 'Your role does not have access to this page.')); return; }
  mount(empty('Loading…'));
  try { await fn(...m.slice(1)); } catch (e) { mount(h('div', { class: 'notice err' }, e.message)); }
  // move focus to the new content after navigating, but not on the very first render: there the first Tab must reach the skip link
  if (!firstRender) view.focus({ preventScroll: true });
  firstRender = false;
}

export function start() {
  window.addEventListener('hashchange', route);
  route();
}
