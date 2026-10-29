# Stances

A stance is a set of choices and rules that someone has written down and that a project takes on as a whole. It settles questions that would otherwise be argued
again in every project. The UI stance, for example, says where an app's logic lives, how a component gets its data, and that every colour is a design token.
When you adopt a stance, your agents get its rules, `naima check` runs its checks, and you get whatever code it ships to make the rules easy to follow.

To Naima, a stance is a plugin that says it is one. Its manifest has `kind: "stance"`, and it is loaded like any other plugin from git, pinned to an exact
commit (see [add a plugin someone gave you](add-a-plugin.md)).

## Where stances come from

For now, stances are published in the naima-project organisation on GitHub. The stance called `ui` is the repository `naima-stance-ui`, the one called `<name>`
is `naima-stance-<name>`, and each one keeps its plugin in `plugin/index.mjs`. To see which stances exist:

```sh
naima stances
```

This asks GitHub's public API, without any credentials, and prints each stance with a line about it. A stance this project already uses is marked `adopted`. If
there is no network, it says it cannot reach GitHub and stops; nothing else is affected.

A repository can be named like a stance and not be one. For each repository it lists, `naima stances` reads `plugin/index.mjs` at the stance's newest release,
or at the head of its main branch when it publishes no releases, and nothing else of the repository. When that file is missing, or the manifest in it doesn't
say `kind: "stance"`, the line says `not a stance` and why. This is a reading of the file, not a run of it: adopting the stance loads it and checks again.

## Adopting one

```sh
naima stance adopt ui
```

This finds the stance's repository and takes its newest release: it downloads the release's archive, checks it against its checksum and against the commit
the release's tag names, and writes that commit into `naima.json` as the plugin `stance-ui`, pinned to it. The download is what counts the adoption on the
stance's releases page, as for Naima itself ([Naima updates to releases](update-naima.md#naima-updates-to-releases)). A stance that publishes no releases is
pinned to the commit at the head of its main branch instead. Either way the pin looks like this:

```json
{
  "plugins": {
    "stance-ui": {
      "source": { "git": "https://github.com/naima-project/naima-stance-ui.git", "commit": "<full commit>", "path": "plugin/index.mjs" }
    }
  }
}
```

Naima then fetches the stance into the tracker folder and loads it. If what it loaded doesn't say it is a stance, `naima.json` is put back as it was and nothing
is adopted. If the stance has its own adoption step (a command with the stance's plugin name that takes `adopt`, such as `naima stance-ui adopt`), Naima runs it
straight away.

What you write after the name goes to one of two places. An option the stance declares in its manifest, such as the UI stance's `--app <folder>`, is written
into the stance's entry in `naima.json`, under `options`, where its checks read it too, and stays there when you adopt it again. Everything else is passed on to
the adoption step, so `naima stance adopt ui --app web --mood dusk` records that the app is in `web/` and copies the UI stance's widget set into it with the
dusk mood board.

Before it runs the adoption step, Naima says where it will write: in the app's folder when the stance declares an `app` option, otherwise in the project's
root. If that would be the root, the root holds no app, and the project has one in a subfolder (a folder with a `package.json` or a Svelte configuration),
Naima refuses, puts `naima.json` back, and names the folders it found. Give `--app <folder>` to adopt the stance into that app, or `--app .` to adopt it at
the root anyway.

The adoption writes into the checkout you run it from. Run from another worktree of the project with the trunk checkout's Naima, it is served from that
worktree's own data, so the pin and the files land on the worktree's branch. If the worktree has no data of its own, Naima refuses and says which Naima to
run instead.

If the stance asks the agent tool to run something, such as its checks after every edit, Naima installs that hook in the tool's settings as part of the
adoption ([hooks in the agent tool](extending-naima.md#hooks-in-the-agent-tool)).

Commit the change to `naima.json`, with whatever the adoption step wrote, like any other change.

## Keeping up with a stance

```sh
naima stance status
```

This lists the stances the project has adopted, the commit each one is pinned to, and whether the stance has a newer commit. Nothing moves by itself. To take
the newer commit, read what changed in the stance's repository, then adopt it again: `naima stance adopt ui` moves the pin to the newest commit and runs the
adoption step again. Without a network, the status says which stances it couldn't reach.

## Examples

A stance may ship examples, such as a small app that follows its rules. It lists them in its manifest as paths inside its repository, under `examples`. Once the
stance is adopted:

```sh
naima stance examples ui
```

prints each example and where it is in the stance's copy in the tracker folder, so you or an agent can open it.

## Writing a stance

A stance is written like any plugin ([extending Naima](extending-naima.md)), with two more keys in its manifest:

- `kind: "stance"`, which is what makes it a stance;
- `examples`, an optional list of paths inside its repository.

For its adoption step, it adds a command named like its plugin entry (`stance-<name>`) whose usage includes `adopt`. Its checks that refuse a landing while
they fail are `refuses` landing reports, and the hooks it wants in the agent tool are `agent-hooks`; it writes no file of the host's own. To be listed by `naima stances`, it is
published as `naima-stance-<name>` in the naima-project organisation, with its plugin in `plugin/index.mjs`.
