# File a bug

Something is broken. Write it down first, before anyone tries to fix it
([the rule](rules.md#write-it-down-before-fixing-it)).

## Now

1. **Open the item**, with a title that says what happened, not what to do:

   ```sh
   naima new bugs "Export drops the alpha channel"
   ```

   It prints the folder it made, `naima-tracker/naima-data/bugs/<slug>/`, and
   the [item](glossary.md#item)'s permanent [id](glossary.md#id).

2. **Write the page**: open `README.md` in that folder and put down
   - **what happened**: what happens, what should happen, how to see it. An
     agent writes this in its own words; your chat with it is never copied
     in without your yes ([the rule](rules.md#the-owners-chat-stays-private));
   - **the evidence**: what you ran and what it printed, a number, a
     screenshot — files go in `attachments/` next to it, with
     `naima attach <item> <file> --own` (a secret in one is refused: cut it
     out first; a machine name, an IP address, a home path or a user name is
     refused too: write `<host>`, `<ip>`, `<path>`, `<user>`,
     [the rule](rules.md#no-machine-names-or-private-infrastructure-in-a-repository));
   - **what you saw and what you only suppose**, kept apart;
   - **the consequence**: who notices, and when.

   Leave out a fix you have not tried and a cause you have not checked.

3. **Triage it** — at least impact, priority and confidence
   ([triage](triage.md)):

   ```sh
   naima triage set export-drops impact=high priority=next confidence=reported
   ```

4. **Check and commit**:

   ```sh
   naima check
   git add naima-tracker && git commit -m "File: export drops the alpha channel"
   ```

## Is it a bug at all?

| You are saying… | File it as |
|---|---|
| "this is broken" | `naima new bugs "…"` |
| "this needs doing" — work, a decision, a tidy-up | `naima new todos "…"` |
| "I'd like it to do X", and it does not exist | a feature: [file a feature](file-a-feature.md) |
| "this still has to be tried" | `naima new tests "…"` |

## The same thing twice

If an item for it already exists (`naima list bugs`), add what you saw to that
item's page. If two items turn out to be one, link them, and keep the
[evidence](glossary.md#evidence) on the one that stays:

```sh
naima link export-drops-2 duplicate-of export-drops
```

## Next

- Rank it: [triage](triage.md).
- Once fixed, prove it: [prove and close](prove-and-close.md).
- How an agent does the same, step by step: [reporting and triage](../agents/reporting-and-triage.md).
