// Signing in: with a username and a password, with a passkey, and with a one-time code when the service asks for
// one. It is app state, so it is a machine in the store and moves only through its transitions; checking what
// was entered is the port's business, since only the service knows the answer.
//
// Written directly as a .svelte.ts class, without an mCRL2 model: five states in one line (credentials,
// checking, code, checking the code, signed in), and its one concurrency, a reply arriving while another attempt
// is under way, cannot happen, because no input is allowed while a reply is awaited.
//
// What it never does, by design (WCAG 2.2 SC 3.3.8, accessible authentication): it asks no puzzle, no CAPTCHA and
// nothing to remember or transcribe beyond the password, which a password manager can fill, and the one-time
// code, which the browser can fill from a message. It never keeps the password: it is passed to the port and
// dropped. It keeps the username, so a later step never asks for it again.

export type AuthStep = "credentials" | "checking" | "code" | "checking-code" | "signed-in";

/** The field an error is about, so the form can tie the message to it. */
export type AuthField = "username" | "password" | "code";

/** What the service answered: signed in, a one-time code needed, or refused with why, in words a person reads. */
export type AuthReply =
  | { result: "signed-in" }
  | { result: "code" }
  | { result: "refused"; error: string; field?: AuthField };

export interface AuthView {
  readonly step: AuthStep;
  /** Why the last attempt was refused, in words, or null. */
  readonly error: string | null;
  /** The field the error is about, or null for an error about the whole attempt. */
  readonly field: AuthField | null;
  /** The username given, kept for the next steps. */
  readonly username: string;
  /** Whether signing in with a passkey is offered: the port can do it. */
  readonly passkey: boolean;
}

export interface AuthPort {
  /** Checks a username and a password. */
  password(username: string, password: string): Promise<AuthReply>;
  /** Signs in with a passkey (WebAuthn); absent when the service or the browser has none. */
  passkey?(): Promise<AuthReply>;
  /** Checks a one-time code. */
  code(code: string): Promise<AuthReply>;
}

export type AuthEvent =
  | { type: "password" }
  | { type: "passkey" }
  | { type: "code" }
  | { type: "back" };

export class Auth {
  #step: AuthStep = $state("credentials");
  #error: string | null = $state(null);
  #field: AuthField | null = $state(null);
  #username = $state("");
  readonly view: AuthView;
  readonly #port: AuthPort;

  constructor(port: AuthPort) {
    this.#port = port;
    const self = () => ({ step: this.#step, error: this.#error, field: this.#field, username: this.#username });
    const passkey = typeof port.passkey === "function";
    this.view = {
      get step() {
        return self().step;
      },
      get error() {
        return self().error;
      },
      get field() {
        return self().field;
      },
      get username() {
        return self().username;
      },
      passkey,
    };
  }

  allowed(event: AuthEvent): boolean {
    switch (event.type) {
      case "password":
        return this.#step === "credentials";
      case "passkey":
        return this.#step === "credentials" && this.view.passkey;
      case "code":
      case "back":
        return this.#step === "code";
    }
  }

  /** Signs in with a username and a password. An empty one is refused here, with the field it is about. */
  async password(username: string, password: string): Promise<boolean> {
    if (!this.allowed({ type: "password" })) return false;
    const name = username.trim();
    if (!name) return this.#refuse({ result: "refused", error: "Enter your username.", field: "username" });
    if (!password) return this.#refuse({ result: "refused", error: "Enter your password.", field: "password" });
    this.#username = name;
    this.#step = "checking";
    this.#settle(await this.#ask(() => this.#port.password(name, password)), "credentials");
    return true;
  }

  /** Signs in with a passkey, through the port. */
  async passkey(): Promise<boolean> {
    if (!this.allowed({ type: "passkey" }) || !this.#port.passkey) return false;
    this.#step = "checking";
    this.#settle(await this.#ask(() => this.#port.passkey!()), "credentials");
    return true;
  }

  /** Gives the one-time code the service asked for. */
  async code(code: string): Promise<boolean> {
    if (!this.allowed({ type: "code" })) return false;
    const given = code.replace(/\s+/g, "");
    if (!given) return this.#refuse({ result: "refused", error: "Enter the code you received.", field: "code" });
    this.#step = "checking-code";
    this.#settle(await this.#ask(() => this.#port.code(given)), "code");
    return true;
  }

  /** Leaves the code step for the credentials, to sign in another way. */
  back(): boolean {
    if (!this.allowed({ type: "back" })) return false;
    this.#step = "credentials";
    this.#error = null;
    this.#field = null;
    return true;
  }

  async #ask(call: () => Promise<AuthReply>): Promise<AuthReply> {
    try {
      return await call();
    } catch {
      return { result: "refused", error: "The service did not answer. Try again in a moment." };
    }
  }

  #refuse(reply: AuthReply & { result: "refused" }): false {
    this.#error = reply.error;
    this.#field = reply.field ?? null;
    return false;
  }

  #settle(reply: AuthReply, back: "credentials" | "code") {
    this.#error = null;
    this.#field = null;
    if (reply.result === "signed-in") this.#step = "signed-in";
    else if (reply.result === "code") this.#step = "code";
    else {
      this.#step = back;
      this.#refuse(reply);
    }
  }
}
