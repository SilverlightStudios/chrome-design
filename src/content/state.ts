import { useSyncExternalStore } from 'react';

/**
 * The one way UI state is kept: a value replaced as a whole, listeners told after each change.
 * Works with React (`useStore`) and in plain tests. The editor (store.ts) and the walkthrough
 * recorder are both one of these.
 */
export class Store<S> {
  protected state: S;
  private listeners = new Set<() => void>();

  constructor(initial: S) {
    this.state = initial;
  }

  getState = (): S => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<S>): void {
    this.replace({ ...this.state, ...patch });
  }

  protected replace(next: S): void {
    this.state = next;
    for (const l of this.listeners) l();
  }
}

/** A slice of a store's state. Selectors must return stable references or primitives. */
export function useStore<S, T>(store: Store<S>, selector: (state: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
