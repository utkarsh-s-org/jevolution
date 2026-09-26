import type { DecisionTrace } from './types.js';

// Bounded history includes recently deceased animals so their final response stays inspectable.
export class DecisionJournal {
  private animals = new Map<number, DecisionTrace[]>();
  private listeners = new Set<(animalId: number | null) => void>();
  get(animalId: number) {
    return this.animals.get(animalId) || [];
  }
  snapshot() {
    return Object.fromEntries(this.animals);
  }
  update(trace: DecisionTrace) {
    const history = this.get(trace.animalId).filter((item) => item.id !== trace.id);
    this.animals.delete(trace.animalId);
    this.animals.set(trace.animalId, [trace, ...history].slice(0, 5));
    if (this.animals.size > 256) this.animals.delete(this.animals.keys().next().value!);
    this.notify(trace.animalId);
  }
  clear() {
    this.animals.clear();
    this.notify(null);
  }
  private notify(animalId: number | null) {
    for (const listener of this.listeners) {
      try {
        listener(animalId);
      } catch {
        this.listeners.delete(listener);
      } // A disconnected viewer must not affect a decision.
    }
  }
  subscribe(listener: (animalId: number | null) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
