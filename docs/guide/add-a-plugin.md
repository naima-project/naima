# Add a plugin someone gave you

Sometimes a colleague, or another project, hands you a [plugin](glossary.md#plugin), either as a single file or as a git repository. You don't need to read its
code to add it, but adding it means you trust it, because it runs inside Naima. Naima only runs a plugin that is pinned, so what runs is exactly what you
reviewed ([the rule](rules.md#third-party-code-runs-only-pinned)).

The agents can do every step below for you; they are written out so you can follow along or do them yourself.

## A file

1. Put it in the project, for example `tools/hello.mjs`, and commit it.
2. Find its fingerprint, which is its sha256:

   ```console
   $ shasum -a 256 tools/hello.mjs
   91532e4fc03758f98e3e2721b64f12d26c7e42536ae7c1bca388f8edb48ac96c  tools/hello.mjs
   ```

   On Windows: `Get-FileHash tools/hello.mjs`.

3. Name it in `naima-tracker/naima-data/naima.json`, together with that fingerprint. You choose the name (`hello` here), and it can use lowercase letters,
   digits and dashes.

   ```json
   {
     "plugins": {
       "hello": { "source": { "path": "tools/hello.mjs", "sha256": "91532e4fc03758f98e3e2721b64f12d26c7e42536ae7c1bca388f8edb48ac96c" } }
     }
   }
   ```

4. Run the checks and make sure it is loaded:

   ```sh
   naima check
   naima plugins
   ```

If the file changes, every command refuses to run until you pin the new fingerprint, and it tells you why:

```console
$ naima check
naima: naima.json: plugins.hello: tools/hello.mjs has changed since it was pinned: its sha256 is 91532e4fc03758f98e3e2721b64f12d26c7e42536ae7c1bca388f8edb48ac96c, not 0000000000000000000000000000000000000000000000000000000000000000 — review it, then pin the new hash
```

Review what changed, and then copy the new fingerprint into `naima.json`.

## A git repository

For a plugin in a git repository, you name the repository, the full commit to run, and the file inside it:

```json
{
  "plugins": {
    "ops": { "source": { "git": "https://example.org/ops-plugin.git", "commit": "<the full 40-character commit>", "path": "index.mjs" } }
  }
}
```

The first run fetches it into `naima-tracker/plugins/ops/`, a folder git ignores. To move to a newer version, change `commit`.

## Its options

If the plugin takes options, they go next to `source`:

```json
{ "plugins": { "hello": { "source": { "path": "tools/hello.mjs", "sha256": "…" }, "options": { "strict": true } } } }
```

The commands, types and checks it adds are described in its own documentation. `naima docs` also prints the reference of every loaded plugin, including this
one.

## Removing it

To remove a plugin, delete its entry from `plugins`. If it added a type, its [items](glossary.md#item) stay on disk, and `naima check` then reports a folder
that no loaded plugin owns (this is the check called `layout`).

If you want to write a plugin of your own, see [extending Naima](extending-naima.md), and the [plugin contract](../reference/plugin-contract.md) for the full
contract it is written against.
