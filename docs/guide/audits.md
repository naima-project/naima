# Audit what was built

Sometimes you want someone who did not build a piece of work to check it against what you decided: the decisions, the requirements, the specifications and the
approved designs. Naima keeps each such check as an [audit](glossary.md#audit), an item that names what it checked against, holds the findings and the evidence,
and ends with a verdict.

## Record one

An audit starts `in-progress` and is dated with today in its field `auditedOn`. Link it to each thing it checks against with `audits`, and to the todo that
asked for it with `fulfils`.

```sh
naima new audits "Export audit"
naima link audits/export-audit audits decisions/exports-keep-alpha-channel
naima link audits/export-audit audits specs/export-format-v2
naima link audits/export-audit fulfils todos/audit-export
```

Its page has three sections: what was checked, the findings, and the verdict in a few sentences. Each finding says what was expected, what was found, and the
evidence for it. A report or a longer write-up goes in as an attachment, with `naima attach <audit> <file> --own`.

## Conclude it

When the findings are complete, set the verdict and conclude the audit in one step:

```sh
naima set audits/export-audit verdict=fail status=concluded
```

The verdict is one of three words. `pass` means the work matches what was decided. `pass-with-findings` means it matches in substance, and the findings name
what is left to fix. `fail` means it does not match, and the findings say where. Naima refuses to conclude an audit that has no verdict, and `naima check`
reports one that was concluded without a verdict anyway.

An audit does not fix anything by itself. Each finding that needs work becomes a bug or a todo of its own, linked to the audit with `relates-to`.

A later audit of the same work is a new item, linked to the earlier one with `supersedes`. Set the earlier one to `superseded`.

The fields, statuses and the check are listed in the [reference](../reference/reference.md), under the planning plugin.
