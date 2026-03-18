import React, { useState } from 'react';
import Users from './pages/Users';
import ServiceKeys from './pages/ServiceKeys';
import AgentKeys from './pages/AgentKeys';

type Tab = 'users' | 'service-keys' | 'agent-keys';

export default function App() {
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div style={{ padding: '1rem', maxWidth: '960px', fontFamily: 'var(--wf-font-sans)', color: 'var(--wf-color-text)' }}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--wf-color-border)', paddingBottom: '0.75rem' }}>
        {(['users', 'service-keys', 'agent-keys'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid var(--wf-color-border)',
              borderRadius: 'var(--wf-radius-sm)',
              background: tab === t ? 'var(--wf-color-bg-elevated)' : 'transparent',
              color: tab === t ? 'var(--wf-color-text)' : 'var(--wf-color-text-secondary)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 'var(--wf-text-sm)',
              fontWeight: tab === t ? 600 : 400,
            }}
          >
            {t === 'users' ? 'Users' : t === 'service-keys' ? 'Service Keys' : 'Agent Keys'}
          </button>
        ))}
      </div>

      {tab === 'users' && <Users />}
      {tab === 'service-keys' && <ServiceKeys />}
      {tab === 'agent-keys' && <AgentKeys />}
    </div>
  );
}
