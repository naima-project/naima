# The no-leaks checklist

Read this before every write of free text or a file to the tracker: a title,
a description, a note, a session note, an event, a free-text field or an
attachment. When the text follows every point below, pass this file's path
with `--revised` to sign that you checked it. Naima compares the file with
its own copy and refuses the write without it
([the rule](../guide/rules.md#free-text-and-files-are-signed-against-the-no-leaks-checklist)).

1. The owner is paraphrased, never quoted. Write what they asked for in your
   own words. Only the agent talking to the owner writes text taken from
   what the owner said; a worker writes its own observations.
2. Nothing about the owner's other private projects, unpublished papers or
   venues, business, money or clients, and no person other than the owner,
   by name or by description.
3. No machine names, IP addresses, addresses with a port, home-directory
   paths or user names. Write `<host>`, `<ip>`, `<path>` and `<user>`
   instead.
4. Every log and every file you attach is read line by line before it goes
   in, its metadata included (an image's location and camera data, a
   document's author and history). Redact what this list rules out, or
   leave the file out.
5. When in doubt, leave it out and ask the owner whether it may go in.
