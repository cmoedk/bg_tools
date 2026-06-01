# 3_test

Games that are ready for **solo testing**.

## Contents

Each game lives in a folder named `[working_title]` and must contain:

- `[working_title]_rules_0.0.x.test.md` — a versioned rules file.
- `[working_title].notes.md` — dated design notes.
- `[working_title].changelog.md` — changes to rules or components, grouped under
  version headers (e.g. `## Version 0.0.x (23 May 2025)`). Each entry is tagged
  with a category: `RULE`, `COMP`, `LANG`, `LOOK`, or `MISC`.

It may also contain component files:

- `[working_title].cards.json5` — indexes and lays out the game's cards for
  printing and play.
- `[working_title].components.json5` — other printable components (e.g. boards).

This is the first status from which `bg_tools` can generate rules HTML,
print-and-play PDFs, Tabletop Simulator sheets, and card images. Run the tools
from the repository root with `pnpm run tools`.

## Moving up to 4_playtest

When the game has been solo-tested and is ready to test with others:

1. Move the `[working_title]` folder to [`../4_playtest/`](../4_playtest/).
2. Rename `[working_title]_rules_0.0.x.test.md` to
   `[working_title]_rules_0.1.playtest.md`.
