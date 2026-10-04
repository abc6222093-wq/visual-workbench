import { createServer as workbenchServer } from '../../src/server.js';
import { temporaryHome } from './temporary-home.js';

// All fixture servers, including browser fixtures, keep settings in a test home.
export function createServer(options = {}) {
  return workbenchServer({ ...options, configHome: options.configHome ?? temporaryHome() });
}
