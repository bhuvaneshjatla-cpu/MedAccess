'use strict';
// Validation for the administrator's bulk pack-size import (CSV: brand_identifier, pack_size).
// Pure function: it looks nothing up itself, so the same code serves the preview and the commit and is easy to test.
const crypto = require('node:crypto');
const { parseCsv, detectDelimiter } = require('./csv');

const MAX_ROWS = 5000;
const MAX_PACK = 60;
const HEADER_ALIASES = {
  brand_identifier: ['brand_identifier', 'brand identifier', 'brand_id', 'brand id', 'identifier'],
  pack_size: ['pack_size', 'pack size', 'pack', 'packsize'],
};
const norm = (s) => String(s ?? '').trim().toLowerCase();

/**
 * @param {string} csvText
 * @param {{brandById: (id: string) => ({brand_name: string, origin?: string, hidden?: number, pack_size?: string|null})|null}} ctx
 * @returns analysis with: fingerprint, delimiter, fatal (string|null), ignored_columns, rows[], totals
 */
function analyzePackSizeCsv(csvText, ctx) {
  const text = String(csvText ?? '');
  const fingerprint = crypto.createHash('sha256').update(text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')).digest('hex');
  const base = { fingerprint, delimiter: ',', fatal: null, ignored_columns: [], rows: [], totals: { rows: 0, add: 0, update: 0, unchanged: 0, invalid: 0, warnings: 0 } };
  if (!text.trim()) return { ...base, fatal: 'The file is empty.' };

  const delimiter = detectDelimiter(text);
  const parsed = parseCsv(text, delimiter);
  if (parsed.error) return { ...base, delimiter, fatal: parsed.error };
  if (parsed.rows.length < 2) return { ...base, delimiter, fatal: 'The file needs a header row and at least one data row.' };

  const header = parsed.rows[0].map(norm);
  const col = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) col[key] = header.findIndex((h) => aliases.includes(h));
  const missing = Object.keys(col).filter((k) => col[k] < 0);
  const ignored = parsed.rows[0].filter((_, i) => i !== col.brand_identifier && i !== col.pack_size).map((h) => h.trim()).filter(Boolean);
  if (missing.length) return { ...base, delimiter, ignored_columns: ignored, fatal: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected a header row with brand_identifier and pack_size.` };
  if (parsed.rows.length - 1 > MAX_ROWS) return { ...base, delimiter, ignored_columns: ignored, fatal: `Too many rows (${parsed.rows.length - 1}); the limit is ${MAX_ROWS} per file.` };

  const seen = new Map(); // brand_identifier -> first line
  const rows = parsed.rows.slice(1).map((cells, i) => {
    const line = parsed.lines[i + 1];
    const id = String(cells[col.brand_identifier] ?? '').trim();
    const pack = String(cells[col.pack_size] ?? '').trim().replace(/\s+/g, ' ');
    const errors = [], warnings = [];
    let brand = null;

    if (!id) errors.push('brand_identifier is empty');
    else {
      brand = ctx.brandById(id);
      if (!brand) errors.push('Not in the catalogue (unknown identifier, or a restricted medicine that is excluded)');
      else if (brand.origin === 'MedAccess') errors.push('Administrator-added brand: edit the brand itself to change its pack size');
      if (seen.has(id)) errors.push(`Duplicate of line ${seen.get(id)}`);
      else seen.set(id, line);
    }

    if (!pack) errors.push('pack_size is empty (rows cannot clear a value; clear it on the brand)');
    else {
      if (pack.length > MAX_PACK) errors.push(`pack_size is longer than ${MAX_PACK} characters`);
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(pack)) errors.push('pack_size contains control characters');
      if (/^[=+\-@]/.test(pack)) errors.push('pack_size must not start with = + - or @ (looks like a spreadsheet formula)');
      if (!errors.length) {
        if (/^[0-9][0-9.,]*$/.test(pack)) warnings.push('No unit after the number (e.g. "10 tablets")');
        else if (!/^[0-9]/.test(pack)) warnings.push('No leading count, so no price per unit will be shown');
      }
    }
    if (brand?.hidden) warnings.push('This brand is hidden from users');

    const current = brand?.pack_size ?? null;
    let action = 'invalid';
    if (!errors.length) action = current == null ? 'add' : current.trim().toLowerCase() === pack.toLowerCase() ? 'unchanged' : 'update';
    return { line, brand_identifier: id, brand_name: brand?.brand_name ?? null, current, new: pack || null, action, errors, warnings };
  });

  const totals = { rows: rows.length, add: 0, update: 0, unchanged: 0, invalid: 0, warnings: 0 };
  for (const r of rows) { totals[r.action] += 1; if (r.warnings.length) totals.warnings += 1; }
  return { ...base, delimiter, ignored_columns: ignored, rows, totals };
}

module.exports = { analyzePackSizeCsv, MAX_ROWS, MAX_PACK };
