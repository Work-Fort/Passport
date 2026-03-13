// SPDX-License-Identifier: Apache-2.0

export interface User {
  id: string;
  username: string;
  name: string;
  displayName: string;
  type: 'user' | 'agent' | 'service';
}

export interface Session {
  id: string;
  expiresAt: string;
  refreshedAt: string;
}

export type AuthEventMap = {
  change: User | null;
  logout: void;
};

export class AuthInitError extends Error {
  cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AuthInitError';
    if (options?.cause) {
      this.cause = options.cause;
    }
  }
}
