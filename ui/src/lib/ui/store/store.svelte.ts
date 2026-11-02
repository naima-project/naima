// The central store: one deep-reactive Svelte 5 object ($state) that holds every state machine of the app.
//
// A machine has the shape naima-codegen's Svelte backend emits: a read-only `view` of its state, `allowed(event)`,
// and one method per input of the model (its transitions). Nothing writes a machine's state except those
// methods, and the types say so: the store, its entries and every view are read-only, so a component that
// assigns to one fails the type check (svelte-check).
//
// Machines compose. Two machines side by side in the store are their product: each moves on its own inputs.
// A machine that synchronises others (parallel processes that share an action) is itself a machine, holding
// them and calling their transitions from its own; the store holds it like any other.

import { getContext, setContext } from "svelte";

/** What the store requires of a machine: a read-only view of its state. Its transitions are its methods. */
export interface Machine {
  readonly view: object;
}

/** The store: the machines by name, read only. Components read `store.<name>.view` and call its methods. */
export type Store<T extends Record<string, Machine>> = { readonly [K in keyof T]: T[K] };

/** Every machine's view as plain data, for logging, tests and persistence: a copy, never the live state. */
export type Snapshot<T extends Record<string, Machine>> = { readonly [K in keyof T]: T[K]["view"] };

const KEY = Symbol("stance-ui/store");

/** Makes the store from the app's machines. Call it once, at the root of the app, outside any component. */
export function createStore<T extends Record<string, Machine>>(machines: T): Store<T> {
  // $state makes the record itself deep-reactive; each machine keeps its own state in its own $state fields.
  const store = $state(machines);
  return store;
}

/** What every machine shows now, as plain data. */
export function snapshot<T extends Record<string, Machine>>(store: Store<T>): Snapshot<T> {
  const out: Record<string, unknown> = {};
  for (const [name, machine] of Object.entries(store)) out[name] = $state.snapshot(fields(machine.view));
  return out as Snapshot<T>;
}

/** A view's fields as a plain object: its own properties and the getters of its class. */
function fields(view: object): Record<string, unknown> {
  const out: Record<string, unknown> = { ...view };
  const proto = Object.getPrototypeOf(view);
  if (proto && proto !== Object.prototype) {
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (d.get && !key.startsWith("_")) out[key] = (view as Record<string, unknown>)[key];
    }
  }
  return out;
}

/** The context that gives the store to every component of an app: `mount(App, { target, context: storeContext(store) })`. */
export function storeContext<T extends Record<string, Machine>>(store: Store<T>): Map<unknown, unknown> {
  return new Map([[KEY, store]]);
}

/** Gives the store to every component under the one that calls this, for an app not mounted with `storeContext`. */
export function provideStore<T extends Record<string, Machine>>(store: Store<T>): Store<T> {
  return setContext(KEY, store);
}

/** The store, in a component under the root: its public view and transitions, nothing else. */
export function useStore<T extends Record<string, Machine>>(): Store<T> {
  const store = getContext<Store<T> | undefined>(KEY);
  if (!store) throw new Error("useStore: no store; call provideStore(createStore(...)) in the root component");
  return store;
}
