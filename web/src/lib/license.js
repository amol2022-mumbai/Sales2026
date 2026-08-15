/**
 * Helpers for presenting a tenant's license/trial state to the user. Purely
 * presentational — the authoritative enforcement stays server-side.
 */

/**
 * Whole days remaining until the given `YYYY-MM-DD` expiry date, using local
 * wall-clock dates. Returns:
 *  - a positive integer for a future date,
 *  - 0 for today,
 *  - a negative integer once past,
 *  - null when no date is available.
 */
export function daysRemaining(expiresAt) {
  if (!expiresAt) return null;
  const date = typeof expiresAt === 'string' ? expiresAt.slice(0, 10) : null;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const end = new Date(`${date}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

/**
 * Human "remaining days" label for a trial or expiring license.
 */
export function remainingDaysLabel(expiresAt) {
  const days = daysRemaining(expiresAt);
  if (days == null) return null;
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} remaining`;
  if (days === 0) return 'Expires today';
  return 'Expired';
}
