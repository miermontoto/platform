// proyección segura de las sesiones para exponer al cliente: el token viaja
// solo hasheado (sha-256) para que el cliente identifique su propia sesión
// comparando contra la cookie sin exfiltrar tokens.
import crypto from 'crypto';
import type { SessionSummary } from './session-service.js';

export interface SessionInfo {
  hash: string;
  createdAt: number;
  expiresAt: number;
  userAgent: string | null;
  current: boolean;
}

export function toSessionInfos(sessions: SessionSummary[], currentToken: string): SessionInfo[] {
  const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
  const currentHash = currentToken ? hash(currentToken) : '';
  return sessions.map((s) => ({
    hash: hash(s.token),
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    userAgent: s.userAgent,
    current: hash(s.token) === currentHash,
  }));
}
