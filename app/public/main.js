/* MedAccess prototype UI entry point (ES modules; no build step). All text is set via textContent / DOM nodes. */
import { session } from './js/session.js';
import { setSession, initShell } from './js/shell.js';
import { start } from './js/router.js';
import { installA11y } from './js/a11y.js';

session.onExpired = () => { setSession(null, null); location.hash = '#/login'; };
initShell();
installA11y();
start();
