# Commit hooks and companion records

Records that are meant to be written "later" tend not to get written at all, like a fix that lands with no test to prove it, or a feature that changes with no
note saying why. So Naima asks for those records in the same commit that makes the change, rather than in a review days afterwards. The agents set this up and
run the commands below for you, unless you want to do it yourself.

## Companion rules

A companion rule says that when a commit makes a certain change, it must also carry a certain record. The change can be

- a file staged under a path (`"when": { "paths": ["src"] }`),
- any change to an item of a type (`"when": { "type": "features" }`),
- a field set to a new value (`"when": { "field": "fixedOn" }`), optionally on one type only.

The record it requires is exactly one of these:

| `requires`                  | holds when the same commit                                                 |
| --------------------------- | -------------------------------------------------------------------------- |
| `{ "type": "tests" }`       | changes an item of that type (another one than the item that triggered it) |
| `{ "field": "commits" }`    | leaves that field set on the item                                          |
| `{ "note": true }`          | changes the item's page, for example with a `naima note` on it             |
| `{ "link": "verified-by" }` | leaves the item linked by that relation, stored on either side             |

A rule on paths has no item of its own, so the only thing it can require is a change to an item of a type.

One rule is built in. It is called **`fixed-has-test`**, and it says that setting `fixedOn` has to come with a linked test that verifies the item. The project
adds its own rules in `naima.json`:

```json
"plugins": {
  "commit-hooks": {
    "options": {
      "companions": [
        { "name": "fix-names-commits", "when": { "field": "fixedOn" }, "requires": { "field": "commits" } },
        { "name": "source-has-test", "says": "a source change comes with its test", "when": { "paths": ["src"] }, "requires": { "type": "tests" } }
      ]
    }
  }
}
```

`"builtin": false` switches the built-in rule off. If a rule is malformed, Naima refuses to load and names the rule, so a broken rule can't quietly end up
checking nothing. To write the rule down for people as well, file it as a [project rule](write-a-project-rule.md) with `enforcedBy` set to `companions`.

## Checking a commit before making it

```sh
git add -A
naima check --staged   # only the checks that read the staged change
naima hooks            # the rules, the watched paths, and whether the hook is installed
```

Each problem names the item, what it lacks and the rule, for example
`bugs/export-drops: no item is linked to it by verified-by — companion rule fixed-has-test: …`. `naima check` runs the same rules as well, over whatever is
staged at the time.

When `naima close` moves an item to the archive, that counts as one change to one item rather than a deletion plus a creation, so a field the item already had
doesn't trigger a rule again.

## The pre-commit hook

```sh
naima hooks install
git add naima-tracker/naima-data/hooks/pre-commit
git commit -m "Hold companion records in every commit"
```

`install` writes the hook into the data directory, where it is tracked like the rest of the tracker, and sets git's `core.hooksPath` to that directory. This is
done once per clone, and every worktree of the clone shares the setting. The only thing written outside the tracker folder is that one key in the clone's git
configuration, and git itself writes it.

The hook is path-scoped, which means it only starts Naima when a staged file is under the data directory or under one of the rules' paths. Any other commit
costs one `git diff` and nothing more. When the hook does start Naima, it runs `naima check --staged`, and any problem it finds stops the commit.

- `git commit --no-verify` skips the hook. That is allowed, but say why in the commit message.
- If the clone already had a hook in `.git/hooks/pre-commit`, it still runs, and it runs first.
- If `core.hooksPath` already names another directory (for example one used by a tool of the project's own), `install` refuses, because those hooks would stop
  running. `--force` points it at Naima's directory anyway.
- `naima hooks uninstall` unsets `core.hooksPath` when it names Naima's directory, and leaves anything else alone.
- After changing the rules, run `naima hooks install` again. The hook-current check fails as long as the committed hook watches different paths from the ones
  the rules name.

## The trunk guard

The same folder holds a second hook, `reference-transaction`, which `naima init` and `naima update` write without being asked. It refuses a commit, merge or
fast-forward of the trunk made by hand, so that work goes through an item, its worktree and `naima land`
([the rule](rules.md#every-change-goes-through-an-item-and-lands)). For any ref other than the trunk it exits at once, and for the trunk it runs
`naima guard-check`.

`core.hooksPath` is git's setting for one clone, not a file anyone commits, so someone who clones the project has the hooks but not the setting. Their first
launched run of Naima (`naima hello` or any other command) points `core.hooksPath` at the folder and says so in one line. Pointing it there stops none of
the clone's own hooks: for every hook name git knows and Naima does not write, the folder holds a small stub that runs the hook of that name in `.git/hooks`
when there is one, with the same arguments and input, and returns its exit code. After `naima hooks uninstall` it
stays unset in that clone.

```sh
naima guard        # on or off, and whether it runs in this clone
naima guard off    # turn it off for the project: recorded in naima.json, the hook removed
naima guard on     # turn it back on
```

Commit `naima.json` and the hook after turning the guard on or off; that commit goes straight on the trunk, since the guard lets it through.

When the tracker is kept as a repository of its own ([sibling mode](private-tracker.md#sibling-mode)), the tracker's repository runs the same hook, and its
trunk is guarded too. Naima commits every write to that tracker itself, and each of those commits carries a `Naima-Command:` trailer naming the command, which
the hook recognises without starting Naima. The tracker's trunk takes those commits, landing markers and a commit with a `Trunk-reason:` trailer, and refuses
any other commit made there by hand.

### Guarding the trunk on the server

The hook guards only a clone that runs it. A clone made somewhere else, before its first run of Naima, or a tool that skips hooks can still push the trunk.
When the code's `origin` is on GitHub, the server can refuse those pushes too, and Naima says so when it installs the guard and in `naima guard`. It never
turns that protection on by itself: it is the owner's decision, and the owner's command.

```sh
naima guard server           # make the ruleset on GitHub, with the GitHub CLI
naima guard server --print   # only say the ruleset, the request and the web page
```

`naima guard server` makes a branch ruleset named `naima: only the coordinator pushes the trunk`. The ruleset refuses an update, a deletion or a force-push of
the trunk from everyone except the repository's admins, and the coordinator pushes as an admin. It needs the GitHub CLI, `gh`, signed in with an account that
may administer the repository. If the ruleset is already there, the command says so and makes nothing. Without `gh`, or with `--print`, it sends nothing:
it prints the ruleset as JSON, the `gh api` and `curl` requests that make it, and the page of the repository's settings where it can be made by hand.

Every option is in the [reference](../reference/reference.md#commit-hooks).
