'use strict';
// SYNTHETIC demo accounts only (SRS NFR-07, BR-10). Medicines and pharmacies come from the read-only CDCI catalogue and
// the synthetic Inventory V2 database; nothing about them is seeded here.
// Demo accounts exist solely so each stakeholder role can be exercised locally.
const { hashPassword } = require('./auth');

const ROLES = ['Patient', 'Caregiver', 'Pharmacist', 'Pharmacy Staff', 'Administrator', 'Doctor'];
const DEMO_PASSWORD = 'Demo@12345';

const USERS = [
  ['Asha Patient', 'patient@demo.medaccess', 'Patient'],
  ['Carl Caregiver', 'caregiver@demo.medaccess', 'Caregiver'],
  ['Priya Pharmacist', 'pharmacist@demo.medaccess', 'Pharmacist'],
  ['Sam Staff', 'staff@demo.medaccess', 'Pharmacy Staff'],
  ['Ada Admin', 'admin@demo.medaccess', 'Administrator'],
  ['Dr. Dev Doctor', 'doctor@demo.medaccess', 'Doctor'],
];

function seed(db) {
  if (db.prepare('SELECT COUNT(*) c FROM roles').get().c > 0) return false;

  ROLES.forEach((r, i) => db.prepare('INSERT INTO roles(role_id, role_name) VALUES (?,?)').run(i + 1, r));
  const rid = (n) => ROLES.indexOf(n) + 1;
  const pwHash = hashPassword(DEMO_PASSWORD);
  for (const [name, email, role] of USERS)
    db.prepare("INSERT INTO users(name,email,password_hash,account_status,role_id) VALUES (?,?,?,'Active',?)").run(name, email, pwHash, rid(role));

  db.prepare("INSERT INTO audit_log(user_id,timestamp,action,result,affected_record,details) VALUES (NULL,?,?,?,?,?)")
    .run(new Date().toISOString(), 'SEED_SYNTHETIC_DATA', 'Success', 'database', JSON.stringify({ users: USERS.length, roles: ROLES.length }));
  return true;
}

module.exports = { seed, DEMO_PASSWORD, ROLES };
