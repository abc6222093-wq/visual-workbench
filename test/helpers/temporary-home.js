import { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Inject a temporary home; never change HOME or touch the user's machine config.
export function temporaryHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'vw-test-home-'));
  const cleanup = () => rmSync(home, { recursive: true, force: true });
  if (t) t.after(cleanup); else after(cleanup);
  return home;
}
