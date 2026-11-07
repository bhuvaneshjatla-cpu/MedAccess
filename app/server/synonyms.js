'use strict';
// Reviewable ingredient synonyms (config/ingredient-synonyms.json). A search convenience only, so a missing or invalid file
// is not fatal: the app logs a warning and searches without synonyms (unlike the restricted-medicine list, which fails closed).
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', 'config', 'ingredient-synonyms.json');

function loadSynonyms(source) {
  let raw = { groups: [] };
  try {
    raw = typeof source === 'object' && source !== null ? source : JSON.parse(fs.readFileSync(source || process.env.MEDACCESS_SYNONYMS || DEFAULT_FILE, 'utf8'));
  } catch (e) {
    console.warn(`Ingredient synonyms not loaded (${e.message}); searching without them.`);
  }
  const groups = (raw.groups || []).map((g) => [...new Set(g.map((n) => String(n).toLowerCase().trim()).filter(Boolean))]).filter((g) => g.length > 1);
  const byName = new Map();
  for (const g of groups) for (const n of g) byName.set(n, g);
  return {
    version: raw.version ?? 'none', status: raw.status ?? '', groups,
    /** all names to search for when the whole term is one known name; otherwise just the term itself */
    expand: (term) => { const t = String(term || '').toLowerCase().trim(); return byName.get(t) ?? [t]; },
  };
}

module.exports = { loadSynonyms };
