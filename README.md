# bg_tools

Reusable board-game tooling: a small browser-based menu that, for a given game
project, can generate:

- **Rules HTML** from a rules markdown file
- **Print-and-play PDFs** (from card images, or rendered from HTML templates)
- **Tabletop Simulator** deck image sheets
- **boardgamemakers.com** card files
- **Card JPGs** rendered from HTML templates

It also includes live editors for the card **HTML templates** and the rules
**markdown**.

The key idea: `bg_tools` contains only the *tools*. It operates on whatever
project directory it is launched from, so you can share/publish `bg_tools`
without any of a project's private rules, images, or card data.

## How it works

The menu is a zero-dependency Node HTTP server (`scripts/menu/server.mjs`). When
launched it serves a small browser UI and runs the generators, resolving:

- **its own code, UI, and card templates** relative to the `bg_tools` folder, and
- **the project's data** (game folders, `image_path.txt`, generated `_dist`
  output, card `design/` folders, rules markdown) relative to the **current
  working directory** — i.e. the project you launch it from.

A project is expected to contain game folders under `3_test/`, `4_playtest/`,
and `5_prototype/`, and an `image_path.txt` pointing at the master image folder
(the menu can create this for you).

See [`scripts/README.md`](scripts/README.md) for the internal layout and the
generator scripts.

## Install

```sh
pnpm install
```

This installs the dependencies and (via `onlyBuiltDependencies`) downloads the
Chrome build Puppeteer uses to render HTML card templates.

## Use from a project

From the root of a game project, launch the menu so its working directory is the
project (that's how it finds your games and writes output into the project's
`_dist/`):

```sh
node ../bg_tools/scripts/menu/server.mjs
```

The typical setup is to add a script to the project's `package.json`:

```jsonc
"scripts": {
  "tools": "node ../bg_tools/scripts/menu/server.mjs"
}
```

and launch it with `pnpm run tools` (e.g. from a `run.cmd`). The menu opens in
your browser automatically.

## Use standalone

```sh
pnpm start
```

runs the menu against the `bg_tools` folder itself (mainly useful for
development of the tools).

## Start your own (private) rules repository

The [`example/`](example/) folder is a ready-made template for a **private**
game-design repository. Unlike the "use from a project" setup above, it does not
need a sibling `bg_tools` checkout — its `package.json` pulls `bg_tools` straight
from GitHub, so you can keep your private rules in their own repo anywhere.

It contains the status folders of the **Moe & Spil Board Game Design System**
(`1_idea/` … `7_archive/`), each with a `README.md` explaining what belongs
there, but no game data of its own.

To use it for your own private rules:

1. **Copy** the `example/` folder out of `bg_tools` to wherever you keep your
   projects, and rename it (e.g. `my-board-games`):

   ```sh
   cp -r bg_tools/example my-board-games
   cd my-board-games
   ```

2. *(optional)* Make it its own **private** git repository:

   ```sh
   git init
   git add .
   git commit -m "Start my board games"
   ```

3. **Install** the tools (this fetches `bg_tools` from GitHub):

   ```sh
   pnpm install
   ```

4. **Launch** the menu against your repository:

   ```sh
   pnpm run tools
   ```

Your rules, images, and card data live only in your private repo; `bg_tools`
stays a shared, publishable dependency. To pull in a newer version of the tools
later, run `pnpm update bg_tools`.
