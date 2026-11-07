/* Shared UI helpers: DOM builder, formatting, toast, badges and small widgets. No application state lives here. */

export const $ = (s) => document.querySelector(s);
export const view = $('#view');

// ---------- helpers ----------
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
export const mount = (...nodes) => { view.replaceChildren(...nodes.flat()); };
export const money = (n, c = 'INR') => (n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: c }).format(n));
export const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export function ago(iso) {
  if (!iso) return 'unknown';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`; return `${Math.round(m / 1440)} d ago`;
}
export function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.setAttribute('role', err ? 'alert' : 'status'); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}
export async function act(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); return null; } }

export const AVAIL_CLASS = { Available: 'b-ok', 'Low Stock': 'b-warn', Unavailable: 'b-bad' };
export const availBadge = (s) => h('span', { class: `badge ${AVAIL_CLASS[s] || 'b-neutral'}` }, s);
export const VERIF = {
  'Informational Match': ['Informational match — not verified', 'b-info'],
  'Pending Review': ['Pending pharmacist review', 'b-warn'],
  'Under Pharmacist Review': ['Under pharmacist review', 'b-warn'],
  Verified: ['Pharmacist-verified', 'b-ok'],
  Rejected: ['Rejected by pharmacist', 'b-bad'],
};
export const verifBadge = (s) => { const [t, c] = VERIF[s] || [s, 'b-neutral']; return h('span', { class: `badge ${c}` }, t); };
export const SAFETY = h('div', { class: 'notice warn', role: 'note' },
  h('strong', null, 'Safety: '), 'A potential match requires confirmation from a doctor or pharmacist before purchase or substitution. A lower price alone does not mean a medicine is suitable.');
export const field = (label, input, id) => h('div', { class: 'field' }, h('label', { for: id }, label), input);
export const empty = (msg) => h('div', { class: 'empty' }, msg);
export const attrText = (v, basis) => (v ? `${v} (${basis})` : 'Not recorded');
export const originBadges = (it) => [
  it.origin === 'MedAccess' ? h('span', { class: 'badge b-info' }, 'Added by MedAccess') : null,
  it.hidden ? h('span', { class: 'badge b-bad' }, 'Hidden from users') : null,
];

// Move keyboard / screen-reader focus to the heading of freshly revealed content (detail panels, edit forms), so it is announced
// and the next Tab continues from there instead of from a button far above.
export function focusHeading(container) {
  const hd = container?.querySelector('h2, h1');
  if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: true }); }
}

// Re-render the current page after an action (the router listens for this event).
export const refresh = () => window.dispatchEvent(new Event('hashchange'));
