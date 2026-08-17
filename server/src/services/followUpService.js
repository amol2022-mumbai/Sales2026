import { getDb } from '../db/connection.js';

// ---------------------------------------------------------------------------
// Follow-up domain constants and helpers (pure, no HTTP). Also owns timeline
// mirroring and reminder/notification generation for follow-ups.
// ---------------------------------------------------------------------------

export const FOLLOW_UP_TYPES = [
  'call',
  'whatsapp',
  'email',
  'meeting',
  'site_visit',
  'demo',
  'presentation',
  'note',
  'follow_up',
];

export const FOLLOW_UP_PRIORITIES = ['Low', 'Medium', 'High'];

// "Overdue" is derived at read time; only these four are stored.
export const FOLLOW_UP_STATUSES = ['Pending', 'Completed', 'Rescheduled', 'Cancelled'];

export const FOLLOW_UP_TYPE_LABELS = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  meeting: 'Meeting',
  site_visit: 'Site Visit',
  demo: 'Demo',
  presentation: 'Presentation',
  note: 'Note',
  follow_up: 'Follow-up',
};

export function activityLabel(type) {
  return FOLLOW_UP_TYPE_LABELS[type] || type;
}

/**
 * Resolve the display name of a follow-up's target entity (lead or customer).
 */
export function targetNameFor(db, followUp) {
  if (followUp.target_type === 'lead' && followUp.lead_id) {
    const lead = db.prepare('SELECT company_name FROM leads WHERE id = ?').get(followUp.lead_id);
    return lead?.company_name || null;
  }
  if (followUp.target_type === 'customer' && followUp.customer_id) {
    const customer = db.prepare('SELECT name FROM customers WHERE id = ?').get(followUp.customer_id);
    return customer?.name || null;
  }
  return null;
}

/**
 * Mirror a follow-up lifecycle event into the target's immutable activity
 * timeline so lead/customer profiles show a complete history.
 */
export function insertTimelineActivity(db, { targetType, targetId, userId, type, description, metadata = null }) {
  if (!targetId) return;
  if (targetType === 'lead') {
    db.prepare(
      `INSERT INTO lead_activities (lead_id, user_id, type, description, metadata)
       VALUES (?, ?, ?, ?, ?)`
    ).run(targetId, userId, type, description, metadata ? JSON.stringify(metadata) : null);
  } else if (targetType === 'customer') {
    db.prepare(
      `INSERT INTO customer_activities (customer_id, user_id, type, description, metadata)
       VALUES (?, ?, ?, ?, ?)`
    ).run(targetId, userId, type, description, metadata ? JSON.stringify(metadata) : null);
  }
}

/**
 * Insert an in-app notification, skipping duplicates (unread, same user/type/
 * link). Used for assignment notifications and reminder sweeps.
 */
export function notifyUser(db, { companyId, userId, type = 'followup', title, body, link }) {
  if (!userId) return false;
  const existing = db
    .prepare('SELECT id FROM notifications WHERE user_id = ? AND type = ? AND link = ? AND is_read = 0')
    .get(userId, type, link);
  if (existing) return false;
  db.prepare(
    `INSERT INTO notifications (company_id, user_id, type, title, body, link, is_read)
     VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).run(companyId, userId, type, title, body ?? null, link);
  return true;
}

/**
 * Reminder sweep: generate notifications for overdue (date < today) and
 * upcoming (today or tomorrow) Pending follow-ups. Idempotent via the
 * unread-notification dedup in notifyUser. Returns the number created.
 */
export function runFollowUpReminders(db = getDb()) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const tomorrow = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `SELECT f.id, f.company_id, f.assigned_to, f.created_by, f.activity_type, f.follow_up_date, f.follow_up_time,
              f.contact_person, f.target_type, f.lead_id, f.customer_id
       FROM follow_ups f
       JOIN companies c ON c.id = f.company_id
       WHERE f.deleted_at IS NULL AND f.status = 'Pending' AND c.deleted_at IS NULL`
    )
    .all();

  let created = 0;
  for (const f of rows) {
    const userId = f.assigned_to ?? f.created_by;
    if (!userId) continue;

    const due = f.follow_up_date;
    let kind = null;
    if (due < today) kind = 'overdue';
    else if (due === today || due === tomorrow) kind = 'upcoming';
    if (!kind) continue;

    const target = targetNameFor(db, f);
    const label = activityLabel(f.activity_type);
    const link = `/follow-ups/${f.id}`;
    const title = kind === 'overdue' ? `Overdue: ${label}` : `Upcoming: ${label}`;
    const who = [target, f.contact_person].filter(Boolean).join(' · ');
    const when = `${due}${f.follow_up_time ? ` ${f.follow_up_time}` : ''}`;
    const body = `${who} — ${when}`;

    if (notifyUser(db, { companyId: f.company_id, userId, title, body, link })) created += 1;
  }
  return created;
}
