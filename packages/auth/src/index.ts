import { AuthClient } from './client.js';

export { AuthClient } from './client.js';
export { AuthInitError } from './types.js';
export type { User, Session, AuthEventMap } from './types.js';

let instance: AuthClient | null = null;

/** Returns the singleton AuthClient. All adapters use this internally. */
export function getAuthClient(): AuthClient {
  if (!instance) instance = new AuthClient();
  return instance;
}

/** @internal Reset singleton for testing only. */
export function _resetAuthClient(): void {
  if (instance) instance.destroy();
  instance = null;
}
