# My Board Games

A template for a **private** board-game design repository, organized with the
**Moe & Spil Board Game Design System** and powered by
[`bg_tools`](https://github.com/cmoedk/bg_tools).

This folder contains only structure and documentation — no game data. Copy it to
your own (private) repository and start adding games.

## What's here

Games are organized into top-level folders that indicate their current status.
Each game moves "up" through these folders as it matures:

| Folder                          | Status                                                      |
| ------------------------------- | ----------------------------------------------------------- |
| [`1_idea/`](1_idea/)            | Concepts and ideas only                                     |
| [`2_draft/`](2_draft/)          | Partial or complete draft rules                             |
| [`3_test/`](3_test/)            | Ready for solo testing                                      |
| [`4_playtest/`](4_playtest/)    | Ready for playtesting with others                           |
| [`5_prototype/`](5_prototype/)  | Ready for testing by others / events / publishers           |
| [`6_production/`](6_production/)| In production                                               |
| [`7_archive/`](7_archive/)      | Discarded games                                             |

Each folder has its own `README.md` describing exactly which files a game at that
status should contain. The full specification lives in `bg_tools`' reference
`structure.md`.

## Setup

```sh
pnpm install
```

This pulls in `bg_tools` from GitHub (and the Chrome build Puppeteer needs to
render card templates).

## Use

From the root of this repository, either **double-click `run.cmd`** or run:

```sh
pnpm run tools
```

This launches the `bg_tools` browser menu with **this folder** as its working
directory, so it finds your games (under `3_test/`, `4_playtest/`, and
`5_prototype/`) and writes generated output into `_dist/`.

The first time you generate something, the menu will offer to create an
`image_path.txt` pointing at your master image folder (kept outside the repo).
