import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compareSync(plain, hash);
}
