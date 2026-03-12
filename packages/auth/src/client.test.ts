import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthClient } from './client.js';
import { AuthInitError } from './types.js';
import type { User, Session } from './types.js';

const mockUser: User = {
  id: 'user-1',
  username: 'kazw',
  name: 'Kaz Walker',
  displayName: 'Kaz',
  type: 'user',
};

const mockSession: Session = {
  id: 'session-1',
  expiresAt: '2026-12-31T00:00:00Z',
  refreshedAt: '2026-03-12T00:00:00Z',
};

function mockFetchResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: new Headers(),
  } as Response;
}

describe('AuthClient', () => {
  let client: AuthClient;

  beforeEach(() => {
    client = new AuthClient();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    client.destroy();
  });

  describe('init', () => {
    it('fetches session and populates user', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse(200, { user: mockUser, session: mockSession }),
      );

      await client.init();

      expect(client.getUser()).toEqual(mockUser);
      expect(client.getSession()).toEqual(mockSession);
      expect(client.isAuthenticated).toBe(true);
    });

    it('sets user to null on 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse(401),
      );

      await client.init();

      expect(client.getUser()).toBeNull();
      expect(client.getSession()).toBeNull();
      expect(client.isAuthenticated).toBe(false);
    });

    it('throws AuthInitError on network failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

      await expect(client.init()).rejects.toThrow(AuthInitError);
      await expect(client.init()).rejects.toThrow('Failed to reach auth service');
    });

    it('throws AuthInitError on non-401 error status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockFetchResponse(500),
      );

      await expect(client.init()).rejects.toThrow(AuthInitError);
      await expect(client.init()).rejects.toThrow('Auth service returned 500');
    });

    it('throws AuthInitError on invalid JSON', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
        headers: new Headers(),
      } as Response);

      await expect(client.init()).rejects.toThrow('Invalid JSON from auth service');
    });
  });

  describe('events', () => {
    it('emits change event with user on successful init', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse(200, { user: mockUser, session: mockSession }),
      );

      const changes: (User | null)[] = [];
      client.on('change', (u) => changes.push(u));

      await client.init();

      expect(changes).toEqual([mockUser]);
    });

    it('emits change event with null on 401', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse(401),
      );

      const changes: (User | null)[] = [];
      client.on('change', (u) => changes.push(u));

      await client.init();

      expect(changes).toEqual([null]);
    });

    it('off removes listener', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        mockFetchResponse(200, { user: mockUser, session: mockSession }),
      );

      const changes: (User | null)[] = [];
      const listener = (u: User | null) => changes.push(u);
      client.on('change', listener);
      client.off('change', listener);

      await client.init();

      expect(changes).toEqual([]);
    });
  });

  describe('logout', () => {
    it('clears user and session', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(200, { user: mockUser, session: mockSession }))
        .mockResolvedValueOnce(mockFetchResponse(200)); // sign-out call

      await client.init();
      expect(client.isAuthenticated).toBe(true);

      await client.logout();
      expect(client.getUser()).toBeNull();
      expect(client.getSession()).toBeNull();
      expect(client.isAuthenticated).toBe(false);
    });

    it('emits logout and change events', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(200, { user: mockUser, session: mockSession }))
        .mockResolvedValueOnce(mockFetchResponse(200));

      await client.init();

      const events: string[] = [];
      client.on('logout', () => events.push('logout'));
      client.on('change', () => events.push('change'));

      await client.logout();

      expect(events).toEqual(['logout', 'change']);
    });

    it('still clears state if sign-out request fails', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(200, { user: mockUser, session: mockSession }))
        .mockRejectedValueOnce(new Error('network down'));

      await client.init();
      await client.logout();

      expect(client.isAuthenticated).toBe(false);
    });
  });

  describe('refresh', () => {
    it('emits logout when session expires between refreshes', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(200, { user: mockUser, session: mockSession }))
        .mockResolvedValueOnce(mockFetchResponse(401));

      await client.init();
      expect(client.isAuthenticated).toBe(true);

      const events: string[] = [];
      client.on('logout', () => events.push('logout'));

      await client.refresh();

      expect(client.isAuthenticated).toBe(false);
      expect(events).toEqual(['logout']);
    });

    it('does not emit logout if was already unauthenticated', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockFetchResponse(401))
        .mockResolvedValueOnce(mockFetchResponse(401));

      await client.init();

      const events: string[] = [];
      client.on('logout', () => events.push('logout'));

      await client.refresh();

      expect(events).toEqual([]);
    });
  });
});
