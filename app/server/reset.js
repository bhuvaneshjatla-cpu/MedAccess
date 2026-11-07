'use strict';
// Deletes the local SQLite file so the next start re-seeds synthetic data.
const fs = require('node:fs');
const path = require('node:path');
const file = process.env.MEDACCESS_DB || path.join(__dirname, '..', 'data', 'medaccess.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
console.log('Database removed:', file);
