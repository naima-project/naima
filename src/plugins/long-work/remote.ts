// Hosts and remote runs: a remote run is a run of the host's own Naima,
// reached through one non-interactive ssh call per question
// (specs/long-work-naima-run-wait-run-list, §4). The hosts are the core's, so
// the tools plugin reaches the same machines.

export { cmdQuote, DEFAULT_REMOTE_NAIMA, type Host, readHosts, remoteCommand, shellQuote, sshArgs, windowsArg, windowsCommandLine } from "../../core/api.ts"
