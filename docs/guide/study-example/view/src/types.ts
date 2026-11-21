// What Naima's Models tab gives the lock's view and observer.

/** A function of the state, `Client -> Phase`: its default and the clients whose value differs. */
export interface Fn<V> {
  default: V;
  at: Record<string, V>;
}

/** The lock's state: the parameters of Core in ../../model/core.mcrl2, as the stepper writes them. */
export interface LockState {
  phase: Fn<string>;
  queue: string[];
  free: boolean;
}

/** A step: its label, its action and arguments, and its %@say phrase and explanation, if any. */
export interface Act {
  label: string;
  action: string;
  args: (number | boolean | string)[];
  phrase: string | null;
  text: string | null;
}

/** An input allowed now, with the outputs the lock would take in reply. */
export interface Step extends Act {
  outputs: Act[];
}

/** One entry of the path: an input, the outputs it caused, the states around it. */
export interface Entry {
  input: Act;
  outputs: Act[];
  before: LockState;
  after: LockState;
  real: boolean;
}

/** What the view receives each time the store changes. */
export interface Data<M> {
  state: LockState;
  allowed: Step[];
  memory: M | undefined;
  current: boolean;
  last: { input: Act; outputs: Act[]; real: boolean } | null;
  position: number;
  length: number;
  real: number;
}

/** The view's only link to the tab. */
export interface Host {
  readonly data: Data<unknown> | null;
  subscribe(fn: (d: Data<unknown>) => void): () => void;
  fire(label: string): Promise<{ ok: boolean; why?: string }>;
  can(label: string): Promise<{ ok: boolean; why?: string; outputs?: string[] }>;
  say(label: string): { phrase: string; text: string } | null;
}

/** The value of a function at a key. */
export const at = <V>(f: Fn<V>, k: string): V => (k in f.at ? f.at[k]! : f.default);

/** The clients, as the model declares them. */
export const CLIENTS = ["c1", "c2", "c3"] as const;

/** The lock's lifeline in the sequence diagram; each client has its own, named after it. */
export const LOCK = "the lock";
