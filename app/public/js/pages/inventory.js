/* Pharmacy stock and price updates (UC-12, UC-13). */
import { h, mount, toast, field, empty, focusHeading } from '../ui.js';
import { api } from '../session.js';
import { availabilityPanel } from './availabilityPanel.js';

// ---------- UC-12 / UC-13 inventory (CDCI brand + pharmacy) ----------
export async function pageInventory() {
  const q = h('input', { id: 'iq', type: 'search', placeholder: 'Search the CDCI catalogue (brand, generic or supplier)' });
  const results = h('div', { class: 'grid' }), panel = h('div');
  const form = h('form', { class: 'card' }, field('Medicine', q, 'iq'), h('button', { class: 'btn', type: 'submit' }, 'Find'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); panel.replaceChildren();
    if (q.value.trim().length < 2) { results.replaceChildren(h('div', { class: 'notice' }, 'Enter at least two characters.')); return; }
    const rs = await api(`/catalogue?search=${encodeURIComponent(q.value.trim())}&limit=24`).catch((x) => { toast(x.message, true); return { results: [] }; });
    results.replaceChildren(...(rs.results.length ? rs.results.map((m) => h('button', { class: 'card', type: 'button', onclick: () => {
      panel.replaceChildren(h('h2', null, m.brand_name), h('p', { class: 'muted' }, `${m.generic_name || ''} · ${m.supplier_name || ''}`), availabilityPanel(m));
      panel.scrollIntoView({ behavior: 'smooth' });
      focusHeading(panel);
    } }, h('strong', { class: 'card-title' }, m.brand_name), h('div', { class: 'muted' }, m.generic_name || ''))) : [empty('No catalogue entries found')]));
  });
  mount(h('h1', null, 'Update stock and prices'), h('p', { class: 'sub' }, 'Pick a CDCI brand, then update availability and price per pharmacy. Each change records who made it and when, and is written to the audit log. Updates are stored by MedAccess; the synthetic seed data is never overwritten.'), form, results, panel);
}
