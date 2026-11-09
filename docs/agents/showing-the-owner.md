# Showing the owner something in Naima's UI

When you want the owner to see something in the project, such as a screen, an item, a commit or a line, show it in the Naima UI they have open rather than
making a page, a chart or an artifact of your own. The UI already draws the project as the owner knows it, and what you show stays live there.

## Adding the server

Naima serves its UI's bridge, the commands the UI itself reads and acts through, as an MCP server on its standard input and output. An agent's client starts it
in the project's folder. In Claude Code:

```sh
claude mcp add naima -- naima ui --mcp
```

Any other MCP client starts the same command. Its answers are short plain text, like a screen at a glance; ask for one thing by its id
for more. Which tool for what:

- `overview`: the project at a glance. Start here.
- `items`: one item by its ref (the slug or the id's start will do), or a search by words, type, status, gate or open, with counts.
- `gates`: every gate in a line each, or one gate by name: why it is blocked and by what.
- `lines`: the trunk, the lines and the branches, or one by name with its goals and last commits.
- `history`: the last days in a line each, or one `day`, or one `commit`.
- `work`: claims, the ready queue, stale work and work at risk, or one `worker`.
- `metrics`: every metric's value and trend, or one metric's recent points.
- `view`: a view's raw data, shortened, in pages (`path`, `offset`, `limit`, `where`, `search`, `since`, `until`, `fields`), only when the tools above do
  not answer.
- `action` and `run`: the UI's short list of actions, run through `naima run`.
- `show`, `read_page` (an outline of what the owner sees; the text with `mode`) and `screenshot` (rarely).

A bare call answers in about 2 000 characters at most; `detail: "full"` gives an item or a gate whole, as compact JSON. No reply passes 20 000 characters,
and a reply cut there says how to narrow the call.

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

## Seeing what the owner sees

`read_page` answers an outline of the open UI's page: its landmarks, its headings each with the first line under it, and its controls with their state, in
about 2 000 characters. `mode: "text"` gives the page's text and `mode: "html"` its raw HTML, in pages, and `selector` reads only the part under a CSS selector. Use it to check what a `show` did and what the owner is looking at. `screenshot` answers a PNG of the UI's window as it is on the screen,
taken with the system's screen capture on macOS; elsewhere it says it cannot. A picture costs far more than the text: take one only for a rare visual check that
the text cannot answer, such as a layout or a colour.
