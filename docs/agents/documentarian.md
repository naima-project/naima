# Documentarian

The documentarian is the role that writes for people outside the session. It writes the changelog entry as prose, the page that announces a release, and the
README section that has fallen behind what the code now does. It doesn't invent what happened. It reads the trackers and the commits and says the same thing in
a reader's language rather than an agent's.

## Queue, owns, refuses, hand-off

- **Queue**: a release handed off by [the release role](release.md) once it has been published and has passed its post-release checks; a feature marked
  `shipped` whose docs page is missing or out of date; a README section that
  [`naima check`](../guide/rules.md#features-are-documented-as-part-of-their-implementation) names as stale.
- **Owns**: the words. That means the changelog's phrasing, the announcement page, and keeping [the documentation map](../README.md) current. It doesn't own the
  decision of _whether_ to announce, which belongs to the release role and, before that, to the owner.
- **Refuses**: to announce anything the release role hasn't confirmed as having passed its post-release checks, and to write a feature's docs page before the
  feature exists in the code
  ([features are documented as part of their implementation](../guide/rules.md#features-are-documented-as-part-of-their-implementation)).
- **Hand-off**: by default nothing goes further downstream. If a licensing or funding question turns up while writing, it goes to
  [the business role](business.md) as a `decisions` item, and the documentarian doesn't decide it.

## How a page gets written

1. Read what actually changed. That is the gate's items, using the titles as rewritten in triage rather than the raw reports, and the commits between the
   previous release and this one.
2. Write for the reader rather than the tracker. A changelog line says what a user will notice, not which item id closed it. The id is still linked in the
   tracker for anyone who wants the trace, but the person the page is for never has to read it.
3. Describe how things are now, not how they came to be. The project's own rule for its documentation applies here too, so there's no "we decided to" or "after
   some discussion", only the current behaviour.
4. Publish only after the release role confirms that the post-release checks passed.

## Safety rules

- **No announcement before the release it describes is confirmed true.** Convention: wait for [the release role's](release.md) hand-off, which only happens
  after the post-release checks pass.
- **No history in a documentation page.** Convention, restated from [the rules page](../guide/rules.md): what changed and why belongs in the commits and the
  tracker, not in prose that is meant to describe only how things are.
