// The theme the user chose: light, dark, or whatever the system prefers. The choice is app state, so it is a
// machine in the store and changes only through its transition, `choose`. It is written directly as a
// .svelte.ts class because a model of three states and one input would prove nothing a reader cannot see.
// Showing the choice (setting data-theme on the page, remembering it) is the port's output.

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

export interface ThemeView {
  readonly choice: ThemeChoice;
}

export interface ThemePort {
  /** Carries the choice out: the page shows that theme from now on. */
  apply(choice: ThemeChoice): void;
}

export class Theme {
  #choice: ThemeChoice = $state("system");
  readonly view: ThemeView;
  readonly #port: ThemePort;

  constructor(config: { initial?: ThemeChoice } = {}, port: ThemePort = { apply() {} }) {
    this.#port = port;
    if (config.initial && THEME_CHOICES.includes(config.initial)) this.#choice = config.initial;
    const choice = () => this.#choice;
    this.view = {
      get choice() {
        return choice();
      },
    };
    port.apply(this.#choice);
  }

  allowed(event: { type: "choose"; choice: ThemeChoice }): boolean {
    return THEME_CHOICES.includes(event.choice) && event.choice !== this.#choice;
  }

  choose(choice: ThemeChoice): boolean {
    if (!this.allowed({ type: "choose", choice })) return false;
    this.#choice = choice;
    this.#port.apply(choice);
    return true;
  }
}
