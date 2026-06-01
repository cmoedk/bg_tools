/**
 * Builds an A4 print-and-play PDF from a list of card images.
 *
 * Cards are grouped by their target physical size, laid out into pages (fronts
 * then a row-flipped backs page for duplex printing), and cut lines are drawn.
 * The result is written to _dist/<gameName>/<saveFolder> and its absolute path
 * is copied to the clipboard.
 */
import path from 'node:path';
import fs from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import clipboardy from 'clipboardy';
import { chunkArray, convertMmToPoints, convertPointsToPixels, createWhiteImageBuffer } from './shared.mjs';
import { A4_HEIGHT_PT, A4_WIDTH_PT, DIST_DIR, PNP_PDF_SUBFOLDER } from './config.mjs';

/** @import * as types from './typedefs.mjs' */

/**
 * @param {types.ImageInfo[]} imageInfos - cards to place, each with its target size and image buffer/path
 * @param {string} gameName
 * @param {string} [saveFolder] - subfolder under _dist/<gameName> to write the PDF into
 */
export async function buildPnpPdf(imageInfos, gameName, saveFolder = PNP_PDF_SUBFOLDER) {
    const notFound = [];
    
    console.time('Reading files'); 

    // TODO: check if the images are larger than A4, orient to landscape if possible
    /** @type {{ width_mm: number, height_mm: number, cardsPerPage: number, placeholder: Buffer}[]} */
    const setups = [];
    
    for (const info of imageInfos) {
        const height_pt = convertMmToPoints(info.targetHeightMm);
        const width_pt = convertMmToPoints(info.targetWidthMm);
        const CARDS_IN_ROW = Math.floor(0.9 * A4_WIDTH_PT / width_pt);
        const CARDS_IN_COL = Math.floor(0.9 * A4_HEIGHT_PT / height_pt);
        const cardsPerPage = CARDS_IN_COL * CARDS_IN_ROW;

        if (CARDS_IN_COL <= 0 || CARDS_IN_ROW <= 0) {
            console.warn(`Image target size is bigger than A4 ${info.path}. Skipping.`)
            continue;
        }

        if (!setups.find(p => p.width_mm === info.targetWidthMm && p.height_mm === info.targetHeightMm)) {
            const placeholderBuffer = await createWhiteImageBuffer(convertPointsToPixels(width_pt), convertPointsToPixels(height_pt));
            setups.push({ width_mm: info.targetWidthMm, height_mm: info.targetHeightMm, cardsPerPage, placeholder: placeholderBuffer });        
        }        
    }

    /** @type {{ width_pt: number, height_pt: number, buffers: Buffer[]}[]} */
    const pages = [];

    for (const setup of setups) {
        const images = imageInfos.filter(info => info.targetWidthMm === setup.width_mm && info.targetHeightMm === setup.height_mm);

        const width_pt = convertMmToPoints(setup.width_mm);
        const height_pt = convertMmToPoints(setup.height_mm);
        const CARDS_IN_ROW = Math.floor(0.9 * A4_WIDTH_PT / width_pt);

        const infoChunks = chunkArray(images, setup.cardsPerPage);
        
        for (const infoChunk of infoChunks) {
            const frontsPage = {
                width_pt, height_pt, 
                buffers: []
            }
            const backsPage = {
                width_pt, height_pt, 
                buffers: []
            }

            for (const info of infoChunk) {
                 if (info.notFound) {
                    notFound.push(info.path);
                    const missingBuffer = await createWhiteImageBuffer(convertPointsToPixels(width_pt), convertPointsToPixels(height_pt), 'MISSING ' + info.path);
                    frontsPage.buffers.push(missingBuffer);
                    backsPage.buffers.push(missingBuffer);
                } else {
                    const frontBuffer = info.buffer || fs.readFileSync(info.path);
                    frontsPage.buffers.push(frontBuffer);

                    if (info.backPath) {
                        const backBuffer = info.backBuffer || fs.readFileSync(info.backPath);
                        backsPage.buffers.push(backBuffer);
                    } else {
                        console.warn("No back. Setting white as back: " + info.path);
                        backsPage.buffers.push(setup.placeholder);
                    }   
                }
            } 

            if (backsPage.buffers.length < setup.cardsPerPage) {
                backsPage.buffers.push(...new Array(setup.cardsPerPage - backsPage.buffers.length).fill(setup.placeholder));
            }

            backsPage.buffers = reverseByRowSize(backsPage.buffers, CARDS_IN_ROW); // Flip rows, so that we have the option for duplex printing
            
            pages.push(frontsPage, backsPage);
        }        
    }
       
    console.timeEnd('Reading files');

    if (notFound.length > 0) {
        console.warn('Not Found Images:');
        notFound.forEach(p => console.warn(` - ${p}`));
    }

    console.time('Writing PDF')
    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();

    for (const page of pages) {
        const cardsInRow = Math.floor(0.9 * A4_WIDTH_PT / page.width_pt);
        const cardsInCol = Math.floor(0.9 * A4_HEIGHT_PT / page.height_pt);
         // Add a new page
        const pdfPage = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);

        // Load all buffers
        const imgPromises = page.buffers.map(imageBytes => pdfDoc.embedJpg(imageBytes));       
        
        const imageBytes = await Promise.all(imgPromises);
        const marginSizePt = (A4_WIDTH_PT - cardsInRow * page.width_pt) / 2;
        
        let x = 0;
        let y = cardsInCol - 1; 
        for (let i = 0; i < imageBytes.length; i++) {
            const jpgImgBytes = imageBytes[i];
        
            // @ts-ignore
            jpgImgBytes.height = page.height_pt;
            // @ts-ignore
            jpgImgBytes.width = page.width_pt;
            
            const imageDimensions = jpgImgBytes.scale(1);

            pdfPage.drawImage(jpgImgBytes, {
                x: marginSizePt + x * imageDimensions.width,
                y: marginSizePt + y * imageDimensions.height,
                width: imageDimensions.width,
                height: imageDimensions.height,
            });

            x++;

            if (x === cardsInRow) {
                x = 0;
                y--;
            }
        }

        drawCutLines(pdfPage, {
            width: page.width_pt,
            height: page.height_pt,
            marginSizePt,
            numVertical: cardsInRow + 1,
            numHorizontal: cardsInCol + 1
        })       
    }


    console.timeEnd('Writing PDF')

    console.time('Saving PDF')
    // Serialize the PDF document to a Uint8Array
    const pdfBytes = await pdfDoc.save();

    const savePath = path.join(DIST_DIR, gameName, saveFolder);

    // Write the PDF to a file
    fs.mkdir(savePath, { recursive: true }, (err) => {
        if (err) throw err;
        const saveFilePath = path.join(savePath, gameName + '_pnp.pdf');
        const absPath = path.resolve(saveFilePath);
        fs.writeFileSync(saveFilePath, pdfBytes);
        clipboardy.writeSync(absPath);
        console.log(`PDF saved: ${absPath}. Copied to clipboard.`);
    });
    console.timeEnd('Saving PDF')
    
}


function drawCutLines(page, opts) {
    // Draw vertical lines
    let numVertical = opts.numVertical;
    let numHorizontal = opts.numHorizontal;

    while (numVertical--) {
        page.drawLine({
            start: { x: opts.marginSizePt + numVertical * opts.width, y: 0},
            end:   { x: opts.marginSizePt + numVertical * opts.width, y: A4_HEIGHT_PT},
            thickness: 1,
            color: rgb(0,0,0)
        })
    }

    while (numHorizontal--) {
        page.drawLine({
            start: { x:0,            y: opts.marginSizePt + numHorizontal * opts.height},
            end:   { x: A4_WIDTH_PT, y: opts.marginSizePt + numHorizontal * opts.height},
            thickness: 1,
            color: rgb(0,0,0)
        })
    }
  
}


function reverseByRowSize(arr, rowSize) {
  const result = [];
  for (let i = 0; i < arr.length; i += rowSize) {
    const chunk = arr.slice(i, i + rowSize).reverse();
    result.push(...chunk);
  }
  return result;
}