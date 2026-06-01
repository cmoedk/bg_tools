# 2_draft

Games that have **draft rules**, either partial or complete.

## Contents

Each game lives in a folder named `[working_title]`, containing only two files:

- `[working_title]_rules.draft.md` — the unversioned draft rules.
- `[working_title].notes.md` — design notes, grouped under date headers
  (e.g. `## 23. June 2025`). Each note is a list item that can be
  `~~struck out~~` once implemented or discarded (give a reason if discarded).

## Moving up to 3_test

When the draft rules are ready for testing:

1. Move the `[working_title]` folder to [`../3_test/`](../3_test/).
2. Rename `[working_title]_rules.draft.md` to
   `[working_title]_rules_0.0.1.test.md`.
3. Create a `[working_title].changelog.md` file.
4. If the game has cards, create `[working_title].cards.json5` (start from the
   `_template.cards.json5` shipped with `bg_tools`).
5. If the game has other printable components, create
   `[working_title].components.json5`.
