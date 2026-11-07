# Showing the owner something in Naima's UI

When you want the owner to see something in the project, such as a screen, an item, a commit or a line, show it in the Naima UI they have open rather than
making a page, a chart or an artifact of your own. The UI already draws the project as the owner knows it, and what you show stays live there.

## Adding the server

Naima serves its UI's bridge, the commands the UI itself reads and acts through, as an MCP server on its standard input and output. An agent's client starts it
in the project's folder. In Claude Code:

```sh
claude mcp add naima -- naima ui --mcp
```

Any other MCP client starts the same command. The tools are the bridge's commands: `describe`, `data` (a view's data, live or at a commit), `tabs`, `tab`,
`metro` (the rail's map), `action` and `run` (the UI's short list of actions, run through `naima run`), and `show`.

## Showing a place

Call `show` with exactly one of:

- `screen`: home, metrics, diary, bugs, features, failed_tests, goals, roadmap, map, all_projects or more;
- `view`: a plugin's view, by its name, as `tabs` lists it;
- `item`: an item's reference, such as `bugs/<slug>`;
- `commit`: a hash or a ref a local branch reaches, which moves the playhead there;
- `line`: a line's name, such as `main` or `line/<gate>`.

Every UI open on the project, the desktop app or a browser tab, goes there at once. The answer says how many open UIs took it. When none is open, `show` opens
one as `naima hello` does, the desktop app when it is installed, else `naima ui` in the browser, and shows the place there; when none could be opened, it says
so: tell the owner to open the UI with `naima ui`, then show again. Say in one line what you showed and why; the owner looks at the UI, not at a copy of it.
