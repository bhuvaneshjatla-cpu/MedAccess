/* Sign-in page (UC-01). */
import { h, mount, field } from '../ui.js';
import { session, api } from '../session.js';
import { setSession } from '../shell.js';

// ---------- UC-01 login ----------
const DEMO = [['Patient', 'patient'], ['Caregiver', 'caregiver'], ['Pharmacist', 'pharmacist'], ['Pharmacy Staff', 'staff'], ['Administrator', 'admin'], ['Doctor', 'doctor']];
export async function pageLogin() {
  if (session.user) { location.hash = '#/search'; return; }
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
  const pw = h('input', { id: 'pw', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('div', { class: 'notice err', hidden: true, role: 'alert' });
  const form = h('form', { class: 'card login' },
    h('h1', null, 'Sign in to MedAccess'),
    h('p', { class: 'sub' }, 'Pharmacist-supervised medicine availability, price comparison and information.'),
    err, field('Email', email, 'email'), field('Password', pw, 'pw'),
    h('button', { class: 'btn', type: 'submit' }, 'Sign in'),
    h('h2', null, 'Demo accounts'),
    h('p', { class: 'muted' }, 'Synthetic accounts for each stakeholder role. Click to fill the email, then enter the demo password from app/README.md.'),
    h('div', { class: 'demo' }, DEMO.map(([label, k]) => h('button', { class: 'btn small ghost', type: 'button', onclick: () => { email.value = `${k}@demo.medaccess`; pw.focus(); } }, label))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email: email.value, password: pw.value } });
      setSession(r.token, r.user); location.hash = '#/search';
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });
  mount(form);
}
