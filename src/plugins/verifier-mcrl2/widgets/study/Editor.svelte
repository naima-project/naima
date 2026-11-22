<!-- A text editor for a study's files: CodeMirror 6, with mCRL2 highlighted by the library's own tokenizer
     (mcrl2-tokens.ts) as a stream language, and Rust, TOML, shell, TypeScript and JSON by CodeMirror's; the language
     chosen by the file's extension. Line numbers, undo, search, and Ctrl-S or Cmd-S to save. Tab leaves the editor
     like every control (Ctrl-M turns Tab indenting on; Mod-] and Mod-[ indent always). Drawn in the design tokens,
     light or dark with the page. It fills its card and scrolls inside it. CodeMirror (editor-cm.ts) is loaded when
     the editor is about to be seen, its own stylesheet inside a shadow root of the editor's own, and until then the
     text shows plainly. One of the widget set. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { languageName } from "./mcrl2-tokens.ts";
  import type { EditorHandle } from "./editor-cm.ts";

  interface Props {
    /** What the editor holds, for the label read aloud. */
    label: string;
    /** The file's name, which chooses the language. */
    file: string;
    text: string;
    readonly?: boolean;
    onchange?: (text: string) => void;
    onsave?: () => void;
  }
  let { label, file, text, readonly = false, onchange, onsave }: Props = $props();

  /** Inside the shadow root: what CodeMirror's own box and the text shown before it loads are drawn with. */
  const INSIDE = `
    :host { display: block; }
    .mount { block-size: 100%; }
    .plain { margin: 0; padding: var(--space-xs) var(--space-sm); white-space: pre-wrap; overflow-wrap: anywhere;
      font-family: var(--font-family-mono); font-size: var(--font-size-sm); line-height: var(--font-line-height-normal);
      color: var(--color-text); background: var(--color-surface-sunken); }
  `;

  let host: HTMLDivElement;
  let handle: EditorHandle | null = $state.raw(null);
  onMount(() => {
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = INSIDE;
    const plain = document.createElement("pre");
    plain.className = "plain";
    plain.textContent = text;
    root.append(style, plain);
    let gone = false;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      import("./editor-cm.ts").then(({ createEditor }) => {
        if (gone) return;
        const mount = document.createElement("div");
        mount.className = "mount";
        root.append(mount);
        handle = createEditor(root, mount, { label, file, text, readonly, onchange, onsave });
        plain.remove();
      });
    }, { rootMargin: "200px" });
    seen.observe(host);
    return () => {
      gone = true;
      seen.disconnect();
      handle?.destroy();
    };
  });

  // Another file, or the text set from outside (opened, reverted): the editor takes it; a change typed here is already in.
  $effect(() => {
    handle?.setText(text);
  });
  $effect(() => {
    handle?.setFile(file);
  });
  $effect(() => {
    handle?.setReadonly(readonly);
  });
</script>

<div class="editor" bind:this={host} role="group" aria-label={label} data-language={languageName(file)}></div>

<style>
  .editor {
    block-size: 100%;
    min-block-size: 0;
    border-radius: var(--radius-sm);
  }
  .editor:focus-within {
    outline: var(--border-width-focus) solid var(--color-focus);
    outline-offset: calc(-1 * var(--border-width-focus));
  }
</style>
