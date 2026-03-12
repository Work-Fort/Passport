import type { User, Session, AuthEventMap } from './types.js';
import { AuthInitError } from './types.js';

type Listener<T> = (data: T) => void;

const SESSION_ENDPOINT = '/api/auth/v1/session';
const SIGNOUT_ENDPOINT = '/api/auth/v1/sign-out';
const VISIBILITY_THRESHOLD_MS = 5 * 60 * 1000;

export class AuthClient {
  private _user: User | null = null;
  private _session: Session | null = null;
  private _listeners = new Map<string, Set<Listener<any>>>();
  private _lastVisible = Date.now();
  private _visHandler: (() => void) | null = null;

  getUser(): User | null { return this._user; }
  getSession(): Session | null { return this._session; }
  get isAuthenticated(): boolean { return this._user !== null; }

  async init(): Promise<void> {
    await this._fetchSession();
    this._setupVisibilityListener();
  }

  async refresh(): Promise<void> {
    const wasAuth = this.isAuthenticated;
    await this._fetchSession();
    if (wasAuth && !this.isAuthenticated) {
      this._emit('logout', undefined as void);
    }
  }

  /** Clears session and emits events. Redirect to login is the shell's responsibility
   *  (it listens for the 'logout' event and navigates accordingly). */
  async logout(): Promise<void> {
    try {
      await fetch(SIGNOUT_ENDPOINT, { method: 'POST', credentials: 'include' });
    } catch { /* best-effort */ }
    this._user = null;
    this._session = null;
    this._emit('logout', undefined as void);
    this._emit('change', null);
  }

  on<K extends keyof AuthEventMap>(event: K, listener: Listener<AuthEventMap[K]>): void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(listener);
  }

  off<K extends keyof AuthEventMap>(event: K, listener: Listener<AuthEventMap[K]>): void {
    this._listeners.get(event)?.delete(listener);
  }

  destroy(): void {
    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }
  }

  private async _fetchSession(): Promise<void> {
    let res: Response;
    try {
      res = await fetch(SESSION_ENDPOINT, { credentials: 'include' });
    } catch (err) {
      throw new AuthInitError('Failed to reach auth service', { cause: err });
    }

    if (res.status === 401) {
      this._user = null;
      this._session = null;
      this._emit('change', null);
      return;
    }

    if (!res.ok) {
      throw new AuthInitError(`Auth service returned ${res.status}`);
    }

    let data: { user: User; session: Session };
    try {
      data = await res.json();
    } catch (err) {
      throw new AuthInitError('Invalid JSON from auth service', { cause: err });
    }

    this._user = data.user;
    this._session = data.session;
    this._emit('change', this._user);
  }

  private _setupVisibilityListener(): void {
    if (typeof document === 'undefined') return;
    this._visHandler = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - this._lastVisible > VISIBILITY_THRESHOLD_MS) {
          this.refresh().catch(() => { /* best-effort; AuthInitError is non-fatal on visibility refresh */ });
        }
      } else {
        this._lastVisible = Date.now();
      }
    };
    document.addEventListener('visibilitychange', this._visHandler);
  }

  private _emit<K extends keyof AuthEventMap>(event: K, data: AuthEventMap[K]): void {
    this._listeners.get(event)?.forEach((fn) => fn(data));
  }
}
