# File a bug

When something is broken, it gets written down as an item before anyone tries to fix it ([the rule](rules.md#write-it-down-before-fixing-it)). Usually you just
tell an agent what you saw and it does the steps below for you. They are here so you can follow along, or run them yourself if you prefer.

## Now

1. **Open the item.** Give it a title that says what happened rather than what to do:

   ```sh
   naima new bugs "Export drops the alpha channel"
   ```

   It prints the folder it made, `naima-tracker/naima-data/bugs/<slug>/`, and the [item](glossary.md#item)'s permanent [id](glossary.md#id).

2. **Write the page.** Open `README.md` in that folder and put down
   - **what happened**: what happens, what should happen, and how to see it. An agent writes this in its own words, and your chat with it is never copied in
     unless you say yes ([the rule](rules.md#the-owners-chat-stays-private));
   - **the evidence**: what you ran and what it printed, a number, or a screenshot. Files go in `attachments/` next to the page, added with
     `naima attach <item> <file> --own`. A file holding a secret is refused, so cut the secret out first. A machine name, an IP address, a home path or a user
     name is refused too, so write `<host>`, `<ip>`, `<path>` or `<user>` instead
     ([the rule](rules.md#no-machine-names-or-private-infrastructure-in-a-repository));
   - **what you saw and what you only suppose**, kept apart;
   - **the consequence**: who notices, and when.

   Leave out any fix you haven't tried and any cause you haven't checked.

3. **Triage it.** Set at least impact, priority and confidence ([triage](triage.md)):

   ```sh
   naima triage set export-drops impact=high priority=next confidence=reported
   ```

4. **Check and commit**:

   ```sh
   naima check
   git add naima-tracker && git commit -m "File: export drops the alpha channel"
   ```

## Is it a bug at all?

| You are saying…                                  | File it as                                     |
| ------------------------------------------------ | ---------------------------------------------- |
| "this is broken"                                 | `naima new bugs "…"`                           |
| "this needs doing" (work, a decision, a tidy-up) | `naima new todos "…"`                          |
| "I'd like it to do X", and it does not exist     | a feature: [file a feature](file-a-feature.md) |
| "this still has to be tried"                     | `naima new tests "…"`                          |

## The same thing twice

If there is already an item for it (`naima list bugs` shows them), add what you saw to that item's page. If two items turn out to be about the same thing, link
them and keep the [evidence](glossary.md#evidence) on the one that stays:

```sh
naima link export-drops-2 duplicate-of export-drops
```

## Next

- Rank it: [triage](triage.md).
- Once it's fixed, prove it: [prove and close](prove-and-close.md).
- How an agent does the same thing, step by step: [reporting and triage](../agents/reporting-and-triage.md).
