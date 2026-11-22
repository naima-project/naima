// The CodeMirror 6 part of the Editor (Editor.svelte), kept apart so that the page loads it only when an editor is
// about to be seen: the library is most of what an editor weighs. Plain module of the widget set.

import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, StreamLanguage, type StreamParser, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { rust } from "@codemirror/lang-rust";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { json, typescript } from "@codemirror/legacy-modes/mode/javascript";
import { tags as t } from "@lezer/highlight";
import { mcrl2Parser, type State } from "./mcrl2-tokens.ts";

const mcrl2 = StreamLanguage.define(mcrl2Parser as unknown as StreamParser<State>);

/** The CodeMirror extension of a file's language, by its extension; none for a file of a kind it does not know. */
const languageOf = (f: string): Extension => {
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
  return modes[ext]?.() ?? [];
};

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
  ".cm-gutters": { backgroundColor: "var(--color-surface-sunken)", color: "var(--color-text-muted)", borderInlineEnd: "var(--border-width-thin) solid var(--color-border)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-accent-tint)" },
  // The focus ring is the editor's box, drawn by the component around it (a ring on the host while a part inside has focus).
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "var(--color-accent-soft)" },
  ".cm-searchMatch": { backgroundColor: "var(--color-accent-soft)" },
  ".cm-panels": { backgroundColor: "var(--color-surface-raised)", color: "var(--color-text)" },
});

export interface EditorOptions {
  /** What the editor holds, for the label read aloud. */
  label: string;
  file: string;
  text: string;
  readonly: boolean;
  onchange?: (text: string) => void;
  onsave?: () => void;
}

export interface EditorHandle {
  /** Another text from outside (opened, reverted): taken only when it differs from what the editor holds. */
  setText(text: string): void;
  setFile(file: string): void;
  setReadonly(readonly: boolean): void;
  destroy(): void;
}

/**
 * An editor in `parent`, which lies in `root` (the shadow root that holds it, so that the library's own stylesheet stays
 * out of the page's). Tab leaves the editor, as it does every other control (a keyboard is never trapped, WCAG 2.1.2);
 * Ctrl-M turns on Tab indenting, and Ctrl-M again turns it off. Mod-] and Mod-[ indent and outdent always.
 */
export function createEditor(root: ShadowRoot, parent: HTMLElement, o: EditorOptions): EditorHandle {
  const language = new Compartment();
  const editable = new Compartment();
  const access = (readonly: boolean) => [EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)];
  let tabIndents = false;
  const view = new EditorView({
    parent,
    root,
    state: EditorState.create({
      doc: o.text,
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
        EditorView.contentAttributes.of({ "aria-label": o.label }),
        language.of(languageOf(o.file)),
        editable.of(access(o.readonly)),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (o.onsave?.(), true) },
          { key: "Ctrl-m", preventDefault: true, run: () => ((tabIndents = !tabIndents), true) },
          { key: "Tab", run: (v) => (tabIndents ? indentMore(v) : false), shift: (v) => (tabIndents ? indentLess(v) : false) },
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) o.onchange?.(u.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    setText(text) {
      const now = view.state.doc.toString();
      if (now !== text) view.dispatch({ changes: { from: 0, to: now.length, insert: text } });
    },
    setFile(file) {
      view.dispatch({ effects: language.reconfigure(languageOf(file)) });
    },
    setReadonly(readonly) {
      view.dispatch({ effects: editable.reconfigure(access(readonly)) });
    },
    destroy: () => view.destroy(),
  };
}
