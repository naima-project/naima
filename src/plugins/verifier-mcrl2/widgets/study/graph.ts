// The nodes and edges a Graph (Graph.svelte) draws: what each shows, and the classes its caller styles it with.

export interface GraphNode {
  id: string;
  label: string;
  /** Small text under the label; a newline starts another line. */
  sub?: string;
  /** Classes the caller styles with: current, faded, ahead, pinned, done, run… */
  cls?: string;
  title?: string;
  /** "initial" draws a UML initial pseudostate. */
  kind?: "initial" | "state";
  rank?: number;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  cls?: string;
  title?: string;
}
