'use strict';
// Accessibility audit that runs INSIDE the page (via the DevTools protocol). Dependency-free; covers the WCAG 2.2 AA checks that can be
// decided mechanically: accessible names, labels, headings, landmarks, table names/headers, scrollable regions, target size,
// live regions, repeated ambiguous control names and colour contrast. It cannot judge meaning (e.g. whether a label is a good one).

/** WCAG relative luminance of an [r, g, b] colour (0-255). */
function relativeLuminance([r, g, b]) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** WCAG contrast ratio between two [r, g, b] colours (1 to 21). */
function contrastRatio(a, b) {
  const l1 = relativeLuminance(a), l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Everything below is stringified and evaluated in the page: it must not close over anything outside this function
// except relativeLuminance / contrastRatio, which are prepended to the evaluated source.
function auditInPage() {
  const problems = [];
  const add = (rule, el, detail) => {
    const id = el?.id ? `#${el.id}` : '';
    const cls = el?.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    problems.push(`${rule}: ${el ? `${el.tagName.toLowerCase()}${id}${cls}` : ''} ${detail || ''}`.trim());
  };
  const visible = (el) => {
    if (!el || el.closest('[hidden]') || el.closest('dialog:not([open])')) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && el.getClientRects().length > 0;
  };
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t; }
    if (el.labels && el.labels.length) { const t = [...el.labels].map((l) => l.textContent).join(' ').trim(); if (t) return t; }
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) return (el.value || '').trim();
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) { const t = (el.innerText || el.textContent || '').trim(); if (t) return t; }
    return (el.getAttribute('title') || '').trim();
  };

  const interactive = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])')].filter(visible);

  // 1. every interactive element has an accessible name (placeholder alone does not count)
  for (const el of interactive) if (!nameOf(el)) add('name', el, 'has no accessible name');

  // 2. repeated controls with an identical name are ambiguous out of context ("Edit", "Save price", ...)
  const seen = new Map();
  for (const el of interactive.filter((e) => ['BUTTON', 'A'].includes(e.tagName) && !e.closest('nav') && !e.classList.contains('skip'))) {
    const n = nameOf(el).toLowerCase(); if (!n) continue;
    seen.set(n, [...(seen.get(n) ?? []), el]);
  }
  for (const [n, els] of seen) if (els.length > 1) add('ambiguous-name', els[0], `"${n}" appears ${els.length} times; give each an accessible name that says what it acts on`);

  // 3. ids are unique
  const ids = new Map();
  for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  for (const [id, n] of ids) if (n > 1) add('duplicate-id', document.getElementById(id), `id "${id}" used ${n} times`);

  // 4. headings: one h1, no skipped levels
  const heads = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible);
  if (heads.filter((h) => h.tagName === 'H1').length !== 1) add('heading', null, `expected exactly one h1, found ${heads.filter((h) => h.tagName === 'H1').length}`);
  let prev = 0;
  for (const h of heads) { const lvl = Number(h.tagName[1]); if (prev && lvl > prev + 1) add('heading-order', h, `jumps from h${prev} to h${lvl}`); prev = lvl; }

  // 5. landmarks and document basics
  if (document.querySelectorAll('main').length !== 1) add('landmark', null, 'expected exactly one <main>');
  if (!document.documentElement.lang) add('lang', document.documentElement, 'missing lang');
  if (!document.title.trim()) add('title', null, 'empty document title');
  const topVisible = visible(document.querySelector('#top'));
  if (topVisible) {
    if (!document.querySelector('header')) add('landmark', null, 'missing <header>');
    const nav = document.querySelector('nav');
    if (!nav || !(nav.getAttribute('aria-label') || nav.getAttribute('aria-labelledby'))) add('landmark', nav, '<nav> needs an accessible name');
  }
  const skip = document.querySelector('.skip');
  if (!skip || !document.querySelector(skip.getAttribute('href'))) add('skip-link', skip, 'skip link missing or its target does not exist');

  // 6. tables: named, with header cells that declare their scope
  for (const t of [...document.querySelectorAll('table')].filter(visible)) {
    if (!(t.getAttribute('aria-label') || t.getAttribute('aria-labelledby') || t.querySelector('caption'))) add('table-name', t, 'table has no accessible name');
    for (const th of t.querySelectorAll('th')) if (!th.getAttribute('scope')) { add('table-scope', th, `header "${th.textContent.trim()}" has no scope`); break; }
  }

  // 7. scrollable regions can be reached with the keyboard
  for (const el of document.querySelectorAll('*')) {
    if (!visible(el) || el === document.body || el === document.documentElement) continue;
    const cs = getComputedStyle(el);
    if (['auto', 'scroll'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.tabIndex < 0
        && !el.querySelector('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])')) add('scrollable-region', el, 'scrolls sideways but cannot be focused');
  }

  // 8. target size (WCAG 2.2 AA 2.5.8: at least 24 x 24 CSS px, inline links in text excepted)
  for (const el of interactive) {
    if (el.classList.contains('skip') || (el.tagName === 'A' && el.closest('p, li'))) continue;
    const r = el.getBoundingClientRect();
    if (el.type === 'checkbox' || el.type === 'radio') continue; // native controls are sized by the browser; their label is the click target
    if (r.width < 24 || r.height < 24) add('target-size', el, `${Math.round(r.width)}x${Math.round(r.height)}px`);
  }

  // 9. live regions
  const toast = document.querySelector('#toast');
  if (!toast || !['status', 'alert'].includes(toast.getAttribute('role')) || !toast.getAttribute('aria-live') && toast.getAttribute('role') !== 'alert') add('live-region', toast, 'toast must be a status/alert live region');

  // 10. colour contrast of rendered text (computed colours, so dark mode and theme variables are included)
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { ctx2d.clearRect(0, 0, 1, 1); ctx2d.fillStyle = '#000'; ctx2d.fillStyle = c; ctx2d.fillRect(0, 0, 1, 1); const d = ctx2d.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => Math.round(top[i] * a + bottom[i] * (1 - a))).concat(1); };
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] === 1) break; } }
    let bg = [255, 255, 255, 1];
    if (!stack.length || stack[stack.length - 1][3] < 1) bg = rgba(getComputedStyle(document.documentElement).backgroundColor)[3] > 0 ? rgba(getComputedStyle(document.documentElement).backgroundColor) : [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i -= 1) bg = over(stack[i], bg);
    return bg;
  };
  const reported = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || !visible(el) || el.closest('script, style, noscript, [disabled], [aria-disabled=true]') || el.matches(':disabled')) continue;
    if (el.closest('.skip') ) continue; // off-screen until focused; styled separately
    const cs = getComputedStyle(el);
    const fg = over(rgba(cs.color), bgOf(el));
    const px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const ratio = contrastRatio(fg, bgOf(el));
    if (ratio < need) {
      const key = `${cs.color}|${bgOf(el).join(',')}|${el.tagName}.${el.className}`;
      if (!reported.has(key)) { reported.add(key); add('contrast', el, `${ratio.toFixed(2)}:1 (needs ${need}:1) "${n.nodeValue.trim().slice(0, 30)}" ${cs.color} on rgb(${bgOf(el).slice(0, 3).join(',')})`); }
    }
  }
  return problems;
}

const AUDIT_SOURCE = `${relativeLuminance.toString()}\n${contrastRatio.toString()}\n(${auditInPage.toString()})()`;

module.exports = { relativeLuminance, contrastRatio, AUDIT_SOURCE };
