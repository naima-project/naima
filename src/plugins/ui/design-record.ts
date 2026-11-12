// The Design tab when a project keeps its design choices as decision items instead of a design folder. The UI stance's
// design tab reads only the design folder (rounds and a decisions.md); a project that chose its mood board, palette,
// typography and the rest in conversation with its owner, and recorded each as a decision item, would show every step
// as "Not decided yet". For such a step this adds the project's own settled decisions that speak of it, so that the
// screen shows what was chosen. A step with a decision in the design folder is left as the stance draws it.

import { type Context, fieldValue, type Item } from "../../core/api.ts"
import type { UiTab, UiTabContent } from "./tabs.ts"

/** The words of a decision's title that say it is about a step of the design method, by the step's name. */
const WORDS: Record<string, RegExp> = {
  "mood-board": /\bmood\b|\blook\b|\bdirections?\b|black and white|\binterface'?s? (is|look)\b/i,
  "palette": /\bcolou?rs?\b|\bpalette\b|\bgreys?\b|\baccent\b/i,
  "typography": /\btypeface\b|\bfonts?\b|\btype scale\b|\btypography\b|\bserif\b|\bSF Pro\b/i,
  "icons": /\bicons?\b/i,
  "widget-shapes": /\bshapes?\b|\bradius\b|\bcorners?\b|\bwidgets?\b/i,
  "screens": /\bscreens?\b|\blayout\b/i,
}

export interface Recorded {
  readonly title: string
  readonly date: string
  readonly ref: string
}

/** The decisions that speak of a step, newest first; superseded ones are left out. */
export function decidedFor(step: string, all: readonly (Recorded & { status: string })[]): Recorded[] {
  const words = WORDS[step]
  if (!words) return []
  return all.filter((d) => d.status !== "superseded" && words.test(d.title)).sort((a, b) => b.date.localeCompare(a.date))
}

/** The lead the screen shows for a step decided in the decision items. */
export function leadOf(found: readonly Recorded[]): string {
  return [
    "**Decided in the project's decision records**, which is where this project keeps its design choices.",
    ...found.map((d) => `- ${d.title} (${d.date}, \`${d.ref}\`)`),
  ].join("\n\n")
}

const recordedIn = (ctx: Context): (Recorded & { status: string })[] =>
  !ctx.registry.types.has("decisions") ? [] : ctx.repo.items.filter((i: Item) => i.type === "decisions").flatMap((d) => {
    const date = fieldValue(d, { name: "decidedOn", kind: "date" }) ?? String(d.meta["created"] ?? "")
    return /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? [{ title: String(d.meta["title"] ?? ""), date, ref: `decisions/${d.slug}`, status: String(d.meta["status"] ?? "") }]
      : []
  })

/** The design tab, with the decision records standing in for a step its folder leaves undecided. */
export function withDecisionRecords(tab: UiTab): UiTab {
  return {
    ...tab,
    async render(params, ctx) {
      const content: UiTabContent = await tab.render(params, ctx)
      if (!("component" in content) || content.component !== "gallery" || !content.lead?.startsWith("Not decided yet")) return content
      const found = decidedFor(params.sub ?? "", recordedIn(ctx))
      return found.length ? { ...content, lead: leadOf(found) } : content
    },
  }
}
