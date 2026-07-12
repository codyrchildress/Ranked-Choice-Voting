import { createHash, randomBytes } from 'node:crypto';

// Lowercase alphanumerics minus look-alikes (0/o, 1/l/i) so ids survive being
// read aloud or hand-copied.
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

export function shortId(length = 10) {
  const bytes = randomBytes(length);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

// 144 bits of entropy, URL-safe. Knowing this token is what makes you the
// election's admin, so it must be unguessable.
export function adminToken() {
  return randomBytes(18).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
