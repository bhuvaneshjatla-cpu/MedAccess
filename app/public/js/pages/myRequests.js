/* The requester's own pharmacist-verification requests (AD-03 "pending review" feedback; gap G18). */
import { h, mount, money, when, verifBadge, empty, SAFETY } from '../ui.js';
import { api } from '../session.js';

export async function pageMyRequests() {
  const { comparisons } = await api('/my-comparisons');
  const counts = comparisons.reduce((m, c) => (m[c.comparison_status] = (m[c.comparison_status] ?? 0) + 1, m), {});
  const summary = h('div', { class: 'row' }, ['Pending Review', 'Under Pharmacist Review', 'Verified', 'Rejected'].map((s) => h('span', { class: 'row' }, verifBadge(s), h('strong', null, String(counts[s] ?? 0)))));
  const card = (c) => {
    const [a, b] = c.brands;
    const last = c.comments.at(-1);
    return h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('h2', { class: 'h3' }, `${a.brand_name}  ↔  ${b.brand_name}`), verifBadge(c.comparison_status)),
      h('p', { class: 'muted' }, `Shared generic: ${a.generic_name || '—'}`),
      h('p', { class: 'muted' }, `Demo prices (synthetic): ${money(a.lowest_demo_price)} vs ${money(b.lowest_demo_price)}`),
      h('p', { class: 'muted' }, `Requested ${when(c.created_at)}`, c.verifier_name ? ` · decided by ${c.verifier_name}, ${when(c.verification_date)}` : ' · waiting for a pharmacist'),
      last ? h('div', { class: 'notice' }, h('strong', null, 'Pharmacist comment: '), `${last.comment_text} — ${last.author}`) : null,
      ['Verified', 'Rejected'].includes(c.comparison_status) ? h('p', { class: 'muted' }, c.safety) : null);
  };
  mount(h('h1', null, 'My verification requests'),
    h('p', { class: 'sub' }, 'Comparisons you asked a pharmacist to check. The status updates here as soon as a pharmacist starts or finishes the review.'),
    h('div', { class: 'card' }, summary), SAFETY,
    ...(comparisons.length ? comparisons.map(card) : [empty('You have not requested any verification yet. Open a medicine in Search and use “Request pharmacist verification” on a potential match.')]));
}
