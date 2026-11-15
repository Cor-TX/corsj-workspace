import { ensureCommandsRegistered, listCapabilities } from '../core/dist/commands/index.js';
ensureCommandsRegistered();
const caps = listCapabilities();
console.log('TOTAL', caps.length);
for (const cap of caps) {
  console.log(`${cap.capability_id}\t${cap.embedded_level}\t${cap.core ? 'core' : 'ext'}`);
}