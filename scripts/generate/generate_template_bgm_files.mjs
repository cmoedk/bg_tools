/**
 * Generate boardgamemakers.com files (from HTML templates).
 *
 * Renders each card from its HTML template (in <gameFolder>/design) with
 * Puppeteer and writes the rendered fronts/backs into _dist/<gameName>/bgm,
 * prefixed with a zero-padded index. Each image then has ~10% of its pixels
 * nudged by 1% in brightness so otherwise-identical cards get unique file
 * content (boardgamemakers.com de-duplicates by content).
 * Requires a *.cards.text.json5 file describing the card content.
 */
import path from 'node:path';
import sharp from 'sharp';
import { createDistFolders, emptyFolder, getImageInfos, getImageTexts, parseGeneratorArgs } from './shared.mjs';
import { renderTemplateCards } from './templateRenderer.mjs';
import { BGM_SUBFOLDER_BACKS, BGM_SUBFOLDER_FRONTS, DIST_DIR, IMG_EXT } from './config.mjs';

const { gameFolder, gameName, imageFolderPath, outputSubfolder } = parseGeneratorArgs();
const frontsSub = outputSubfolder ? `${outputSubfolder}/fronts` : BGM_SUBFOLDER_FRONTS;
const backsSub = outputSubfolder ? `${outputSubfolder}/backs` : BGM_SUBFOLDER_BACKS;
const frontsFolder = path.join(DIST_DIR, gameName, frontsSub);
const backsFolder = path.join(DIST_DIR, gameName, backsSub);

(async () => {
    const imageTexts = await getImageTexts(gameFolder);
    if (!imageTexts) {
        console.error(`\n[ABORT] No .cards.text.json5 content file found in: ${gameFolder}\n`);
        process.exit(1);
    }

    await createDistFolders(gameName, frontsSub);
    await createDistFolders(gameName, backsSub);
    await emptyFolder(frontsFolder);
    await emptyFolder(backsFolder);

    const imageInfos = await getImageInfos(gameFolder, imageFolderPath, true);
    await renderTemplateCards(imageInfos, imageTexts, gameFolder, gameName); // attaches info.buffer / info.backBuffer

    const digitCount = imageInfos.length.toString().length;
    let count = 1;
    for (const info of imageInfos) {
        if (!info.buffer) continue;
        const prefix = String(count).padStart(digitCount, '0') + '_';
        await writeNudged(info.buffer, path.join(frontsFolder, `${prefix}${info.cardId}.${IMG_EXT}`));
        if (info.backBuffer) {
            await writeNudged(info.backBuffer, path.join(backsFolder, `${prefix}${info.backCardId || info.cardId}.${IMG_EXT}`));
        }
        count += 1;
    }
    console.log(`\nWrote boardgamemakers.com files to ${path.join(DIST_DIR, gameName, outputSubfolder || 'bgm')}`);
})();

/**
 * Writes a JPEG to dest after nudging ~10% of its pixels by ±1% brightness so
 * duplicate card images produce distinct file content.
 * @param {Buffer} buffer
 * @param {string} dest
 */
async function writeNudged(buffer, dest) {
    try {
        const image = sharp(buffer);
        const { width, height, channels } = await image.metadata();
        const { data } = await image.raw().toBuffer({ resolveWithObject: true });
        const numPixels = width * height;
        const numToChange = Math.floor(numPixels * 0.10);

        const indices = Array.from({ length: numPixels }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }

        for (const pixelIndex of indices.slice(0, numToChange)) {
            const base = pixelIndex * channels;
            const [r, g, b] = [data[base], data[base + 1], data[base + 2]];
            const factor = [r, g, b].some(c => c * 1.01 > 255) ? 0.99 : 1.01;
            data[base] = Math.min(255, Math.max(0, Math.round(r * factor)));
            data[base + 1] = Math.min(255, Math.max(0, Math.round(g * factor)));
            data[base + 2] = Math.min(255, Math.max(0, Math.round(b * factor)));
        }

        await sharp(data, { raw: { width, height, channels } }).toFormat('jpeg', { quality: 100 }).toFile(dest);
    } catch (err) {
        console.error('Error processing card image:', err.message);
    }
}
