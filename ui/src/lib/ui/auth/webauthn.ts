// A passkey in a browser, for the sign-in machine's port: the service gives the request's options (its challenge),
// the browser asks the person's authenticator, and the service checks what it signed. The service's two calls are
// the app's; this only joins them to the Web Authentication API.
import type { AuthReply } from "./auth.svelte.ts";

/** Whether this browser can sign in with a passkey at all. */
export function passkeySupported(): boolean {
  return typeof globalThis.PublicKeyCredential === "function" && !!globalThis.navigator?.credentials;
}

/**
 * The port's `passkey`: `options` fetches the service's request options, `verify` sends the signed answer back and
 * returns the service's reply. A cancelled or failed request is a refusal said in words.
 */
export function webauthnPasskey(
  options: () => Promise<PublicKeyCredentialRequestOptions>,
  verify: (credential: PublicKeyCredential) => Promise<AuthReply>,
): () => Promise<AuthReply> {
  return async () => {
    let credential: Credential | null;
    try {
      credential = await navigator.credentials.get({ publicKey: await options(), mediation: "optional" });
    } catch {
      return { result: "refused", error: "The passkey was not used. Try again, or sign in with your password." };
    }
    if (!(credential instanceof PublicKeyCredential)) {
      return { result: "refused", error: "No passkey was given. Sign in with your password instead." };
    }
    return verify(credential);
  };
}
