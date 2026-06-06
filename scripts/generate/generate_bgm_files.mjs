/**
 * Generate boardgamemakers.com files.
 *
 * Copies each card's front (and back, if any) image into
 * _dist/<gameName>/bgm/fronts and _dist/<gameName>/bgm/backs, prefixed with a
 * zero-padded index. Each copy then has ~10% of its pixels nudged by 1% in
 * brightness (see changeCornerPixel) so that otherwise-identical card images
 * get unique file content — boardgamemakers.com de-duplicates by content.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createDistFolders, getImageInfos, parseGeneratorArgs } from './shared.mjs';
import { BGM_SUBFOLDER_BACKS, BGM_SUBFOLDER_FRONTS, DIST_DIR } from './config.mjs';

const { gameFolder, gameName, imageFolderPath, outputSubfolder } = parseGeneratorArgs();

const frontsSub = outputSubfolder ? `${outputSubfolder}/fronts` : BGM_SUBFOLDER_FRONTS;
const backsSub = outputSubfolder ? `${outputSubfolder}/backs` : BGM_SUBFOLDER_BACKS;
const frontsFolder = path.join(DIST_DIR, gameName, frontsSub);
const backsFolder = path.join(DIST_DIR, gameName, backsSub);

createDistFolders(gameName, frontsSub);
createDistFolders(gameName, backsSub);

(async () => {
    console.time('Preparing images');
    const imageInfos = await getImageInfos(gameFolder, imageFolderPath);
    console.timeEnd('Preparing images');

    const digitCount = imageInfos.length.toString().length;
    const notFound = [];

    let count = 1;
    for (const info of imageInfos) {
        if (info.notFound) {
            notFound.push(info.path);
            continue;
        }

        const prefix = count.toString().padStart(digitCount, '0') + '_';

        const frontDest = path.join(frontsFolder, prefix + path.basename(info.path));
        fs.copyFile(info.path, frontDest, () => changeCornerPixel(frontDest));

        if (info.backPath) {
            const backDest = path.join(backsFolder, prefix + path.basename(info.backPath));
            fs.copyFile(info.backPath, backDest, () => changeCornerPixel(backDest));
        }

        count += 1;
    }

    if (notFound.length > 0) {
        console.warn('Not Found Images:');
        notFound.forEach(p => console.warn(p));
    }
})();

/**
 * Nudges the brightness of a random ~10% of an image's pixels by ±1%, in place,
 * so that duplicate card images produce distinct file content (and thus hashes).
 * @param {string} imagePath
 */
async function changeCornerPixel(imagePath) {
    const percentToChange = 0.10; // fraction of pixels to alter

    try {
        const image = sharp(imagePath);
        const { width, height, channels } = await image.metadata();
        const numPixels = width * height;
        const numToChange = Math.floor(numPixels * percentToChange);

        const { data } = await image.raw().toBuffer({ resolveWithObject: true });

        // Pick a random subset of pixel indices to alter.
        const pixelIndices = Array.from({ length: numPixels }, (_, i) => i);
        shuffleArray(pixelIndices);
        const pixelsToChange = pixelIndices.slice(0, numToChange);

        for (const pixelIndex of pixelsToChange) {
            const baseIndex = pixelIndex * channels;
            const [r, g, b] = [data[baseIndex], data[baseIndex + 1], data[baseIndex + 2]];

            // Brighten by 1%, or darken by 1% if brightening would overflow 255.
            const factor = [r, g, b].some(c => c * 1.01 > 255) ? 0.99 : 1.01;

            data[baseIndex] = Math.min(255, Math.max(0, Math.round(r * factor)));
            data[baseIndex + 1] = Math.min(255, Math.max(0, Math.round(g * factor)));
            data[baseIndex + 2] = Math.min(255, Math.max(0, Math.round(b * factor)));
            // Alpha channel (if present) is left unchanged.
        }

        await sharp(data, { raw: { width, height, channels } })
            .toFormat('jpeg', { quality: 100 })
            .toFile(imagePath);
    } catch (err) {
        console.error('Error processing image:', err);
    }
}

// Fisher-Yates shuffle (in place).
/** @param {any[]} array */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}
