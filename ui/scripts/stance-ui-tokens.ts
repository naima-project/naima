// Turns one mood board, a set of token files in the W3C Design Tokens (DTCG) format, into CSS custom
// properties. Style Dictionary reads the DTCG files and resolves aliases; the transforms below write each
// DTCG type as CSS, since the stable DTCG format (2025.10) gives colors, dimensions and durations as
// objects, which Style Dictionary's built-in CSS transforms do not all read.
//
//   deno task tokens [--mood white | --tokens <folder>] [--out dist/tokens.css]

import { fileURLToPath } from "node:url";
import StyleDictionary from "style-dictionary";
import type { TransformedToken } from "style-dictionary/types";

type Dim = { value: number; unit: string };
type Color = { colorSpace: string; components: number[]; alpha?: number; hex?: string };
type Shadow = { color: Color; offsetX: Dim; offsetY: Dim; blur: Dim; spread: Dim; inset?: boolean };

const num = (n: number) => String(Math.round(n * 10000) / 10000);
export const dim = (d: Dim): string => d.value === 0 ? "0" : `${num(d.value)}${d.unit}`;

export function color(c: Color): string {
  if (c.colorSpace !== "srgb") throw new Error(`colorSpace ${c.colorSpace} is not written as CSS yet`);
  const [r, g, b] = c.components.map((x) => Math.round(x * 255));
  const hex = c.hex ?? "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return c.alpha === undefined || c.alpha === 1 ? hex : `rgb(${r} ${g} ${b} / ${num(c.alpha)})`;
}

const fontName = (f: string) => /^[a-z-]+$/.test(f) ? f : `"${f}"`;

/** The CSS for one token's resolved value, by its DTCG type. */
export function css(type: string, v: unknown): string {
  switch (type) {
    case "color":
      return color(v as Color);
    case "dimension":
    case "duration":
      return dim(v as Dim);
    case "fontFamily":
      return Array.isArray(v) ? v.map(fontName).join(", ") : fontName(String(v));
    case "fontWeight":
    case "number":
      return String(v);
    case "cubicBezier":
      return `cubic-bezier(${(v as number[]).map(num).join(", ")})`;
    case "shadow": {
      const list = Array.isArray(v) ? v as Shadow[] : [v as Shadow];
      return list.map((s) =>
        [s.inset ? "inset" : "", dim(s.offsetX), dim(s.offsetY), dim(s.blur), dim(s.spread), color(s.color)].filter(
          Boolean,
        )
          .join(" ")
      ).join(", ");
    }
    default:
      throw new Error(`token type ${type} is not written as CSS yet`);
  }
}

StyleDictionary.registerTransform({
  name: "stance/dtcg-css",
  type: "value",
  transitive: true,
  filter: (t: TransformedToken) => t.$type !== undefined,
  transform: (t: TransformedToken) => css(t.$type as string, t.$value),
});

/** One theme of a mood board: its name and the token files that make it, in the order they apply. */
export interface Theme {
  name: string;
  files: string[];
}

/** What a mood board's resolver says, or why it cannot be read. */
export interface Resolved {
  /** The themes, the default one first. A folder with no resolver has one theme, "default". */
  themes: Theme[];
  /** The resolver file, relative to the folder, if there is one. */
  resolver?: string;
  errors: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads a mood board's themes. A mood board with themes has one `*.resolver.json` file in the DTCG Resolver
 * Module format (2025.10): sets that every theme shares, and one modifier, `theme`, whose contexts are the
 * themes (`light` and `dark`). A folder without a resolver is one theme made of its `*.tokens.json` files.
 * Paths in the result are relative to `dir`.
 */
export async function readThemes(dir: string): Promise<Resolved> {
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile) names.push(e.name);
  const resolvers = names.filter((n) => n.endsWith(".resolver.json"));
  if (resolvers.length === 0) {
    return { themes: [{ name: "default", files: names.filter((n) => n.endsWith(".tokens.json")).sort() }], errors: [] };
  }
  const resolver = resolvers.sort()[0];
  const errors: string[] = resolvers.length > 1 ? [`more than one resolver: ${resolvers.join(", ")}`] : [];
  let doc: unknown;
  try {
    doc = JSON.parse(await Deno.readTextFile(`${dir}/${resolver}`));
  } catch (e) {
    return { themes: [], resolver, errors: [`not JSON: ${(e as Error).message}`] };
  }
  if (!isObject(doc)) return { themes: [], resolver, errors: ["a resolver is a JSON object"] };
  if (doc.version !== "2025.10") errors.push(`version must be "2025.10", not ${JSON.stringify(doc.version)}`);
  const sets = isObject(doc.sets) ? doc.sets : {};
  const modifiers = isObject(doc.modifiers) ? doc.modifiers : {};
  const order = Array.isArray(doc.resolutionOrder) ? doc.resolutionOrder : null;
  if (!order) return { themes: [], resolver, errors: [...errors, "resolutionOrder must be a list"] };
  /** The files a list of sources names; inline tokens are not used by the stance. */
  const files = (sources: unknown, where: string): string[] => {
    if (!Array.isArray(sources)) {
      errors.push(`${where}: sources must be a list`);
      return [];
    }
    const out: string[] = [];
    for (const s of sources) {
      const ref = isObject(s) ? s.$ref : undefined;
      if (typeof ref !== "string" || ref.startsWith("#")) {
        errors.push(`${where}: each source is a {"$ref": "<file>"}`);
      } else if (!names.includes(ref) && !ref.includes("/")) {
        errors.push(`${where}: ${ref} is not a file of the mood board`);
      } else out.push(ref);
    }
    return out;
  };
  const shared: string[] = [];
  let modifier: string | null = null;
  let contexts: Record<string, unknown> = {};
  let fallback: string | undefined;
  for (const step of order) {
    const ref = isObject(step) ? step.$ref : undefined;
    const set = typeof ref === "string" ? /^#\/sets\/([^/]+)$/.exec(ref)?.[1] : undefined;
    const mod = typeof ref === "string" ? /^#\/modifiers\/([^/]+)$/.exec(ref)?.[1] : undefined;
    if (set !== undefined) {
      const s = sets[set];
      if (!isObject(s)) errors.push(`resolutionOrder: no set "${set}"`);
      else if (modifier) errors.push(`resolutionOrder: the set "${set}" comes after the theme; sets go first`);
      else shared.push(...files(s.sources, `sets.${set}`));
    } else if (mod !== undefined) {
      const m = modifiers[mod];
      if (!isObject(m) || !isObject(m.contexts)) errors.push(`resolutionOrder: no modifier "${mod}" with contexts`);
      else if (modifier) errors.push(`only one modifier, the theme, is supported; found "${modifier}" and "${mod}"`);
      else {
        modifier = mod;
        contexts = m.contexts;
        fallback = typeof m.default === "string" ? m.default : undefined;
      }
    } else errors.push(`resolutionOrder: ${JSON.stringify(step)} is not a reference to a set or a modifier`);
  }
  if (modifier === null) return { themes: [{ name: "default", files: shared }], resolver, errors };
  if (modifier !== "theme") errors.push(`the modifier is called "theme", not "${modifier}"`);
  const themeNames = Object.keys(contexts);
  if (fallback !== undefined && !themeNames.includes(fallback)) errors.push(`default "${fallback}" is not a context`);
  for (const want of ["light", "dark"]) if (!themeNames.includes(want)) errors.push(`no "${want}" theme`);
  const first = fallback ?? themeNames[0];
  const themes = themeNames.sort((a, b) => (a === first ? -1 : b === first ? 1 : a.localeCompare(b))).map((name) => ({
    name,
    files: [...shared, ...files(contexts[name], `modifiers.${modifier}.contexts.${name}`)],
  }));
  return { themes, resolver, errors };
}

/** Every custom property of one theme, by name, resolved by Style Dictionary. */
async function properties(dir: string, files: string[]): Promise<Map<string, { value: string; type: string }>> {
  const sd = new StyleDictionary({
    usesDtcg: true,
    log: { verbosity: "silent", warnings: "disabled" },
    source: files.map((f) => `${dir}/${f}`),
    platforms: { css: { transforms: ["name/kebab", "stance/dtcg-css"] } },
  });
  const { allTokens } = await sd.getPlatformTokens("css");
  return new Map(
    allTokens.map((t) => [`--${t.name}`, { value: String(t.$value), type: String(t.$type) }] as const).sort((a, b) =>
      a[0].localeCompare(b[0])
    ),
  );
}

const block = (selector: string, lines: string[], indent = "") =>
  `${indent}${selector} {\n${lines.map((l) => `${indent}  ${l}\n`).join("")}${indent}}\n`;

/**
 * Builds a mood board into CSS custom properties and returns the file written. The default theme is on
 * :root; the dark theme replaces the values that differ when the system prefers dark, unless the user chose
 * light, and whenever the user chose dark (`<html data-theme="dark">`). Every duration is zero when the
 * system asks for reduced motion.
 */
export async function buildTokens(dir: string, out: string, label = dir): Promise<string> {
  try {
    await Deno.stat(dir);
  } catch {
    throw new Error(`no folder of tokens at ${dir}`);
  }
  const { themes, errors } = await readThemes(dir);
  if (errors.length) throw new Error(`${dir}: ${errors.join("; ")}`);
  const built = await Promise.all(themes.map(async (t) => ({ name: t.name, props: await properties(dir, t.files) })));
  const [base, ...rest] = built;
  const decl = (props: Map<string, { value: string }>, only?: Map<string, { value: string }>) =>
    [...props].filter(([n, p]) => !only || only.get(n)?.value !== p.value).map(([n, p]) => `${n}: ${p.value};`);
  const scheme = (name: string) => name === "light" || name === "dark" ? name : null;
  let css = `/**\n * tokens: ${label}\n * generated from the DTCG tokens: do not edit\n */\n\n`;
  css += block(":root", [
    ...(themes.length > 1 ? [`color-scheme: ${themes.map((t) => scheme(t.name)).filter(Boolean).join(" ")};`] : []),
    ...decl(base.props),
  ]);
  if (rest.length) css += "\n" + block(`:root[data-theme="${base.name}"]`, [`color-scheme: ${base.name};`]);
  for (const t of rest) {
    const lines = decl(t.props, base.props);
    if (t.name === "dark") {
      css += "\n" + `@media (prefers-color-scheme: dark) {\n` +
        block(`:root:not([data-theme="${base.name}"])`, lines, "  ") + "}\n";
    }
    css += "\n" +
      block(`:root[data-theme="${t.name}"]`, [...(scheme(t.name) ? [`color-scheme: ${t.name};`] : []), ...lines]);
  }
  const durations = [...base.props].filter(([, p]) => p.type === "duration").map(([n]) => `${n}: 0s;`);
  if (durations.length) {
    css += "\n" + `@media (prefers-reduced-motion: reduce) {\n` + block(":root", durations, "  ") + "}\n";
  }
  await Deno.mkdir(out.slice(0, out.lastIndexOf("/") + 1) || ".", { recursive: true });
  await Deno.writeTextFile(out, css);
  return out;
}

if (import.meta.main) {
  const arg = (flag: string) => {
    const i = Deno.args.indexOf(flag);
    return i >= 0 ? Deno.args[i + 1] : undefined;
  };
  // In this repository, --mood names a mood board; in a project, --tokens names its folder of tokens.
  const mood = arg("--mood");
  // A file path on every system: on Windows a URL's pathname starts with "/C:".
  const here = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
  const dir = arg("--tokens") ?? `${here}/tokens/moods/${mood ?? "white"}`;
  console.log(await buildTokens(dir, arg("--out") ?? "dist/tokens.css", mood ? `mood board ${mood}` : dir));
}
