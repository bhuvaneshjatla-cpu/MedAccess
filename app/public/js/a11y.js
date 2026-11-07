/* Accessibility enhancer. Pages are built from plain DOM nodes, so this adds what is easier to guarantee in one place than in every
   page: names and header scopes for data tables, keyboard access to tables that scroll sideways, and one title per screen. */
import { view } from './ui.js';

const PREFIX = 'data-a11y-added';

// text of the closest heading that comes before `el` inside the same card / panel (or the page)
function headingBefore(el) {
  const scope = el.closest('.card, details, dialog') || view;
  let best = null;
  for (const hd of scope.querySelectorAll('h1, h2, h3')) if (hd.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = hd;
  return best ? best.textContent.trim() : '';
}

export function enhance() {
  for (const t of view.querySelectorAll('table')) {
    const cols = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim()).filter(Boolean);
    if (!t.hasAttribute('aria-label') && !t.hasAttribute('aria-labelledby') && !t.querySelector('caption')) {
      const head = headingBefore(t);
      t.setAttribute('aria-label', `${head ? `${head} — ` : ''}${cols.join(', ') || 'data'}`);
      t.setAttribute(PREFIX, '');
    }
    for (const th of t.querySelectorAll('th')) if (!th.hasAttribute('scope')) th.setAttribute('scope', th.closest('thead') ? 'col' : 'row');
  }
  // a table that scrolls sideways must be reachable and scrollable from the keyboard (WCAG 2.1.1)
  for (const w of view.querySelectorAll('.table-wrap')) {
    const scrolls = w.scrollWidth > w.clientWidth + 1;
    const added = w.hasAttribute(PREFIX);
    if (scrolls && !added) {
      w.setAttribute('tabindex', '0'); w.setAttribute('role', 'region'); w.setAttribute(PREFIX, '');
      w.setAttribute('aria-label', w.querySelector('table')?.getAttribute('aria-label') || 'Table');
    } else if (!scrolls && added) {
      w.removeAttribute('tabindex'); w.removeAttribute('role'); w.removeAttribute('aria-label'); w.removeAttribute(PREFIX);
    }
  }
  const h1 = view.querySelector('h1')?.textContent.trim();
  document.title = h1 ? `${h1} — MedAccess` : 'MedAccess';
}

export function installA11y() {
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; enhance(); }); } };
  // childList only: the enhancer changes attributes, so it can never trigger itself
  new MutationObserver(schedule).observe(view, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  schedule();
}
