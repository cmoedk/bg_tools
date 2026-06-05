/**
 * Generate rules HTML.
 *
 * Finds the project's rules markdown (the first *.md whose name contains
 * "rules") and renders it into a styled, standalone HTML file at
 * _dist/<gameName>/rules_html/<gameName>.html using the shared markdown pipeline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdownDocument } from './markdownRenderer.mjs';
import { parseGeneratorArgs } from './shared.mjs';

const { gameFolder, gameName } = parseGeneratorArgs();

const distGameFolder = path.join('./_dist', gameName, 'rules_html');
fs.mkdirSync(distGameFolder, { recursive: true });

const files = fs.readdirSync(gameFolder);
const rulesFile = files.find(
    (file) => path.extname(file).toLowerCase() === '.md' && file.toLowerCase().includes('rules'),
);

if (!rulesFile) {
    throw new Error(`No rules markdown (a *.md file containing "rules") found in: ${gameFolder}`);
}

const markdown = fs.readFileSync(path.join(gameFolder, rulesFile), 'utf8');
const title = capitalize(gameName.replaceAll('_', ' ').replaceAll('rules', '').split('v.')[0].toLowerCase());
const html = renderMarkdownDocument(markdown, title);

const outPath = path.join(distGameFolder, `${gameName}.html`);
fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
