/* Accessible modal dialog built on the native <dialog> element: focus moves into it, Tab stays inside it, Esc cancels,
   the page behind is inert, and focus returns to whatever opened it. Replaces window.prompt(). */
import { h } from './ui.js';

let seq = 0;

/**
 * Ask for a line of text. Resolves with the (trimmed) text, or null when the user cancels.
 * @param {{title: string, label: string, description?: string, confirmLabel?: string, cancelLabel?: string, required?: boolean, maxlength?: number}} o
 */
export function askText({ title, label, description = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', required = true, maxlength = 1000 }) {
  return new Promise((resolve) => {
    const id = `dlg${++seq}`;
    const opener = document.activeElement;
    const area = h('textarea', { id: `${id}-t`, maxlength, rows: 4, 'aria-describedby': `${id}-d ${id}-e`, 'aria-required': required ? 'true' : false });
    const err = h('div', { id: `${id}-e`, class: 'notice err', role: 'alert', hidden: true });
    let dlg, result = null;
    const form = h('form', { method: 'dialog', class: 'stack', novalidate: true },
      h('h2', { id: `${id}-h` }, title),
      h('p', { id: `${id}-d`, class: 'muted' }, description),
      h('div', { class: 'field' }, h('label', { for: `${id}-t` }, label), area),
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'submit' }, confirmLabel),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => dlg.close() }, cancelLabel)));
    dlg = h('dialog', { class: 'dialog', 'aria-labelledby': `${id}-h` }, form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = area.value.trim();
      if (required && !value) { // keep the dialog open, say what is wrong, and put the cursor back where it can be fixed
        err.textContent = `${label} is required.`; err.hidden = false;
        area.setAttribute('aria-invalid', 'true'); area.focus();
        return;
      }
      result = value; dlg.close();
    });
    dlg.addEventListener('keydown', (e) => { // keep Tab cycling inside the dialog (WAI-ARIA modal dialog pattern)
      if (e.key !== 'Tab') return;
      const stops = [...dlg.querySelectorAll('textarea, input, select, button:not([disabled]), a[href]')].filter((x) => !x.closest('[hidden]'));
      const first = stops[0], last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      // the page behind may have been re-rendered while the dialog was open; fall back to the page content
      (opener && document.contains(opener) ? opener : document.querySelector('#view'))?.focus?.();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
  });
}
