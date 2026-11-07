/* Catalogue administration overlay and bulk pack-size import (UC-19). */
import { h, mount, toast, act, field, empty, originBadges, focusHeading } from '../ui.js';
import { api } from '../session.js';

// ---------- UC-19 catalogue administration (overlay on the read-only CDCI catalogue) ----------
export async function pageAdminCatalogue() {
  const FILTERS = [['changed', 'Changed by administrators'], ['hidden', 'Hidden'], ['annotated', 'Annotated'], ['custom', 'Added by MedAccess'], ['all', 'Search all brands']];
  const filter = h('select', { id: 'cf' }, FILTERS.map(([v, l]) => h('option', { value: v }, l)));
  const search = h('input', { id: 'cs', type: 'search', placeholder: 'Search by brand, generic or supplier' });
  const list = h('div'), editor = h('div');
  let offset = 0;
  const PAGE = 25;

  async function load(reset) {
    if (reset) offset = 0;
    try {
      const p = new URLSearchParams({ filter: filter.value, limit: PAGE, offset });
      if (search.value.trim()) p.set('search', search.value.trim());
      const d = await api(`/admin/catalogue?${p}`);
      list.replaceChildren(
        d.brands.length ? h('div', { class: 'table-wrap card' }, h('table', null,
          h('thead', null, h('tr', null, ['Brand', 'Generic · supplier', 'Status', ''].map((t) => h('th', null, t)))),
          h('tbody', null, d.brands.map((b) => h('tr', null,
            h('td', null, h('strong', null, b.brand_name), h('div', { class: 'muted' }, b.brand_identifier)),
            h('td', null, b.generic_name || '—', h('div', { class: 'muted' }, b.supplier_name || '')),
            h('td', null, h('div', { class: 'row' }, originBadges(b)), b.hidden_reason ? h('div', { class: 'muted' }, `Hidden: ${b.hidden_reason}`) : null, b.admin_note ? h('div', { class: 'muted' }, `Note: ${b.admin_note}`) : null, b.origin !== 'MedAccess' && b.attributes?.pack_size ? h('div', { class: 'muted' }, `Pack size: ${b.attributes.pack_size}`) : null),
            h('td', null, h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Edit ${b.brand_name}`, onclick: () => edit(b) }, 'Edit')))))))
          : empty(filter.value === 'changed' ? 'No brands have been hidden, annotated or added yet. Search to find a brand.' : 'No matching brands.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Previous page of brands', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - PAGE); load(false); } }, 'Previous'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': 'Next page of brands', disabled: !d.has_more, onclick: () => { offset += PAGE; load(false); } }, 'Next')));
    } catch (e) { list.replaceChildren(h('div', { class: 'notice err' }, e.message)); }
  }

  function edit(b) {
    const note = h('textarea', { id: 'en', maxlength: 500, placeholder: 'Note shown to users with this brand (leave empty to clear)', value: b.admin_note || '' });
    note.value = b.admin_note || '';
    const pack = h('input', { id: 'ep', maxlength: 60, placeholder: 'e.g. 10 tablets, 100 mL bottle (leave empty to clear)' }); pack.value = b.origin === 'MedAccess' ? '' : (b.attributes?.pack_size || '');
    const hide = h('input', { id: 'eh', type: 'checkbox' }); hide.checked = !!b.hidden;
    const reason = h('input', { id: 'er', maxlength: 300, placeholder: 'Reason for hiding (required)', value: b.hidden_reason || '' });
    const save = h('button', { class: 'btn', type: 'submit' }, 'Save');
    const form = h('form', { class: 'card stack' }, h('h2', null, `Edit: ${b.brand_name}`),
      h('p', { class: 'muted' }, b.origin === 'MedAccess' ? 'Added by MedAccess — you can edit all fields below or in the form further down.' : 'CDCI data cannot be changed. You can hide this brand from users and add a note.'),
      field('Catalogue note', note, 'en'), b.origin === 'MedAccess' ? null : field('Pack size (CDCI records none)', pack, 'ep'), h('label', null, hide, ' Hide from users (search and matches)'), field('Reason', reason, 'er'), save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await act(() => api(`/admin/catalogue/${encodeURIComponent(b.brand_identifier)}/overlay`, { method: 'PUT', body: { hidden: hide.checked, hidden_reason: reason.value, note: note.value, ...(b.origin === 'MedAccess' ? {} : { pack_size: pack.value }) } }), 'Saved')) { editor.replaceChildren(); load(false); }
    });
    editor.replaceChildren(form);
    if (b.origin === 'MedAccess') fillAdd(b);
    editor.scrollIntoView({ behavior: 'smooth' });
    focusHeading(editor);
  }

  // add / edit administrator-added brands (FR-08, FR-09)
  const keys = [['brand_name', 'Brand name'], ['active_ingredient', 'Active ingredient'], ['strength', 'Strength'], ['dosage_form', 'Dosage form'], ['pack_size', 'Pack size'], ['manufacturer', 'Manufacturer'], ['generic_identifier', 'CDCI generic identifier (optional, enables matches)']];
  const inputs = Object.fromEntries(keys.map(([k]) => [k, h('input', { id: `c_${k}`, maxlength: 120, required: k !== 'generic_identifier' })]));
  let editingId = null;
  const title = h('h2', null, 'Add a brand to the catalogue');
  const cancel = h('button', { class: 'btn ghost', type: 'button', hidden: true }, 'Cancel edit');
  const addForm = h('form', { class: 'card' }, title, h('div', { class: 'form-grid' }, keys.map(([k, l]) => field(l, inputs[k], `c_${k}`))),
    h('p', { class: 'muted' }, 'All fields except the generic identifier are required. Controlled and restricted medicines are outside the prototype scope. The CDCI catalogue itself is read-only.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Save brand'), cancel));
  function fillAdd(b) {
    editingId = b.brand_identifier; title.textContent = `Edit added brand ${b.brand_identifier}`; cancel.hidden = false;
    inputs.brand_name.value = b.brand_name; inputs.active_ingredient.value = (b.generic_name || '').replace(` ${b.strength} ${b.attributes?.dosage_form || ''}`, '');
    inputs.strength.value = b.attributes?.strength || ''; inputs.dosage_form.value = b.attributes?.dosage_form || ''; inputs.pack_size.value = b.attributes?.pack_size || '';
    inputs.manufacturer.value = b.supplier_name || ''; inputs.generic_identifier.value = '';
  }
  function resetAdd() { editingId = null; title.textContent = 'Add a brand to the catalogue'; cancel.hidden = true; for (const i of Object.values(inputs)) i.value = ''; }
  cancel.addEventListener('click', resetAdd);
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(keys.map(([k]) => [k, inputs[k].value]));
    const r = await act(() => api(editingId ? `/admin/catalogue/custom/${encodeURIComponent(editingId)}` : '/admin/catalogue/custom', { method: editingId ? 'PUT' : 'POST', body }), editingId ? 'Brand updated' : 'Brand added');
    if (r) { resetAdd(); filter.value = 'custom'; load(true); }
  });

  // ---- bulk pack-size import: choose a CSV, PREVIEW every row, then confirm ----
  function importCard() {
    let analysis = null;
    const area = h('textarea', { id: 'impcsv', rows: 5, placeholder: 'brand_identifier,pack_size\n1373771000189106,10 tablets' });
    const fileIn = h('input', { id: 'impfile', type: 'file', accept: '.csv,text/csv,text/plain' });
    const onlyProblems = h('input', { id: 'impprob', type: 'checkbox' });
    const reviewed = h('input', { id: 'impok', type: 'checkbox' });
    const out = h('div');
    const download = (name, text) => {
      const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }));
      const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const reset = () => { analysis = null; out.replaceChildren(); };
    area.addEventListener('input', reset); // an edited file must be previewed again

    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      if (f.size > 2_000_000) { toast('That file is larger than 2 MB', true); fileIn.value = ''; return; }
      area.value = await f.text(); reset();
    });

    function render() {
      if (!analysis) return;
      const a = analysis, t = a.totals;
      if (a.fatal) { out.replaceChildren(h('div', { class: 'notice err', role: 'alert' }, a.fatal)); return; }
      const rows = a.rows.filter((r) => !onlyProblems.checked || r.errors.length || r.warnings.length);
      const shown = rows.slice(0, 200);
      const cls = { add: 'b-ok', update: 'b-info', unchanged: 'b-neutral', invalid: 'b-bad' };
      const label = { add: 'New', update: 'Changes value', unchanged: 'No change', invalid: 'Rejected' };
      const actionable = t.add + t.update;
      const go = h('button', { class: 'btn', type: 'button', disabled: true, onclick: async () => {
        const r = await act(() => api('/admin/catalogue/pack-size-import', { method: 'POST', body: { csv: area.value, fingerprint: a.fingerprint } }));
        if (r) { toast(`Imported ${r.imported} pack size${r.imported === 1 ? '' : 's'} (${r.added} new, ${r.updated} changed); ${r.skipped_invalid} rejected rows skipped`); area.value = ''; fileIn.value = ''; reviewed.checked = false; reset(); load(false); }
      } }, `Save ${actionable} change${actionable === 1 ? '' : 's'}`);
      reviewed.checked = false; reviewed.onchange = () => { go.disabled = !reviewed.checked || actionable === 0; };
      out.replaceChildren(...[
        h('div', { class: 'row' }, [['New', t.add, 'b-ok'], ['Changes value', t.update, 'b-info'], ['No change', t.unchanged, 'b-neutral'], ['Rejected', t.invalid, 'b-bad'], ['With warnings', t.warnings, 'b-warn']]
          .map(([l, n, c]) => h('span', { class: `badge ${c}` }, `${l}: ${n}`))),
        a.ignored_columns.length ? h('p', { class: 'muted' }, `Ignored columns: ${a.ignored_columns.join(', ')}`) : null,
        h('label', null, onlyProblems, ' Show only rows with errors or warnings'),
        h('div', { class: 'table-wrap' }, h('table', null,
          h('thead', null, h('tr', null, ['Line', 'Brand', 'Pack size now → new', 'Result', 'Notes'].map((x) => h('th', null, x)))),
          h('tbody', null, shown.map((r) => h('tr', null, h('td', null, String(r.line)), h('td', null, h('strong', null, r.brand_name || '—'), h('div', { class: 'muted' }, r.brand_identifier)),
            h('td', null, `${r.current ?? 'not recorded'} → ${r.new ?? '—'}`), h('td', null, h('span', { class: `badge ${cls[r.action]}` }, label[r.action])),
            h('td', null, [...r.errors.map((e) => h('div', null, `✖ ${e}`)), ...r.warnings.map((w) => h('div', { class: 'muted' }, `⚠ ${w}`))])))))),
        rows.length > shown.length ? h('p', { class: 'muted' }, `Showing the first ${shown.length} of ${rows.length} rows. All rows are checked and imported.`) : null,
        t.invalid ? h('div', { class: 'notice warn' }, `${t.invalid} rejected row${t.invalid === 1 ? '' : 's'} will be skipped; the others can still be saved.`) : null,
        actionable ? h('div', { class: 'stack' }, h('label', null, reviewed, ' I have reviewed this preview'), go)
          : h('div', { class: 'notice' }, 'Nothing to save: there are no new or changed pack sizes in valid rows.')].filter(Boolean));
      onlyProblems.onchange = () => { const keep = reviewed.checked; render(); reviewed.checked = keep; reviewed.onchange(); };
    }

    const previewBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!area.value.trim()) { toast('Choose a file or paste CSV text first', true); return; }
      const r = await act(() => api('/admin/catalogue/pack-size-import/preview', { method: 'POST', body: { csv: area.value } }));
      if (r) { analysis = r; render(); }
    } }, 'Preview');
    const missingOnly = h('input', { id: 'impmiss', type: 'checkbox' }); missingOnly.checked = true;
    const exportBtn = h('button', { class: 'btn small ghost', type: 'button', onclick: async () => {
      const q2 = new URLSearchParams({ search: search.value.trim() }); if (missingOnly.checked) q2.set('missing', '1');
      const r = await act(() => api(`/admin/catalogue/pack-size-export?${q2}`));
      if (r) { download('pack-sizes.csv', r.csv); toast(`${r.count} brand${r.count === 1 ? '' : 's'} exported${r.truncated ? ' (first 2,000 only; narrow the search)' : ''}`); }
    } }, 'Export brands matching the search above');
    return h('div', { class: 'card stack' }, h('h2', null, 'Bulk import pack sizes (CSV)'),
      h('p', { class: 'muted' }, 'CDCI records no pack size. Upload a CSV with the columns brand_identifier and pack_size. Every row is checked in a preview first; nothing is saved until you confirm. Rows cannot clear a value, and administrator-added brands are edited on the brand itself.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => download('pack-size-template.csv', 'brand_identifier,pack_size\r\n1373771000189106,10 tablets\r\n') }, 'Download template'),
        exportBtn, h('label', null, missingOnly, ' only brands without a pack size')),
      field('CSV file', fileIn, 'impfile'), field('…or paste CSV text', area, 'impcsv'), h('div', { class: 'row' }, previewBtn), out);
  }

  const controls = h('form', { class: 'card form-grid' }, field('Show', filter, 'cf'), field('Search', search, 'cs'), h('div', null, h('label', null, '\u00a0'), h('button', { class: 'btn', type: 'submit' }, 'Apply')));
  controls.addEventListener('submit', (e) => { e.preventDefault(); load(true); });
  mount(h('h1', null, 'Catalogue administration'),
    h('p', { class: 'sub' }, 'The CDCI catalogue is read-only. Administrators can hide brands from users, annotate them, and add brands that CDCI does not list. Every change is audited.'),
    controls, list, editor, importCard(), addForm);
  await load(true);
}
