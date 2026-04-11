import { createHash, randomBytes } from 'node:crypto';

/** URL-safe token shown once to the inviter (share link). */
export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}
