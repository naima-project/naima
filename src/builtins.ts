// The first-party plugins, in load order. Each is loaded with the defaults it
// infers from the repository, unless the project's `plugins` table gives it
// options, switches it off or replaces it. This file and cli.ts are the
// composition root: the only modules that see both the core and the plugins.

import { apiFor, type FirstParty, type Plugin, type PluginOptions } from "./core/internal.ts"
import adopt from "./plugins/adopt/index.ts"
import announce from "./plugins/announce/index.ts"
import betaMarkers from "./plugins/beta-markers/index.ts"
import docs from "./plugins/docs/index.ts"
import epics from "./plugins/epics/index.ts"
import coordination from "./plugins/coordination/index.ts"
import gates from "./plugins/gates/index.ts"
import hooks from "./plugins/hooks/index.ts"
import loop from "./plugins/loop/index.ts"
import longWork from "./plugins/long-work/index.ts"
import metrics from "./plugins/metrics/index.ts"
import packAnalyses from "./plugins/pack-analyses/index.ts"
import packPapers from "./plugins/pack-papers/index.ts"
import planning from "./plugins/planning/index.ts"
import storm from "./plugins/storm/index.ts"
import ruleTemplates from "./plugins/rule-templates/index.ts"
import privacy from "./plugins/privacy/index.ts"
import roles from "./plugins/roles/index.ts"
import rules from "./plugins/rules/index.ts"
import tools from "./plugins/tools/index.ts"
import trackers from "./plugins/trackers/index.ts"
import triage from "./plugins/triage/index.ts"
import ui from "./plugins/ui/index.ts"
import verifier from "./plugins/verifier/index.ts"
import verifierMcrl2 from "./plugins/verifier-mcrl2/index.ts"

/** Every first-party plugin: its name, and the factory that makes it from its options. */
export const firstParty: readonly FirstParty[] = [
  { name: "trackers", factory: trackers },
  { name: "coordination", factory: coordination },
  { name: "triage", factory: triage },
  { name: "gates", factory: gates },
  { name: "epics", factory: epics },
  { name: "planning", factory: planning },
  { name: "roles", factory: roles },
  { name: "announce", factory: announce },
  { name: "loop", factory: loop },
  { name: "beta-markers", factory: betaMarkers },
  { name: "verifier", factory: verifier },
  { name: "tools", factory: tools },
  { name: "verifier-mcrl2", factory: verifierMcrl2, optIn: true },
  { name: "storm", factory: storm, optIn: true },
  { name: "pack-analyses", factory: packAnalyses, optIn: true },
  { name: "pack-papers", factory: packPapers, optIn: true },
  { name: "ui", factory: ui },
  { name: "metrics", factory: metrics },
  { name: "rules", factory: rules },
  { name: "long-work", factory: longWork },
  { name: "rule-templates", factory: ruleTemplates, optIn: true },
  { name: "commit-hooks", factory: hooks },
  { name: "privacy", factory: privacy },
  { name: "adopt", factory: adopt },
  { name: "docs", factory: docs },
]

/** Every first-party plugin's manifest, each made with its options in `options` (by plugin name) or none, an opt-in one only when `options` names it: for tests, which load them without a naima.json. */
export const firstPartyPlugins = (options: Record<string, PluginOptions> = {}): Plugin[] =>
  firstParty.filter((p) => !p.optIn || p.name in options).map((p) => p.factory(options[p.name] ?? {}, apiFor(p.name, { rename: {} })))
