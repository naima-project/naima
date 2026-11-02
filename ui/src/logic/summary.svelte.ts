// The summary the home screen shows: a small machine written by hand, as the stance allows for the simplest
// ones, since its three states (loading, shown, failed) have nothing a model checker would find. Its state
// changes only through its transitions; the port, given by the app, does the reading and reports back
// through them. The live updates of a later step replace the one reading at start.

/** One section of `naima summary`, as /data/summary answers it: its name and its data. */
export interface Section {
  readonly name: string;
  readonly data: unknown;
}

export type SummaryPhase = "LOADING" | "SHOWN" | "FAILED";

export interface SummaryView {
  readonly phase: SummaryPhase;
  readonly sections: readonly Section[];
  /** Why the last reading failed, when it did. */
  readonly error: string;
}

export interface SummaryPort {
  /** Read the summary now; the result comes back as `shown` or `failed`. */
  read(): void;
}

class Fields implements SummaryView {
  phase: SummaryPhase = $state.raw("LOADING");
  sections: readonly Section[] = $state.raw([]);
  error: string = $state.raw("");
}

export class Summary {
  readonly view: SummaryView;
  readonly #fields = new Fields();
  readonly #port: SummaryPort;

  constructor(port: SummaryPort) {
    this.#port = port;
    this.view = this.#fields;
    port.read();
  }

  /** The summary was read: its sections, in the order the server gave them. */
  shown(data: Record<string, unknown>): boolean {
    if (this.#fields.phase !== "LOADING") return false;
    this.#fields.sections = Object.entries(data).map(([name, d]) => ({ name, data: d }));
    this.#fields.error = "";
    this.#fields.phase = "SHOWN";
    return true;
  }

  /** The reading failed. */
  failed(why: string): boolean {
    if (this.#fields.phase !== "LOADING") return false;
    this.#fields.error = why;
    this.#fields.phase = "FAILED";
    return true;
  }

  /** Read again, after it was shown or failed. */
  reload(): boolean {
    if (this.#fields.phase === "LOADING") return false;
    this.#fields.phase = "LOADING";
    this.#port.read();
    return true;
  }
}
