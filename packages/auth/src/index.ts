// barrel de @platform/auth: tabla canónica de sesiones + servicio de ciclo de vida
export { defineSessionTable, type SessionTable } from './session-table.js';
export {
  createSessionService,
  type PlatformSession,
  type SessionService,
  type SessionServiceOptions,
  type SessionSummary,
} from './session-service.js';
