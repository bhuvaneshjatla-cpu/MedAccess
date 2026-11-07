/* User and role administration (UC-18). */
import { h, mount, act, field, refresh } from '../ui.js';
import { session, api } from '../session.js';

// ---------- UC-18 users ----------
export async function pageAdminUsers() {
  const { users, roles } = await api('/admin/users');
  const name = h('input', { id: 'un', required: true }), email = h('input', { id: 'ue', type: 'email', required: true }),
    pass = h('input', { id: 'up', type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }),
    role = h('select', { id: 'ur' }, roles.map((r) => h('option', null, r)));
  const form = h('form', { class: 'card' }, h('h2', null, 'Create user'),
    h('div', { class: 'form-grid' }, field('Name', name, 'un'), field('Email', email, 'ue'), field('Temporary password (min 8)', pass, 'up'), field('Role', role, 'ur')),
    h('p', { class: 'muted' }, 'New accounts start as “Created” and must be activated before the user can sign in.'), h('button', { class: 'btn', type: 'submit' }, 'Create user'));
  form.addEventListener('submit', async (e) => { e.preventDefault(); if (await act(() => api('/admin/users', { method: 'POST', body: { name: name.value, email: email.value, password: pass.value, role: role.value } }), 'User created')) refresh(); });
  const stCls = { Active: 'b-ok', Created: 'b-info', Inactive: 'b-warn', Deactivated: 'b-bad' };
  const ACTIONS = { Created: ['activate'], Active: ['inactivate', 'deactivate'], Inactive: ['reactivate'], Deactivated: [] };
  const rows = users.map((u) => {
    const rsel = h('select', { 'aria-label': `Role for ${u.name}` }, roles.map((r) => h('option', null, r))); rsel.value = u.role;
    rsel.addEventListener('change', async () => { if (await act(() => api(`/admin/users/${u.user_id}`, { method: 'PATCH', body: { role: rsel.value } }), 'Role updated')) refresh(); else refresh(); });
    return h('tr', null, h('td', null, h('strong', null, u.name), h('div', { class: 'muted' }, u.email)), h('td', null, rsel),
      h('td', null, h('span', { class: `badge ${stCls[u.account_status]}` }, u.account_status)),
      h('td', null, h('div', { class: 'row' }, u.user_id === session.user.user_id ? h('span', { class: 'muted' }, 'You') : ACTIONS[u.account_status].map((a) =>
        h('button', { class: `btn small ${a === 'deactivate' ? 'danger' : 'ghost'}`, type: 'button', 'aria-label': `${a[0].toUpperCase() + a.slice(1)} ${u.name}`, onclick: async () => { if (await act(() => api(`/admin/users/${u.user_id}/${a}`, { method: 'POST' }), `Account ${a}d`)) refresh(); } }, a[0].toUpperCase() + a.slice(1))))));
  });
  mount(h('h1', null, 'Users and roles'), form, h('div', { class: 'table-wrap card' }, h('table', null, h('thead', null, h('tr', null, ['User', 'Role', 'Status', 'Actions'].map((t) => h('th', null, t)))), h('tbody', null, rows))));
}
