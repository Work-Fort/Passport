import React, { useEffect, useState } from 'react';
import { listUsers, removeUser, setRole, deactivateUser, reactivateUser, createUser, type User } from '../lib/api';

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const refresh = async () => {
    try { setUsers(await listUsers()); setError(''); }
    catch (e: any) { setError(e.message); }
  };
  useEffect(() => { refresh(); }, []);

  const handleDelete = async (u: User) => {
    if (!confirm(`Delete user ${u.username ?? u.email}?`)) return;
    try { await removeUser(u.id); await refresh(); } catch (e: any) { setError(e.message); }
  };

  const handleToggleActive = async (u: User) => {
    try { u.banned ? await reactivateUser(u.id) : await deactivateUser(u.id); await refresh(); }
    catch (e: any) { setError(e.message); }
  };

  const handleRoleChange = async (u: User) => {
    const newRole = u.role === 'admin' ? 'user' : 'admin';
    try { await setRole(u.id, newRole); await refresh(); } catch (e: any) { setError(e.message); }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await createUser({
        email: form.get('email') as string,
        password: form.get('password') as string,
        name: form.get('displayName') as string || form.get('username') as string,
        role: form.get('role') as string || 'user',
        data: {
          username: form.get('username') as string,
          displayName: form.get('displayName') as string || form.get('username') as string,
          type: 'user',
        },
      });
      setShowCreate(false);
      await refresh();
    } catch (err: any) { setError(err.message); }
  };

  const btnStyle: React.CSSProperties = {
    padding: '0.25rem 0.5rem', border: '1px solid var(--wf-color-border)',
    borderRadius: 'var(--wf-radius-sm)', background: 'transparent',
    color: 'var(--wf-color-text-secondary)', cursor: 'pointer', fontSize: 'var(--wf-text-xs)',
    fontFamily: 'inherit',
  };
  const dangerBtn: React.CSSProperties = { ...btnStyle, borderColor: 'var(--wf-color-danger)', color: 'var(--wf-color-danger)' };
  const primaryBtn: React.CSSProperties = { ...btnStyle, background: 'var(--wf-color-primary)', color: '#fff', borderColor: 'var(--wf-color-primary)' };
  const inputStyle: React.CSSProperties = {
    display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem',
    border: '1px solid var(--wf-color-border)', borderRadius: 'var(--wf-radius-sm)',
    background: 'var(--wf-color-bg-elevated)', color: 'var(--wf-color-text)',
    fontFamily: 'inherit', fontSize: 'var(--wf-text-sm)',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--wf-text-lg)' }}>Users</h2>
        <button style={primaryBtn} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ Create User'}
        </button>
      </div>

      {error && <div style={{ padding: '0.5rem', marginBottom: '1rem', background: 'var(--wf-color-danger)', color: '#fff', borderRadius: 'var(--wf-radius-sm)', fontSize: 'var(--wf-text-sm)' }}>{error}</div>}

      {showCreate && (
        <form onSubmit={handleCreate} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--wf-color-border)', borderRadius: 'var(--wf-radius-sm)' }}>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: '1fr 1fr' }}>
            <label style={{ fontSize: 'var(--wf-text-sm)' }}>Email<input name="email" type="email" required style={inputStyle} /></label>
            <label style={{ fontSize: 'var(--wf-text-sm)' }}>Username<input name="username" type="text" required style={inputStyle} /></label>
            <label style={{ fontSize: 'var(--wf-text-sm)' }}>Display Name<input name="displayName" type="text" style={inputStyle} /></label>
            <label style={{ fontSize: 'var(--wf-text-sm)' }}>Password<input name="password" type="password" required minLength={8} style={inputStyle} /></label>
            <label style={{ fontSize: 'var(--wf-text-sm)' }}>Role
              <select name="role" style={inputStyle}><option value="user">User</option><option value="admin">Admin</option></select>
            </label>
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" style={primaryBtn}>Create</button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {users.map((u) => (
          <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', border: '1px solid var(--wf-color-border)', borderRadius: 'var(--wf-radius-sm)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--wf-text-sm)' }}>{u.username ?? u.email}</div>
              <div style={{ fontSize: 'var(--wf-text-xs)', color: 'var(--wf-color-text-secondary)' }}>
                {u.email} · {u.role ?? 'user'} · {u.banned ? 'inactive' : 'active'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              <button style={btnStyle} onClick={() => handleRoleChange(u)}>{u.role === 'admin' ? 'Demote' : 'Promote'}</button>
              <button style={btnStyle} onClick={() => handleToggleActive(u)}>{u.banned ? 'Reactivate' : 'Deactivate'}</button>
              <button style={dangerBtn} onClick={() => handleDelete(u)}>Delete</button>
            </div>
          </div>
        ))}
        {users.length === 0 && <div style={{ color: 'var(--wf-color-text-secondary)', fontSize: 'var(--wf-text-sm)' }}>No users.</div>}
      </div>
    </div>
  );
}
