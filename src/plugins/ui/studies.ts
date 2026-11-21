// The studies of a project, for the Models tab (develop/models-tab.md §2 and §3): a study is declared by a `%@ui begin` …
// `%@ui end` block in a `.mcrl2` file of the project, tracked or not yet ignored, and explained by its `%@say` lines. The
// stepper, observer and view it names are served from the declaring file's folder; the model it names is only read.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gitPath, projectFiles } from "../../core/api.ts";

export interface SayLine {
  file: string;
  line: number;
  text: string;
}

export interface Study {
  /** A slug of the declaring file's project-relative path. */
  id: string;
  /** The declaring file, relative to the project, with forward slashes. */
  file: string;
  title: string;
  says: string;
  /** The model's path relative to the project, or null. */
  model: string | null;
  /** The paths below are relative to the declaring file's folder, with forward slashes. */
  stepper: string | null;
  observer: string | null;
  view: string | null;
  config: Record<string, number | boolean>;
  /** The named standard diagrams its view draws, as declared (`name: what it maps; …`); the tab checks the names. */
  diagrams: string;
  /** The view's parts, each a card of its own (`id: title; …`); empty when the view is one card. */
  parts: { id: string; title: string }[];
  says_lines: SayLine[];
  /**
   * What each state variable is, in its author's words: the comment beside each parameter of the model's process, with
   * the section it is under; a `%@state <name>: "<text>"` line of the declaring file adds or replaces one.
   */
  state_notes: { name: string; section: string; note: string }[];
  /** Why the study cannot open, or is not as declared; empty when it is sound. */
  problems: string[];
}

const KEYS = [
  "title",
  "model",
  "stepper",
  "observer",
  "view",
  "config",
  "says",
  "diagrams",
  "parts",
];
const BEGIN = /^%@ui\s+begin\s*$/;
const END = /^%@ui\s+end\s*$/;

/** The id of the study a file declares: lowercase letters, digits and dashes. */
export const studyId = (file: string): string =>
  file.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const inside = (dir: string, rel: string): string | null => {
  if (!rel || isAbsolute(rel) || rel.includes("\u0000")) return null;
  const full = resolve(dir, rel);
  const r = relative(dir, full);
  return r === "" || r.startsWith("..") || isAbsolute(r) ? null : full;
};

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const read = (p: string): string | null => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};

const saysIn = (file: string, text: string): SayLine[] => {
  const out: SayLine[] = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*%@say(\s|$)/.test(l)) {
      out.push({ file, line: i + 1, text: l.trim() });
    }
  });
  return out;
};

/** The study a file declares, or null when it holds no `%@ui begin` line. */
function studyOf(root: string, file: string, text: string): Study | null {
  const lines = text.split(/\r?\n/);
  const begin = lines.findIndex((l) => BEGIN.test(l.trim()));
  if (begin < 0) return null;
  const study: Study = {
    id: studyId(file),
    file,
    title: file,
    says: "",
    diagrams: "",
    parts: [],
    model: null,
    stepper: null,
    observer: null,
    view: null,
    config: {},
    says_lines: saysIn(file, text),
    state_notes: [],
    problems: [],
  };
  const dir = join(root, dirname(file));
  const values: Record<string, string> = {};
  let closed = false;
  for (let n = begin + 1; n < lines.length; n++) {
    const l = lines[n]!.trim();
    if (END.test(l)) {
      closed = true;
      break;
    }
    if (l === "") continue;
    const m = /^%\s+([A-Za-z][A-Za-z-]*)(?:\s+(.*))?$/.exec(l);
    if (!m) {
      if (/^%\s*$/.test(l)) continue;
      study.problems.push(
        `line ${n + 1} of the %@ui block is not a "% key value" line`,
      );
      return study;
    }
    const key = m[1]!.toLowerCase();
    if (!KEYS.includes(key)) {
      study.problems.push(`unknown key ${key} (line ${n + 1})`);
    } else values[key] = (m[2] ?? "").trim();
  }
  if (!closed) study.problems.push("the %@ui block has no %@ui end line");
  if (values["title"]) study.title = values["title"];
  study.says = values["says"] ?? "";
  study.diagrams = values["diagrams"] ?? "";
  for (
    const part of (values["parts"] ?? "").split(";").map((p) => p.trim())
      .filter(Boolean)
  ) {
    const m = /^([a-z][a-z0-9-]*)\s*:\s*(.+)$/.exec(part);
    if (!m) study.problems.push(`the part ${part} is not "id: title"`);
    else study.parts.push({ id: m[1]!, title: m[2]!.trim() });
  }
  for (const part of (values["config"] ?? "").split(/\s+/).filter(Boolean)) {
    const eq = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(part);
    const v = eq?.[2];
    if (
      !eq || !(v === "true" || v === "false" || (/^-?\d+(\.\d+)?$/.test(v!)))
    ) {
      study.problems.push(
        `config entry ${part} is not name=number or name=true/false`,
      );
      continue;
    }
    study.config[eq[1]!] = v === "true"
      ? true
      : v === "false"
      ? false
      : Number(v);
  }
  for (const key of ["stepper", "observer", "view"] as const) {
    const rel = values[key];
    if (!rel) {
      if (key === "stepper") study.problems.push("no stepper is declared");
      continue;
    }
    const full = inside(dir, rel);
    if (full === null) {
      study.problems.push(
        `the ${key} ${rel} is outside the declaring file's folder`,
      );
      continue;
    }
    study[key] = gitPath(relative(dir, full));
    if (!isFile(full)) {
      study.problems.push(`the ${key} file ${rel} does not exist`);
    }
  }
  const model = values["model"];
  if (model) {
    const full = resolve(dir, model);
    const r = relative(root, full);
    if (isAbsolute(model) || r.startsWith("..") || isAbsolute(r)) {
      study.problems.push(`the model ${model} is outside the project`);
    } else {
      study.model = gitPath(r);
      const modelText = study.model === file ? null : read(full);
      if (modelText !== null) {
        study.says_lines.push(...saysIn(study.model, modelText));
        study.state_notes = stateNotes(modelText);
      } else if (study.model !== file && !existsSync(full)) {
        study.problems.push(`the model file ${model} does not exist`);
      }
    }
  }
  // The declaring file's own notes on the state: added, or replacing the model's.
  for (
    const m of text.matchAll(
      /^%@state\s+([A-Za-z_][\w']*)\s*:\s*"((?:[^"\\]|\\.)*)"\s*$/gm,
    )
  ) {
    const at = study.state_notes.findIndex((n) => n.name === m[1]);
    const note = {
      name: m[1]!,
      section: at >= 0 ? study.state_notes[at]!.section : "",
      note: m[2]!.replace(/\\(.)/g, "$1"),
    };
    if (at >= 0) study.state_notes[at] = note;
    else study.state_notes.push(note);
  }
  return study;
}

/**
 * The parameters of a model's process and their comments, read from its source: the first `proc <Name>(` with
 * parameters, one per line as `name: Sort, % comment`, and `% <section>` lines between them. A model written otherwise
 * gives no notes, which only leaves the state's rows without words.
 */
export function stateNotes(
  text: string,
): { name: string; section: string; note: string }[] {
  const out: { name: string; section: string; note: string }[] = [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) =>
    /^proc\s+\w+\s*\(\s*$/.test(l.trim()) ||
    /^proc\s+\w+\s*\(\s*%/.test(l.trim())
  );
  if (start < 0) return out;
  let section = "";
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (/^\)\s*=/.test(l)) break;
    const sec = /^%\s*(.+)$/.exec(l);
    if (sec) {
      section = sec[1]!.trim();
      continue;
    }
    const p = /^([A-Za-z_][\w']*)\s*:[^%]*?(?:%\s*(.*))?$/.exec(l);
    if (p) out.push({ name: p[1]!, section, note: (p[2] ?? "").trim() });
  }
  return out;
}

/** Every study of the project at `root`, in the order of their files; `program` is Naima's own folder, left out. */
export function findStudies(root: string, program?: string): Study[] {
  const out: Study[] = [];
  for (const file of projectFiles(root, program)) {
    if (!file.toLowerCase().endsWith(".mcrl2")) continue;
    const text = read(join(root, file));
    if (text === null || !/^%@ui\s+begin\s*$/m.test(text)) continue;
    const s = studyOf(root, file, text);
    if (s) out.push(s);
  }
  return out;
}

/** The folder, absolute, of the files of the study `id`: its declaring file's, or null when there is no such study. */
export function studyFolder(
  root: string,
  program: string | undefined,
  id: string,
): string | null {
  const s = findStudies(root, program).find((x) => x.id === id);
  return s ? join(root, dirname(s.file)) : null;
}
