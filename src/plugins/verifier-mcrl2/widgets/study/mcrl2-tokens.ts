// mCRL2 for the editor: a CodeMirror stream language for mCRL2 specifications (.mcrl2)
// and modal mu-calculus formulas (.mcf), which share their data language. It marks comments, the annotations (%@…) in
// comments (%@ui, %@say, %@input, %@order, %@state …), the section keywords (sort, act, proc, init …), the process
// operators (sum, allow, comm, hide …), the sorts built in, the formulas' fixpoints and quantifiers, numbers, process
// names (capitalised) and the operators. It highlights; it does not parse: a mistake is the toolset's to report.
// Written against CodeMirror's stream interface with no import of it, so that it is tested without the editor;
// Editor.svelte makes it a CodeMirror language.

/** What the tokenizer reads of CodeMirror's StringStream. */
export interface Stream {
  eatSpace(): boolean;
  peek(): string | undefined;
  next(): string | void;
  skipToEnd(): void;
  match(pattern: string | RegExp): boolean | RegExpMatchArray | null;
}

/** The words of mCRL2, by the tag each is drawn with. */
export const MCRL2_WORDS = {
  /** The sections of a specification. */
  sections: ["sort", "cons", "map", "var", "eqn", "act", "proc", "init", "glob", "pbes", "form"],
  /** The process operators and constants. */
  operators: ["sum", "allow", "block", "hide", "rename", "comm", "delta", "tau", "dist"],
  /** The data language's words. */
  data: ["struct", "whr", "end", "lambda", "forall", "exists", "if", "div", "mod", "in", "val"],
  /** The formulas' fixpoints. */
  fixpoints: ["mu", "nu"],
  /** The sorts built in. */
  sorts: ["Bool", "Pos", "Nat", "Int", "Real", "List", "Set", "Bag", "FSet", "FBag"],
  /** The constants. */
  atoms: ["true", "false", "nil"],
} as const;

const tagOf = new Map<string, string>([
  ...MCRL2_WORDS.sections.map((w) => [w, "keyword"] as const),
  ...MCRL2_WORDS.operators.map((w) => [w, "controlKeyword"] as const),
  ...MCRL2_WORDS.data.map((w) => [w, "operatorKeyword"] as const),
  ...MCRL2_WORDS.fixpoints.map((w) => [w, "definitionKeyword"] as const),
  ...MCRL2_WORDS.sorts.map((w) => [w, "typeName"] as const),
  ...MCRL2_WORDS.atoms.map((w) => [w, "bool"] as const),
]);

/** The operators, longest first, so that `->` is one token and not `-` then `>`. */
const OPERATORS = [
  "<=>",
  "=>",
  "->",
  "<>",
  "||_",
  "||",
  "|>",
  "<|",
  "++",
  "&&",
  "==",
  "!=",
  "<=",
  ">=",
  "|",
  "+",
  "-",
  "*",
  ".",
  "!",
  "<",
  ">",
  "#",
  "=",
  ":",
  "@",
];

export interface State {
  /** Inside a %@ui block: its lines are keys and values, not prose. */
  ui: boolean;
}

export const mcrl2Parser = {
  name: "mcrl2",
  startState: (): State => ({ ui: false }),
  token(stream: Stream, state: State): string | null {
    if (stream.eatSpace()) return null;
    if (stream.peek() === "%") {
      // An annotation in a comment: the tag, then the rest of the line as the comment it is.
      const tag = stream.match(/^%@[A-Za-z-]+(\s+(begin|end))?/) as RegExpMatchArray | null;
      if (tag) {
        if (/%@ui\s+begin/.test(tag[0])) state.ui = true;
        if (/%@ui\s+end/.test(tag[0])) state.ui = false;
        return "meta";
      }
      if (state.ui && stream.match(/^%\s+[A-Za-z][A-Za-z-]*/)) return "propertyName";
      stream.skipToEnd();
      return "lineComment";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_']*/) as RegExpMatchArray | null;
    if (word) {
      const tag = tagOf.get(word[0]);
      if (tag) return tag;
      return /^[A-Z]/.test(word[0]) ? "className" : "variableName";
    }
    for (const op of OPERATORS) if (stream.match(op)) return "operator";
    if (stream.match(/^[()[\]{},;]/)) return "punctuation";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "%" } },
};

/** The name of a file's language, as the editor's card says it, by its extension. */
export function languageName(file: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(file)?.[1]?.toLowerCase() ?? "";
  return ({
    mcrl2: "mCRL2",
    mcf: "mCRL2 formula",
    rs: "Rust",
    toml: "TOML",
    sh: "shell",
    ts: "TypeScript",
    svelte: "TypeScript",
    json: "JSON",
  } as Record<string, string>)[ext] ?? "text";
}
