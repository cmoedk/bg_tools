#!/usr/bin/env node
import http from 'http';
import fs from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { renderMarkdownDocument } from '../generate/markdownRenderer.mjs';

// ---------- Paths ----------
// Two distinct roots:
//   MODULE_ROOT  - where bg_tools lives (this server's own code, UI, generators, templates).
//   PROJECT_ROOT - the game project being worked on. It is the directory bg_tools is
//                  launched from (process.cwd()), so the tool can be shared and run
//                  against any project without containing that project's data.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = process.cwd();
const GENERATE_DIR = path.join(__dirname, '..', 'generate'); // bg_tools' own generator scripts
const IMAGE_PATH_FILE = path.join(PROJECT_ROOT, 'image_path.txt');
const UI_DIR = path.join(__dirname, 'ui');
const DIST_DIR = path.join(PROJECT_ROOT, '_dist'); // generators write their output here

// ---------- Config (mirrors menu.mjs) ----------
const ROOTFOLDERS = ['3_test', '4_playtest', '5_prototype'];
const MENU_OPTIONS = [
    {
        label: 'Generate rules HTML',
        script: path.join(GENERATE_DIR, 'generate_html.mjs'),
        description: "Renders the project's rules markdown into a styled, standalone HTML file in _dist.",
    },
    {
        label: 'Generate rules PDF',
        script: path.join(PROJECT_ROOT, 'generate_rules_pdf.js'),
        description: 'Generates a PDF of the rules (runs generate_rules_pdf.js at the project root).',
    },
    {
        label: 'Generate Print-and-Play PDF',
        script: path.join(GENERATE_DIR, 'generate_pnp_pdf.mjs'),
        description: 'Builds a print-and-play PDF laid out from the card images in the master image folder.',
    },
    {
        label: 'Generate Tabletop Simulator Files',
        script: path.join(GENERATE_DIR, 'generate_tts_files.mjs'),
        description: 'Creates Tabletop Simulator deck image sheets from the card images.',
    },
    {
        label: 'Generate Boardgamemakers.com files',
        script: path.join(GENERATE_DIR, 'generate_bgm_files.mjs'),
        description: 'Creates card front/back image files formatted for boardgamemakers.com.',
    },
    {
        label: 'Generate Print-and-Play PDF (from templates)',
        script: path.join(GENERATE_DIR, 'generate_test_pnp_pdf.mjs'),
        description: 'Renders each card from its HTML template (in design/) with Puppeteer and assembles a print-and-play PDF.',
    },
    {
        label: 'Generate JPGs (from templates)',
        script: path.join(GENERATE_DIR, 'generate_jpgs_from_templates.mjs'),
        description: 'Renders each card from its HTML template (in design/) with Puppeteer and saves one JPG per card to _dist.',
    },
];

const PORT = Number(process.env.MENU_PORT) || 4599;

// ---------- Helpers ----------
async function readImagePath() {
    try {
        const data = await fs.readFile(IMAGE_PATH_FILE, 'utf-8');
        const selectedPath = data.split(/\r?\n/)[0].replace(/\\/g, '/').trim();
        if (!selectedPath) return { path: '', valid: false };
        try {
            const stat = await fs.stat(selectedPath);
            return { path: selectedPath, valid: stat.isDirectory() };
        } catch {
            return { path: selectedPath, valid: false };
        }
    } catch {
        return { path: '', valid: false };
    }
}

async function getFolderOptions() {
    const options = [];
    for (const root of ROOTFOLDERS) {
        const fullRootPath = path.join(PROJECT_ROOT, root);
        if (!existsSync(fullRootPath)) continue;
        const subdirs = (await fs.readdir(fullRootPath, { withFileTypes: true }))
            .filter(d => d.isDirectory())
            .map(d => ({ name: d.name, relPath: path.join(root, d.name), root }));
        options.push(...subdirs);
    }
    return options;
}

// Recursively collect *.pdf files under DIST_DIR as a Map(absPath -> { mtimeMs, size }).
async function scanPdfs() {
    const found = new Map();
    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return; // dir doesn't exist yet
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
                try {
                    const stat = await fs.stat(full);
                    found.set(full, { mtimeMs: stat.mtimeMs, size: stat.size });
                } catch { /* ignore */ }
            }
        }
    }
    await walk(DIST_DIR);
    return found;
}

// Compare two scans; return descriptors for PDFs that are new or were modified.
function diffPdfs(before, after) {
    const results = [];
    for (const [full, info] of after) {
        const prev = before.get(full);
        if (!prev || info.mtimeMs > prev.mtimeMs) {
            const rel = path.relative(DIST_DIR, full).replace(/\\/g, '/');
            results.push({
                name: path.basename(full),
                relPath: rel,
                url: '/dist/' + rel.split('/').map(encodeURIComponent).join('/'),
                sizeKB: Math.round(info.size / 1024),
            });
        }
    }
    results.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return results;
}

// Resolve a folder option by its index in the (stable) getFolderOptions() ordering.
async function resolveFolder(index) {
    const folders = await getFolderOptions();
    return folders[Number(index)] || null;
}

const TEMPLATE_NAME_RE = /^[\w.\- ]+\.(html|css)$/i;
const MD_NAME_RE = /^[\w.\- ]+\.md$/i;

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf-8');
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
};

function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const filePath = path.join(UI_DIR, rel);
    // Prevent path traversal outside UI_DIR
    if (!filePath.startsWith(UI_DIR)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    if (!existsSync(filePath)) {
        res.writeHead(404).end('Not found');
        return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
}

// ---------- Script runner (Server-Sent Events) ----------
async function runScriptSSE(res, { optionIndex, folder }) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    const sse = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const option = MENU_OPTIONS[optionIndex];
    if (!option) {
        sse('error', { message: 'Invalid menu option.' });
        sse('done', { code: 1 });
        return res.end();
    }
    if (!existsSync(option.script)) {
        sse('output', { text: `ERROR: Script not found:\n${option.script}\n` });
        sse('done', { code: 1 });
        return res.end();
    }

    sse('start', { label: option.label, folder: folder.name });

    // Snapshot existing PDFs so we can report only the ones this run produces.
    const pdfsBefore = await scanPdfs();

    const child = spawn('node', [option.script, IMAGE_PATH, folder.relPath, folder.name], {
        cwd: PROJECT_ROOT,
        env: process.env,
    });

    child.stdout.on('data', (d) => sse('output', { text: d.toString() }));
    child.stderr.on('data', (d) => sse('output', { text: d.toString() }));
    child.on('error', (err) => sse('output', { text: `Failed to start process: ${err.message}\n` }));
    child.on('close', async (code) => {
        try {
            const pdfsAfter = await scanPdfs();
            const pdfs = diffPdfs(pdfsBefore, pdfsAfter);
            if (pdfs.length) sse('pdfs', { pdfs });
        } catch { /* ignore scan errors */ }
        sse('done', { code });
        res.end();
    });

    // Kill child if the client disconnects
    res.on('close', () => {
        if (!child.killed) child.kill();
    });
}

// IMAGE_PATH is refreshed on each /api/config and run request.
let IMAGE_PATH = '';

// ---------- Request router ----------
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    try {
        // --- API ---
        if (pathname === '/api/config' && req.method === 'GET') {
            const image = await readImagePath();
            IMAGE_PATH = image.path;
            const folders = await getFolderOptions();
            return sendJson(res, 200, {
                imagePath: image.path,
                imagePathValid: image.valid,
                folders,
                options: MENU_OPTIONS.map((o, i) => ({ index: i, label: o.label, description: o.description || '' })),
            });
        }

        if (pathname === '/api/image-path' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const folderPath = (body.path || '').trim();
            if (!folderPath) return sendJson(res, 400, { error: 'No path provided.' });
            try {
                const stat = await fs.stat(folderPath);
                if (!stat.isDirectory()) return sendJson(res, 400, { error: 'Path is not a directory.' });
            } catch {
                return sendJson(res, 400, { error: 'Path does not exist.' });
            }
            await fs.writeFile(IMAGE_PATH_FILE, folderPath, 'utf-8');
            IMAGE_PATH = folderPath.replace(/\\/g, '/');
            return sendJson(res, 200, { ok: true, imagePath: IMAGE_PATH });
        }

        if (pathname === '/api/run' && req.method === 'GET') {
            const image = await readImagePath();
            if (!image.valid) {
                res.writeHead(400, { 'Content-Type': 'text/event-stream' });
                res.write('event: output\n');
                res.write(`data: ${JSON.stringify({ text: 'ERROR: Image path is not set or invalid.\n' })}\n\n`);
                res.write('event: done\n');
                res.write(`data: ${JSON.stringify({ code: 1 })}\n\n`);
                return res.end();
            }
            IMAGE_PATH = image.path;
            const optionIndex = Number(url.searchParams.get('option'));
            const folders = await getFolderOptions();
            const folderIndex = Number(url.searchParams.get('folder'));
            const folder = folders[folderIndex];
            if (!folder) return sendJson(res, 400, { error: 'Invalid folder.' });
            return runScriptSSE(res, { optionIndex, folder });
        }

        // --- Template editor API ---
        // List templates in <gameFolder>/design
        if (pathname === '/api/templates' && req.method === 'GET') {
            const folder = await resolveFolder(url.searchParams.get('folder'));
            if (!folder) return sendJson(res, 400, { error: 'Invalid folder.' });
            const designDir = path.join(PROJECT_ROOT, folder.relPath, 'design');
            let templates = [];
            try {
                templates = (await fs.readdir(designDir, { withFileTypes: true }))
                    .filter(d => d.isFile() && /\.(html|css)$/i.test(d.name))
                    .map(d => d.name)
                    .sort();
            } catch { /* design dir may not exist yet */ }
            return sendJson(res, 200, { folder: folder.name, relPath: folder.relPath, templates });
        }

        // Read a single template's content
        if (pathname === '/api/template' && req.method === 'GET') {
            const folder = await resolveFolder(url.searchParams.get('folder'));
            if (!folder) return sendJson(res, 400, { error: 'Invalid folder.' });
            const name = url.searchParams.get('name') || '';
            if (!TEMPLATE_NAME_RE.test(name)) return sendJson(res, 400, { error: 'Invalid template name.' });
            const filePath = path.join(PROJECT_ROOT, folder.relPath, 'design', name);
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                return sendJson(res, 200, { name, content });
            } catch {
                return sendJson(res, 404, { error: 'Template not found.' });
            }
        }

        // Save (create or overwrite) a template
        if (pathname === '/api/template' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const folder = await resolveFolder(body.folder);
            if (!folder) return sendJson(res, 400, { error: 'Invalid folder.' });
            const name = (body.name || '').trim();
            if (!TEMPLATE_NAME_RE.test(name)) {
                return sendJson(res, 400, { error: 'Name must be a simple filename ending in .html or .css' });
            }
            const designDir = path.join(PROJECT_ROOT, folder.relPath, 'design');
            await fs.mkdir(designDir, { recursive: true });
            await fs.writeFile(path.join(designDir, name), body.content ?? '', 'utf-8');
            return sendJson(res, 200, { ok: true, name });
        }

        // --- Markdown editor API ---
        // List markdown files directly in the game folder; flag the default (rules) file.
        if (pathname === '/api/markdown-files' && req.method === 'GET') {
            const folder = await resolveFolder(url.searchParams.get('folder'));
            if (!folder) return sendJson(res, 400, { error: 'Invalid folder.' });
            const gameDir = path.join(PROJECT_ROOT, folder.relPath);
            let files = [];
            try {
                files = (await fs.readdir(gameDir, { withFileTypes: true }))
                    .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.md'))
                    .map(d => d.name)
                    .sort();
            } catch { /* folder may be missing */ }
            const defaultFile = files.find(f => f.toLowerCase().includes('rules')) || files[0] || null;
            return sendJson(res, 200, { folder: folder.name, relPath: folder.relPath, files, defaultFile });
        }

        // Read a markdown file's content
        if (pathname === '/api/markdown' && req.method === 'GET') {
            const folder = await resolveFolder(url.searchParams.get('folder'));
            if (!folder) return sendJson(res, 400, { error: 'Invalid folder.' });
            const name = url.searchParams.get('name') || '';
            if (!MD_NAME_RE.test(name)) return sendJson(res, 400, { error: 'Invalid markdown name.' });
            try {
                const content = await fs.readFile(path.join(PROJECT_ROOT, folder.relPath, name), 'utf-8');
                return sendJson(res, 200, { name, content });
            } catch {
                return sendJson(res, 404, { error: 'Markdown file not found.' });
            }
        }

        // Save a markdown file
        if (pathname === '/api/markdown' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const folder = await resolveFolder(body.folder);
            if (!folder) return sendJson(res, 400, { error: 'Invalid folder.' });
            const name = (body.name || '').trim();
            if (!MD_NAME_RE.test(name)) {
                return sendJson(res, 400, { error: 'Name must be a simple filename ending in .md' });
            }
            await fs.writeFile(path.join(PROJECT_ROOT, folder.relPath, name), body.content ?? '', 'utf-8');
            return sendJson(res, 200, { ok: true, name });
        }

        // Render markdown to a full HTML document (matches the rules HTML generator)
        if (pathname === '/api/render-markdown' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const html = renderMarkdownDocument(body.content ?? '', body.title || '');
            return sendJson(res, 200, { html });
        }

        // Serve files from <gameFolder>/design so the live preview can resolve relative assets
        if (pathname.startsWith('/api/design-asset/') && req.method === 'GET') {
            const rest = pathname.slice('/api/design-asset/'.length);
            const slash = rest.indexOf('/');
            const folderIndex = slash === -1 ? rest : rest.slice(0, slash);
            const assetRel = slash === -1 ? '' : decodeURIComponent(rest.slice(slash + 1));
            const folder = await resolveFolder(folderIndex);
            if (!folder) { res.writeHead(404).end('Not found'); return; }
            const designDir = path.join(PROJECT_ROOT, folder.relPath, 'design');
            const filePath = path.join(designDir, assetRel);
            if (!filePath.startsWith(designDir) || !existsSync(filePath) || !(await fs.stat(filePath)).isFile()) {
                res.writeHead(404).end('Not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            return createReadStream(filePath).pipe(res);
        }

        // --- Serve generated PDFs from _dist ---
        if (pathname.startsWith('/dist/') && req.method === 'GET') {
            const rel = decodeURIComponent(pathname.slice('/dist/'.length));
            const filePath = path.join(DIST_DIR, rel);
            if (!filePath.startsWith(DIST_DIR) || !existsSync(filePath)) {
                res.writeHead(404).end('Not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, {
                'Content-Type': ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
                'Content-Disposition': `inline; filename="${path.basename(filePath)}"`,
            });
            return createReadStream(filePath).pipe(res);
        }

        // --- Static UI ---
        if (req.method === 'GET') {
            return serveStatic(res, pathname);
        }

        res.writeHead(405).end('Method not allowed');
    } catch (err) {
        sendJson(res, 500, { error: err.message });
    }
});

function start(port, attemptsLeft = 10) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
            console.log(`Port ${port} in use, trying ${port + 1}...`);
            start(port + 1, attemptsLeft - 1);
        } else {
            console.error('Server error:', err.message);
            process.exit(1);
        }
    });
    server.listen(port, () => {
        const addr = `http://localhost:${port}`;
        console.log(`\nBoard Game Rules menu running at ${addr}`);
        console.log('Press Ctrl+C to stop.\n');
        // Best-effort: open the default browser (Windows).
        if (process.env.MENU_NO_OPEN !== '1') {
            spawn('cmd', ['/c', 'start', '""', addr], { stdio: 'ignore', detached: true }).unref();
        }
    });
}

start(PORT);
