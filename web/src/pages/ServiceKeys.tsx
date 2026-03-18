import React, { useEffect, useState } from 'react';
import { listAllApiKeys, createApiKey, deleteApiKey, type ApiKey } from '../lib/api';

export default function ServiceKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [revealKey, setRevealKey] = useState('');

  const refresh = async () => {
    try {
      const all = await listAllApiKeys();
      setKeys(all.filter((k) => k.metadata?.type === 'service'));
      setError('');
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { refresh(); }, []);

  const handleRevoke = async (k: ApiKey) => {
    if (!confirm(`Revoke service key "${k.name}"?`)) return;
    try { await deleteApiKey(k.id); await refresh(); } catch (e: any) { setError(e.message); }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name') as string;
    try {
      const result = await createApiKey({ prefix: 'wf-svc', name, metadata: { type: 'service' } });
      setShowCreate(false);
      setRevealKey(result.key);
      await refresh();
    } catch (err: any) { setError(err.message); }
  };

  const btnStyle: React.CSSProperties = {
    padding: '0.25rem 0.5rem', border: '1px solid var(--wf-color-border)',
    borderRadius: 'var(--wf-radius-sm)', background: 'transparent',
    color: 'var(--wf-color-text-secondary)', cursor: 'pointer', fontSize: 'var(--wf-text-xs)', fontFamily: 'inherit',
  };
  const dangerBtn: React.CSSProperties = { ...btnStyle, borderColor: 'var(--wf-color-danger)', color: 'var(--wf-color-danger)' };
  const primaryBtn: React.CSSProperties = { ...btnStyle, background: 'var(--wf-color-primary)', color: '#fff', borderColor: 'var(--wf-color-primary)' };
  const inputStyle: React.CSSProperties = {
    display: 'block', width: '100%', padding: '0.5rem', marginTop: '0.25rem',
    border: '1px solid var(--wf-color-border)', borderRadius: 'var(--wf-radius-sm)',
    background: 'var(--wf-color-bg-elevated)', color: 'var(--wf-color-text)', fontFamily: 'inherit', fontSize: 'var(--wf-text-sm)',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--wf-text-lg)' }}>Service Keys</h2>
        <button style={primaryBtn} onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ Create Service Key'}
        </button>
      </div>

      {error && <div style={{ padding: '0.5rem', marginBottom: '1rem', background: 'var(--wf-color-danger)', color: '#fff', borderRadius: 'var(--wf-radius-sm)', fontSize: 'var(--wf-text-sm)' }}>{error}</div>}

      {revealKey && (
        <div style={{ padding: '1rem', marginBottom: '1rem', border: '1px solid var(--wf-color-warning)', borderRadius: 'var(--wf-radius-sm)', background: 'var(--wf-color-bg-elevated)' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'var(--wf-color-warning)', fontSize: 'var(--wf-text-sm)' }}>Copy this key now — it won't be shown again.</div>
          <div style={{ fontFamily: 'var(--wf-font-mono)', fontSize: 'var(--wf-text-sm)', wordBreak: 'break-all', padding: '0.5rem', background: 'var(--wf-color-bg)', borderRadius: 'var(--wf-radius-sm)' }}>{revealKey}</div>
          <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button style={primaryBtn} onClick={() => { navigator.clipboard.writeText(revealKey); }}>Copy</button>
            <button style={btnStyle} onClick={() => setRevealKey('')}>Done</button>
          </div>
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--wf-color-border)', borderRadius: 'var(--wf-radius-sm)' }}>
          <label style={{ fontSize: 'var(--wf-text-sm)' }}>Key Name<input name="name" type="text" required placeholder="e.g. sharkfin-prod" style={inputStyle} /></label>
          <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" style={primaryBtn}>Create</button>
          </div>
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {keys.map((k) => (
          <div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', border: '1px solid var(--wf-color-border)', borderRadius: 'var(--wf-radius-sm)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--wf-text-sm)' }}>{k.name}</div>
              <div style={{ fontSize: 'var(--wf-text-xs)', color: 'var(--wf-color-text-secondary)' }}>{k.prefix}••• · Created {new Date(k.createdAt).toLocaleDateString()}</div>
            </div>
            <button style={dangerBtn} onClick={() => handleRevoke(k)}>Revoke</button>
          </div>
        ))}
        {keys.length === 0 && <div style={{ color: 'var(--wf-color-text-secondary)', fontSize: 'var(--wf-text-sm)' }}>No service keys. Create one to connect a service like Sharkfin.</div>}
      </div>
    </div>
  );
}
