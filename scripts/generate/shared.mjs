import fs from 'node:fs/promises';
import path from 'node:path';
import JSON5 from 'json5';
import sharp from 'sharp';
import { createCanvas } from 'canvas';
import { DEFAULT_BACK_FILENAME_APPEND, DEFAULT_CARD_MM_HEIGHT, DEFAULT_CARD_MM_WIDTH, DIST_DIR, IMG_EXT, TEST_DEFAULT_CARD_HEIGHT_PX, TEST_DEFAULT_CARD_WIDTH_PX } from './config.mjs';

/** @import * as types from './typedefs.mjs' */

/**
 * Parses the command-line arguments shared by every generator script.
 *
 * The menu launches each generator as:
 *   node <script> <masterImagePath> <gameFolder> <gameName>
 *
 * @returns {{
 *   masterImagePath: string,  // absolute path to the master image folder (chosen in the menu)
 *   gameFolder: string,       // project folder relative to the repo root, e.g. "5_prototype/the_king_of_ragnarok"
 *   gameName: string,         // the folder name, also the per-game subfolder inside the master image folder
 *   imageFolderPath: string,  // masterImagePath + "/" + gameName: where this game's card images live
 * }}
 */
export function parseGeneratorArgs() {
    const [, , masterImagePath, gameFolder, gameName, imageFolderOverride] = process.argv;
    return {
        masterImagePath,
        gameFolder,
        gameName,
        // An explicit 4th argument overrides where card images are read from (used to
        // feed the image generators with the JPGs rendered from templates).
        imageFolderPath: imageFolderOverride || `${masterImagePath}/${gameName}`,
    };
}

/**
 * 
 * @param {string} gameFolder 
 * @returns {Promise<types.CardData>}
 */
export async function getImageTexts(gameFolder) {
    let filePaths = [];

    if (gameFolder.includes('.')) {
        // Translations have a .xx extension (f.ex .en). We want the json5 file from the main folder
        gameFolder = gameFolder.split('.')[0];
    }

    try {
        filePaths = await fs.readdir(gameFolder);
    } catch (err) {        
        console.log(err);
    }

    for (const filePath of filePaths) {        
        if (!filePath.includes('.json5') || !filePath.includes('.text')) {
            continue;
        }

        const buffer = await fs.readFile(path.join(gameFolder, filePath));
        const fileData = buffer.toString();

        if (!fileData) {
            throw new Error(`${filePath} contains no data.`);
        };

        /** @type types.CardData  */
        return normalizeCardTexts(JSON5.parse(fileData));
    }

}

/**
 * Card-text files may use the batched format (matching .cards.json5), where a
 * batch shares a `template` url and lists `cards: { id: { values } }`:
 *
 *   { magic_backs: { template: 'magic_back.html', cards: { m01: { values: {...} } } } }
 *
 * The renderer consumes a flat map of cardId -> text entry, so this flattens the
 * batched form to `{ m01: { template: { url, values } } }`. The older flat form
 * (cardId -> string | array | { template: { url, values } }) is returned as-is.
 * @param {*} data
 */
export function normalizeCardTexts(data) {
    if (!data || typeof data !== 'object') return data;
    const isBatched = Object.values(data).some(
        v => v && typeof v === 'object' && !Array.isArray(v) && v.cards && typeof v.cards === 'object');
    if (!isBatched) return data;

    const flat = {};
    for (const batch of Object.values(data)) {
        if (!batch || typeof batch !== 'object' || !batch.cards) continue;
        const batchTemplate = batch.template;
        for (const [cardId, card] of Object.entries(batch.cards)) {
            if (card && typeof card === 'object' && !Array.isArray(card)) {
                const url = card.template || batchTemplate;
                flat[cardId] = url ? { template: { url, values: card.values || {} } } : (card.values || card);
            } else {
                flat[cardId] = card; // plain string / array -> canvas text fallback
            }
        }
    }
    return flat;
}


/**
 * This function find all json5 files in the given folder, generate image paths for every image,
 * and return an array with image information, including the image width and height in pixels
 
 * @param {string} gameFolder - The path to the folder, that contains the json5 files
 * @param {string} imagefolderpath - The path to the folder, that contains the image files referenced in the json5 files
 * @returns {Promise<types.ImageInfo[]>}
 */
export async function getImageInfos(gameFolder, imagefolderpath, isText = false) {
    /** @type types.ImageInfo[] */
    const imageInfos = [];
    
    let filePaths = [];

    if (gameFolder.includes('.')) {
        // Translations have a .xx extension (f.ex .en). We want the json5 file from the main folder
        gameFolder = gameFolder.split('.')[0];
    }

    try {
        filePaths = await fs.readdir(gameFolder);
    } catch (err) {        
        console.log(err);
    }

    const errataFilePath = filePaths.find((f) => f.includes('.errata.json5'));
    /** @type {{ cardIds?: string[], backIds?: string[] }}  */
    const errata = { cardIds: [], backIds: [] };
    let hasErrata = false;

    if (errataFilePath) {
        const buffer = await fs.readFile(path.join(gameFolder, errataFilePath));
        const fileData = buffer.toString();
        /** @type {{ cards?: string, backs?: string }}  */
        const errataData = JSON5.parse(fileData);

        if (errataData.cards) {
            errata.cardIds = errataData.cards.split(" ").map(cid => cid.trim());
            hasErrata = true;
        }
        if (errataData.backs) {
            errata.backIds = errataData.backs.split(" ").map(cid => cid.trim());
            hasErrata = true;
        }
    }
    
    for (const filePath of filePaths) {
        // Card structure/quantities come from *.cards.json5 (and component files),
        // never from the *.cards.text.json5 content file.
        if (!filePath.includes('.json5') || filePath.includes('.errata') || filePath.includes('.text')) {
            continue;
        }
       
        const buffer = await fs.readFile(path.join(gameFolder, filePath));
        const fileData = buffer.toString();

        if (!fileData) {
            throw new Error(`${filePath} contains no data.`);
        };
        
        /** @type types.AppData  */
        const json = JSON5.parse(fileData);    

        const batchKeys = Object.keys(json);
        
        for (const batchKey of batchKeys) {
            const batch = json[batchKey];            

            const targetWidthMm = batch._width_mm || DEFAULT_CARD_MM_WIDTH;
            const targetHeightMm = batch._height_mm || DEFAULT_CARD_MM_HEIGHT;

            // Card batches share the same back. However each card can be individually changed.

            let backCardId = '';
            let sharedBack = '';    
            let useSelfAsBack = false;
            if (batch._back) {
                if (batch._back === "self") {
                    useSelfAsBack = true;
                } else {
                    const backPath = path.join(imagefolderpath, batch._back + '.' + IMG_EXT);
                    sharedBack = backPath;
                    backCardId = batch._back;
                }                
            }

            const uniqueBacks = batch._backs || {};

            const cardIds = Object.keys(batch).filter(k => k[0] !== '_');
            
            for (let c = 0; c < cardIds.length; c++) {
                const cardId = cardIds[c];

                const stopCardPrint = hasErrata && !errata.cardIds.includes(cardId);
                let stopBackPrint = hasErrata && !errata.backIds.includes(cardId);

                if (stopBackPrint && stopCardPrint) {
                    continue;
                }

                const imgPath = path.join(imagefolderpath, cardId + '.' + IMG_EXT);

                /** @type types.ImageInfo */
                const info = {
                    cardId: cardId,
                    backCardId: backCardId,
                    batch: batchKey,
                    path: imgPath,
                    backPath: useSelfAsBack ? imgPath : sharedBack,
                    notFound: false,
                    widthPx: 0,
                    heightPx: 0,
                    targetHeightMm: targetHeightMm,
                    targetWidthMm: targetWidthMm                    
                }

                if (stopBackPrint) {
                    info.backPath = "";
                }

                if (stopCardPrint) {
                    info.path = "";
                }

                const useAlternateBack = !useSelfAsBack && (!!uniqueBacks[cardId] || !sharedBack);

                if (!stopBackPrint && useAlternateBack) {
                    // If no shared backs and no specific back, search for images ending with b, else add no backs
                    const altBackCardName = uniqueBacks[cardId] || cardId + DEFAULT_BACK_FILENAME_APPEND;
                    const altBackPath = path.join(imagefolderpath, altBackCardName + '.' + IMG_EXT);

                    // Use meta to test whether the back image exists
                    const meta = await getWidthHeight(altBackPath);

                    if (meta) {
                        info.backPath = altBackPath;
                        info.backCardId = uniqueBacks[cardId] || cardId;
                        
                    } else if (uniqueBacks[cardId]) {
                        // No back could be found
                        info.backPath = '';
                    }
                }                
                
                const meta = await getWidthHeight(info.path);

                if (meta) {
                    info.widthPx = meta.width;
                    info.heightPx = meta.height;
                } else if(!isText) {
                    info.notFound = true;
                }

                const quantity = batch[cardId];
                
                for (let i = 0; i < quantity; i++) {
                    imageInfos.push(info);
                }
            }
            
        }
    }

    return imageInfos;
}

/**
 * @param {string} filePath 
 * @returns { Promise<{width: number, height: number} | false> }
 */
async function getWidthHeight(filePath) {
    try {
        const metadata = await sharp(filePath).metadata();
        return { width: metadata.width, height: metadata.height };

    } catch (err) {
        return false;
    }
}



/**
 * Renders multiple lines of text, each with its own font size and optional font.
 * @param {types.ImageText[]} linesArray 
 * @returns Buffer (JPEG image)
 */
export async function generateCardBuffer(linesArray) {
    const width = TEST_DEFAULT_CARD_WIDTH_PX;
    const height = TEST_DEFAULT_CARD_HEIGHT_PX;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = 'top';
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    let y = 50;
    const x = 50;
    const maxWidth = width - 100;

    for (const { text, fontSize = 140, font = 'arial', color = '#000000', bold = false } of linesArray) {
        if (!text) continue;
        let dynamicSize = fontSize;

        ctx.font = `${bold ? 'bold '  : ''}${dynamicSize}px ${font}`;
        ctx.fillStyle = color;

        // Make sure the font size fits single word widths
        text.split(' ').forEach((word) => {
            let width = ctx.measureText(word).width;
            
            while (width > maxWidth) {
                dynamicSize -= 1;
                ctx.font = `${bold ? 'bold'  : ''} ${dynamicSize}px ${font}`;
                width = ctx.measureText(word).width;
            }            
        })

        // Wrap text if needed
        const wrappedLines = wrapText(ctx, text, maxWidth);
        for (const line of wrappedLines) {
            ctx.fillText(line, x, y);
            y += dynamicSize + 10; // Line spacing
        }
    }

    return canvas.toBuffer('image/jpeg', { quality: 1 });
}

// Helper to wrap long text
function wrapText(ctx, text, maxWidth) {
    if (!text || !text.split) return [''];
    const words = text.split(' ');
    const lines = [];
    let line = '';

    for (let i = 0; i < words.length; i++) {
        const testLine = line + words[i] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && i > 0) {
            lines.push(line.trim());
            line = words[i] + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push(line.trim());
    return lines;
}


/**
 * @param {string} gameName 
 * @param {string} subFolderPath
 */
export async function createDistFolders(gameName, subFolderPath) {
    const dirPath = path.join(DIST_DIR, gameName, subFolderPath);

    await fs.mkdir(dirPath, { recursive: true });
}


/**
 * @param {number} mm 
 */
export function convertMmToPoints(mm) {
    return mm * 2.83465;
}

export function convertPixelsToMm(pixels, dpi = 300) {
    const one_inch = 25.4; // mm
    const px_to_mm = one_inch / dpi;
    
    return pixels * px_to_mm;
}

export function convertPointsToPixels(points, dpi = 300) {
    const one_inch = 72; // points per inch
    return (points / one_inch) * dpi;
}

/**
 * Deletes all files inside a folder (non-recursive).
 * @param {string} folderPath
 */
export async function emptyFolder(folderPath) {
    try {
        const files = await fs.readdir(folderPath);
        for (const file of files) {
            const fullPath = path.join(folderPath, file);
    
            await fs.unlink(fullPath);    
        }
    } catch(err) {
        return;    
    }
}


/**
 * Splits an array into chunks of a given size.
 * @template T
 * @param {T[]} array - The array to split.
 * @param {number} chunkSize - Maximum size of each chunk.
 * @returns {T[][]} Array of chunked subarrays.
 */
export function chunkArray(array, chunkSize) {
  if (!Array.isArray(array)) throw new TypeError('Expected an array');
  if (chunkSize <= 0) throw new RangeError('chunkSize must be > 0');

  const result = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    result.push(array.slice(i, i + chunkSize));
  }
  return result;
}

export async function createWhiteImageBuffer(width, height, text = '') {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill background with white
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);

  // Optional centered text
  if (text) {
    const fontSize = 14;
    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2);
  }

  // Convert canvas to buffer and reprocess with Sharp (optional)
  const buffer = canvas.toBuffer('image/png');
  return await sharp(buffer).jpeg().toBuffer(); // re-encode if needed
}

