'use strict';
// Refill reminders (UC-16, UC-17; FR-32..FR-34).

module.exports = function register(k) {
  const { ref, q, one, run, audit, route, ApiError, bad, nowIso, str, brandOr404 } = k;

  // UC-16 / UC-17 Refill reminders (AD-07, STD-05)
  const remindersFor = (uid) => {
    // "Triggered" is modelled lazily: a Scheduled reminder whose time has passed becomes Triggered (STD-05 trigger).
    run("UPDATE refill_reminders SET status='Triggered' WHERE user_id=? AND status='Scheduled' AND reminder_date_time<=?", uid, nowIso());
    const idx = ref.search;
    return q(`SELECT * FROM refill_reminders WHERE user_id=? ORDER BY status IN ('Completed','Cancelled'), reminder_date_time`, uid).map((r) => {
      const b = idx?.brandById(r.brand_identifier);
      return { ...r, strength: b?.strength ?? null, dosage_form: b?.dosage_form ?? null };
    });
  };
  const REMINDER_ROLES = ['Patient', 'Caregiver'];
  route('GET', '/api/reminders', REMINDER_ROLES, (ctx) => ({ reminders: remindersFor(ctx.user.user_id) }));
  route('POST', '/api/reminders', REMINDER_ROLES, (ctx) => {
    const b = brandOr404(ctx.body.brand_identifier);
    const when = new Date(ctx.body.reminder_date_time);
    if (Number.isNaN(when.getTime())) throw bad('A valid reminder date/time is required');
    const rec = str(ctx.body.recurrence, 10) || 'None';
    if (!['None', 'Daily', 'Weekly', 'Monthly'].includes(rec)) throw bad('Invalid recurrence pattern');
    const id = run('INSERT INTO refill_reminders(user_id,brand_identifier,brand_name,reminder_date_time,recurrence,created_at) VALUES (?,?,?,?,?,?)',
      ctx.user.user_id, b.brand_identifier, b.brand_name, when.toISOString(), rec, nowIso()).lastInsertRowid;
    audit(ctx.user.user_id, 'REMINDER_CREATED', 'Success', `reminder:${id}`, { recurrence: rec });
    return { reminders: remindersFor(ctx.user.user_id) };
  });
  // SD-07 Modify reminder: change the date/time and/or recurrence of an open reminder; it becomes Scheduled again.
  route('PUT', '/api/reminders/:id', REMINDER_ROLES, (ctx) => {
    const r = one('SELECT * FROM refill_reminders WHERE reminder_id=? AND user_id=?', ctx.params.id, ctx.user.user_id);
    if (!r) throw new ApiError(404, 'Reminder not found');
    if (['Completed', 'Cancelled'].includes(r.status)) throw new ApiError(409, `Reminder is already ${r.status.toLowerCase()}`);
    const when = ctx.body.reminder_date_time != null ? new Date(ctx.body.reminder_date_time) : new Date(r.reminder_date_time);
    if (Number.isNaN(when.getTime())) throw bad('A valid reminder date/time is required');
    const rec = ctx.body.recurrence != null ? str(ctx.body.recurrence, 10) : r.recurrence;
    if (!['None', 'Daily', 'Weekly', 'Monthly'].includes(rec)) throw bad('Invalid recurrence pattern');
    run("UPDATE refill_reminders SET reminder_date_time=?, recurrence=?, status='Scheduled' WHERE reminder_id=?", when.toISOString(), rec, r.reminder_id);
    audit(ctx.user.user_id, 'REMINDER_MODIFIED', 'Success', `reminder:${r.reminder_id}`,
      { before: { reminder_date_time: r.reminder_date_time, recurrence: r.recurrence, status: r.status }, after: { reminder_date_time: when.toISOString(), recurrence: rec, status: 'Scheduled' } });
    return { reminders: remindersFor(ctx.user.user_id) };
  });
  route('POST', '/api/reminders/:id/:action', REMINDER_ROLES, (ctx) => {
    const r = one('SELECT * FROM refill_reminders WHERE reminder_id=? AND user_id=?', ctx.params.id, ctx.user.user_id);
    if (!r) throw new ApiError(404, 'Reminder not found');
    if (['Completed', 'Cancelled'].includes(r.status)) throw new ApiError(409, `Reminder is already ${r.status.toLowerCase()}`);
    if (ctx.params.action === 'cancel') {
      run("UPDATE refill_reminders SET status='Cancelled' WHERE reminder_id=?", r.reminder_id);
    } else if (ctx.params.action === 'complete') {
      if (r.recurrence === 'None') run("UPDATE refill_reminders SET status='Completed' WHERE reminder_id=?", r.reminder_id);
      else { // STD-05 reschedule [recurring]
        const d = new Date(r.reminder_date_time);
        do { // advance past "now" so the next occurrence is in the future
          if (r.recurrence === 'Daily') d.setDate(d.getDate() + 1);
          else if (r.recurrence === 'Weekly') d.setDate(d.getDate() + 7);
          else d.setMonth(d.getMonth() + 1);
        } while (d.getTime() <= Date.now());
        run("UPDATE refill_reminders SET status='Scheduled', reminder_date_time=? WHERE reminder_id=?", d.toISOString(), r.reminder_id);
      }
    } else throw new ApiError(404, 'Unknown reminder action');
    audit(ctx.user.user_id, `REMINDER_${ctx.params.action.toUpperCase()}`, 'Success', `reminder:${r.reminder_id}`);
    return { reminders: remindersFor(ctx.user.user_id) };
  });
};
