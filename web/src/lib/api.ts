function fortPrefix(): string {
  const match = window.location.pathname.match(/^\/forts\/([^/]+)/);
  return match ? `/forts/${match[1]}/api/auth` : '/api/auth';
}

async function apiFetch(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${fortPrefix()}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
  });
}

export interface User {
  id: string;
  email: string;
  name: string;
  username?: string;
  displayName?: string;
  role?: string;
  type?: string;
  banned?: boolean;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export async function listUsers(): Promise<User[]> {
  const res = await apiFetch('/v1/admin/list-users');
  if (!res.ok) throw new Error('Failed to list users');
  const data = await res.json();
  return data.users ?? [];
}

export async function createUser(body: {
  email: string; password: string; name: string; role: string;
  data: { username: string; displayName: string; type: string };
}): Promise<User> {
  const res = await apiFetch('/v1/admin/create-user', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
  return res.json();
}

export async function removeUser(userId: string): Promise<void> {
  const res = await apiFetch('/v1/admin/remove-user', { method: 'POST', body: JSON.stringify({ userId }) });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
}

export async function setRole(userId: string, role: string): Promise<void> {
  const res = await apiFetch('/v1/admin/set-role', { method: 'POST', body: JSON.stringify({ userId, role }) });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
}

export async function deactivateUser(userId: string): Promise<void> {
  const res = await apiFetch('/v1/admin/ban-user', { method: 'POST', body: JSON.stringify({ userId }) });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
}

export async function reactivateUser(userId: string): Promise<void> {
  const res = await apiFetch('/v1/admin/unban-user', { method: 'POST', body: JSON.stringify({ userId }) });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
}

export async function listAllApiKeys(): Promise<ApiKey[]> {
  const res = await apiFetch('/v1/admin/api-keys');
  if (!res.ok) throw new Error('Failed to list keys');
  const data = await res.json();
  return data.keys ?? [];
}

export async function createApiKey(body: {
  prefix: string; name: string; metadata: Record<string, unknown>;
}): Promise<{ key: string; id: string }> {
  const res = await apiFetch('/v1/api-key/create', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
  return res.json();
}

export async function deleteApiKey(keyId: string): Promise<void> {
  const res = await apiFetch('/v1/api-key/delete', { method: 'POST', body: JSON.stringify({ keyId }) });
  if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
}
