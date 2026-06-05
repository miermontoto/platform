// barrel de @platform/core-api: bootstrap http compartido por las apis de la plataforma
export { loadAppEnv } from './env.js';
export { createPlatformApp, type PlatformAppOptions } from './create-app.js';
export { sessionGate, type SessionGateOptions } from './session-gate.js';
export { mountSpa, type MountSpaOptions } from './spa.js';
export { startApiServer, type StartServerOptions } from './server.js';
