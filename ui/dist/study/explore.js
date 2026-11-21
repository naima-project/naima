// The state space of a machine naima-codegen generated, explored from its module's transition table
// (develop/models-default-study.md §3.1): from the start state, or a state given, every input with every value of its
// arguments (enumerations, booleans, id sorts over the values of the model's instance) and every enabled output, breadth
// first, up to a bound. Labels are the module's own (mcrl2Label) without the c_ of the core, so they are the refined
// system's, and a counterexample of that system loads as it is. It runs in a study's frame (host.js, role explore),
// where a project's code runs, and in the tests; it imports nothing.

/** The values an argument takes, or null when its sort cannot be enumerated. */
export function valuesOf(sort, sizes) {
  switch (sort.kind) {
    case "bool":
      return [false, true];
    case "enum":
      return sort.values;
    case "id": {
      const name = sort.sort.toLowerCase();
      const n = sizes[name + "s"] ?? sizes[name] ?? 2;
      return Array.from({ length: n }, (_, i) => i);
    }
    case "int":
      return [0, 1];
    default:
      return null;
  }
}

const product = (lists) =>
  lists.reduce((acc, l) => acc.flatMap((a) => l.map((v) => [...a, v])), [[]]);

const bare = (label) => label.replace(/^c_/, "");

/**
 * The space of module `m`, as the tab's stepper reads it: `{ params, states, initial, edges, truncated, edge, bound,
 * skipped, keys }`, where `keys[i]` is the module's own key of state i (to start again from it) and `raw` the states as
 * the module holds them. `from` is a state of the module, or null for its start.
 */
export function exploreModule(m, sizes = {}, bound = 20000, from = null) {
  const states = [];
  const raw = [];
  const keys = [];
  const index = new Map();
  const edges = [];
  const skipped = [];
  const events = [];
  const label = (entry, fallback) => {
    try {
      return typeof m.mcrl2Label === "function"
        ? bare(m.mcrl2Label(entry))
        : fallback;
    } catch {
      return fallback;
    }
  };
  for (const t of m.inputs) {
    const lists = t.args.map((a) => valuesOf(a.sort, sizes));
    if (lists.some((l) => l === null)) {
      skipped.push(bare(t.label ?? t.type));
      continue;
    }
    for (const vs of product(lists)) {
      const event = { type: t.type };
      t.args.forEach((a, i) => (event[a.name] = vs[i]));
      const plain = bare(t.label ?? t.type) +
        (vs.length ? `(${vs.map(String).join(", ")})` : "");
      events.push({ t, event, label: label({ event }, plain) });
    }
  }
  const outputs = m.outputs.map((o) => ({
    o,
    label: label({ action: { type: o.type } }, bare(o.label ?? o.type)),
  }));
  let truncated = false;
  const add = (s) => {
    const k = m.stateKey(s);
    const known = index.get(k);
    if (known !== undefined) return known;
    if (states.length >= bound) {
      truncated = true;
      return null;
    }
    index.set(k, states.length);
    raw.push(s);
    keys.push(k);
    states.push(JSON.parse(JSON.stringify(s)));
    return states.length - 1;
  };
  add(from ?? m.start({}));
  // Breadth first: the states found are explored in the order they were found, and those left are at the edge.
  let i = 0;
  for (; i < raw.length; i++) {
    const s = raw[i];
    for (const e of events) {
      const to = e.t.next(s, e.event);
      if (!to) continue;
      const j = add(to);
      if (j !== null) {
        edges.push({ from: i, to: j, label: e.label, kind: "input" });
      }
    }
    for (const { o, label: l } of outputs) {
      const r = o.next(s);
      if (!r) continue;
      // An output's action may carry arguments: its label is the module's for that action.
      const j = add(r.state);
      if (j !== null) {
        edges.push({
          from: i,
          to: j,
          label: r.action ? label({ action: r.action }, l) : l,
          kind: "output",
        });
      }
    }
    // A state whose steps went past the bound is at the edge too: some of its steps are not drawn.
    if (truncated) break;
  }
  const edge = truncated ? states.map((_, k) => k).filter((k) => k >= i) : [];
  const params = Object.keys(states[0] ?? {}).map((name) => ({
    name,
    sort: "",
  }));
  return {
    params,
    states,
    initial: 0,
    edges,
    truncated,
    edge,
    bound,
    skipped,
    keys,
    raw,
  };
}
