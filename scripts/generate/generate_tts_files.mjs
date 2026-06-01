/**
 * Generate Tabletop Simulator files.
 *
 * Packs a game's card images into Tabletop Simulator "deck" sheets (grids of up
 * to 10x7 cards per image, max 70), writing one fronts sheet and one backs sheet
 * per chunk to _dist/<gameName>/tts. Sheet filenames encode [count,rows,cols].
 */
import path from 'node:path';
import sharp from 'sharp';
import { DIST_DIR, IMG_EXT, MAX_TTS_WIDTH_PX, TTS_SUBFOLDER } from './config.mjs';
import { chunkArray, createDistFolders, emptyFolder, getImageInfos, parseGeneratorArgs } from './shared.mjs';

/** @import * as types from './typedefs.mjs' */

const TTS_MAX_ROW_SIZE = 10;
const TTS_MAX_COL_SIZE = 7;

const { gameFolder, gameName, imageFolderPath } = parseGeneratorArgs();
const distFolder = path.join(DIST_DIR, gameName, TTS_SUBFOLDER);

createDistFolders(gameName, TTS_SUBFOLDER);

(async () => {
    console.time('Reading files.');
    await emptyFolder(distFolder);
    const imageInfos = await getImageInfos(gameFolder, imageFolderPath);

    /** @type {{[key: string] : types.ImageInfo[]}} */
    const batches = {};

    imageInfos.forEach((info) => {
        if (!batches[info.batch]) {
            batches[info.batch] = [];
        }

        batches[info.batch].push(info);
    })

    console.timeEnd('Reading files.');

    

    for (let [batchName, infos] of Object.entries(batches)) {
        console.time('Generating ' + batchName);
        let width = infos[0].widthPx;
        let height = infos[0].heightPx;

        infos = infos.filter(i => !i.notFound)

        // TTS max is 70 images, we make a jpeg for each 70 images chunk.
        const arrayChunks = chunkArray(infos, TTS_MAX_ROW_SIZE * TTS_MAX_COL_SIZE);

        let i = 0;
        for (const chunk of arrayChunks) {
            let rows = TTS_MAX_ROW_SIZE;
            let cols = TTS_MAX_COL_SIZE;                

            while (width * rows > MAX_TTS_WIDTH_PX) {
                rows -= 1;
            }
            
            while ((cols - 1) * rows > infos.length) {
                cols -= 1;
            }

            if (rows <= 0) {
                console.warn(`Base images are wider than ${MAX_TTS_WIDTH_PX} pixels. Please fix.`);
                return;
            }

            if (cols <= 0) {
                console.warn(`Columns less than 0. Weird error.`);
                return;
            }
            const frontInfo = `_fronts_[${chunk.length},${rows},${cols}]`;        
            const backInfo = `_backs_[${chunk.length},${rows},${cols}]`;        

            const allFronts = chunk.map((info, index)=>({
                input: info.path,
                left: (index%rows)*width,
                top: (Math.floor(index/rows)%cols) * height,
                width: width,
                height: height,
            }))

            const allBacks = chunk.map((info, index)=>({
                input: info.backPath,
                left: (index%rows)*width,
                top: (Math.floor(index/rows)%cols) * height,
                width: width,
                height: height,
            }))
            
            await sharp({
                create: {
                    width: rows * width,
                    height: Math.max(2, cols) * height, // Tabletop Simulator cannot use 1 col images
                    channels: 3,
                    background: { r: 255, g: 255, b: 255 },
                },
            })
            .composite(allFronts)
            .toFormat('jpeg', { quality: 100 })    
            .toFile(path.join(distFolder, batchName + frontInfo + '_' + i + '.' + IMG_EXT));  
            
            await sharp({
                create: {
                    width: rows * width,
                    height: Math.max(2, cols) * height, // Tabletop Simulator cannot use 1 col images
                    channels: 3,
                    background: { r: 255, g: 255, b: 255 },
                },
            })
            .composite(allBacks)
            .toFormat('jpeg', { quality: 100 })    
            .toFile(path.join(distFolder, batchName + backInfo + '_' + i + '.' + IMG_EXT));   
            i++;
        }
        console.timeEnd('Generating ' + batchName);
    }
})();
