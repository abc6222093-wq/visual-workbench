import { readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

// Advisory only. Never remove, merge, or choose one of these copies.
export function detectSyncConflicts(projectDir) {
  const found = [];
  function visit(dir, prefix = '') {
    const entries = readdirSync(dir, { withFileTypes: true });
    const siblings = new Set(entries.filter((entry) => !entry.isSymbolicLink()).map((entry) => entry.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name === 'versions') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const explicit = /conflict(?:ed)?(?:[ _-]+copy)?|冲突|衝突|競合/i.test(entry.name);
      const extension = extname(entry.name);
      const stem = extension ? entry.name.slice(0, -extension.length) : entry.name;
      const canonical = stem.replace(/\s*[（(]\d+[）)]$/, '') + extension;
      if (explicit || (canonical !== entry.name && siblings.has(canonical))) found.push(relative);
      if (entry.isDirectory()) visit(join(dir, entry.name), relative);
    }
  }
  visit(projectDir);
  return found.sort();
}
