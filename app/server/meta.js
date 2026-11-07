'use strict';
// Project reference data transcribed from docs/MedAccess_SRS.docx and docs/uml-diagrams/MedAccess_UseCase_Diagram.mdj.
// Served at /api/meta and shown on the in-app "Project Docs" page.

const UC = (id, name, actors, frs, screen, api) => ({ id, name, actors, frs, screen, api });

const USE_CASES = [
  UC('UC-01', 'Authenticate User', 'All actors (Doctor optional)', 'FR-01–FR-04', '#/login', 'POST /api/auth/login'),
  UC('UC-02', 'Search Medicine', 'Patient, Caregiver', 'FR-05–FR-09', '#/catalogue', 'GET /api/catalogue'),
  UC('UC-03', 'View Medicine Details', 'Patient, Caregiver, Pharmacist, Pharmacy Staff, Administrator, Doctor (optional)', 'FR-05–FR-09', '#/catalogue (detail panel)', 'GET /api/catalogue (attributes in each result)'),
  UC('UC-04', 'View Pharmacy Availability', 'Patient, Caregiver', 'FR-10–FR-14', '#/catalogue (detail panel)', 'GET /api/catalogue/:bid/availability'),
  UC('UC-05', 'View Indicative Prices', 'Patient, Caregiver', 'FR-15–FR-19', '#/catalogue (detail panel)', 'GET /api/catalogue/:bid/availability (price columns)'),
  UC('UC-06', 'Compare Medicine Prices', 'Patient, Caregiver', 'FR-15–FR-19', '#/catalogue (pharmacy table sorted by price; matches table)', 'GET /api/catalogue/:bid/availability, /matches'),
  UC('UC-07', 'View Potential Medicine Match', 'Patient, Caregiver, Pharmacist, Doctor (optional)', 'FR-20–FR-27', '#/catalogue (Potential matches panel)', 'GET /api/catalogue/:bid/matches'),
  UC('UC-08', 'Review Medicine Comparison', 'Pharmacist', 'FR-20–FR-27', '#/verification', 'GET /api/comparisons, POST /api/comparisons/:id/open'),
  UC('UC-09', 'Verify Medicine Comparison', 'Pharmacist', 'FR-22, FR-25, FR-26', '#/verification', 'POST /api/comparisons/:id/verify'),
  UC('UC-10', 'Reject Medicine Comparison', 'Pharmacist', 'FR-23, FR-25', '#/verification', 'POST /api/comparisons/:id/reject'),
  UC('UC-11', 'Add Verification Comment (optional)', 'Pharmacist', 'FR-24', '#/verification', 'POST /api/comparisons/:id/comments'),
  UC('UC-12', 'Update Medicine Stock', 'Pharmacy Staff, Pharmacist (if authorized)', 'FR-10–FR-14', '#/inventory', 'PUT /api/availability (brand + pharmacy)'),
  UC('UC-13', 'Update Medicine Price', 'Pharmacy Staff, Pharmacist (if authorized)', 'FR-15–FR-19', '#/inventory', 'PUT /api/prices (brand + pharmacy)'),
  UC('UC-14', 'Report Incorrect Information', 'Patient, Caregiver, Pharmacist, Pharmacy Staff', 'FR-28–FR-31', '#/catalogue (Report a problem), #/reports', 'POST /api/reports'),
  UC('UC-15', 'Review/Resolve Report', 'Pharmacist, Pharmacy Staff (if authorized), Administrator', 'FR-28–FR-31', '#/reports', 'POST /api/reports/:id/:action'),
  UC('UC-16', 'Create Refill Reminder', 'Patient, Caregiver', 'FR-32–FR-34', '#/reminders', 'POST /api/reminders'),
  UC('UC-17', 'Manage Recurring Refill Reminder (optional)', 'Patient, Caregiver', 'FR-32–FR-34', '#/reminders', 'POST /api/reminders/:id/:action'),
  UC('UC-18', 'Manage Users and Roles', 'Administrator', 'FR-35–FR-39', '#/admin/users', '/api/admin/users…'),
  UC('UC-19', 'Manage Medicine Catalogue', 'Administrator', 'FR-05–FR-09, FR-35–FR-39', '#/admin/catalogue', '/api/admin/catalogue… (overlay: hide, annotate, add brands)'),
  UC('UC-20', 'View Administrative Reports', 'Administrator', 'FR-35–FR-39', '#/admin/reports', 'GET /api/admin/reports'),
  UC('UC-21', 'View Audit Log', 'Administrator', 'FR-35–FR-39', '#/admin/audit', 'GET /api/admin/audit'),
];

const BUSINESS_RULES = [
  ['BR-01', 'A potential medicine match is informational and is not automatically a substitution recommendation.'],
  ['BR-02', 'Only authorized pharmacists may mark a comparison as pharmacist-verified.'],
  ['BR-03', 'A lower price alone shall not establish medicine suitability.'],
  ['BR-04', 'Medicine comparisons shall expose relevant attributes and pack size to reduce misleading price comparisons.'],
  ['BR-05', 'Availability information is reported data and shall be associated with a timestamp/source.'],
  ['BR-06', 'Diagnosis, prescribing, dosage changes and treatment recommendations are outside system responsibility.'],
  ['BR-07', 'Controlled, narcotic, psychotropic, high-risk and otherwise restricted medicines are outside the MVP.'],
  ['BR-08', 'Online sales, payments and home delivery are outside the MVP.'],
  ['BR-09', 'Direct live commercial pharmacy integration and unverified scraping are outside the core prototype.'],
  ['BR-10', 'Real patient data shall not be used without appropriate authorization.'],
];

const STATE_MACHINES = [
  { id: 'STD-01', name: 'User Account State', states: 'Created → Active ⇄ Inactive; Active/Inactive → Deactivated' },
  { id: 'STD-02', name: 'Potential Medicine Match State', states: 'Potential Match → Pending Pharmacist Review → Pharmacist-Verified | Rejected' },
  { id: 'STD-03', name: 'Medicine Comparison State', states: 'Created → Pending Review → Under Pharmacist Review → Verified | Rejected' },
  { id: 'STD-04', name: 'Incorrect Information Report State', states: 'Submitted → Under Review → Investigating → Resolved | Rejected' },
  { id: 'STD-05', name: 'Refill Reminder State', states: 'Created → Scheduled → Triggered → Completed | Cancelled; recurring → rescheduled' },
  { id: 'STD-06', name: 'Pharmacy Availability State', states: 'Available ⇄ Low Stock ⇄ Unavailable' },
];

const DIAGRAMS = [
  ['UML Use Case Diagram', 'docs/uml-diagrams/MedAccess_UseCase_Diagram.mdj'],
  ['ER-01 Entity-Relationship Diagram', 'docs/uml-diagrams/MedAccess_ER_Diagram.mdj'],
  ['Architecture (component) Diagram', 'docs/uml-diagrams/MedAccess_Architecture_Diagram.mdj'],
  ['State Diagrams STD-01..STD-06', 'docs/uml-diagrams/MedAccess State Diagrams.mdj'],
  ['Sequence Diagrams SD-01..SD-10', 'docs/uml-diagrams/MedAccess_Sequence_Diagrams_SD01-SD10.mdj'],
  ['Activity Diagrams AD-01..AD-10', 'docs/uml-diagrams/activity-diagrams/'],
].map(([name, file]) => ({ name, file }));

const META = { use_cases: USE_CASES, business_rules: BUSINESS_RULES, state_machines: STATE_MACHINES, diagrams: DIAGRAMS };
module.exports = { META };
