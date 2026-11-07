'use strict';
// Reviewable list of controlled / restricted medicines (SRS BR-07, SC-07). The list lives in config/restricted-medicines.json
// so a pharmacist can read and edit it; it is applied when the catalogue search index is built.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FILE = path.join(__dirname, '..', 'config', 'restricted-medicines.json');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// whole-word, case-insensitive: "morphine" matches "Morphine sulfate" but not "hydromorphone"
const wordRe = (names) => new RegExp(`(?<![a-z0-9])(?:${names.map(escapeRe).join('|')})(?![a-z0-9])`, 'i');

/**
 * @param {string|object} [source] path to a JSON file, or an already-parsed list object
 * Fails closed: an unreadable or invalid list throws, so the server never starts with the exclusion silently off.
 */
function loadRestrictedList(source) {
  let raw;
  try {
    raw = typeof source === 'object' && source !== null ? source : JSON.parse(fs.readFileSync(source || process.env.MEDACCESS_RESTRICTED_LIST || DEFAULT_FILE, 'utf8'));
  } catch (e) {
    throw new Error(`Restricted-medicines list could not be loaded (${e.message}). Refusing to start without it.`);
  }
  const names = (raw.ingredients || []).map((i) => String(i.name || '').trim().toLowerCase()).filter(Boolean);
  if (!names.length) throw new Error('Restricted-medicines list is empty or invalid. Refusing to start without it.');
  const classes = new Set((raw.classifications || []).map((c) => String(c.value || '').trim().toLowerCase()).filter(Boolean));
  const any = wordRe(names);
  const each = names.map((n) => [n, wordRe([n])]);

  /** names of every list entry found in the given text (empty array = not restricted by name) */
  const matches = (...texts) => {
    const text = texts.filter(Boolean).join(' ');
    if (!any.test(text)) return [];
    return each.filter(([, re]) => re.test(text)).map(([n]) => n);
  };
  /** @returns {string[]} reasons this catalogue row is restricted (ingredient names and/or classification) */
  const reasons = ({ generic_name, product_name, brand_name, classification }) => {
    const r = matches(generic_name, product_name, brand_name);
    if (classification && classes.has(String(classification).trim().toLowerCase())) r.push(`classification:${String(classification).trim()}`);
    return r;
  };
  return {
    version: raw.version ?? 'unversioned', status: raw.status ?? 'unknown', description: raw.description ?? '',
    ingredients: raw.ingredients, classifications: raw.classifications ?? [], notIncluded: raw.not_included_pending_review ?? [],
    matches, reasons,
  };
}

module.exports = { loadRestrictedList, DEFAULT_FILE };
