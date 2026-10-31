---
title: "Agents answer in the user's terms, and commit without asking whether to"
kind: behaviour-change
affects:
  - workflow
rules:
  - added Answer in the user's terms; Naima's words only where they really help
  - changed Never ask what the rules answer
---

A new working rule, `answer-in-the-user-s-terms`, acknowledged as "Plain terms mode on": an agent answers in the user's own words, as briefly as the question
allows, and uses Naima's vocabulary (gate, claim, land and the rest of the glossary) only where it is pertinent and really helps; a question unrelated to Naima
gets an answer with none of it, while every change still goes through its item. The rule on never asking what the rules answer now says plainly that an agent
commits as the rules say and never asks the owner whether to commit, so no change is left uncommitted waiting for that answer. The skill and the rules page say
the same.
