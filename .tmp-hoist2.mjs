import { readdirSync, statSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = 'E:/software/corsj-workspace';
const pnpmDir = join(root, 'node_modules/.pnpm');
const appNodeModules = join(root, 'corsj-app/node_modules');
let linked = 0, skipped = 0, failed = 0;
for (const entry of readdirSync(pnpmDir)) {
  if (!entry.includes('@')) continue;
  const inner = join(pnpmDir, entry, 'node_modules');
  if (!existsSync(inner)) continue;
  for (const pkg of readdirSync(inner)) {
    if (pkg.startsWith('.')) continue;
    const src = join(inner, pkg);
    if (!statSync(src).isDirectory()) continue;
    const dst = join(appNodeModules, pkg);
    if (existsSync(dst)) { try { rmSync(dst, { recursive: true, force: true }); } catch { skipped++; continue; } }
    try { symlinkSync(src, dst, 'junction'); linked++; } catch (e) { failed++; }
  }
}
console.log('linked=' + linked + ' skipped=' + skipped + ' failed=' + failed);
