/* Audit log (UC-21). */
import { h, mount, when, field, empty } from '../ui.js';
import { api } from '../session.js';

// ---------- UC-21 audit ----------
export async function pageAdminAudit() {
  const action = h('input', { id: 'af', placeholder: 'e.g. PRICE, LOGIN, REPORT' });
  const result = h('select', { id: 'ar' }, ['', 'Success', 'Failure'].map((s) => h('option', { value: s }, s || 'Any result')));
  const out = h('div', { class: 'table-wrap card' });
  async function load() {
    const { entries } = await api(`/admin/audit?action=${encodeURIComponent(action.value)}&result=${result.value}&limit=200`);
    out.replaceChildren(entries.length ? h('table', null, h('thead', null, h('tr', null, ['Time', 'Actor', 'Action', 'Result', 'Record', 'Details'].map((t) => h('th', null, t)))),
      h('tbody', null, entries.map((e) => h('tr', null, h('td', null, when(e.timestamp)), h('td', null, e.actor_name || 'System / anonymous'), h('td', null, e.action),
        h('td', null, h('span', { class: `badge ${e.result === 'Success' ? 'b-ok' : 'b-bad'}` }, e.result)), h('td', null, e.affected_record || '—'),
        h('td', null, e.details ? h('pre', { class: 'detail' }, e.details) : '—'))))) : empty('No matching audit events.'));
  }
  const form = h('form', { class: 'card form-grid' }, field('Action contains', action, 'af'), field('Result', result, 'ar'), h('div', null, h('label', null, ' '), h('button', { class: 'btn', type: 'submit' }, 'Filter')));
  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  mount(h('h1', null, 'Audit log'), h('p', { class: 'sub' }, 'Account, catalogue, stock, price, verification and report-resolution actions, with actor and time.'), form, out);
  await load();
}
