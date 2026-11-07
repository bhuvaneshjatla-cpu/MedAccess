/* Medicine catalogue: search with filters, brand detail, availability, potential matches. */
import { h, mount, money, act, verifBadge, SAFETY, field, empty, attrText, originBadges, focusHeading } from '../ui.js';
import { session, api } from '../session.js';
import { availabilityPanel } from './availabilityPanel.js';

export async function pageCatalogue(qs) {
  const params = new URLSearchParams(qs || '');
  const PAGE = 25;
  let offset = Number(params.get('offset')) || 0;
  const q = h('input', { id: 'cq', type: 'search', placeholder: 'e.g. paracetamol, cetirizine, a brand or supplier', value: params.get('search') || '' });
  const fIng = h('input', { id: 'cing', placeholder: 'e.g. paracetamol', value: params.get('ingredient') || '' });
  const fStr = h('input', { id: 'cstr', placeholder: 'e.g. 500 or 500 mg', value: params.get('strength') || '' });
  const fForm = h('input', { id: 'cfrm', placeholder: 'e.g. tablet, syrup, injection', value: params.get('form') || '' });
  const out = h('div'), detail = h('div');
  const canInventory = session.user.role !== 'Doctor';

  async function run(resetOffset) {
    if (resetOffset) offset = 0;
    const crit = new URLSearchParams();
    if (q.value.trim().length >= 2) crit.set('search', q.value.trim());
    if (fIng.value.trim().length >= 2) crit.set('ingredient', fIng.value.trim());
    if (fStr.value.trim()) crit.set('strength', fStr.value.trim());
    if (fForm.value.trim().length >= 2) crit.set('form', fForm.value.trim());
    detail.replaceChildren();
    if (![...crit.keys()].length) { out.replaceChildren(h('div', { class: 'notice' }, 'Enter a medicine name, or an active ingredient, strength or dosage form, to search.')); return; }
    history.replaceState(null, '', `#/catalogue?${crit}&offset=${offset}`);
    out.replaceChildren(empty('Searching…'));
    try {
      const r = await api(`/catalogue?${crit}&limit=${PAGE}&offset=${offset}`);
      out.replaceChildren(
        h('p', { class: 'muted', 'aria-live': 'polite' }, r.results.length ? `Showing ${offset + 1}–${offset + r.results.length}` : 'No results'),
        r.results.length ? h('div', { class: 'grid' }, r.results.map((it) => h('button', { class: 'card', type: 'button', onclick: () => select(it) },
          h('strong', { class: 'card-title' }, it.brand_name || it.product_name), h('div', { class: 'muted' }, it.generic_name || ''), h('div', { class: 'muted' }, it.supplier_name || ''),
          h('div', { class: 'row' }, originBadges(it)), it.admin_note ? h('div', { class: 'muted' }, `Note: ${it.admin_note}`) : null))) : empty('No catalogue entries match.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Previous page of results', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - PAGE); run(false); } }, 'Previous'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Next page of results', disabled: !r.has_more, onclick: () => { offset += PAGE; run(false); } }, 'Next')));
    } catch (e) { out.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
  }

  async function select(it) {
    const a = it.attributes || {};
    const rows = [['Brand', it.brand_name], ['Product', it.product_name], ['Generic description', it.generic_name], ['Supplier / manufacturer', it.supplier_name],
      ['Strength', attrText(a.strength, a.strength_basis || 'unverified')], ['Dosage form', attrText(a.dosage_form, a.dosage_form_basis || 'unverified')], ['Pack size', attrText(a.pack_size, a.pack_size_basis || '')],
      ['Brand identifier', it.brand_identifier], ['Generic identifier', it.generic_identifier]];
    const box = h('div', { class: 'card stack' }, h('h2', null, it.brand_name || it.product_name), h('div', { class: 'row' }, originBadges(it)),
      h('dl', { class: 'attrs' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v || '—')])),
      it.admin_note ? h('div', { class: 'notice warn' }, h('strong', null, 'Catalogue note: '), it.admin_note) : null,
      h('div', { class: 'notice' }, `Source: ${it.source}. Reference terminology only — not stock, not a price, and not evidence that products are interchangeable. Ask a pharmacist before substituting.`));
    const inv = h('div'), matchesBox = h('div');
    const canMatches = ['Patient', 'Caregiver', 'Pharmacist', 'Doctor'].includes(session.user.role);
    const canRequest = ['Patient', 'Caregiver', 'Pharmacist'].includes(session.user.role);
    detail.replaceChildren(box, inv, ...(canMatches ? [matchesBox] : []));
    detail.scrollIntoView({ behavior: 'smooth' });
    focusHeading(box);
    if (canInventory) inv.replaceChildren(availabilityPanel(it));
    if (canMatches) renderMatches(0);

    async function renderMatches(off) {
      try {
        const d = await api(`/catalogue/${encodeURIComponent(it.brand_identifier)}/matches?limit=10&offset=${off}`);
        const price = (v) => (v == null ? 'No demo price' : money(v));
        matchesBox.replaceChildren(h('div', { class: 'card stack' },
          h('h2', { class: 'h3' }, 'Potential matches — same CDCI generic'),
          SAFETY.cloneNode(true),
          h('p', { class: 'muted' }, `${d.basis} ${d.total} other brand${d.total === 1 ? '' : 's'} found. Each is informational until a pharmacist verifies it.`),
          d.matches.length ? h('div', { class: 'table-wrap' }, h('table', null,
            h('thead', null, h('tr', null, ['Brand', 'Supplier', 'What differs', 'Demo price', 'Verification', ''].map((t) => h('th', null, t)))),
            h('tbody', null, d.matches.map((m) => h('tr', null,
              h('td', null, h('strong', null, m.brand_name), h('div', { class: 'row' }, originBadges(m)), m.admin_note ? h('div', { class: 'muted' }, `Note: ${m.admin_note}`) : null),
              h('td', null, m.supplier_name || '—'),
              h('td', null, [m.differences.brand ? 'Different brand' : 'Same brand', m.differences.supplier ? 'different supplier' : 'same supplier', `pack size ${m.differences.pack_size}`].join(' · ')),
              h('td', null, price(m.lowest_demo_price), m.lowest_demo_price != null ? h('div', { class: 'muted' }, m.lowest_price_per_unit != null ? `≈ ${money(m.lowest_price_per_unit)} per unit · synthetic` : 'synthetic; pack size needed to compare') : null),
              h('td', null, verifBadge(m.status)),
              h('td', null, canRequest && ['Informational Match', 'Rejected'].includes(m.status) ? h('button', { class: 'btn small', type: 'button', 'aria-label': `Request pharmacist verification for ${m.brand_name}`, onclick: async () => {
                if (await act(() => api('/cdci-comparisons', { method: 'POST', body: { brand_identifier: it.brand_identifier, match_brand_identifier: m.brand_identifier } }), 'Verification requested')) renderMatches(off);
              } }, 'Request pharmacist verification') : null))))))
            : empty('No other catalogue brand shares this generic identifier.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Previous matches', disabled: off === 0, onclick: () => renderMatches(Math.max(0, off - 10)) }, 'Previous'),
            h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Next matches', disabled: !d.has_more, onclick: () => renderMatches(off + 10) }, 'Next'))));
      } catch (e) { matchesBox.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
    }
  }

  const hasFilter = !!(params.get('ingredient') || params.get('strength') || params.get('form'));
  const form = h('form', { class: 'card' }, field('Search the medicine catalogue', q, 'cq'),
    h('details', { open: hasFilter }, h('summary', null, 'Filter by active ingredient, strength or dosage form'),
      h('div', { class: 'form-grid' }, field('Active ingredient', fIng, 'cing'), field('Strength', fStr, 'cstr'), field('Dosage form', fForm, 'cfrm'))),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Search'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { q.value = fIng.value = fStr.value = fForm.value = ''; out.replaceChildren(); detail.replaceChildren(); history.replaceState(null, '', '#/catalogue'); } }, 'Clear')));
  form.addEventListener('submit', (e) => { e.preventDefault(); run(true); });
  mount(h('h1', null, 'Medicine catalogue'), h('p', { class: 'sub' }, 'National reference codes for brands, products and generics (NRCeS Common Drug Codes for India), plus brands added by MedAccess administrators. Names and identifiers only.'), form, out, detail);
  if (params.get('search') || params.get('ingredient') || params.get('strength') || params.get('form')) run(false);
}
