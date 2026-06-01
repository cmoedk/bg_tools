/**
 * Generate JPGs (from HTML templates).
 *
 * Renders each card from its HTML template (in <gameFolder>/design) with
 * Puppeteer and saves one JPG per unique card face/back to
 * _dist/<gameName>/template_jpg. Requires a *.cards.text.json5 file in the
 * game folder describing the card content.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { DIST_DIR, TEMPLATE_JPG_SUBFOLDER } from './config.mjs';
import { createDistFolders, emptyFolder, getImageInfos, getImageTexts, parseGeneratorArgs } from './shared.mjs';
import { renderTemplateCards } from './templateRenderer.mjs';

const { gameFolder, gameName, imageFolderPath } = parseGeneratorArgs();

(async () => {
    const imageTexts = await getImageTexts(gameFolder);

    // Abort if no translation/content file exists
    if (!imageTexts) {
        console.error(`\n[ABORT] Error: No .text.json5 translation/content file found in the game folder: ${gameFolder}`);
        console.error(`Please create a .cards.text.json5 file in the directory to run the template JPG generator.\n`);
        process.exit(1);
    }

    const imageInfos = await getImageInfos(gameFolder, imageFolderPath, true);

    const { cardBuffersMap, backBuffersMap } = await renderTemplateCards(imageInfos, imageTexts, gameFolder, gameName);

    // Write one JPG per unique card face and back into _dist/<game>/template_jpg
    const outDir = path.join(DIST_DIR, gameName, TEMPLATE_JPG_SUBFOLDER);
    await createDistFolders(gameName, TEMPLATE_JPG_SUBFOLDER);
    await emptyFolder(outDir);

    let count = 0;
    const writeJpg = async (id, buffer) => {
        if (!buffer) return;
        await fs.writeFile(path.join(outDir, `${id}.jpg`), buffer);
        count++;
    };

    for (const [cardId, buffer] of Object.entries(cardBuffersMap)) {
        await writeJpg(cardId, buffer);
    }
    for (const [backId, buffer] of Object.entries(backBuffersMap)) {
        if (cardBuffersMap[backId]) continue; // already written as a face
        await writeJpg(backId, buffer);
    }

    console.log(`\nWrote ${count} JPG${count === 1 ? '' : 's'} to ${outDir}`);
})();
