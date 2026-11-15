import { ensureCommandsRegistered, verifyRegistry } from '../core/dist/commands/index.js';
ensureCommandsRegistered();
const r = verifyRegistry();
console.log('verifyRegistry ok=', r.ok, 'errors=', JSON.stringify(r.errors));