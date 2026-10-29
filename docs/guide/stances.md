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

## Adopting one

```sh
naima stance adopt ui
```

This finds the stance's repository, reads the commit at the head of its main branch, and writes it into `naima.json` as the plugin `stance-ui`, pinned to that
commit:

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
straight away. Anything you write after the name is passed on to that step, so `naima stance adopt ui --mood dusk` copies the UI stance's widget set with the
dusk mood board.

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

For its adoption step, it adds a command named like its plugin entry (`stance-<name>`) whose usage includes `adopt`. To be listed by `naima stances`, it is
published as `naima-stance-<name>` in the naima-project organisation, with its plugin in `plugin/index.mjs`.
