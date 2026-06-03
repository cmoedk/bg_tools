/**
 * Generate Print-and-Play PDF (from HTML templates).
 *
 * Renders each card from its HTML template (in <gameFolder>/design) with
 * Puppeteer, then assembles the rendered cards into an A4 print-and-play PDF
 * saved to _dist/<gameName>/test. Requires a *.cards.text.json5 file in the
 * game folder describing the card content.
 */
import { TEST_PNP_PDF_SUBFOLDER } from './config.mjs';
import { buildPnpPdf } from './pdfBuilder.mjs';
import { createDistFolders, getImageInfos, getImageTexts, parseGeneratorArgs } from './shared.mjs';
import { renderTemplateCards } from './templateRenderer.mjs';

const { gameFolder, gameName, imageFolderPath } = parseGeneratorArgs();

createDistFolders(gameName, TEST_PNP_PDF_SUBFOLDER);

(async () => {
    const imageTexts = await getImageTexts(gameFolder);

    // Abort if no translation/content file exists
    if (!imageTexts) {
        console.error(`\n[ABORT] Error: No .text.json5 translation/content file found in the game folder: ${gameFolder}`);
        console.error(`Please create a .cards.text.json5 file in the directory to run the template PDF generator.\n`);
        process.exit(1);
    }

    const imageInfos = await getImageInfos(gameFolder, imageFolderPath, true);

    await renderTemplateCards(imageInfos, imageTexts, gameFolder, gameName);

    buildPnpPdf(imageInfos, gameName, TEST_PNP_PDF_SUBFOLDER).catch((err) => console.log('Error:', err.message));
})();
