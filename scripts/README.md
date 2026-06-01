# `8_utils/scripts`

Tooling for working with the board games in this repo: a browser-based menu and
the generators it launches (rules HTML, print-and-play PDFs, Tabletop Simulator
sheets, boardgamemakers.com files, and card images rendered from HTML templates).

## Layout

```
scripts/
  menu/                  Browser-based menu (launched by run.cmd at the repo root)
    server.mjs           Zero-dependency Node HTTP server: serves the UI + small JSON API,
                         and runs the generators, streaming their output back live (SSE)
    ui/                  The browser UI (plain HTML/CSS/JS, no build step)
      index.html/app.js  3-pane workspace: projects (add/promote) | inline file
                         editor | live preview + generator actions
      style.css          Shared styles for the workspace, editor and preview
    menu.mjs             Older terminal version of the menu (kept for reference)
    create_image_txt.mjs One-off prompt to create image_path.txt

  generate/              The generators (each is a standalone CLI entry script)
    config.mjs           Shared constants (output folders, card sizes, A4 dimensions, ...)
    shared.mjs           Shared helpers: CLI-arg parsing, reading card data, image lookup, canvas text
    typedefs.mjs         JSDoc @typedefs shared across the generators
    pdfBuilder.mjs       Builds the A4 print-and-play PDF (used by the two PDF generators)
    templateRenderer.mjs Renders cards from HTML templates via Puppeteer (used by the two template generators)
    markdownRenderer.mjs Shared markdown -> styled HTML pipeline (used by the rules HTML generator and the markdown editor preview)

    generate_html.mjs               rules markdown   -> _dist/<game>/<game>.html
    generate_pnp_pdf.mjs            card images      -> _dist/<game>/pnp_pdf  (print-and-play PDF)
    generate_test_pnp_pdf.mjs       HTML templates   -> _dist/<game>/test     (print-and-play PDF)
    generate_jpgs_from_templates.mjs HTML templates  -> _dist/<game>/template_jpg (one JPG per card)
    generate_tts_files.mjs          card images      -> _dist/<game>/tts      (Tabletop Simulator sheets)
    generate_bgm_files.mjs          card images      -> _dist/<game>/bgm      (boardgamemakers.com files)

  tools/                 Misc standalone tools (e.g. compare_images.py)
```

All generated output goes under `_dist/<gameName>/...` at the repo root.

## How generators are invoked

The menu spawns every generator the same way:

```
node <script> <masterImagePath> <gameFolder> <gameName>
```

- **masterImagePath** – absolute path to the master image folder (chosen in the
  menu, stored in `image_path.txt`).
- **gameFolder** – the project folder relative to the repo root, e.g.
  `5_prototype/the_king_of_ragnarok`.
- **gameName** – that folder's name, which is also the per-game subfolder name
  inside the master image folder where the card images live.

Each entry script parses these with `parseGeneratorArgs()` from `shared.mjs`, so
the convention lives in exactly one place.

## Running

From the repo root, launch the menu with `run.cmd` (it starts `menu/server.mjs`
and opens the browser). You can also run any generator directly with the three
arguments above.
