/* Incorrect-information reports (UC-14, UC-15). */
import { h, mount, when, act, empty, refresh } from '../ui.js';
import { askText } from '../dialog.js';
import { api } from '../session.js';

// ---------- UC-14 / UC-15 reports ----------
export async function pageReports() {
  const { reports, can_review } = await api('/reports');
  const list = h('div');
  async function act2(r, action, needNote) {
    let note = '';
    if (needNote) { // an accessible dialog instead of window.prompt()
      note = await askText({
        title: `${action === 'resolve' ? 'Resolve' : 'Reject'} report #${r.report_id}`, label: 'Resolution note',
        description: `${r.brand_name} at ${r.pharmacy_name}. The note is recorded with your name and the time.`,
        confirmLabel: action === 'resolve' ? 'Resolve report' : 'Reject report',
      });
      if (note === null) return;
    }
    if (await act(() => api(`/reports/${r.report_id}/${action}`, { method: 'POST', body: { note } }), 'Report updated')) refresh();
  }
  list.append(...(reports.length ? reports.map((r) => h('div', { class: 'card stack' },
    h('div', { class: 'row between' }, h('h2', { class: 'h3' }, `#${r.report_id} · ${r.report_type}`), h('span', { class: `badge ${r.status === 'Resolved' ? 'b-ok' : r.status === 'Rejected' ? 'b-bad' : 'b-warn'}` }, r.status)),
    h('div', null, `${r.brand_name} at ${r.pharmacy_name}`), r.description ? h('p', null, r.description) : null,
    h('div', { class: 'muted' }, `Reported by ${r.reporter_name} on ${when(r.created_at)}`),
    r.resolution_note ? h('div', { class: 'notice' }, `Resolution: ${r.resolution_note} — ${r.resolver_name}, ${when(r.resolved_at)}`) : null,
    can_review ? h('div', { class: 'row' },
      r.status === 'Submitted' ? h('button', { class: 'btn small', type: 'button', 'aria-label': `Start review of report #${r.report_id}`, onclick: () => act2(r, 'review') }, 'Start review') : null,
      r.status === 'Under Review' ? h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Investigate report #${r.report_id}`, onclick: () => act2(r, 'investigate') }, 'Investigate') : null,
      r.status === 'Investigating' ? [h('button', { class: 'btn small', type: 'button', 'aria-label': `Resolve report #${r.report_id}`, onclick: () => act2(r, 'resolve', true) }, 'Resolve'),
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Reject report #${r.report_id}`, onclick: () => act2(r, 'reject', true) }, 'Reject')] : null) : null))
    : [empty(can_review ? 'No reports yet.' : 'You have not submitted any reports. Use “Report a problem” on a medicine page.')]));
  mount(h('h1', null, can_review ? 'Incorrect-information reports' : 'My reports'),
    h('p', { class: 'sub' }, can_review ? 'Review and resolve user reports. Each resolution is audited.' : 'Reports you have submitted and their status.'), list);
}
