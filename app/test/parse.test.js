'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGenericName } = require('../server/cdciParse');

const cases = [
  ['Cefpodoxime 200 mg film-coated oral tablet', '200 mg', 'Cefpodoxime'],
  ['Chlorpheniramine maleate 4 mg and Acetaminophen 500 mg and Phenylephrine hydrochloride 10 mg oral tablet', '4 mg + 500 mg + 10 mg', 'Chlorpheniramine maleate + Acetaminophen + Phenylephrine hydrochloride'],
  ['Ambroxol hydrochloride 30 mg/5 mL and Guaifenesin 50 mg/5 mL oral syrup', '30 mg/5 mL + 50 mg/5 mL', 'Ambroxol hydrochloride + Guaifenesin'],
  ['Sodium chloride 4.5 mg/1 mL solution for injection', '4.5 mg/1 mL', 'Sodium chloride'],
  ['Tazarotene 500 microgram/mL cutaneous cream', '500 microgram/mL', 'Tazarotene'],
  ['Acyclovir (as acyclovir sodium) 25 mg/mL solution for infusion', '25 mg/mL', 'Acyclovir (as acyclovir sodium)'],
  ['Asparaginase 10000 unit powder for solution for injection vial', '10000 unit', 'Asparaginase'],
  ['Interferon alfa-2b 1 million unit powder for solution for injection vial', '1 million unit', 'Interferon alfa-2b'],
  ['Empagliflozin 12.5 mg and metformin hydrochloride 1 g oral tablet', '12.5 mg + 1 g', 'Empagliflozin + metformin hydrochloride'],
  ['Vitamin B12 500 microgram oral tablet', '500 microgram', 'Vitamin B12'], // digit inside the name is not a strength
];

for (const [input, strength, ingredients] of cases) {
  test(`parses strength from "${input.slice(0, 50)}"`, () => {
    const p = parseGenericName(input);
    assert.equal(p.strength, strength);
    assert.equal(p.ingredients, ingredients);
  });
}

test('returns nulls (never guesses) when no strength is present', () => {
  assert.deepEqual(parseGenericName('Oral rehydration salts'), { strength: null, ingredients: null, components: [] });
  assert.equal(parseGenericName(null).strength, null);
  assert.equal(parseGenericName('').strength, null);
});
