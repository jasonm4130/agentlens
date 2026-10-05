/** A minimal typed event emitter. A throwing listener cannot stop the others. */
export interface Emitter<M> {
  on<K extends keyof M>(event: K, cb: (payload: M[K]) => void): () => void;
  emit<K extends keyof M>(event: K, payload: M[K]): void;
  clear(): void;
}

export function createEmitter<M>(): Emitter<M> {
  const listeners = new Map<keyof M, Set<(payload: never) => void>>();
  return {
    on(event, cb) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb);
      return () => void set.delete(cb);
    },
    emit(event, payload) {
      for (const cb of listeners.get(event) ?? []) {
        try {
          (cb as (p: typeof payload) => void)(payload);
        } catch {
          // Consumer errors stay out of the detector.
        }
      }
    },
    clear: () => listeners.clear(),
  };
}
