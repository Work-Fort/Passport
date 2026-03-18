import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './App';

const roots = new WeakMap<HTMLElement, Root>();

export function mount(el: HTMLElement, props: { connected: boolean }) {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  root.render(<App />);
}

export function unmount(el: HTMLElement) {
  const root = roots.get(el);
  if (root) {
    root.unmount();
    roots.delete(el);
  }
}

export const manifest = {
  name: 'auth',
  label: 'Admin',
  route: '/admin',
  display: 'menu' as const,
};
