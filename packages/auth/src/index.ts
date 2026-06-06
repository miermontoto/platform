// barrel de @platform/auth: tabla canónica de sesiones + servicio de ciclo de vida
export {
  defineSessionTable,
  defineSessionTableText,
  type AnySessionTable,
  type SessionTable,
  type SessionTableText,
} from './session-table.js';
export {
  createSessionService,
  type PlatformSession,
  type SessionService,
  type SessionServiceOptions,
  type SessionSummary,
} from './session-service.js';
export { createOneTimeCodeStore, type OneTimeCodeStore } from './one-time-codes.js';
export { toSessionInfos, type SessionInfo } from './session-info.js';
