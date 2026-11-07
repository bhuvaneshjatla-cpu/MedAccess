'use strict';
// Catalogue-brand helpers shared by several components: how a brand row is described (attributes and their sources),
// pack-size arithmetic, the search filter, and the "brand or 404" lookup.
const { strengthNeedles } = require('./cdciParse');

module.exports = function createBrands(k) {
  const { ref, route, ApiError, bad, str, requireRef } = k;

  // Dosage form comes from CDCI's structured drug-form master; strength is parsed from the generic name text
  // (unverified); CDCI carries no pack size, so it is reported as not recorded rather than guessed.
  const attributesOf = (strength, dosageForm, row) => {
    const custom = row?.origin === 'MedAccess';
    return {
      strength: strength ?? null, strength_basis: custom ? 'entered by administrator' : (strength ? 'parsed from CDCI generic name (unverified)' : 'not recorded'),
      dosage_form: dosageForm ?? null, dosage_form_basis: custom ? 'entered by administrator' : (dosageForm ? 'CDCI drug-form master' : 'not recorded'),
      pack_size: row?.pack_size ?? null, pack_size_basis: row?.pack_size ? 'entered by administrator' : (custom ? 'not recorded' : 'not recorded (CDCI has no pack size)'),
    };
  };
  // "10 tablets" -> 10; used only for an approximate price per unit, and only when an administrator entered the pack size
  const unitsIn = (pack) => { const n = parseInt(pack, 10); return Number.isFinite(n) && n > 0 ? n : null; };
  const perUnit = (price, pack) => { const n = unitsIn(pack); return price != null && n ? Math.round((price / n) * 100) / 100 : null; };
  const packDiff = (a, b) => (!a || !b ? 'unknown (not recorded)' : a.trim().toLowerCase() === b.trim().toLowerCase() ? `same (${a})` : `differs (${a} vs ${b})`);
  const productId = (v) => { const id = str(v, 100); if (!id) throw bad('A CDCI product identifier is required'); return id; };

  // Shared by the search route and the administrator export. A known ingredient name also finds its synonyms
  // (paracetamol <-> acetaminophen); see config/ingredient-synonyms.json.
  function catalogueFilter(query, isAdmin) {
    const text = str(query.get('search'), 100).toLowerCase(), ingredient = str(query.get('ingredient'), 100).toLowerCase(),
      strength = str(query.get('strength'), 60), form = str(query.get('form'), 60).toLowerCase();
    const where = ['(hidden = 0 OR ?)'], args = [isAdmin ? 1 : 0];
    const anyOf = (col, term) => { const names = ref.synonyms.expand(term); args.push(...names); return `(${names.map(() => `instr(${col}, ?) > 0`).join(' OR ')})`; };
    if (text.length >= 2) where.push(anyOf('hay', text));
    if (ingredient.length >= 2) where.push(anyOf('ingredients', ingredient));
    if (form.length >= 2) { where.push('instr(lower(dosage_form), ?) > 0'); args.push(form); }
    for (const n of strengthNeedles(strength)) { where.push('instr(strength_tokens, ?) > 0'); args.push(n); }
    return { where, args, hasCriteria: where.length > 1 };
  }

  const brandOr404 = (id) => {
    const b = requireRef(ref.search, 'CDCI catalogue').brandById(productId(id));
    if (!b) throw new ApiError(404, 'Unknown CDCI brand identifier');
    return b;
  };
  const brandSummary = (b) => ({
    brand_identifier: b.brand_identifier, brand_name: b.brand_name, product_name: b.product_name, supplier_name: b.supplier_name,
    generic_identifier: b.generic_identifier, generic_name: b.generic_name, origin: b.origin ?? 'CDCI', hidden: !!b.hidden, admin_note: b.admin_note ?? null, attributes: attributesOf(b.strength, b.dosage_form, b),
  });

  return { attributesOf, unitsIn, perUnit, packDiff, productId, catalogueFilter, brandOr404, brandSummary };
};
