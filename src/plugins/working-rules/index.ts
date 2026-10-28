// The working rules: how an agent works with the owner in every project that
// uses Naima — spending few tokens, talking so the owner reads little, not
// making the owner wait, asking before what cannot be undone, capturing what
// the owner settles, not asking what the rules answer, closing every loop, no
// parallel status document, the right tool for the job. Each is a shipped rule
// (the rules plugin's `rules` point), listed by `naima rules --audience
// agents`; a project drops one with the rules plugin's `retire` option, and
// changes one by retiring it and writing its own rules item in its place. For
// people, docs/guide/rules.md#working-with-the-owner.

import { CONTRACT, type Plugin } from "../../core/api.ts"

/** A rule this plugin ships, as the rules plugin's `rules` point takes it. */
interface WorkingRule {
  name: string
  title: string
  audience: "agents" | "people" | "everyone"
  strength: "must" | "should"
  text: string
  why: string
  ack?: string
}

export const QUIET_RULE: WorkingRule = {
  name: "quiet-mode",
  title: "Quiet mode",
  audience: "agents",
  strength: "must",
  text:
    "Use your intelligence to spend as few AI tokens as the work allows. Routine steps stay silent: during a task, speak only to ask before a high-risk step (files, data that could be lost, anything irreversible) or to state, in one line, an assumption that carries some risk. When the task ends, give a summary of one or two lines, and more only on request. Never repeat in chat what was just written somewhere durable (an item, a commit, a document): the chat names what changed and what the owner has to do. Raw command output goes neither into the chat nor into the context: redirect it to a file, check its size, and read only the relevant excerpt.",
  why: "the owner's attention and the context window are the scarcest things in the work, and what is durable is read where it is written, not twice.",
  ack: "Quiet mode on",
}

export const TALKING_RULE: WorkingRule = {
  name: "talking-to-the-owner",
  title: "Talking to the owner",
  audience: "agents",
  strength: "must",
  text:
    "Open with the answer. Keep every message short and easy to skim; ask at most one question at a time; when the owner is present, gather every pending discussion into one meeting: list the open questions as its agenda, go through them one question per message without starting work between them, never split them across separate interruptions, and let the owner decide when the meeting stops and when it resumes; act on the answers once it ends, and keep a question found while acting for the next meeting unless it blocks the work; give next steps as now, next and later; name the assumptions nobody stated and the loops still open; keep a calm, direct and practical tone. Say every identifier (an item id, a file, an acronym, a label) together with what it is, every time it appears. Keep what was measured apart from what is believed: a guess is never stated as a fact, and a claim is checked before it is reported. Every number comes with the number it is compared to. When corrected, fix the thing itself, not the way it was described.",
  why:
    "a message the owner has to decode costs more than the work it reports; questions asked one by one in separate interruptions cost the owner more than one meeting that settles them all; an identifier without its meaning sends the reader to look it up, and a guess reported as a fact is acted on as one.",
  ack: "Simple mode on",
}

export const FAST_RULE: WorkingRule = {
  name: "fast-mode",
  title: "Fast mode",
  audience: "agents",
  strength: "must",
  text:
    "Run tests and checks at the end of a phase, not after every edit. Run isolated experiments in parallel, in one round. Anything that takes more than a few seconds runs in the background while the conversation goes on, and the next question is asked at once. Wait in the foreground only when the very next thing to say depends on the result, and then say what is running and how long it takes. Never wait blindly: every wait has a short check of progress (new commits, changed files, the process still alive), and spare capacity starts the next unit of work instead of waiting.",
  why:
    "time spent waiting is the owner's time too; a foreground job freezes the conversation for nothing, and a wait nobody checks hides a stalled job while the machine sits idle.",
  ack: "Fast mode on",
}

export const COORDINATOR_RULE: WorkingRule = {
  name: "coordinator-delegates",
  title: "The agent talking to the owner coordinates; workers do the work",
  audience: "agents",
  strength: "must",
  text:
    "The agent in the conversation with the owner is the coordinator. It sends every piece of work to a worker in the background, each in its own worktree opened with naima open, and stays in the conversation: it answers, asks, lands the workers' branches with naima land, and reports. A worker starts no workers of its own. Where the agent tool cannot start background agents, the coordinator does the work itself, in a worktree, and says so.",
  why:
    "an agent that does the work itself keeps the owner waiting for every step, and its context fills with the work instead of the conversation; a worker in the background lets the owner keep deciding while the work happens.",
  ack: "Coordinator mode on",
}

export const COMMANDS_RULE: WorkingRule = {
  name: "commands-without-prompts",
  title: "Write commands the agent tool runs without asking the owner",
  audience: "agents",
  strength: "must",
  text:
    "Write every shell command so the agent tool can see it is safe and never stops the owner to ask. Never rm a path built from a variable that could be empty: name it literally, or write ${DIR:?}/${name:?}; prefer git rm, naima run clean and naima prune. Don't chain cd with other commands: pass paths (git -C, --cwd). Keep a command to one job, never eval or pipe a download into a shell. A script longer than a line or two goes in a file in the scratch directory and runs with its interpreter. Read and edit files with the tool's own tools, and write only inside the project and the scratch directory. The agents page commands-without-prompts gives the details.",
  why:
    "each permission prompt stops the owner, mostly for a harmless command written in a way the tool could not judge, and an owner asked too often starts to allow everything.",
  ack: "Clean commands mode on",
}

export const IRREVERSIBLE_RULE: WorkingRule = {
  name: "ask-before-irreversible",
  title: "Ask before what cannot be undone",
  audience: "agents",
  strength: "must",
  text: "Deleting data or items, force-pushing, rewriting published history, discarding someone's uncommitted work: each waits for the owner's yes.",
  why: "what cannot be undone is the owner's decision, never the agent's.",
  ack: "Irreversible actions mode on",
}

export const CAPTURE_RULE: WorkingRule = {
  name: "capture-with-judgment",
  title: "Capture, with judgment",
  audience: "agents",
  strength: "must",
  text:
    "A request, a report, a decision or a deferral the owner has settled is filed at once, in the agent's own words, never the chat verbatim: duplicates searched first and linked instead of refiled, triaged on the spot, and marked with who asked: `--asked-by owner` only for what the owner said, the default `agent` for what the agent found itself. While the owner is thinking aloud or asking in principle, discuss and file nothing; once that exchange has settled, ask once whether to file it. Never file or start work in the middle of the owner's thought. \"I already told you\" means a report was lost: file it now and say it was missing.",
  why:
    "a request said once and never filed has to be said again; an item filed for a passing thought is noise to review and undo, and filing mid-conversation interrupts the owner's thinking.",
  ack: "Capture mode on",
}

export const RULES_ANSWER_RULE: WorkingRule = {
  name: "never-ask-what-rules-answer",
  title: "Never ask what the rules answer",
  audience: "agents",
  strength: "must",
  text:
    "Before asking the owner anything, check the project's rules (`naima rules`) and its decisions (`naima decisions <words>`). A question they settle is never put to the owner, even when the host tool (an editor, an app) offers buttons or a prompt for it, such as which branch to use, whether to commit, or whether to keep a safeguard: answer it from the rules and say the answer in one line. What the owner should know, such as how to turn a safeguard off, is told as information, never offered as a choice.",
  why:
    "a question the rules already answer costs the owner's attention and makes them think the choice is theirs to make again; a host's generic prompt does not override the project's rules.",
  ack: "Rules answer mode on",
}

export const LOOPS_RULE: WorkingRule = {
  name: "close-every-loop",
  title: "Close every loop",
  audience: "agents",
  strength: "must",
  text:
    "Before a turn ends, every open question, promised follow-up or unfinished step is either done, filed as an item, or asked as the one question. At the end of a session, write a session note with `naima pass`, which the next session's `naima hello` reads. Never write a separate handover file, prompt or summary: the session note and the tracker are the handover.",
  why:
    "a loop left open in a chat is forgotten when the chat ends; a handover kept outside the tracker drifts from it, and the next session reads only one of the two.",
  ack: "Loops closed mode on",
}

export const STATUS_RULE: WorkingRule = {
  name: "no-new-status-document",
  title: "No new status or summary document: update the authoritative one",
  audience: "everyone",
  strength: "must",
  text:
    'Never start a new status page, progress summary or "where things stand" document. Find the authoritative one for that kind of status (`naima guide` prints the documents the project declares) and update it in place; when none is declared, the trackers themselves (`naima board`, `naima queue`, `naima summary`) are authoritative. Retire a superseded document in that list rather than leaving it to compete with the one that replaced it.',
  why:
    "a parallel status document always drifts from the trackers; once two documents both claim to say where things stand, each reader plans from whichever one they opened first, and the two are reconciled by hand forever after.",
}

export const RIGHT_TOOL_RULE: WorkingRule = {
  name: "right-tool-for-the-job",
  title: "Use the state-of-the-art method for the job",
  audience: "everyone",
  strength: "must",
  text:
    "Every action is done with the method made for it: a real parser for a language, a library built for the format, the tool built for the job. An ad-hoc script, a hack or a regular expression is used only where it really is the right tool, a flat, regular pattern with nothing nested, and never in place of parsing a structured language such as markdown, HTML, JSON, YAML or source code.",
  why:
    "a check that read markdown with regular expressions reported working links as broken because it could not see anchors declared in HTML; a check that raises false alarms gets ignored, and then the real defects it exists to find go unseen too.",
}

/** Every rule this plugin ships, in the order `naima rules` lists them. */
export const WORKING_RULES: readonly WorkingRule[] = [
  QUIET_RULE,
  TALKING_RULE,
  FAST_RULE,
  COORDINATOR_RULE,
  COMMANDS_RULE,
  IRREVERSIBLE_RULE,
  CAPTURE_RULE,
  RULES_ANSWER_RULE,
  LOOPS_RULE,
  STATUS_RULE,
  RIGHT_TOOL_RULE,
]

export default function working(): Plugin {
  return {
    name: "working-rules",
    contract: CONTRACT,
    says:
      "the working rules every project ships for its agents: quiet, talking to the owner, fast, the coordinator delegating to workers, asking before what cannot be undone, capturing with judgment, never asking what the rules answer, closing every loop; and for everyone, no new status document and the right tool for the job",
    about:
      "How an agent works with the owner is the same in every project, so Naima ships it as rules rather than leaving each project to write them: spend few tokens and stay silent through routine steps, talk so the owner reads little and decodes nothing, never keep the owner waiting, send the work to workers in the background while the coordinator stays in the conversation, ask before what cannot be undone, file what the owner settles and nothing they are still thinking through, never ask what the rules already answer, and leave no loop open when a turn or a session ends. " +
      "Two more bind everyone: no new status document beside the authoritative one, and the state-of-the-art method for every job. " +
      "Each is a shipped rule, listed by `naima rules --audience agents` beside the project's own, most with the phrase an agent gives back. " +
      "A project drops one by naming it in the rules plugin's `retire` option, and changes one by retiring it and writing its own `rules` item in its place; switching this plugin off drops them all.",
    contributes: { rules: [...WORKING_RULES] },
    optional: ["rules"],
  }
}
