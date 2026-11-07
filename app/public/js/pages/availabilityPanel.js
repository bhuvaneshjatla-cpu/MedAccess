/* Per-brand availability, price, report and reminder panel (shared by the catalogue and Inventory pages). All data is SYNTHETIC. */
import { h, money, ago, act, availBadge, field, empty } from '../ui.js';
import { session, api } from '../session.js';

// ---------- brand-keyed availability, price, report and reminder panel ----------
// All data is SYNTHETIC. Seeded rows come from the read-only demo inventory; staff edits are stored by MedAccess and merged on top.
export function availabilityPanel(it, opts) {
  const root = h('div');
  const role = session.user.role;
  const canEdit = ['Pharmacist', 'Pharmacy Staff'].includes(role);
  const canReport = ['Patient', 'Caregiver', 'Pharmacist', 'Pharmacy Staff'].includes(role);
  const canRemind = ['Patient', 'Caregiver'].includes(role);
  const bid = encodeURIComponent(it.brand_identifier);

  async function load() {
    root.replaceChildren(empty('Loading availability…'));
    try {
      const [d, ph] = await Promise.all([api(`/catalogue/${bid}/availability`), api('/pharmacies')]);
      const listed = new Set(d.availability.map((r) => r.pharmacy_id));
      const rows = d.availability.map((r) => availRow(r));
      const addable = ph.pharmacies.filter((p) => !listed.has(p.pharmacy_id));
      const addSel = h('select', { 'aria-label': 'Pharmacy to add' }, addable.map((p) => h('option', { value: p.pharmacy_id }, `${p.pharmacy_name} — ${p.city}`)));
      root.replaceChildren(...[ // null slots (role-dependent widgets) must be dropped: replaceChildren(null) renders the text "null"
        h('div', { class: 'notice warn', role: 'note' }, h('strong', null, d.data_label), '. Fictional pharmacies, quantities, prices and times. Never use for real purchasing or treatment decisions.'),
        d.count ? h('div', { class: 'table-wrap card' }, h('table', null,
          h('thead', null, h('tr', null, ['Pharmacy', 'Availability', 'Indicative price', canEdit ? 'Update' : ''].map((t) => h('th', null, t)))), h('tbody', null, rows)))
          : h('div', { class: 'notice' }, 'No pharmacy has reported this brand yet.'),
        h('p', { class: 'muted' }, 'Strength, dosage form and pack size for this brand are shown above with their source. Pack size is entered by administrators (CDCI records none); price per unit is shown only when it is known.'),
        canEdit && addable.length ? h('div', { class: 'card row' }, h('strong', null, 'Add a pharmacy:'), addSel,
          h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
            if (await act(() => api('/availability', { method: 'PUT', body: { brand_identifier: it.brand_identifier, pharmacy_id: addSel.value, availability_status: 'Available' } }), 'Pharmacy added as Available')) load();
          } }, 'Add as Available')) : null,
        canReport ? reportForm(ph.pharmacies) : null,
        canRemind ? reminderForm() : null].filter(Boolean));
    } catch (e) { root.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
  }

  function availRow(r) {
    const stamp = (at, who, src, stale) => h('div', { class: 'muted' }, `Updated ${ago(at)}${who ? ` by ${who}` : ''} (${src || 'unknown source'}) `,
      stale ? h('span', { class: 'badge b-stale', title: 'Older than 7 days; may be out of date' }, 'Possibly out of date') : null);
    const cells = [
      h('td', null, h('strong', null, r.pharmacy_name), h('div', { class: 'muted' }, r.area || '')),
      h('td', null, r.availability_status ? availBadge(r.availability_status) : h('span', { class: 'muted' }, 'Not reported'), r.status_updated_at ? stamp(r.status_updated_at, r.status_updated_by, r.status_source, r.status_stale) : null),
      h('td', null, r.price_inr != null ? h('span', { class: 'price' }, money(r.price_inr, r.currency)) : h('span', { class: 'muted' }, 'Not reported'), r.price_per_unit != null ? h('div', { class: 'muted' }, `≈ ${money(r.price_per_unit, r.currency)} per unit`) : null, r.price_updated_at ? stamp(r.price_updated_at, r.price_updated_by, r.price_source, r.price_stale) : null),
    ];
    if (canEdit) {
      const st = h('select', { 'aria-label': `Availability at ${r.pharmacy_name}` }, ['Available', 'Low Stock', 'Unavailable'].map((x) => h('option', null, x)));
      if (r.availability_status) st.value = r.availability_status;
      const amt = h('input', { type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', 'aria-label': `Price at ${r.pharmacy_name}`, value: r.price_inr ?? '' });
      cells.push(h('td', null, h('div', { class: 'stack' }, h('div', { class: 'row' }, st, h('button', { class: 'btn small', type: 'button', 'aria-label': `Save stock for ${r.pharmacy_name}`, onclick: async () => {
        if (await act(() => api('/availability', { method: 'PUT', body: { brand_identifier: it.brand_identifier, pharmacy_id: r.pharmacy_id, availability_status: st.value } }), 'Stock updated')) load();
      } }, 'Save stock')), h('div', { class: 'row' }, amt, h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Save price for ${r.pharmacy_name}`, onclick: async () => {
        if (await act(() => api('/prices', { method: 'PUT', body: { brand_identifier: it.brand_identifier, pharmacy_id: r.pharmacy_id, amount: amt.value } }), 'Price updated')) load();
      } }, 'Save price')))));
    }
    return h('tr', null, cells);
  }

  function reportForm(pharmacies) {
    const ph = h('select', { id: 'rph' }, pharmacies.map((p) => h('option', { value: p.pharmacy_id }, `${p.pharmacy_name} — ${p.city}`)));
    const type = h('select', { id: 'rty' }, ['Incorrect Price', 'Incorrect Availability', 'Other'].map((t) => h('option', null, t)));
    const desc = h('textarea', { id: 'rde', maxlength: 1000, placeholder: 'What looks wrong? (no personal health details)' });
    const form = h('form', { class: 'stack' }, field('Pharmacy', ph, 'rph'), field('Issue type', type, 'rty'), field('Details (optional)', desc, 'rde'), h('button', { class: 'btn', type: 'submit' }, 'Submit report'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await act(() => api('/reports', { method: 'POST', body: { brand_identifier: it.brand_identifier, pharmacy_id: ph.value, report_type: type.value, description: desc.value } }), 'Report submitted — thank you')) desc.value = '';
    });
    return h('details', { class: 'card' }, h('summary', null, 'Report a problem with this price or availability'), form);
  }

  function reminderForm() {
    const dt = h('input', { id: 'rdt', type: 'datetime-local', required: true });
    const rec = h('select', { id: 'rrec' }, ['None', 'Daily', 'Weekly', 'Monthly'].map((r) => h('option', null, r)));
    const form = h('form', { class: 'stack' }, h('div', { class: 'form-grid' }, field('Remind me on', dt, 'rdt'), field('Repeat', rec, 'rrec')), h('button', { class: 'btn', type: 'submit' }, 'Create reminder'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await act(() => api('/reminders', { method: 'POST', body: { brand_identifier: it.brand_identifier, reminder_date_time: new Date(dt.value).toISOString(), recurrence: rec.value } }), 'Reminder created — see Reminders')) form.reset();
    });
    return h('details', { class: 'card' }, h('summary', null, 'Create a refill reminder for this brand'), form);
  }

  load();
  return root;
}
