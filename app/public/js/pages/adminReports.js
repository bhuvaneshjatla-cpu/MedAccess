/* Administrative reports and restricted-medicine review (UC-20). */
import { h, mount, when } from '../ui.js';
import { api } from '../session.js';

// ---------- UC-20 admin reports ----------
export async function pageAdminReports() {
  const r = await api('/admin/reports');
  const total = (arr) => arr.reduce((s, x) => s + x.count, 0) || 1;
  const block = (title, arr, label = 'status') => h('div', { class: 'card' }, h('h2', { class: 'h3' }, title),
    arr.length ? arr.map((x) => h('div', { class: 'stack' }, h('div', { class: 'row between' }, h('span', null, x[label]), h('strong', null, x.count)), h('div', { class: 'bar' }, h('span', { style: false, 'data-w': Math.round((x.count / total(arr)) * 100) })))) : h('p', { class: 'muted' }, 'No data'));
  const grid = h('div', { class: 'grid' },
    block('Users by role', r.users_by_role, 'role'), block('Users by status', r.users_by_status), block('Reported availability', r.availability_by_status),
    block('Comparisons', r.comparisons_by_status), block('Incorrect-information reports', r.reports_by_status), block('Refill reminders', r.reminders_by_status),
    h('div', { class: 'card' }, h('h2', { class: 'h3' }, 'Catalogue overlay'), h('p', null, `${r.catalogue.hidden} hidden · ${r.catalogue.annotated} annotated · ${r.catalogue.added} added by MedAccess`)),
    h('div', { class: 'card' }, h('h2', { class: 'h3' }, `Data older than ${r.stale_records.threshold_days} days`), h('p', null, `${r.stale_records.availability} availability records · ${r.stale_records.prices} price records`)));
  grid.querySelectorAll('.bar > span').forEach((s) => { s.style.width = `${s.dataset.w}%`; }); // CSSOM is CSP-safe
  // BR-07 review aid: what the restricted-medicines list currently removes from the catalogue
  const rs = await api('/admin/restricted');
  const review = h('div', { class: 'card stack' }, h('h2', null, 'Restricted medicines (excluded from the catalogue)'),
    h('div', { class: 'notice warn' }, h('strong', null, `${rs.excluded_brands.toLocaleString()} brands excluded. `), `List ${rs.version} — ${rs.status}`),
    h('p', { class: 'muted' }, rs.description),
    h('details', null, h('summary', null, 'Show the list and how many brands each entry removes'),
      h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Substance', 'Group', 'Brands excluded', 'Note'].map((t) => h('th', null, t)))),
        h('tbody', null, [...rs.rules, ...rs.classifications.map((c) => ({ name: `Classification: ${c.value}`, group: 'CDCI classification', excluded_brands: c.excluded_brands, note: c.note }))]
          .map((x) => h('tr', null, h('td', null, x.name), h('td', null, x.group), h('td', null, String(x.excluded_brands)), h('td', null, x.note || '')))))),
      h('p', { class: 'muted' }, 'Not included, pending review: ' + rs.not_included_pending_review.join('; ')),
      h('p', { class: 'muted' }, 'To change the list, edit app/config/restricted-medicines.json and restart the server.')));
  mount(h('h1', null, 'Administrative reports'), h('p', { class: 'sub' }, `Generated ${when(r.generated_at)}`), grid, review);
}
