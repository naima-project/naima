// The named diagrams (develop/models-tab.md §13): when a view maps a model's state to a standard diagram, it draws that
// standard's notation unaltered and is called by its name, so that a reader recognises it. A study declares the
// diagrams its view draws in its %@ui block (`% diagrams <name>: <what it maps>; …`); the tab checks each name here.
// The list is open: a formalism or a notation is added with its name, its standard and the elements it draws.

export interface NamedDiagram {
  /** The name a study declares. */
  name: string;
  /** What readers call it. */
  title: string;
  /** The standard that defines its notation, and where. */
  standard: string;
  /** The notation's elements this library draws, unaltered. */
  elements: readonly string[];
  /** The library's component that draws it, or null when a view draws it itself. */
  widget: string | null;
}

export const NAMED: readonly NamedDiagram[] = [
  {
    name: "uml-state-machine",
    title: "UML state machine diagram",
    standard: "OMG UML 2.5.1, clause 14 (StateMachines)",
    elements: [
      "state (rounded rectangle)",
      "initial pseudostate (filled circle)",
      "transition (open arrowhead)",
      "transition label (trigger)",
    ],
    widget: "Graph",
  },
  {
    name: "uml-sequence",
    title: "UML sequence diagram",
    standard: "OMG UML 2.5.1, clause 17.8 (Interactions, sequence diagrams)",
    elements: [
      "lifeline (head and dashed line)",
      "message (arrow, filled head for a call)",
      "message label",
      "execution order top to bottom",
    ],
    widget: "Sequence",
  },
  {
    name: "uml-communication",
    title: "UML communication diagram (collaboration diagram)",
    standard:
      "OMG UML 2.5.1, clause 17.9 (Interactions, communication diagrams)",
    elements: [
      "lifeline (rectangle)",
      "link (line)",
      "numbered message with arrow",
    ],
    widget: null,
  },
  {
    name: "uml-activity",
    title: "UML activity diagram",
    standard: "OMG UML 2.5.1, clause 15 (Activities)",
    elements: [
      "action (rounded rectangle)",
      "initial node",
      "activity final node",
      "decision and merge (diamond)",
      "fork and join (bar)",
      "control flow",
    ],
    widget: null,
  },
  {
    name: "uml-timing",
    title: "UML timing diagram",
    standard: "OMG UML 2.5.1, clause 17.10 (Interactions, timing diagrams)",
    elements: ["lifeline", "state or condition timeline", "time ruler"],
    widget: null,
  },
  {
    name: "bpmn-process",
    title: "BPMN process diagram",
    standard: "OMG BPMN 2.0.2, clause 10 (Process)",
    elements: [
      "task (rounded rectangle)",
      "start and end events (circles)",
      "gateway (diamond)",
      "sequence flow",
      "pool and lane",
    ],
    widget: null,
  },
  {
    name: "directed-graph",
    title: "Directed graph",
    standard:
      "no standard notation: nodes and arrows, named so that it is not mistaken for one",
    elements: ["node (circle)", "edge (filled arrowhead)"],
    widget: "Graph",
  },
];

export const named = (name: string): NamedDiagram | undefined =>
  NAMED.find((d) => d.name === name);

/** A study's declared diagrams (`name: what it maps; …`), each checked: known ones, and the problems of the rest. */
export function declaredDiagrams(
  text: string | null | undefined,
): { diagrams: { diagram: NamedDiagram; maps: string }[]; problems: string[] } {
  const diagrams: { diagram: NamedDiagram; maps: string }[] = [];
  const problems: string[] = [];
  for (
    const part of (text ?? "").split(";").map((p) => p.trim()).filter(Boolean)
  ) {
    const i = part.indexOf(":");
    const name = (i < 0 ? part : part.slice(0, i)).trim();
    const d = named(name);
    if (!d) {
      problems.push(
        `${name} is not a named diagram this Naima knows (${
          NAMED.map((x) => x.name).join(", ")
        })`,
      );
    } else {diagrams.push({
        diagram: d,
        maps: i < 0 ? "" : part.slice(i + 1).trim(),
      });}
  }
  return { diagrams, problems };
}
