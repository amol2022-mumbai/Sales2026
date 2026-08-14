import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const ISSUER = 'salesdesk-crm';
const AUDIENCE = 'salesdesk-api';
const ALGORITHM = 'HS256';

export function signToken(payload) {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: ALGORITHM,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: [ALGORITHM],
  });
}

export function decodeToken(token) {
  return jwt.decode(token);
}
