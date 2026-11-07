'use strict';
const http = require('node:http');
const { openDb } = require('./db');
const { seed } = require('./seed');
const { createApp } = require('./app');
const { openReference } = require('./refdata');

const db = openDb();
if (seed(db)) console.log('Seeded synthetic demo accounts.');
// MEDACCESS_DEMO_REANCHOR=0 keeps the original (fixed) synthetic timestamps
const ref = openReference({ reanchorDemo: process.env.MEDACCESS_DEMO_REANCHOR !== '0' }); // throws (server does not start) if the restricted-medicines list cannot be loaded
if (ref.demoShiftDays) console.log(`Synthetic inventory timestamps re-anchored by ${ref.demoShiftDays} days (MEDACCESS_DEMO_REANCHOR=0 to disable).`);
console.log(`Restricted medicines: ${ref.restrictedBrands.size} catalogue brands excluded (list ${ref.restricted.version}).`);
const port = Number(process.env.PORT) || 3000;
http.createServer(createApp(db, ref)).listen(port, '127.0.0.1', () => {
  console.log(`MedAccess prototype running at http://localhost:${port}  (synthetic data - not live pharmacy availability)`);
});
