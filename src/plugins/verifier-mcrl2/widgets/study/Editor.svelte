<!-- A text editor for a study's files: CodeMirror 6, with mCRL2 highlighted by the library's own tokenizer
     (mcrl2-tokens.ts) as a stream language, and Rust, TOML, shell, TypeScript and JSON by CodeMirror's; the language
     chosen by the file's extension. Line numbers, undo, search, and Ctrl-S or
     Cmd-S to save. Drawn in the design tokens, light or dark with the page. It fills its card and scrolls inside it. One of
     the widget set. -->
<script lang="ts">
  import { onMount } from "svelte";
  import { Compartment, EditorState } from "@codemirror/state";
  import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { bracketMatching, HighlightStyle, StreamLanguage, type StreamParser, syntaxHighlighting } from "@codemirror/language";
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
  import { rust } from "@codemirror/lang-rust";
  import { toml } from "@codemirror/legacy-modes/mode/toml";
  import { shell } from "@codemirror/legacy-modes/mode/shell";
  import { json, typescript } from "@codemirror/legacy-modes/mode/javascript";
  import type { Extension } from "@codemirror/state";
  import { tags as t } from "@lezer/highlight";
  import { languageName, mcrl2Parser, type State } from "./mcrl2-tokens.ts";

  const mcrl2 = StreamLanguage.define(mcrl2Parser as unknown as StreamParser<State>);
  /** The language of a file, by its extension: its name (mcrl2-tokens.ts) and its CodeMirror extension. */
  const languageOf = (f: string): { name: string; extension: Extension | null } => {
    const ext = /\.([A-Za-z0-9]+)$/.exec(f)?.[1]?.toLowerCase() ?? "";
    const modes: Record<string, () => Extension> = {
      mcrl2: () => mcrl2,
      mcf: () => mcrl2,
      rs: () => rust(),
      toml: () => StreamLanguage.define(toml),
      sh: () => StreamLanguage.define(shell),
      ts: () => StreamLanguage.define(typescript),
      svelte: () => StreamLanguage.define(typescript),
      json: () => StreamLanguage.define(json),
    };
    return { name: languageName(f), extension: modes[ext]?.() ?? null };
  };

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

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  const language = new Compartment();
  const editable = new Compartment();

  const highlight = HighlightStyle.define([
    { tag: [t.lineComment, t.comment], color: "var(--color-text-muted)", fontStyle: "italic" },
    { tag: t.meta, color: "var(--color-line-3)", fontWeight: "600" },
    { tag: [t.keyword, t.definitionKeyword], color: "var(--color-accent)", fontWeight: "600" },
    { tag: [t.controlKeyword, t.operatorKeyword, t.modifier], color: "var(--color-line-2)" },
    { tag: [t.typeName, t.className, t.namespace], color: "var(--color-line-4)" },
    { tag: [t.number, t.bool, t.atom], color: "var(--color-line-5)" },
    { tag: [t.string, t.special(t.string)], color: "var(--color-line-6)" },
    { tag: [t.propertyName, t.attributeName, t.labelName], color: "var(--color-line-1)" },
    { tag: [t.function(t.variableName), t.macroName], color: "var(--color-line-7)" },
    { tag: t.operator, color: "var(--color-text)" },
    { tag: t.invalid, color: "var(--color-danger)" },
  ]);

  const theme = EditorView.theme({
    "&": { height: "100%", color: "var(--color-text)", backgroundColor: "var(--color-surface-sunken)", fontSize: "var(--font-size-sm)" },
    ".cm-scroller": { fontFamily: "var(--font-family-mono)", lineHeight: "var(--font-line-height-normal)" },
    ".cm-content": { caretColor: "var(--color-accent)" },
    ".cm-gutters": { backgroundColor: "var(--color-surface-sunken)", color: "var(--color-text-muted)", borderRight: "var(--border-width-thin) solid var(--color-border)" },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-accent-tint)" },
    "&.cm-focused": { outline: "var(--border-width-focus) solid var(--color-focus)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--color-accent-soft)" },
    ".cm-searchMatch": { backgroundColor: "var(--color-accent-soft)" },
    ".cm-panels": { backgroundColor: "var(--color-surface-raised)", color: "var(--color-text)" },
  });

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          bracketMatching(),
          highlightSelectionMatches(),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label }),
          language.of(languageOf(file).extension ?? []),
          editable.of([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (onsave?.(), true) },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onchange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view?.destroy();
  });

  // Another file, or the text set from outside (opened, reverted): the editor takes it; a change typed here is already in.
  $effect(() => {
    const v = view;
    if (!v) return;
    const now = v.state.doc.toString();
    if (now !== text) v.dispatch({ changes: { from: 0, to: now.length, insert: text } });
  });
  $effect(() => {
    view?.dispatch({ effects: language.reconfigure(languageOf(file).extension ?? []) });
  });
  $effect(() => {
    view?.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]) });
  });
</script>

<div class="editor" bind:this={host} data-language={languageOf(file).name}></div>

<style>
  .editor {
    block-size: 100%;
    min-block-size: 0;
    overflow: hidden;
    border-radius: var(--radius-sm);
  }
  .editor :global(.cm-editor) {
    block-size: 100%;
  }
</style>
