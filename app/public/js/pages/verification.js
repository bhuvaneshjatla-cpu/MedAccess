/* Pharmacist verification queue (UC-08..UC-11). */
import { h, mount, money, when, toast, act, verifBadge, field, empty, attrText } from '../ui.js';
import { api } from '../session.js';

// ---------- UC-08..11 pharmacist verification ----------
export async function pageVerification() {
  const filter = h('select', { id: 'vf' }, ['', 'Pending Review', 'Under Pharmacist Review', 'Verified', 'Rejected'].map((s2) => h('option', { value: s2 }, s2 || 'All statuses')));
  filter.value = 'Pending Review';
  const clist = h('div');
  async function loadCdci() {
    const { comparisons } = await api(`/cdci-comparisons${filter.value ? `?status=${encodeURIComponent(filter.value)}` : ''}`);
    clist.replaceChildren(...(comparisons.length ? comparisons.map(cdciCard) : [empty('No comparisons with this status.')]));
  }
  function cdciCard(c) {
    const [a, b] = c.brands;
    const note = h('textarea', { 'aria-label': `Review comment for comparison #${c.comparison_id} (optional)`, maxlength: 1000, placeholder: 'Review comment (optional)' });
    const run = (path, ok, withNote) => async () => { if (await act(() => api(`/cdci-comparisons/${c.comparison_id}/${path}`, { method: 'POST', body: withNote ? { comment: note.value } : {} }), ok)) { if (path === 'open') filter.value = 'Under Pharmacist Review'; loadCdci(); } };
    const row = (label, f) => h('tr', null, h('td', null, label), h('td', null, f(a)), h('td', null, f(b)));
    const attr = (k) => (x) => attrText(x.attributes?.[k], x.attributes?.[`${k}_basis`] || '');
    return h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', { class: 'h3' }, `Comparison #${c.comparison_id}`), verifBadge(c.comparison_status)),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Attribute', a.brand_name, b.brand_name].map((t) => h('th', null, t)))),
        h('tbody', null, row('Generic (shared)', (x) => x.generic_name || '—'), row('Strength', attr('strength')), row('Dosage form', attr('dosage_form')),
          row('Pack size', attr('pack_size')), row('Supplier', (x) => x.supplier_name || '—'), row('Demo price (synthetic)', (x) => (x.lowest_demo_price == null ? '—' : money(x.lowest_demo_price)))))),
      h('div', { class: 'notice' }, 'Check that the strength, form and pack size are right and that the supplier is acceptable before verifying. ' + c.safety),
      h('p', { class: 'muted' }, `Requested ${when(c.created_at)}`, c.verifier_name ? ` · Decided by ${c.verifier_name} on ${when(c.verification_date)}` : ''),
      c.comments.length ? h('ul', null, c.comments.map((x) => h('li', null, `${x.comment_text} — ${x.author}, ${when(x.created_at)}`))) : null,
      c.comparison_status === 'Pending Review' ? h('button', { class: 'btn', type: 'button', 'aria-label': `Start review of comparison #${c.comparison_id}`, onclick: run('open', 'Review started') }, 'Start review') : null,
      c.comparison_status === 'Under Pharmacist Review' ? [note, h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', 'aria-label': `Verify comparison #${c.comparison_id}`, onclick: run('verify', 'Marked pharmacist-verified', true) }, 'Verify comparison'),
        h('button', { class: 'btn danger', type: 'button', 'aria-label': `Reject comparison #${c.comparison_id}`, onclick: run('reject', 'Comparison rejected', true) }, 'Reject comparison'),
        h('button', { class: 'btn ghost', type: 'button', 'aria-label': `Add comment only to comparison #${c.comparison_id}`, onclick: async () => {
          if (!note.value.trim()) return toast('Enter a comment first', true);
          if (await act(() => api(`/cdci-comparisons/${c.comparison_id}/comments`, { method: 'POST', body: { text: note.value } }), 'Comment added')) loadCdci();
        } }, 'Add comment only'))] : null);
  }
  filter.addEventListener('change', loadCdci);
  mount(h('h1', null, 'Pharmacist verification'), h('p', { class: 'sub' }, 'Verification is an explicit pharmacist decision. Your name and the time are recorded.'),
    h('div', { class: 'card' }, field('Show', filter, 'vf')), clist);
  await loadCdci();
}
