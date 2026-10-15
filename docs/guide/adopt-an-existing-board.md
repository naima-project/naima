# Adopt an existing board

Your project may already keep its work somewhere, such as a `TODO.md`, a
notes file, or an issue list exported as markdown. `naima adopt` turns that
file into [items](glossary.md#item), so nobody has to retype it and no line
gets lost. Every step only shows what it would do until you add `--write`,
and the file itself is never deleted. The agents run these steps for you
unless you want to run them yourself.

## Now

1. **Propose the boundaries.** Each top-level list item (`- `, `* `, `+ `
   or `1. `, together with everything indented under it) becomes one item:

   ```sh
   naima adopt propose TODO.md            # what it would mark
   naima adopt propose TODO.md --write    # insert the markers
   git diff TODO.md
   ```

   The markers are HTML comments, so they don't show when the file is
   rendered:

   ```md
   <!-- naima: todos key=fix-login-redirect-loop -->
   - [ ] Fix the login redirect loop
     After the session expires the page reloads forever.
   <!-- /naima -->
   ```

   The diff only adds lines and never deletes any, because `propose`
   refuses to write anything else. Read it and edit the markers by hand if
   needed. You can change the type (`todos`, `bugs`, `features`, …), the
   `key`, and `status=` (a ticked checkbox is proposed as `status=done`). To
   cut the board differently, move, add or remove a pair. A heading or a
   paragraph that sits outside every pair stays as the board's own prose.

2. **Split.** Commit the marked file first, so that each item can name the
   commit it came from:

   ```sh
   naima adopt split TODO.md              # the items it would open
   naima adopt split TODO.md --write      # open them
   ```

   Each item's page is its segment, byte for byte, under a title line taken
   from the segment's first line. The field `section` is the nearest heading
   above it, and `adoptedFrom` says where it came from, for example
   `TODO.md#L8-L9@<commit>`, or `working-tree` when the file was not
   committed. The board's own prose and each segment's text as it was adopted
   are kept in `naima-tracker/naima-data/adopted/<file>.json`, and together
   they give the file back exactly.

3. **Audit.**

   ```sh
   naima adopt audit TODO.md
   ```

   This re-reads every committed version of the file, following renames, and
   lists each line that isn't carried by any item or by the board's prose,
   with the commit and line where it was last seen. So a todo that was
   deleted months ago without being done shows up here. The audit also says
   whether the board still round-trips byte for byte, and it exits 1 as long
   as anything is missing. You can carry a missing line into an item by hand,
   or put it back in the file and run the steps again.

4. **Links.** These are written only when there is hard evidence for them.

   ```sh
   naima adopt links TODO.md              # what it would link
   naima adopt links TODO.md --write      # write the proposed links
   ```

   A `relates-to` link is proposed only when both items name the same real
   commit of this repository and their titles share at least two words.
   Anything else is printed for you to decide and is never written. That
   covers a shared commit without shared wording, shared wording without a
   shared commit, and each command in a fenced shell block, which is shown as
   a candidate [gate](glossary.md#gate). Gates are declared in `naima.json`
   ([configure the project](configure-the-project.md)).

## Again, later

The file can stay in use alongside the tracker, and the steps can be run
again whenever it grows. `propose` only marks list items that are outside
every pair, and `split` only opens keys that haven't been adopted yet. If a
segment's text has changed since it was adopted, that is reported and not
written over, and an item that someone has edited is never touched.

## What it does not do

- It doesn't delete, empty or move the file. Retiring the file is your
  decision, once the audit says nothing is missing.
- It doesn't read an issue tracker's API, so export the list as markdown
  first.
- It doesn't decide a link or a gate on wording alone.

Every option is in [the reference](../reference/reference.md).
