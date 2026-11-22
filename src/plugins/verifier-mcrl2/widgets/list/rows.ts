// Any list of rows that are not all tracker items (Home's What's left, a state of the work, what lies ahead, a slice's
// commits: stage-rows.ts StageRow) as the one list (List.svelte) shows them: the row's short label (an age, a day, an
// hour), its sentence, who holds it, and the group its heading opens. Plain functions, no Svelte.

import type { ListSpec } from "./list.ts";

/** A row as the stage's lists give it (the parts the list shows). */
export interface RowLike {
  readonly key: string;
  readonly text: string;
  readonly aside: string;
  readonly mark: string;
  readonly who?: string;
  readonly head?: string;
  readonly more?: readonly string[];
}

/** A row with the group its heading opened, carried to every row under it, and its place in the list. */
export interface ListRow extends RowLike {
  readonly group: string;
  readonly at: number;
}

/** The rows with their groups: a row under a heading belongs to it until the next heading. */
export function listRows(rows: readonly RowLike[]): ListRow[] {
  let group = "";
  return rows.map((r, at) => {
    if (r.head) group = r.head;
    return { ...r, group, at };
  });
}

/** The rows as a list: the sentence, the label, who holds it, and what is said under it; grouped by their headings. */
export function rowSpec(): ListSpec<ListRow> {
  return {
    key: (r) => r.key,
    columns: [
      { id: "text", label: "What", value: (r) => r.text, width: "grow", column: true },
      { id: "aside", label: "When", value: (r) => r.at, text: (r) => r.aside, width: "narrow", column: true },
      { id: "who", label: "Held by", value: (r) => r.who ?? "", width: "fit" },
      { id: "more", label: "Details", value: (r) => (r.more ?? []).join(" · "), width: "fit", optional: true },
    ],
    facets: [{ id: "who", label: "Person", values: (r) => [r.who || "nobody"] }],
    // The groups in the order their headings come.
    groupings: [{ id: "head", label: "Group", group: (r) => ({ key: r.group, title: r.group || "Other" }) }],
  };
}
