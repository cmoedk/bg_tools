/**
 * Generate Print-and-Play PDF (from card images).
 *
 * Reads the card images for a game from the master image folder and lays them
 * out into an A4 print-and-play PDF (fronts + backs, with cut lines) saved to
 * _dist/<gameName>/pnp_pdf.
 */
import { PNP_PDF_SUBFOLDER } from './config.mjs';
import { buildPnpPdf } from './pdfBuilder.mjs';
import { createDistFolders, getImageInfos, parseGeneratorArgs } from './shared.mjs';

const { gameFolder, gameName, imageFolderPath, outputSubfolder } = parseGeneratorArgs();
const outFolder = outputSubfolder || PNP_PDF_SUBFOLDER;

createDistFolders(gameName, outFolder);

(async () => {
    const imageInfos = await getImageInfos(gameFolder, imageFolderPath);
    buildPnpPdf(imageInfos, gameName, outFolder).catch((err) => console.log('Error:', err.message));
})();
