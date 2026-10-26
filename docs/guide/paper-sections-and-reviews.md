# Writing a paper: sections and reviews

The `pack-analyses` pack ([Extending Naima](extending-naima.md)) proves a non-software step by rerunning a command. A paper has steps with no command to rerun
at all. A section is done when its prose matches what was agreed in the outline, and deciding that takes a co-author's judgement rather than a diff.
`pack-papers` is the second worked example of a non-software item-type pack, and it is built for exactly this case. The agents run the commands below for you,
unless you want to run them yourself.

To turn it on, add it to the project's plugins.

```json
"plugins": { "pack-papers": {} }
```

The pack adds two types.

- **`sections`** is one section of the paper. A section starts as `proposed`.
- **`reviews`** is a co-author's pass over one section. A review starts as `open` while the reviewer raises objections. It ends as `answered` when every
  objection has been addressed and the section matches the outline, or as `standing` when at least one objection was never addressed and the reviewer says the
  section still doesn't match.

A review proves or refutes a section in the same way a test proves or refutes a requirement, and it is linked with the same relation, `verifies`/`verified-by`.
The difference is that the proof is a reviewer reading the prose, never a program running.

```sh
naima new sections "Related work"
naima new reviews "Ada reviews related work" --set reviewer="Ada"
naima link <the review> verifies <the section>
naima set <the review> status=answered       # every objection addressed
naima set <the section> status=confirmed
```

`naima check` points out a section marked `confirmed` that no review has answered, and a section that already matches its outline but is still `proposed`. These
are the same two notes that `pack-analyses` gives for a data-analysis step, because the pack reuses the same proof machinery instead of building a parallel one.
If a review later finds an objection still standing, its status is set to `status=standing`, and the check then says which section to move back to `disputed`.

Source: [`naima/src/plugins/pack-papers/index.ts`](https://github.com/naima-project/naima/blob/main/naima/src/plugins/pack-papers/index.ts).
