<!-- The sign-in form, built from Field, Checkbox, Button and Text. It is the only place in a project where a password or
     a one-time code is asked for (the auth-only check refuses one anywhere else), so that every sign-in meets WCAG 2.2's
     accessible authentication (SC 3.3.8): the fields carry the autocomplete a password manager and the browser fill,
     pasting is never blocked, the password can be shown, a passkey is offered when the service has one, the one-time
     code can be filled from the message that brought it, and no puzzle is ever asked.

     Like every widget it reads no store: the app passes the sign-in machine's view and its transitions. What is being
     typed, and whether the password is shown, is this component's own state; the password is handed over and never
     kept. -->
<script lang="ts">
  import type { AuthView } from "../auth/auth.svelte.ts";
  import Button from "./Button.svelte";
  import Checkbox from "./Checkbox.svelte";
  import Field from "./Field.svelte";
  import Stack from "./Stack.svelte";
  import Text from "./Text.svelte";

  interface Props {
    view: AuthView;
    onpassword: (username: string, password: string) => void;
    onpasskey?: () => void;
    oncode: (code: string) => void;
    onback?: () => void;
    /** What the code step says about where the code was sent. */
    codeHint?: string;
  }

  let { view, onpassword, onpasskey, oncode, onback, codeHint = "Enter the code we just sent you." }: Props = $props();

  let username = $state("");
  let password = $state("");
  let code = $state("");
  let shown = $state(false);

  const busy = $derived(view.step === "checking" || view.step === "checking-code");
  const about = (field: "username" | "password" | "code") => (view.field === field ? view.error : null);
  const general = $derived(view.error && !view.field ? view.error : null);

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (view.step === "credentials") {
      onpassword(username, password);
      password = "";
    } else if (view.step === "code") {
      oncode(code);
      code = "";
    }
  }
</script>

<form class="auth" onsubmit={submit} aria-busy={busy}>
  <Stack gap="md">
    {#if view.step === "signed-in"}
      <Text live="polite">Signed in as {view.username}.</Text>
    {:else if view.step === "code" || view.step === "checking-code"}
      <Text>{codeHint}</Text>
      <Field
        label="One-time code"
        bind:value={code}
        autocomplete="one-time-code"
        inputmode="numeric"
        invalid={!!about("code")}
        message={about("code") ?? undefined}
      />
      {#if general}<Text tone="danger" live="assertive">{general}</Text>{/if}
      <Stack gap="sm">
        <Button variant="primary" type="submit" disabled={busy}>Continue</Button>
        {#if onback}<Button variant="ghost" onclick={onback} disabled={busy}>Sign in another way</Button>{/if}
      </Stack>
    {:else}
      <Field
        label="Username"
        bind:value={username}
        autocomplete={view.passkey ? "username webauthn" : "username"}
        autocapitalize="none"
        spellcheck={false}
        invalid={!!about("username")}
        message={about("username") ?? undefined}
      />
      <Field
        label="Password"
        bind:value={password}
        type={shown ? "text" : "password"}
        autocomplete="current-password"
        autocapitalize="none"
        spellcheck={false}
        invalid={!!about("password")}
        message={about("password") ?? undefined}
      />
      <Checkbox bind:checked={shown}>Show password</Checkbox>
      {#if general}<Text tone="danger" live="assertive">{general}</Text>{/if}
      <Stack gap="sm">
        <Button variant="primary" type="submit" disabled={busy}>Sign in</Button>
        {#if view.passkey && onpasskey}
          <Button onclick={onpasskey} disabled={busy}>Sign in with a passkey</Button>
        {/if}
      </Stack>
    {/if}
  </Stack>
</form>

<style>
  .auth {
    max-width: var(--size-panel-width);
  }
</style>
