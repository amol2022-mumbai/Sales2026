import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const SALT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compareSync(plain, hash);
}

// Character classes with visually ambiguous characters removed.
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_LOWER = 'abcdefghijkmnpqrstuvwxyz';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_SYMBOLS = '!@#$%^&*()-_=+[]{}?';

/**
 * Generate a cryptographically strong temporary password that is guaranteed to
 * contain at least one uppercase letter, one lowercase letter, one digit and
 * one symbol, and is long enough to satisfy the application password policy.
 * @param {number} [length]
 */
export function generateTemporaryPassword(length = 16) {
  const all = PASSWORD_UPPER + PASSWORD_LOWER + PASSWORD_DIGITS + PASSWORD_SYMBOLS;
  const pick = (set) => set[crypto.randomInt(set.length)];

  const chars = [pick(PASSWORD_UPPER), pick(PASSWORD_LOWER), pick(PASSWORD_DIGITS), pick(PASSWORD_SYMBOLS)];
  while (chars.length < length) {
    chars.push(pick(all));
  }

  // Fisher-Yates shuffle so the guaranteed classes are not always in the same
  // leading positions.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

