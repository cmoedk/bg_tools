/**
 * Generate Tabletop Simulator files (from HTML templates).
 *
 * Renders each card from its HTML template (in <gameFolder>/design) with
 * Puppeteer, then packs the rendered cards into Tabletop Simulator "deck" sheets
 * (grids of up to 10x7 cards per image, max 70) in _dist/<gameName>/tts.
 * Requires a *.cards.text.json5 file describing the card content.
 */
import path from 'node:path';
import sharp from 'sharp';
import { DIST_DIR, IMG_EXT, MAX_TTS_WIDTH_PX, TTS_SUBFOLDER } from './config.mjs';
import { chunkArray, createDistFolders, emptyFolder, getImageInfos, getImageTexts, parseGeneratorArgs } from './shared.mjs';
import { renderTemplateCards } from './templateRenderer.mjs';

/** @import * as types from './typedefs.mjs' */

const TTS_MAX_ROW_SIZE = 10;
const TTS_MAX_COL_SIZE = 7;

const { gameFolder, gameName, imageFolderPath, outputSubfolder } = parseGeneratorArgs();
const outFolder = outputSubfolder || TTS_SUBFOLDER;
const distFolder = path.join(DIST_DIR, gameName, outFolder);

(async () => {
    const imageTexts = await getImageTexts(gameFolder);
    if (!imageTexts) {
        console.error(`\n[ABORT] No .cards.text.json5 content file found in: ${gameFolder}\n`);
        process.exit(1);
    }

    await createDistFolders(gameName, outFolder);
    await emptyFolder(distFolder);

    const imageInfos = await getImageInfos(gameFolder, imageFolderPath, true);
    await renderTemplateCards(imageInfos, imageTexts, gameFolder, gameName); // attaches info.buffer / info.backBuffer

    const first = imageInfos.find(i => i.buffer);
    if (!first) { console.error('No cards were rendered.'); return; }
    const meta = await sharp(first.buffer).metadata();
    const width = meta.width;
    const height = meta.height;

    /** @type {{[key: string]: types.ImageInfo[]}} */
    const batches = {};
    for (const info of imageInfos) {
        if (!info.buffer) continue;
        (batches[info.batch] = batches[info.batch] || []).push(info);
    }

    for (const [batchName, infos] of Object.entries(batches)) {
        const arrayChunks = chunkArray(infos, TTS_MAX_ROW_SIZE * TTS_MAX_COL_SIZE);
        let i = 0;
        for (const chunk of arrayChunks) {
            let rows = TTS_MAX_ROW_SIZE;
            let cols = TTS_MAX_COL_SIZE;
            while (width * rows > MAX_TTS_WIDTH_PX) rows -= 1;
            while ((cols - 1) * rows > infos.length) cols -= 1;
            if (rows <= 0 || cols <= 0) { console.warn('Could not compute a valid TTS grid size.'); return; }

            const place = (index) => ({
                left: (index % rows) * width,
                top: (Math.floor(index / rows) % cols) * height,
                width, height,
            });
            const sheet = () => sharp({
                create: {
                    width: rows * width,
                    height: Math.max(2, cols) * height, // TTS cannot use single-row images
                    channels: 3,
                    background: { r: 255, g: 255, b: 255 },
                },
            });

            await sheet()
                .composite(chunk.map((info, index) => ({ input: info.buffer, ...place(index) })))
                .toFormat('jpeg', { quality: 100 })
                .toFile(path.join(distFolder, `${batchName}_fronts_[${chunk.length},${rows},${cols}]_${i}.${IMG_EXT}`));

            if (chunk.some(info => info.backBuffer)) {
                await sheet()
                    .composite(chunk.map((info, index) => ({ input: info.backBuffer || info.buffer, ...place(index) })))
                    .toFormat('jpeg', { quality: 100 })
                    .toFile(path.join(distFolder, `${batchName}_backs_[${chunk.length},${rows},${cols}]_${i}.${IMG_EXT}`));
            }
            i++;
        }
    }
    console.log(`\nWrote Tabletop Simulator sheets to ${distFolder}`);
})();
