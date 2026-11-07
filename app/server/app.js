'use strict';
// Composition root: builds the shared kernel, registers each component's routes (the order is the routing priority),
// and returns the request handler. The behaviour lives in the modules under server/routes/.
const { openReference } = require('./refdata');
const { createKernel } = require('./kernel');
const { createHandler } = require('./http');

const COMPONENTS = [
  require('./routes/auth'),
  require('./routes/catalogue'),
  require('./routes/matching'),
  require('./routes/availability'),
  require('./routes/reports'),
  require('./routes/reminders'),
  require('./routes/adminUsers'),
  require('./routes/adminCatalogue'),
  require('./routes/adminReports'),
  require('./routes/audit'),
];

function createApp(db, ref = openReference()) {
  const k = createKernel(db, ref);
  for (const register of COMPONENTS) register(k);
  const handler = createHandler(k);
  handler.routes = k.routes; // exposed for tests and tooling
  return handler;
}

module.exports = { createApp };
