import { readdirSync, statSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = 'E:/software/corsj-workspace';
const pnpmDir = join(root, 'node_modules/.pnpm');
const appNodeModules = join(root, 'corsj-app/node_modules');
let linked = 0, skipped = 0;
for (const entry of readdirSync(pnpmDir)) {
  // 形如 name@version 或 name@version_dep...
  if (!entry.includes('@')) continue;
  const inner = join(pnpmDir, entry, 'node_modules');
  if (!existsSync(inner)) continue;
  for (const pkg of readdirSync(inner)) {
    if (pkg.startsWith('.')) continue;
    const src = join(inner, pkg);
    if (!statSync(src).isDirectory()) continue;
    const dst = join(appNodeModules, pkg);
    if (existsSync(dst)) { skipped++; continue; }
    try { symlinkSync(src, dst, 'dir'); linked++; } catch (e) { skipped++; }
  }
}
console.log('linked=' + linked + ' skipped=' + skipped);
