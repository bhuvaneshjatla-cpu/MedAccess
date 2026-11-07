/* Refill reminders (UC-16, UC-17). */
import { h, mount, when, toast, act, field, empty, refresh } from '../ui.js';
import { api } from '../session.js';

// ---------- UC-16 / UC-17 reminders ----------
export async function pageReminders() {
  const { reminders } = await api('/reminders');
  const q = h('input', { id: 'rm', type: 'search', placeholder: 'Search the CDCI catalogue by brand or generic' });
  const sel = h('select', { id: 'rsel' }, h('option', { value: '' }, 'Search above, then choose…'));
  const dt = h('input', { id: 'rdt', type: 'datetime-local', required: true });
  const rec = h('select', { id: 'rrec' }, ['None', 'Daily', 'Weekly', 'Monthly'].map((r) => h('option', null, r)));
  q.addEventListener('input', async () => {
    if (q.value.trim().length < 2) return;
    const { results } = await api(`/catalogue?search=${encodeURIComponent(q.value.trim())}&limit=25`).catch(() => ({ results: [] }));
    sel.replaceChildren(...results.map((m) => h('option', { value: m.brand_identifier }, m.brand_name)));
  });
  const form = h('form', { class: 'card' }, h('h2', null, 'New refill reminder'), field('Medicine', q, 'rm'), field('Choose medicine', sel, 'rsel'),
    h('div', { class: 'form-grid' }, field('Remind me on', dt, 'rdt'), field('Repeat', rec, 'rrec')), h('button', { class: 'btn', type: 'submit' }, 'Create reminder'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sel.value) return toast('Choose a medicine first', true);
    if (await act(() => api('/reminders', { method: 'POST', body: { brand_identifier: sel.value, reminder_date_time: new Date(dt.value).toISOString(), recurrence: rec.value } }), 'Reminder created')) refresh();
  });
  const cls = { Scheduled: 'b-info', Triggered: 'b-warn', Completed: 'b-ok', Cancelled: 'b-neutral' };
  // SD-07 modify: an inline editor for date/time and repeat; saving puts the reminder back to Scheduled
  const local = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  function editor(r, card) {
    const id = `ed${r.reminder_id}`;
    const edt = h('input', { id: `${id}dt`, type: 'datetime-local', required: true, value: local(r.reminder_date_time) });
    const erec = h('select', { id: `${id}rec` }, ['None', 'Daily', 'Weekly', 'Monthly'].map((x) => h('option', { selected: x === r.recurrence }, x)));
    const f = h('form', { class: 'card stack', 'aria-label': `Edit reminder: ${r.brand_name}` }, h('h2', { class: 'h3' }, `Edit reminder — ${r.brand_name}`),
      h('div', { class: 'form-grid' }, field('Remind me on', edt, `${id}dt`), field('Repeat', erec, `${id}rec`)),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save changes'), h('button', { class: 'btn ghost', type: 'button', onclick: () => f.replaceWith(card) }, 'Discard')));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await act(() => api(`/reminders/${r.reminder_id}`, { method: 'PUT', body: { reminder_date_time: new Date(edt.value).toISOString(), recurrence: erec.value } }), 'Reminder updated')) refresh();
    });
    card.replaceWith(f); edt.focus();
  }
  const list = reminders.length ? reminders.map((r) => { const card = h('div', { class: 'card row between' },
    h('div', null, h('h2', { class: 'h3' }, r.brand_name), h('div', { class: 'muted' }, `${when(r.reminder_date_time)}${r.recurrence !== 'None' ? ` · repeats ${r.recurrence.toLowerCase()}` : ''}`)),
    h('div', { class: 'row' }, h('span', { class: `badge ${cls[r.status]}` }, r.status === 'Triggered' ? 'Due now' : r.status),
      ['Scheduled', 'Triggered'].includes(r.status) ? [
        h('button', { class: 'btn small', type: 'button', 'aria-label': `Mark done: ${r.brand_name}`, onclick: async () => { if (await act(() => api(`/reminders/${r.reminder_id}/complete`, { method: 'POST' }), r.recurrence === 'None' ? 'Marked done' : 'Done — next reminder scheduled')) refresh(); } }, 'Mark done'),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Edit reminder: ${r.brand_name}`, onclick: () => editor(r, card) }, 'Edit'),
        h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Cancel reminder: ${r.brand_name}`, onclick: async () => { if (await act(() => api(`/reminders/${r.reminder_id}/cancel`, { method: 'POST' }), 'Reminder cancelled')) refresh(); } }, 'Cancel')] : null)); return card; })
    : [empty('No reminders yet.')];
  mount(h('h1', null, 'Refill reminders'), h('p', { class: 'sub' }, 'Reminders show here when they are due. Notifications by SMS or email are not part of this prototype.'), form, h('h2', null, 'Your reminders'), ...list);
}
