'use strict';
// Derives strength (and ingredient labels) from a CDCI generic description such as
//   "Chlorpheniramine maleate 4 mg and Acetaminophen 500 mg oral tablet"
//   "Ambroxol hydrochloride 30 mg/5 mL and Guaifenesin 50 mg/5 mL oral syrup"
// CDCI has no structured strength column, so this is a best-effort parse of free text: results are labelled
// "parsed from name" in the API/UI and must never be treated as verified (BR-01/BR-02). Pack size is not parsed:
// CDCI carries none, so it stays "not recorded".

const UNIT = '(?:million[ ]+units?|milligrams?|micrograms?|nanograms?|microliters?|milliliters?|mcg|mg|ng|kg|g|mmol|meq|miu|iu|units?|mbq|gbq|kbq|mci|ml|l|%)';
const DENOM = '(?:[0-9][0-9.,]*[ ]*)?(?:ml|l|g|mg|dose|actuation|puff|hour|vial|ampoule|unit|tablet|capsule|drop|sachet)';
// number + unit [+ "/" + optional number + denominator]; not preceded by a letter/digit/dot (e.g. "B12", "1.05" tails)
const STRENGTH = new RegExp(`(?<![A-Za-z0-9.])([0-9][0-9]*(?:[.,][0-9]+)?[ ]*${UNIT}(?:[ ]*/[ ]*${DENOM})?)(?![A-Za-z])`, 'gi');

function cleanIngredient(text) {
  return text.replace(/^[ ,]*(?:and|\+)[ ]+/i, '').replace(/[ ,]+$/, '').trim();
}

/**
 * @param {string} genericName  CDCI generic description
 * @returns {{strength: string|null, ingredients: string|null, components: {ingredient: string, strength: string}[]}}
 */
function parseGenericName(genericName) {
  const text = String(genericName || '');
  const components = [];
  let cursor = 0;
  for (const m of text.matchAll(STRENGTH)) {
    const ingredient = cleanIngredient(text.slice(cursor, m.index));
    components.push({ ingredient, strength: m[1].replace(/[ ]+/g, ' ').replace(/ ?\/ ?/g, '/') });
    cursor = m.index + m[0].length;
  }
  if (!components.length) return { strength: null, ingredients: null, components: [] };
  const named = components.every((c) => c.ingredient);
  return {
    strength: components.map((c) => c.strength).join(' + '),
    ingredients: named ? components.map((c) => c.ingredient).join(' + ') : null,
    components,
  };
}

// Filtering support. A strength like "30 mg/5 mL + 50 mg/5 mL" becomes " 30mg/5ml 50mg/5ml n:30 n:50 ", so a filter can match a
// whole component ("30mg/5ml") or just its number ("30" matches n:30 but never "300mg" or "130mg").
const NUM = /^[0-9][0-9]*(?:[.,][0-9]+)?/;
const squash = (p) => p.toLowerCase().split(' ').join('').trim();
function strengthTokens(strength) {
  const parts = String(strength || '').split('+').map(squash).filter(Boolean);
  const nums = parts.map((p) => (p.match(NUM) || [null])[0]).filter(Boolean).map((n) => `n:${n.replace(',', '.')}`);
  return ` ${[...parts, ...nums].join(' ')} `;
}
/** needles that must ALL appear in strengthTokens(); a bare number matches the numeric part of a component */
function strengthNeedles(term) {
  return String(term || '').split('+').map(squash).filter(Boolean)
    .map((p) => (/^[0-9][0-9]*(?:[.,][0-9]+)?$/.test(p) ? ` n:${p.replace(',', '.')} ` : ` ${p} `));
}

module.exports = { parseGenericName, strengthTokens, strengthNeedles };
