# TODOS

## 5 June 2026

- ~~Do not show filename <span> in editor (#file-name). Rename X Close Editor, to just X. Move Rename before Bump Version.~~
- ~~All config.ini settings should be editable from Settings menu.~~
- ~~Under Edit Files, add "Edit Rules in A5 Print Tool" for 3_test and above. For now, add an alert, that says the tool is soon available.~~
- ~~In the Projecs pane, add a "Projects" header. In the middle pane add a "Overview/Editor" header~~
- ~~Remove the bg_tools main header. It does nothing, but take up space.~~
- ~~Center the Edit Template button and make it blue background.~~
- ~~When editing .cards.json5, in the preview pane, add a toggle to switch between Images and Templates (JPGS) if both are present. Else just view whichever is present.~~
- ~~When parsing markdown, we want HTML comments hidden.~~

- ~~Indent json5 correctly on save. Add a indentation config value, and set it to 2 spaces. (also use that setting when pressing tab)~~
- ~~When previewing a template (when editing .cards.text), add a button in the preview: Edit Template. This opens the template file in the editor file list.~~
- ~~Promote button should be black, not blue. Blue draws too much attention, and it is a rare action.~~
- ~~Preview Template Images should also be blue (Like preview images)~~
- ~~When selecting a non-default language, the language <select> element changes the default language to "Default", even when .info has a non-empty string in the language property.~~
- ~~Languages in select menus should be Capitalized.~~
- ~~Generating rules should create a rules_html/rules_pdf folder under the _dist/<project> folder.~~
- ~~In the editor, add a Design optgroup that has the design files. This optgroup should be the second, after the main one.~~
- ~~Optgroup titles should be Capitalized.~~
- ~~In the editor, instead of having a input for the filename string (which is rarely changed), add a Rename button (black background, as with Bump). Also add a Delete button (with red background) that deletes a file (after a window.confirm). Use a Trashcan icon for Delete, to save horizontal space, and put it last.~~

- ~~After clicking "Add Missing Template", the new file is not added to the file select element.~~
- ~~If an external program alters a file already being edited and no changes has been made, update the current file being edited to the file on disk.~~
- ~~If an external program alters a file already being edited and changes has been made, ask the user what to do (overwrite file on disk, keep file on disk, cancel).~~
- ~~When moving line to line in .cards.text, the preview blinks. Do not update the preview, if it the same card being rendered.~~
- ~~Track where the user is. If in a specific project, editing a specific file, remember where, and restore that location on reload/revisit. Use localstorage for that data.~~
- ~~In the file-list, remove the <title> part of the "official" files (_rules, .cards, .cards.text, .info, .notes, .changelog). Also move those files to the top of the select under a <optgroup> header (with additional languages under their own optgroup header named after the language). Have the rest in a Misc. optgroup., and then + New file at the bottom.~~
- ~~Under "Add Missing Template", add a "Add All Missing Templates" if multiple template files are missing.~~
- ~~In config, add a list to get language names from: da=dansk, en=english~~
- ~~In all Generate actions, the Output folder is the same. Show the output folder for that Generate options (fex <title>/tts, or <title>/pnp_pdf), which is also the target of the Open Folder.~~
- ~~In all Generate actions, add a Delete Output Folder button, with a window.confirm before the folder is cleared.~~
- ~~Only show Generate action categories Images and Templates if Master Image Path has images/project folder, and the project has a .cards.text file (respectively).~~
- ~~When editing a rules file in 3_test and above, add the button "Bump version". When pressing the button, allow the user to edit the current version (f.ex. from 2.5 to 2.6 - as a string or prompt), and rename the rules file accordingly.~~

## 4 June 2026

- ~~Create a default design template, that is copied when initiating a project that has a design folder (3_test and above). The design template has a card.html (for the specific card with a <style> section, that distinguishes that type of card), card.css (which have general card size and layout properties), and style.css (that has color, font, and text properties)~~
- ~~When editing html files, the design preview drop-down should also have the card name, f.ex. m01: Clairvoyance.~~
- ~~When editing css files, add a select box, where you can select a card, that uses a template that imports that css for previewing changes (right now it defaults to the first html file).~~
- ~~When editing a .text.json5, and the template html file does not exit, in the preview pane add a button "Add Missing Template". When pressing the button, it creates the missing file, and fills it with the default design template (card.html).~~
- ~~When editing a file in 1_idea, + New file should not be an option (idea projects are just one file)~~
- ~~In the category headers in the left panel, add how many projects exist in that category (f.ex. 1 Idea (13))~~
- ~~After Generate JPGs from templates, in the project overview the Preview Template Images does not appear until after a reload of the page.~~
- ~~When upgrading to playtest, add a <title>.info.json5, which contains { title, oneLiner, description, duration, playerCount, ages, language  }, that is displayed under the header in project overview (before the data information). If this file does not exist in a current project (playtest and above), generate it. This file may be created by the user in 2_draft and 3_test, and be displayed as well.~~
- ~~In the project overview, if there are more languages, add a select to switch between languages. If there are no .info file, just add "Default" as the main language. Generated templates will look in the <title>.<lang> folder for .text.cards, and in the same folder from the master image path.~~

## 3 June 2026

- ~~No white background on image preview images (stay gray, so you can see the edges of the image)~~
- ~~When previewing an image, highlight the thumbnail of the previewd image. Allow arrow keys to go forward/backward/upward/downward in the preview pane.~~
- ~~In image preview and other places, Open folder is not a link or button (no hover state)~~
- ~~Generate rules pdf: remove information about which script it runs (in parenthesis)~~
- ~~When clicking settings, remove selected project highlight.~~

- ~~In Image preview, when clicking an image, open a right panel with the image to full-size (or window height - whichever it hits first.). The panel should have a close button, or close when the same image is clicked again.~~
- ~~Templates actions: Remove (from templates) in button name. Add Generate Tabletop Simulator Files. Add Generate Boardgamemakers.com files.~~
- ~~In Actions view, Run should be Generate. Remove the Clear button. Show the console view before clicking any buttons, with an inline: "Console output will appear here" or something like that (helpful).~~
- ~~After generating things, have a link to the generated file/folder as well as its parent folder (_dist project folder) between the Run button and the Console view.~~
- ~~Generate rules HTML: In Action view, add to description "using Github markdown style". Create a link to the generated _dist folder (or_dist/<project>) if no generated content exist yet.~~
- ~~Images/Templates Generate Print-and-Play PDF: Generated PDFS should be between Run and Console. The first line "Running...." does not appear until the script has finished - show that line immediately.~~
- ~~Images/Templates Generate TTS: Description: Inform that the filenames will contain the exact rows and card amounts for each file, for use in the Tabletop Simulator Application.~~
- ~~Images/Templates Generate Boardgamemakers.com: Inform that the images will be slightly changed (and how) for easy bulk upload to boardgamemakers.com~~
- ~~Templates: Generate JPGS: Do not mention Puppeteer. If these files exist, then pressing Generate PDF/TTS/Boardgamemakers should use those, instead of generating new files from template. When pressing Run in those three actions, the user should be queried if they want to use the jpgs from that folder, or generate anew.~~
- ~~When previewing images, add a link to the parent folder at the top: "Images - <project title> (<amount>) - <link to parent folder>".~~
- ~~In the project overview, add a Template Images similar to the Images item, if those exist as separate jpgs (from the Generate JPGS option)~~

- ~~Saved info (after pressing save in settings) is not centered and too much border radius.~~
- ~~In previewing images, you should be able to change the amount (mod). Also should just display images in .cards.json5, not all images in folder.~~
- ~~Folder names with .en f.ex. represents translations. They should be part of the project without the suffix, and their files in the Edit Files have "(en)" after the file name.~~
- ~~If config.ini does not exist, generate it.~~
- ~~Template files (.cards.text) should have the same format as .cards, with batch names. Batches can then share the same template url (so it becomes { magic_backs: {template: 'magic_back.html', cards: {m01: { values: {...}}}}})~~
- ~~Scrolling a file still does not scroll the markdown preview.~~
- ~~When previewing a template, add a select input at the top, where you can preview a specific card, that uses that template. Default to the first card.~~
- ~~Hover over a category (1_idea, etc.) to tooltip the description of the category.~~

## 2 June 2026

- ~~Remove change image path from header~~
- ~~Rename Board Game Rules to bg_tools in header and title~~
- ~~Folder picker dialogue in Settings, when picking a new Master image folder~~
- ~~Add the end of the image/card list, sum up the totals (unique/total)~~

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
