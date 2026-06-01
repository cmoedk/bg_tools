import path from 'node:path';
import fs from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DIST_DIR } from './config.mjs';
import { generateCardBuffer } from './shared.mjs';
import puppeteer from 'puppeteer';

/**
 * Render a single card face/back into a JPEG buffer.
 * Uses the HTML template (rendered via Puppeteer) when the card's text entry
 * declares one, otherwise falls back to a plain text-on-canvas card.
 * @param {string} cardId
 * @param {*} imageText
 * @param {string} gameFolder
 * @param {string} gameName
 * @param {import('puppeteer').Browser} browser
 * @param {Record<string, Buffer>} renderedBuffers - cache shared across one render run
 * @returns {Promise<Buffer>}
 */
async function getCardBuffer(cardId, imageText, gameFolder, gameName, browser, renderedBuffers) {
    if (renderedBuffers[cardId]) {
        return renderedBuffers[cardId];
    }

    // Check if it uses the HTML template schema
    if (imageText && typeof imageText === 'object' && imageText.template) {
        const { url, values } = imageText.template;

        // Resolve path: check local gameFolder/design first, then fallback to gameFolder, then fallback to global 8_utils/templates
        let templatePath = path.resolve(gameFolder, 'design', url);

        try {
            await fs.access(templatePath);
        } catch {
            // Fallback 1: Try directly inside the gameFolder
            const alternativePath1 = path.resolve(gameFolder, url);
            try {
                await fs.access(alternativePath1);
                templatePath = alternativePath1;
            } catch {
                // Fallback 2: Try inside the global 8_utils/templates folder
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = path.dirname(__filename);
                const alternativePath2 = path.resolve(__dirname, '..', '..', 'templates', url);
                try {
                    await fs.access(alternativePath2);
                    templatePath = alternativePath2;
                } catch {
                    // Default to local design path so it will throw a clear read error below
                    templatePath = path.resolve(gameFolder, 'design', url);
                }
            }
        }

        let htmlContent;
        try {
            htmlContent = await fs.readFile(templatePath, 'utf8');
        } catch (err) {
            console.error(`Error reading template for card ${cardId} from ${templatePath}:`, err.message);
            const errorBuffer = await generateCardBuffer([
                { text: `TEMPLATE ERROR`, bold: true, color: '#cc0000' },
                { text: `Card: ${cardId}`, fontSize: 100 },
                { text: `Could not read template:`, fontSize: 80 },
                { text: url, fontSize: 60 }
            ]);
            renderedBuffers[cardId] = errorBuffer;
            return errorBuffer;
        }

        // Dynamically inject values and automatically populate 'id' if not provided. Values can be omitted.
        const mergedValues = { id: cardId, ...(values || {}) };

        for (const [key, val] of Object.entries(mergedValues)) {
            htmlContent = htmlContent.replaceAll(`{${key}}`, String(val));
        }

        // The temp file is rendered from _dist/<game>/temp_templates, so relative
        // links (./card.css, images, fonts) would resolve there and 404. Point a
        // <base> at the template's own folder so they resolve like in the editor preview.
        const baseHref = 'file://' + path.resolve(path.dirname(templatePath)).replace(/\\/g, '/') + '/';
        const baseTag = `<base href="${baseHref}">`;
        if (/<head[^>]*>/i.test(htmlContent)) {
            htmlContent = htmlContent.replace(/<head[^>]*>/i, (m) => m + baseTag);
        } else {
            htmlContent = baseTag + htmlContent;
        }

        const tempDir = path.resolve(DIST_DIR, gameName, 'temp_templates');
        await fs.mkdir(tempDir, { recursive: true });
        const tempFilePath = path.join(tempDir, `temp_${cardId}.html`);

        try {
            await fs.writeFile(tempFilePath, htmlContent, 'utf8');

            const page = await browser.newPage();
            // Default card sizes are standard 750x1125
            await page.setViewport({ width: 750, height: 1125 });

            // Go to file URL so local paths inside HTML resolve correctly
            const fileUrl = 'file://' + path.resolve(tempFilePath).replace(/\\/g, '/');
            await page.goto(fileUrl, { waitUntil: 'load' });

            // Wait for styles and web fonts
            await page.evaluateHandle('document.fonts.ready');

            const buffer = await page.screenshot({ type: 'jpeg', quality: 100 });
            await page.close();

            renderedBuffers[cardId] = buffer;
            return buffer;
        } catch (err) {
            console.error(`Puppeteer rendering error for card ${cardId}:`, err.message);
            const errorBuffer = await generateCardBuffer([
                { text: `PUPPETEER ERROR`, bold: true, color: '#cc0000' },
                { text: `Card: ${cardId}`, fontSize: 100 },
                { text: err.message.substring(0, 100), fontSize: 70 }
            ]);
            renderedBuffers[cardId] = errorBuffer;
            return errorBuffer;
        }
    }

    // Normal Canvas fallback
    let buffer;
    if (typeof imageText === 'string') {
        buffer = await generateCardBuffer([{ text: imageText }]);
    } else if (Array.isArray(imageText)) {
        buffer = await generateCardBuffer(imageText);
    } else {
        buffer = await generateCardBuffer([{ text: cardId }, { text: JSON.stringify(imageText), fontSize: 80 }]);
    }

    renderedBuffers[cardId] = buffer;
    return buffer;
}

async function cleanupTempTemplates(gameName) {
    const tempDir = path.resolve(DIST_DIR, gameName, 'temp_templates');
    try {
        await rm(tempDir, { recursive: true, force: true });
    } catch (err) {
        // Silently ignore
    }
}

/**
 * Renders every unique card face and back referenced by imageInfos into JPEG buffers,
 * attaches them to each info (info.buffer / info.backBuffer), and returns the buffer maps.
 * @param {import('./typedefs.mjs').ImageInfo[]} imageInfos
 * @param {import('./typedefs.mjs').CardData} imageTexts
 * @param {string} gameFolder
 * @param {string} gameName
 * @returns {Promise<{ cardBuffersMap: Record<string, Buffer>, backBuffersMap: Record<string, Buffer> }>}
 */
export async function renderTemplateCards(imageInfos, imageTexts, gameFolder, gameName) {
    console.log(`Starting Puppeteer renderer for ${gameName}...`);
    const browser = await puppeteer.launch();

    // Keep cache of rendered card buffers to avoid rendering copies of cards multiple times
    const renderedBuffers = {};
    const cardBuffersMap = {};
    const backBuffersMap = {};

    try {
        // Render unique card faces
        const uniqueCardIds = [...new Set(imageInfos.map(i => i.cardId))];
        for (const cardId of uniqueCardIds) {
            const imageText = imageTexts ? imageTexts[cardId] : null;
            cardBuffersMap[cardId] = await getCardBuffer(cardId, imageText, gameFolder, gameName, browser, renderedBuffers);
        }

        // Render unique card backs
        const uniqueBackCardIds = [...new Set(imageInfos.map(i => i.backCardId).filter(Boolean))];
        for (const backId of uniqueBackCardIds) {
            const backImageText = imageTexts ? imageTexts[backId] : null;
            backBuffersMap[backId] = await getCardBuffer(backId, backImageText, gameFolder, gameName, browser, renderedBuffers);
        }

        // Apply buffers to imageInfos
        for (const info of imageInfos) {
            info.buffer = cardBuffersMap[info.cardId];
            if (info.backCardId) {
                info.backBuffer = backBuffersMap[info.backCardId];
            }
        }
    } catch (err) {
        console.error('Error during card rendering:', err);
    } finally {
        await browser.close();
        await cleanupTempTemplates(gameName);
        console.log('Puppeteer renderer closed and cleaned up.');
    }

    return { cardBuffersMap, backBuffersMap };
}
