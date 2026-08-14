// ============================================================================
// Opportunity domain constants and helpers (pure, no HTTP). Owns the
// opportunity activity timeline (with mirroring into lead/customer activity
// trails) and the weighted-pipeline calculation.
// ============================================================================

export const OPPORTUNITY_STAGES = [
  'New',
  'Contacted',
  'Qualified',
  'Proposal',
  'Negotiation',
  'Won',
  'Lost',
];

// Stages that still count toward the open pipeline (exclude Won/Lost).
export const OPPORTUNITY_OPEN_STAGES = ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation'];

export const OPPORTUNITY_PRIORITIES = ['Low', 'Medium', 'High'];

/**
 * Weighted pipeline value = deal value * probability / 100.
 * @param {number|null} dealValue
 * @param {number|null} probability
 */
export function weightedValue(dealValue, probability) {
  if (dealValue == null || probability == null) return null;
  return Math.round(dealValue * probability) / 100;
}

/**
 * Insert an opportunity timeline entry and mirror it into the linked lead or
 * customer activity trail so profiles show a complete history.
 */
export function insertOpportunityActivity(db, { opportunityId, targetType, targetId, userId, type, description, metadata = null }) {
  const info = db
    .prepare(
      `INSERT INTO opportunity_activities (opportunity_id, user_id, type, description, metadata)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(opportunityId, userId, type, description, metadata ? JSON.stringify(metadata) : null);

  // Mirror into the target entity's immutable activity trail.
  if (targetId) {
    if (targetType === 'lead') {
      db.prepare(
        `INSERT INTO lead_activities (lead_id, user_id, type, description, metadata)
         VALUES (?, ?, 'opportunity', ?, ?)`
      ).run(targetId, userId, description, metadata ? JSON.stringify(metadata) : null);
    } else if (targetType === 'customer') {
      db.prepare(
        `INSERT INTO customer_activities (customer_id, user_id, type, description, metadata)
         VALUES (?, ?, 'opportunity', ?, ?)`
      ).run(targetId, userId, description, metadata ? JSON.stringify(metadata) : null);
    }
  }

  return Number(info.lastInsertRowid);
}
