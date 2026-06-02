# TODOS

## 2 June 2026

- ~~Add a Archive button next to the Promote button (window.confirm before archiving)~~
- ~~Add a settings button at the bottom of the project list. Settings open up in the middle pane (empty right pane). We set the image asset folderpath from there.~~
- ~~Change image_path.txt to a config.ini file, so we can add configurations later.~~
- ~~Project overview: Dont show "cards" and "images" on 1_idea and 2_draft. Cards should list a detailed view of the batch names, and amount of cards (unique and total).~~
- ~~Under the information list, add a button: Preview Images (if images exist for that project). This will open a full screen (closable) image grid of all images, with their id, name and amount information underneath each image.~~
- ~~Group Action buttons in the Action panel: Editing (rules/templates), Rules (generate html/pdf), Images (tts, boardgamemaker, pdf), Templates (jpgs, tts, boardgamemaker, pdf)~~
- ~~Scroll is not working in the editor.~~
- ~~This is not version 1.0.0, but 0.1.0 we are working on.~~
- ~~Can we avoid using winget in install.cmd? And use portable versions of node/git/pnpm? (Yes — install.cmd now downloads portable Node/Git/pnpm into the project's .runtime/.)~~


## 1 June 2026

## Project Pane

- ~~Each project group should be a list of text-links, instead of buttons. Max. 5 items visible per group, scroll for more projects.~~
- ~~Each project should be a text-link (single line). No padding/margin. Not look like a button. Remove promote button.~~

## Middle Pane (Project View/Action View)

- ~~When clicking a project in the project pane, the middle pain should contain an overview of the project: Name, date created, cards, whether it as images in the image path, how many images. At the top a Promote button, to promote it to the next level.~~
- ~~In Project View, the right pane should only have the Actions available for the project. Pressing an Action button, should show the Action description and settings in the middle pane.~~
- ~~The first action in the Action Pane should be: Edit Files.~~

## Middle Pane (Editor)

- ~~When Edit Files, the Middle Pane and Right Pane should have equal width.~~
- ~~The Right Pane will only contain a Preview (no Actions).~~
- ~~When selecting a css file, default to the first html file, that imports that css file.~~
- ~~Pressing Tab in the editor, should insert 4 spaces.~~
- ~~At the top of the middle pane, should be a button: Close Editor.~~
- ~~There should be warnings if an edited file is not saved: ask "Save before closing"~~
