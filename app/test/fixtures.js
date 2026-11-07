'use strict';
// Small fixture databases standing in for the real CDCI catalogue and the synthetic Inventory V2,
// so tests never depend on the large files in ../database.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function makeFixtures(dir) {
  const cdciFile = path.join(dir, 'cdci.db'), invFile = path.join(dir, 'inv.db');

  const c = new DatabaseSync(cdciFile);
  c.exec('CREATE TABLE catalogue_search(brand_identifier, brand_name, product_identifier, product_name, generic_identifier, generic_name, supplier_identifier, supplier_name);');
  const ins = c.prepare('INSERT INTO catalogue_search VALUES (?,?,?,?,?,?,?,?)');
  for (let i = 1; i <= 30; i++) ins.run(`B${i}`, `Fixtamol ${i}`, `P${i}`, 'Paracetamol', 'G1', 'Paracetamol 500 mg oral tablet', 'S1', 'Test Supplier');
  ins.run('B99', '100% Pure Brand', 'P99', 'Odd', 'G2', 'Odd generic', 'S2', 'Odd Supplier');
  // restricted-medicine fixtures (BR-07): none of these may ever be reachable
  ins.run('B90', 'Painfix 50', 'P90', 'Painfix', 'G9', 'Tramadol hydrochloride 50 mg oral capsule', 'S1', 'Test Supplier');
  ins.run('B91', 'CodePara', 'P91', 'CodePara', 'G10', 'Codeine phosphate 30 mg and paracetamol 500 mg oral tablet', 'S1', 'Test Supplier'); // combination product
  ins.run('B92', 'Hydrosoft', 'P92', 'Hydrosoft', 'G11', 'Hydromorphone hydrochloride 2 mg oral tablet', 'S1', 'Test Supplier');
  ins.run('B93', 'Calmwell', 'P93', 'Calmwell', 'G12', 'ALPRAZOLAM 0.25 mg oral tablet', 'S1', 'Test Supplier'); // upper case
  ins.run('B95', 'Xfix', 'P95', 'Xfix', 'G14', 'Foobarine 5 mg oral tablet', 'S1', 'Test Supplier'); // excluded by CDCI classification (Schedule X), not by name
  ins.run('B96', 'Coughease', 'P96', 'Coughease', 'G15', 'Ambroxol hydrochloride 30 mg/5 mL and Guaifenesin 50 mg/5 mL oral syrup', 'S1', 'Test Supplier'); // combination, per-volume strengths
  ins.run('B97', 'Feverfix 650', 'P97', 'Feverfix', 'G16', 'Acetaminophen 650 mg oral tablet', 'S1', 'Test Supplier'); // CDCI uses the US name for paracetamol
  ins.run('B94', 'Allerfix 10', 'P94', 'Allerfix', 'G13', 'Cetirizine 10 mg oral tablet', 'S1', 'Test Supplier'); // not restricted
  c.exec(`CREATE TABLE generic_master("Identifier", "Dose Form", "Classification of Drugs"); CREATE TABLE drug_form_master("Id", "Dose Form");
    INSERT INTO generic_master VALUES ('G1','F1',''), ('G13','F1','Schedule H'), ('G14','F1','Schedule X'), ('G15','F2',''), ('G16','F1',''); INSERT INTO drug_form_master VALUES ('F1','Oral tablet'), ('F2','Oral solution');`);
  c.close();

  const v = new DatabaseSync(invFile);
  v.exec(`CREATE TABLE pharmacies(pharmacy_id, pharmacy_name, locality, city, district, state);
    INSERT INTO pharmacies VALUES ('PH1','Demo Pharmacy 1','Loc','Chennai','D','Tamil Nadu'), ('PH2','Demo Pharmacy 2','Loc','Madurai','D','Tamil Nadu'), ('PH3','Demo Pharmacy 3','Loc','Salem','D','Tamil Nadu');
    CREATE TABLE v_demo_inventory(inventory_item_id, pharmacy_id, pharmacy_name, locality, city, district, state, cdci_product_identifier, cdci_brand_identifier, cdci_generic_identifier, product_name, brand_name, generic_name,
      strength, dosage_form, pack_size, quantity_available, stock_status, price_inr, last_updated_at, data_origin, is_synthetic, catalogue_match_status);`);
  const iv = v.prepare('INSERT INTO v_demo_inventory VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  iv.run('I1', 'PH1', 'Demo Pharmacy 1', 'Loc', 'Chennai', 'D', 'Tamil Nadu', 'P1', 'B1', 'G1', 'Paracetamol', 'Fixtamol 1', 'Paracetamol', null, null, null, 5, 'low_stock', 42.5, new Date().toISOString(), 'synthetic_seeded', 1, 'identifier_linked');
  iv.run('I2', 'PH2', 'Demo Pharmacy 2', 'Loc', 'Madurai', 'D', 'Tamil Nadu', 'P1', 'B1', 'G1', 'Paracetamol', 'Fixtamol 1', 'Paracetamol', null, null, null, 0, 'out_of_stock', 30, '2020-01-01T00:00:00Z', 'synthetic_seeded', 1, 'identifier_linked');
  iv.run('I3', 'PH1', 'Demo Pharmacy 1', 'Loc', 'Chennai', 'D', 'Tamil Nadu', 'P90', 'B90', 'G9', 'Painfix', 'Painfix 50', 'Tramadol', null, null, null, 9, 'in_stock', 55, new Date().toISOString(), 'synthetic_seeded', 1, 'identifier_linked');
  iv.run('I4', 'PH1', 'Demo Pharmacy 1', 'Loc', 'Chennai', 'D', 'Tamil Nadu', 'P94', 'B94', 'G13', 'Allerfix', 'Allerfix 10', 'Cetirizine', null, null, null, 9, 'in_stock', 12, new Date().toISOString(), 'synthetic_seeded', 1, 'identifier_linked');
  v.close();
  return { cdciFile, invFile };
}

module.exports = { makeFixtures };
