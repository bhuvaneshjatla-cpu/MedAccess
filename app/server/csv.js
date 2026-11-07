'use strict';
// Small RFC 4180 CSV reader/writer (no dependencies). Handles quoted fields containing delimiters, quotes ("") and line breaks,
// CRLF / LF / CR line endings and a UTF-8 byte-order mark.

/** Pick the delimiter (comma, semicolon or tab) that splits the header line into the most columns. */
function detectDelimiter(text) {
  const header = text.replace(/^﻿/, '').split(/\r\n|\n|\r/, 1)[0] ?? '';
  let best = ',', bestCount = 0;
  for (const d of [',', ';', '\t']) {
    const n = header.split(d).length - 1;
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

/**
 * @returns {{rows: string[][], lines: number[], error: string|null}}
 *   rows  - one array of fields per record, entirely blank records are dropped
 *   lines - the 1-based physical line on which each returned record starts (for error messages)
 *   error - set when a quoted field is never closed
 */
function parseCsv(input, delimiter = ',') {
  const text = String(input ?? '').replace(/^﻿/, '');
  const rows = [], lines = [];
  let row = [], field = '', inQuotes = false, line = 1, startLine = 1, wasQuoted = false;
  const endField = () => { row.push(field); field = ''; wasQuoted = false; };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim() !== '')) { rows.push(row); lines.push(startLine); }
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else { if (c === '\n') line += 1; field += c; }
    } else if (c === '"' && field === '' && !wasQuoted) { inQuotes = true; wasQuoted = true; }
    else if (c === delimiter) endField();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRow(); line += 1; startLine = line;
    } else field += c;
  }
  if (inQuotes) return { rows, lines, error: `A quoted field that starts on line ${startLine} is never closed` };
  if (field !== '' || row.length) endRow();
  return { rows, lines, error: null };
}

/** One CSV cell. Quotes when needed, and defuses spreadsheet formulas (= + - @) by prefixing an apostrophe. */
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows) => `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

module.exports = { parseCsv, detectDelimiter, toCsv, csvCell };
