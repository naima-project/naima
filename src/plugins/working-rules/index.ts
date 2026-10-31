// The working rules, one file each in rules/: how an agent works with the owner in every project that
// uses Naima — spending few tokens, talking so the owner reads little, not
// making the owner wait, asking before what cannot be undone, capturing what
// the owner settles, not asking what the rules answer, closing every loop, no
// parallel status document, the right tool for the job. Each is a shipped rule
// (the rules plugin's `rules` point), listed by `naima rules --audience
// agents`; a project drops one with the rules plugin's `retire` option, and
// changes one by retiring it and writing its own rules item in its place. For
// people, docs/guide/rules.md#working-with-the-owner.

import { CONTRACT, type Plugin } from "../../core/api.ts"

export default function working(): Plugin {
  return {
    name: "working-rules",
    contract: CONTRACT,
    says:
      "the working rules every project ships for its agents: quiet, talking to the owner, fast, the coordinator delegating to workers, asking before what cannot be undone, capturing with judgment, never asking what the rules answer, closing every loop, introducing a Naima feature along the way; and for everyone, no new status document and the right tool for the job",
    about:
      "How an agent works with the owner is the same in every project, so Naima ships it as rules rather than leaving each project to write them: spend few tokens and stay silent through routine steps, talk so the owner reads little and decodes nothing, never keep the owner waiting, send the work to workers in the background while the coordinator stays in the conversation, ask before what cannot be undone, file what the owner settles and nothing they are still thinking through, never ask what the rules already answer, leave no loop open when a turn or a session ends, and let the owner meet a feature of Naima at the moment it plainly helps, one at a time and in one line. " +
      "Two more bind everyone: no new status document beside the authoritative one, and the state-of-the-art method for every job. " +
      "Each is a shipped rule, listed by `naima rules --audience agents` beside the project's own, most with the phrase an agent gives back. " +
      "A project drops one by naming it in the rules plugin's `retire` option, and changes one by retiring it and writing its own `rules` item in its place; switching this plugin off drops them all.",
    home: import.meta.url,
    contributes: { rules: "rules/" },
    optional: ["rules"],
  }
}
