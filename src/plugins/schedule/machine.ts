// The machine of one piece of work's actual schedule: fed the piece's records oldest first, it says where each
// stretch of the actual schedule begins. It follows the workshop's mCRL2 model (develop/models/schedule/model/core.mcrl2),
// whose properties hold (the properties items that verify features/record-each-piece-work-s-actual-schedule), summand
// by summand; the workshop's test compares it, in every state and on every record, with the machine naima-codegen
// generates from that model. naima-codegen's TypeScript is not imported here: it uses parameter properties, which
// Node's type stripping refuses, and Naima runs on Node as well as Deno and Bun.
//
// Every record is accepted in every phase: one that changes nothing there is taken and ignored, because the history is
// what it is. A piece that landed or closed is reopened only by a new claim, never by a stray commit or step, and its
// end is the first landing or close after its last claim: a later landing of the same work (its line landing on the
// trunk) or its close after the landing leaves the end where it was.

export type Phase = "NOT_STARTED" | "ACTIVE" | "STALLED" | "PAUSED" | "LANDED" | "CLOSED"

/** A record, as the machine takes it. */
export type Input = "claim" | "sign" | "quiet" | "release" | "land" | "close"

/** A stretch that begins: work going on, stalled, paused, or the end of the piece. */
export type Output = "work" | "stall" | "pause" | "finish"

export const INITIAL: Phase = "NOT_STARTED"

const OPENS: Partial<Record<Phase, Output>> = { ACTIVE: "work", STALLED: "stall", PAUSED: "pause", LANDED: "finish", CLOSED: "finish" }

/** The phase a record leads to, or the same phase when it changes nothing there: the model's input summands. */
function next(phase: Phase, input: Input): Phase {
  switch (input) {
    case "claim":
      return "ACTIVE"
    case "sign":
      return phase === "NOT_STARTED" || phase === "STALLED" || phase === "PAUSED" ? "ACTIVE" : phase
    case "quiet":
      return phase === "ACTIVE" ? "STALLED" : phase
    case "release":
      return phase === "ACTIVE" || phase === "STALLED" ? "PAUSED" : phase
    case "land":
      return phase === "LANDED" || phase === "CLOSED" ? phase : "LANDED"
    case "close":
      return "CLOSED"
  }
}

/** One step: the next phase, and the stretch it opens, if any (the model's output, taken before the next record). */
export function step(phase: Phase, input: Input): { phase: Phase; opens: Output | null } {
  const to = next(phase, input)
  // Every change of phase opens the stretch of the phase it leads to, but a close after a landing: the landing already
  // ended the piece, so its end stays where it was.
  const opens = to === phase || (phase === "LANDED" && to === "CLOSED") ? null : OPENS[to] ?? null
  return { phase: to, opens }
}
