/* Project documentation map. */
import { h, mount } from '../ui.js';
import { api } from '../session.js';

// ---------- project docs ----------
export async function pageDocs() {
  const meta = await api('/meta');
  const tbl = (heads, rows) => h('div', { class: 'table-wrap card' }, h('table', null, h('thead', null, h('tr', null, heads.map((t) => h('th', null, t)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
  mount(h('h1', null, 'Project documentation map'), h('p', { class: 'sub' }, 'How this prototype traces to the SRS and the StarUML models in docs/.'),
    h('h2', null, 'Use cases → screens and API'), tbl(['ID', 'Use case', 'Actors (UML)', 'SRS', 'Screen', 'API'], meta.use_cases.map((u) => [u.id, u.name, u.actors, u.frs, u.screen, u.api])),
    h('h2', null, 'State machines implemented'), tbl(['ID', 'Name', 'States'], meta.state_machines.map((s) => [s.id, s.name, s.states])),
    h('h2', null, 'Business rules'), tbl(['ID', 'Rule'], meta.business_rules),
    h('h2', null, 'Source diagrams'), tbl(['Diagram', 'File'], meta.diagrams.map((d) => [d.name, d.file])));
}
