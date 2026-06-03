#!/usr/bin/env node
import http from 'http';
import fs from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import JSON5 from 'json5';
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
const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates'); // bg_tools' starter templates
const CONFIG_FILE = path.join(PROJECT_ROOT, 'config.ini'); // per-project settings (image path, ...)
const LEGACY_IMAGE_FILE = path.join(PROJECT_ROOT, 'image_path.txt'); // migrated from, if present
const UI_DIR = path.join(__dirname, 'ui');
const DIST_DIR = path.join(PROJECT_ROOT, '_dist'); // generators write their output here

// ---------- Design-system status folders ----------
// Projects live in one of these folders, in this order. A project is "promoted"
// from one folder to the next (see planPromotion). In 1_idea a project is a single
// `<name>.idea.md` file; in every later folder it is a `<name>/` subfolder.
const STATUS_FOLDERS = [
    { key: '1_idea', label: 'Idea', kind: 'file', description: 'Games that only exist as concepts or ideas.' },
    { key: '2_draft', label: 'Draft', kind: 'folder', description: 'Games that have partial or complete draft rules.' },
    { key: '3_test', label: 'Test', kind: 'folder', description: 'Games that are ready to be tested solo.' },
    { key: '4_playtest', label: 'Playtest', kind: 'folder', description: 'Games that are ready to be tested with others.' },
    { key: '5_prototype', label: 'Prototype', kind: 'folder', description: 'Games ready to be tested by others / shown at events or to a publisher.' },
    { key: '6_production', label: 'Production', kind: 'folder', description: 'Games that are in production.' },
    { key: '7_archive', label: 'Archive', kind: 'folder', description: 'Discarded games.' },
];
const STATUS_BY_KEY = new Map(STATUS_FOLDERS.map(f => [f.key, f]));
// Generators only make sense once a game has component files (from 3_test onward).
const GENERATE_FOLDERS = new Set(['3_test', '4_playtest', '5_prototype']);
// Safe working-title / filename: starts alphanumeric, then word chars, space, _, -, .
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _\-.]*$/;
// Editable file extensions for the inline editor.
const EDITABLE_EXT = new Set(['.md', '.json5', '.txt', '.html', '.css']);
const KIND_BY_EXT = { '.md': 'markdown', '.json5': 'json5', '.txt': 'text', '.html': 'html', '.css': 'css' };
// Parses a versioned rules filename: <base>_rules_<version>.<stage>.md
const RULES_RE = /^(.*)_rules_([0-9][0-9.]*)\.(test|playtest|prototype|production)\.md$/i;
const DRAFT_RULES_RE = /^(.*)_rules\.draft\.md$/i;

// Generators, grouped for the Action panel:
//   Rules     - from the rules markdown
//   Images    - from the card images in the master image folder
//   Templates - from the HTML/CSS card templates in design/
const MENU_OPTIONS = [
    {
        label: 'Generate rules HTML',
        group: 'Rules',
        script: path.join(GENERATE_DIR, 'generate_html.mjs'),
        description: "Renders the project's rules markdown into a styled, standalone HTML file in _dist.",
    },
    {
        label: 'Generate rules PDF',
        group: 'Rules',
        script: path.join(PROJECT_ROOT, 'generate_rules_pdf.js'),
        description: 'Generates a PDF of the rules (runs generate_rules_pdf.js at the project root).',
    },
    {
        label: 'Generate Print-and-Play PDF',
        group: 'Images',
        script: path.join(GENERATE_DIR, 'generate_pnp_pdf.mjs'),
        description: 'Builds a print-and-play PDF laid out from the card images in the master image folder.',
    },
    {
        label: 'Generate Tabletop Simulator Files',
        group: 'Images',
        script: path.join(GENERATE_DIR, 'generate_tts_files.mjs'),
        description: 'Creates Tabletop Simulator deck image sheets from the card images.',
    },
    {
        label: 'Generate Boardgamemakers.com files',
        group: 'Images',
        script: path.join(GENERATE_DIR, 'generate_bgm_files.mjs'),
        description: 'Creates card front/back image files formatted for boardgamemakers.com.',
    },
    {
        label: 'Generate Print-and-Play PDF (from templates)',
        group: 'Templates',
        script: path.join(GENERATE_DIR, 'generate_test_pnp_pdf.mjs'),
        description: 'Renders each card from its HTML template (in design/) with Puppeteer and assembles a print-and-play PDF.',
    },
    {
        label: 'Generate JPGs (from templates)',
        group: 'Templates',
        script: path.join(GENERATE_DIR, 'generate_jpgs_from_templates.mjs'),
        description: 'Renders each card from its HTML template (in design/) with Puppeteer and saves one JPG per card to _dist.',
    },
];

const PORT = Number(process.env.MENU_PORT) || 4599;

// ---------- Config (config.ini) ----------
// Minimal INI: "[section]" lines and "key = value" lines. Keys are stored flat
// as "section.key" (top-level keys keep their bare name). This keeps room to add
// more settings later without changing the on-disk format.
function parseIni(text) {
    const map = {};
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const sec = line.match(/^\[(.+)\]$/);
        if (sec) { section = sec[1].trim(); continue; }
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        map[section ? `${section}.${key}` : key] = val;
    }
    return map;
}

function serializeIni(map) {
    const sections = {};
    for (const [k, v] of Object.entries(map)) {
        const i = k.indexOf('.');
        const s = i === -1 ? '' : k.slice(0, i);
        const key = i === -1 ? k : k.slice(i + 1);
        (sections[s] = sections[s] || []).push([key, v]);
    }
    let out = '';
    if (sections['']) { for (const [k, v] of sections['']) out += `${k} = ${v}\n`; out += '\n'; }
    for (const s of Object.keys(sections)) {
        if (s === '') continue;
        out += `[${s}]\n`;
        for (const [k, v] of sections[s]) out += `${k} = ${v}\n`;
        out += '\n';
    }
    return out;
}

async function readConfigMap() {
    try {
        return parseIni(await fs.readFile(CONFIG_FILE, 'utf-8'));
    } catch {
        // Migrate a pre-existing image_path.txt (first line) the first time around.
        try {
            const legacy = (await fs.readFile(LEGACY_IMAGE_FILE, 'utf-8')).split(/\r?\n/)[0].trim();
            if (legacy) return { 'paths.images': legacy };
        } catch { /* none */ }
        return {};
    }
}

async function writeConfigValue(key, value) {
    const map = await readConfigMap();
    map[key] = value;
    await fs.writeFile(CONFIG_FILE, serializeIni(map), 'utf-8');
}

// Create config.ini if it doesn't exist yet (migrating a legacy image_path.txt
// into it when present), so the project always has a config file to grow.
async function ensureConfig() {
    if (existsSync(CONFIG_FILE)) return;
    const map = await readConfigMap();
    if (!('paths.images' in map)) map['paths.images'] = '';
    try { await fs.writeFile(CONFIG_FILE, serializeIni(map), 'utf-8'); } catch { /* read-only fs */ }
}

// The master image folder, read from config.ini ([paths] images = ...).
async function readImagePath() {
    const map = await readConfigMap();
    const selectedPath = (map['paths.images'] || '').replace(/\\/g, '/').trim();
    if (!selectedPath) return { path: '', valid: false };
    try {
        const stat = await fs.stat(selectedPath);
        return { path: selectedPath, valid: stat.isDirectory() };
    } catch {
        return { path: selectedPath, valid: false };
    }
}

// ---------- Project model ----------
// A project id is "<status>/<name>" (forward slash, URL-safe). resolveProject
// validates it and returns the absolute locations it maps to.
function resolveProject(id) {
    if (typeof id !== 'string') return null;
    const parts = id.split('/');
    if (parts.length !== 2) return null;
    const [status, name] = parts;
    const meta = STATUS_BY_KEY.get(status);
    if (!meta) return null;
    if (!NAME_RE.test(name) || name.includes('..')) return null;
    const statusDir = path.join(PROJECT_ROOT, status);
    if (meta.kind === 'file') {
        return {
            id: `${status}/${name}`,
            relPath: path.join(status, name),
            status, name, kind: 'file',
            statusDir,
            folderDir: null,
            ideaFile: path.join(statusDir, `${name}.idea.md`),
            ideaRel: `${name}.idea.md`,
            canGenerate: GENERATE_FOLDERS.has(status),
        };
    }
    const folderDir = path.join(statusDir, name);
    return {
        id: `${status}/${name}`,
        relPath: path.join(status, name),
        status, name, kind: 'folder',
        statusDir,
        folderDir,
        canGenerate: GENERATE_FOLDERS.has(status),
    };
}

// A folder named "<base>.<xx>" (xx = two letters) is a localized variant of the
// project "<base>" (see structure.md). Variants are folded into the base project;
// their files appear in the editor tagged with the language code.
const LANG_RE = /^([A-Za-z0-9][A-Za-z0-9 _\-.]*)\.([a-z]{2})$/;

// Discover the localized variant folders of a (folder-kind) project.
async function getVariants(project) {
    if (project.kind !== 'folder') return [];
    let entries = [];
    try { entries = await fs.readdir(project.statusDir, { withFileTypes: true }); } catch { return []; }
    const prefix = `${project.name}.`;
    const variants = [];
    for (const e of entries) {
        if (!e.isDirectory() || !e.name.startsWith(prefix)) continue;
        const lang = e.name.slice(prefix.length);
        if (/^[a-z]{2}$/.test(lang)) variants.push({ lang, dir: path.join(project.statusDir, e.name), folderName: e.name });
    }
    variants.sort((a, b) => a.lang.localeCompare(b.lang));
    return variants;
}

// List all projects, grouped by status folder.
async function listProjects() {
    const folders = [];
    for (const meta of STATUS_FOLDERS) {
        const dir = path.join(PROJECT_ROOT, meta.key);
        const projects = [];
        let entries = [];
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch { /* status folder may not exist */ }
        if (meta.kind === 'file') {
            for (const e of entries) {
                if (e.isFile() && /\.idea\.md$/i.test(e.name)) {
                    const name = e.name.replace(/\.idea\.md$/i, '');
                    if (NAME_RE.test(name)) projects.push({ id: `${meta.key}/${name}`, name, status: meta.key });
                }
            }
        } else {
            // Fold "<base>.<xx>" translation folders into their base project.
            const bases = new Set();
            for (const e of entries) {
                if (!e.isDirectory() || !NAME_RE.test(e.name)) continue;
                const m = e.name.match(LANG_RE);
                bases.add(m ? m[1] : e.name);
            }
            for (const base of bases) projects.push({ id: `${meta.key}/${base}`, name: base, status: meta.key });
        }
        projects.sort((a, b) => a.name.localeCompare(b.name));
        folders.push({
            key: meta.key, label: meta.label, kind: meta.kind, description: meta.description || '',
            canGenerate: GENERATE_FOLDERS.has(meta.key),
            projects,
        });
    }
    return { folders };
}

// Collect the editable files in one folder, tagged with a language code ('' = base).
async function collectFiles(dir, lang, files) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!EDITABLE_EXT.has(ext) || ext === '.html' || ext === '.css') continue;
        files.push({ path: e.name, kind: KIND_BY_EXT[ext], group: 'text', lang, default: false });
    }
    try {
        const designEntries = await fs.readdir(path.join(dir, 'design'), { withFileTypes: true });
        for (const e of designEntries) {
            if (!e.isFile()) continue;
            const ext = path.extname(e.name).toLowerCase();
            if (ext === '.html' || ext === '.css') {
                files.push({ path: `design/${e.name}`, kind: KIND_BY_EXT[ext], group: 'template', lang, default: false });
            }
        }
    } catch { /* no design dir */ }
}

// List the editable files belonging to a project, including localized variants
// (their descriptors carry a `lang` code; '' means the base project).
async function listProjectFiles(project) {
    const files = [];
    if (project.kind === 'file') {
        if (existsSync(project.ideaFile)) {
            files.push({ path: project.ideaRel, kind: 'markdown', group: 'text', lang: '', default: true });
        }
        return files;
    }
    await collectFiles(project.folderDir, '', files);
    for (const v of await getVariants(project)) await collectFiles(v.dir, v.lang, files);

    // Default file: the base rules markdown, else the first markdown, else the first file.
    const rules = files.find(f => f.lang === '' && f.group === 'text' && /rules/i.test(f.path) && f.kind === 'markdown');
    const def = rules || files.find(f => f.kind === 'markdown') || files[0];
    if (def) def.default = true;
    files.sort((a, b) =>
        a.lang !== b.lang ? a.lang.localeCompare(b.lang)
            : a.group === b.group ? a.path.localeCompare(b.path)
                : a.group === 'text' ? -1 : 1);
    return files;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff']);

// Find and parse the project's *.cards.json5 (if any). Returns {file, data} or null.
async function readCardsFile(project) {
    if (project.kind !== 'folder') return null;
    let entries;
    try { entries = await fs.readdir(project.folderDir, { withFileTypes: true }); } catch { return null; }
    const f = entries.find(e => e.isFile() && /\.cards\.json5$/i.test(e.name));
    if (!f) return null;
    try {
        const data = JSON5.parse(await fs.readFile(path.join(project.folderDir, f.name), 'utf-8'));
        return { file: f.name, data };
    } catch {
        return { file: f.name, data: null, error: true };
    }
}

// id -> total quantity across all batches (used for an image's "amount").
function cardAmounts(data) {
    const amounts = {};
    for (const v of Object.values(data || {})) {
        if (!v || typeof v !== 'object') continue;
        for (const [k, qty] of Object.entries(v)) {
            if (k.startsWith('_')) continue;
            amounts[k] = (amounts[k] || 0) + (typeof qty === 'number' ? qty : 1);
        }
    }
    return amounts;
}

// Detailed card overview: per-batch unique/total counts plus grand totals.
async function readCardsOverview(project) {
    const c = await readCardsFile(project);
    if (!c) return null;
    if (c.error || !c.data) return { file: c.file, error: true };
    const batches = [];
    let unique = 0, total = 0;
    for (const [name, v] of Object.entries(c.data)) {
        if (!v || typeof v !== 'object') continue;
        let u = 0, t = 0;
        for (const [k, qty] of Object.entries(v)) {
            if (k.startsWith('_')) continue;
            u++; t += (typeof qty === 'number' ? qty : 1);
        }
        batches.push({ name, unique: u, total: t });
        unique += u; total += t;
    }
    return { file: c.file, batches, unique, total };
}

// Summary of images in <imagePath>/<name> (count only).
async function imagesSummary(project) {
    const img = await readImagePath();
    if (!img.valid) return { configured: false };
    const dir = path.join(img.path, project.name);
    try {
        const st = await fs.stat(dir);
        if (!st.isDirectory()) return { configured: true, hasFolder: false };
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const count = entries.filter(e => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase())).length;
        return { configured: true, hasFolder: true, count };
    } catch {
        return { configured: true, hasFolder: false };
    }
}

// Card-back image ids referenced via _back / _backs across all batches.
function cardBackIds(data) {
    const backs = new Set();
    for (const v of Object.values(data || {})) {
        if (!v || typeof v !== 'object') continue;
        if (typeof v._back === 'string' && v._back !== 'self') backs.add(v._back);
        if (v._backs && typeof v._backs === 'object') {
            for (const b of Object.values(v._backs)) if (typeof b === 'string') backs.add(b);
        }
    }
    return backs;
}

// Full image list for the Preview Images grid. When a .cards.json5 exists, only
// images referenced by it (card faces + backs) are returned; otherwise all images.
async function listProjectImages(project) {
    const img = await readImagePath();
    if (!img.valid) return { configured: false, images: [] };
    const dir = path.join(img.path, project.name);
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return { configured: true, hasFolder: false, images: [] }; }
    const c = await readCardsFile(project);
    const hasCards = !!(c && c.data);
    const amounts = hasCards ? cardAmounts(c.data) : {};
    const backIds = hasCards ? cardBackIds(c.data) : new Set();
    const images = entries
        .filter(e => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
        .map(e => {
            const id = e.name.replace(/\.[^.]+$/, '');
            const isCard = id in amounts;
            return { file: e.name, id, amount: isCard ? amounts[id] : null, isBack: !isCard && backIds.has(id) };
        })
        .filter(im => !hasCards || im.amount !== null || im.isBack)
        .sort((a, b) => a.id.localeCompare(b.id));
    return { configured: true, hasFolder: true, cardsFile: c ? c.file : null, images };
}

// Set a card's quantity in the project's .cards.json5, editing the raw text so
// comments and formatting are preserved. Updates every batch that defines the id.
async function setCardAmount(project, cardId, amount) {
    const c = await readCardsFile(project);
    if (!c) throw httpError(404, 'This project has no .cards.json5 file.');
    const filePath = path.join(project.folderDir, c.file);
    let text = await fs.readFile(filePath, 'utf-8');
    const esc = cardId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[\\s,{])(["']?${esc}["']?\\s*:\\s*)(\\d+)`, 'gm');
    let found = false;
    text = text.replace(re, (m, p1, p2) => { found = true; return `${p1}${p2}${amount}`; });
    if (!found) throw httpError(404, `Card "${cardId}" was not found in ${c.file}.`);
    await fs.writeFile(filePath, text, 'utf-8');
}

// Cards (id + values) that use a given template file, read from the batched
// *.cards.text.json5. Looks in the language variant folder first, then the base.
async function templateCardsFor(project, templateBase, lang) {
    if (project.kind !== 'folder') return [];
    const dirs = [];
    if (lang) dirs.push(path.join(project.statusDir, `${project.name}.${lang}`));
    dirs.push(project.folderDir);
    const want = templateBase.toLowerCase();
    for (const dir of dirs) {
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
        const f = entries.find(e => e.isFile() && /\.text\.json5$/i.test(e.name));
        if (!f) continue;
        let data;
        try { data = JSON5.parse(await fs.readFile(path.join(dir, f.name), 'utf-8')); } catch { return []; }
        const cards = [];
        for (const batch of Object.values(data || {})) {
            if (!batch || typeof batch !== 'object' || Array.isArray(batch) || !batch.cards) continue;
            const batchTmpl = (batch.template || '').toLowerCase();
            for (const [id, card] of Object.entries(batch.cards)) {
                const cardTmpl = (card && typeof card === 'object' && card.template) ? card.template.toLowerCase() : '';
                if ((cardTmpl || batchTmpl) === want) cards.push({ id, values: (card && card.values) || {} });
            }
        }
        return cards;
    }
    return [];
}

// Build an overview of a project for the middle "Project View".
// Cards/images are only relevant once a game has components, so they are omitted
// for 1_idea and 2_draft (showAssets = false).
async function projectOverview(project) {
    let createdMs = null;
    try {
        const target = project.kind === 'file' ? project.ideaFile : project.folderDir;
        const st = await fs.stat(target);
        createdMs = st.birthtimeMs || st.ctimeMs || st.mtimeMs || null;
    } catch { /* missing */ }

    const showAssets = !(project.status === '1_idea' || project.status === '2_draft');
    let cards = null;
    let images = { configured: false };
    if (showAssets) {
        cards = await readCardsOverview(project);
        images = await imagesSummary(project);
    }

    return {
        id: project.id, name: project.name, status: project.status,
        canGenerate: project.canGenerate, showAssets, createdMs, cards, images,
    };
}

// Resolve & validate a file path within a project (optionally a language variant
// folder, lang = 'en' etc.); returns absolute path or null.
function resolveProjectFile(project, relPath, lang = '') {
    if (typeof relPath !== 'string' || !relPath || relPath.includes('..')) return null;
    const ext = path.extname(relPath).toLowerCase();
    if (!EDITABLE_EXT.has(ext)) return null;
    if (project.kind === 'file') {
        // Only the idea file itself is editable for an idea project.
        if (relPath !== project.ideaRel) return null;
        return project.ideaFile;
    }
    let baseDir = project.folderDir;
    if (lang) {
        if (!/^[a-z]{2}$/.test(lang)) return null;
        baseDir = path.join(project.statusDir, `${project.name}.${lang}`);
    }
    const abs = path.join(baseDir, relPath);
    if (abs !== baseDir && !abs.startsWith(baseDir + path.sep)) return null;
    return abs;
}

// ---------- Scaffolding (Add Project) ----------
function formatDate(d) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    return `${d.getDate()}. ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function notesSeed(title) {
    return `# ${title} — Notes\n\n## ${formatDate(new Date())}\n\n- \n`;
}

function infoSeed(title) {
    return `# ${title} — Info\n\n` +
        `- **Release title:** ${title}\n` +
        `- **Player count:** \n` +
        `- **Player age:** \n` +
        `- **Game type:** \n` +
        `- **Game mechanisms:** \n` +
        `- **Estimated game time:** \n\n` +
        `## Pitch\n\n\n## Why does this game exist?\n\n\n## Why is this game interesting for a publisher?\n\n`;
}

async function changelogSeed(title) {
    try {
        const tpl = await fs.readFile(path.join(TEMPLATES_DIR, '_template.changelog.md'), 'utf-8');
        return tpl.replace(/\[working_title\]/g, title);
    } catch {
        return `# Changelog for ${title}\n\n## Version 0.0.1 (${formatDate(new Date())})\n\n- RULE: Initial rules.\n`;
    }
}

// Create the starting files for a new project at the given status.
async function scaffoldProject(status, title) {
    const meta = STATUS_BY_KEY.get(status);
    if (!meta) throw httpError(400, 'Unknown status folder.');
    if (!NAME_RE.test(title) || title.includes('..')) {
        throw httpError(400, 'Title must start with a letter or number and contain only letters, numbers, spaces, _ , - or .');
    }
    const statusDir = path.join(PROJECT_ROOT, status);

    if (meta.kind === 'file') {
        const file = path.join(statusDir, `${title}.idea.md`);
        if (existsSync(file)) throw httpError(409, 'A project with that name already exists.');
        await fs.mkdir(statusDir, { recursive: true });
        await fs.writeFile(file, `# ${title}\n\n`, 'utf-8');
        return `${status}/${title}`;
    }

    const dir = path.join(statusDir, title);
    if (existsSync(dir)) throw httpError(409, 'A project with that name already exists.');
    await fs.mkdir(dir, { recursive: true });

    const write = (name, content) => fs.writeFile(path.join(dir, name), content, 'utf-8');
    switch (status) {
        case '2_draft':
            await write(`${title}_rules.draft.md`, `# ${title}\n\n_Draft rules._\n`);
            await write(`${title}.notes.md`, notesSeed(title));
            break;
        case '3_test':
            await write(`${title}_rules_0.0.1.test.md`, `# ${title}\n`);
            await write(`${title}.notes.md`, notesSeed(title));
            await write(`${title}.changelog.md`, await changelogSeed(title));
            break;
        case '4_playtest':
            await write(`${title}_rules_0.1.playtest.md`, `# ${title}\n`);
            await write(`${title}.notes.md`, notesSeed(title));
            await write(`${title}.changelog.md`, await changelogSeed(title));
            break;
        case '5_prototype':
            await write(`${title}_rules_0.1.prototype.md`, `# ${title}\n`);
            await write(`${title}.notes.md`, notesSeed(title));
            await write(`${title}.changelog.md`, await changelogSeed(title));
            await write(`${title}.info.md`, infoSeed(title));
            break;
        case '6_production':
            await write(`${title}_rules_0.1.production.md`, `# ${title}\n`);
            await write(`${title}.notes.md`, notesSeed(title));
            await write(`${title}.changelog.md`, await changelogSeed(title));
            await write(`${title}.info.md`, infoSeed(title));
            break;
        case '7_archive':
            // Discarded games: just the (named) folder.
            break;
    }
    return `${status}/${title}`;
}

// ---------- Promotion ----------
function nextStatusKey(status) {
    const i = STATUS_FOLDERS.findIndex(f => f.key === status);
    return i >= 0 && i < STATUS_FOLDERS.length - 1 ? STATUS_FOLDERS[i + 1].key : null;
}

const relToRoot = (abs) => path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/');

// Build an ordered promotion plan. Returns { from, to, ops, needs, blocked }.
// ops: { type: 'mkdir'|'move'|'rename'|'create', from?, to?, abs*, content?, desc }.
async function planPromotion(project, { releaseTitle } = {}) {
    const from = project.status;
    const to = nextStatusKey(from);
    if (!to) return { from, to: null, ops: [], needs: [], blocked: 'Archived projects cannot be promoted.' };

    const name = project.name;
    const ops = [];
    const needs = [];

    // 1_idea (file) -> 2_draft (folder)
    if (from === '1_idea') {
        if (!existsSync(project.ideaFile)) return { from, to, ops: [], needs: [], blocked: 'Idea file is missing.' };
        const targetDir = path.join(PROJECT_ROOT, to, name);
        if (existsSync(targetDir)) return { from, to, ops: [], needs: [], blocked: `${to}/${name} already exists.` };
        ops.push({ type: 'mkdir', abs: targetDir, desc: `Create folder ${to}/${name}/` });
        ops.push({
            type: 'move', absFrom: project.ideaFile, absTo: path.join(targetDir, `${name}.notes.md`),
            desc: `Move ${relToRoot(project.ideaFile)} → ${to}/${name}/${name}.notes.md`,
        });
        ops.push({
            type: 'create', abs: path.join(targetDir, `${name}_rules.draft.md`), content: `# ${name}\n\n_Draft rules._\n`,
            desc: `Create ${to}/${name}/${name}_rules.draft.md`,
        });
        return { from, to, ops, needs };
    }

    // Folder-based promotions: validate the source folder exists.
    if (!existsSync(project.folderDir)) return { from, to, ops: [], needs: [], blocked: 'Project folder is missing.' };

    const newName = (from === '5_prototype') ? (releaseTitle && releaseTitle.trim() ? releaseTitle.trim() : name) : name;
    if (from === '5_prototype') {
        needs.push({ field: 'releaseTitle', label: 'Release title', default: name });
        if (!NAME_RE.test(newName) || newName.includes('..')) {
            return { from, to, ops: [], needs, blocked: 'Invalid release title.' };
        }
    }
    const targetDir = path.join(PROJECT_ROOT, to, newName);
    if (existsSync(targetDir)) return { from, to, ops, needs, blocked: `${to}/${newName} already exists.` };

    // Move the whole folder first; subsequent renames operate on the moved location.
    ops.push({
        type: 'move', absFrom: project.folderDir, absTo: targetDir,
        desc: `Move ${from}/${name}/ → ${to}/${newName}/`,
    });

    // Carry localized variant folders along (renamed to the new base name).
    for (const v of await getVariants(project)) {
        const vTarget = path.join(PROJECT_ROOT, to, `${newName}.${v.lang}`);
        if (existsSync(vTarget)) return { from, to, ops, needs, blocked: `${to}/${newName}.${v.lang} already exists.` };
        ops.push({
            type: 'move', absFrom: v.dir, absTo: vTarget,
            desc: `Move ${from}/${v.folderName}/ → ${to}/${newName}.${v.lang}/`,
        });
    }

    const entries = (await fs.readdir(project.folderDir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name);
    const findRules = (re) => entries.find(n => re.test(n));

    if (from === '2_draft') {
        const draft = findRules(DRAFT_RULES_RE);
        if (draft) {
            ops.push({
                type: 'rename', absFrom: path.join(targetDir, draft), absTo: path.join(targetDir, `${name}_rules_0.0.1.test.md`),
                desc: `Rename ${draft} → ${name}_rules_0.0.1.test.md`,
            });
        }
        if (!entries.some(n => /\.changelog\.md$/i.test(n))) {
            ops.push({
                type: 'create', abs: path.join(targetDir, `${name}.changelog.md`), content: await changelogSeed(name),
                desc: `Create ${name}.changelog.md`,
            });
        }
    } else if (from === '3_test') {
        const rules = findRules(/_rules_[0-9.]+\.test\.md$/i);
        if (rules) {
            ops.push({
                type: 'rename', absFrom: path.join(targetDir, rules), absTo: path.join(targetDir, `${name}_rules_0.1.playtest.md`),
                desc: `Rename ${rules} → ${name}_rules_0.1.playtest.md`,
            });
        }
    } else if (from === '4_playtest') {
        const rules = findRules(/_rules_([0-9.]+)\.playtest\.md$/i);
        if (rules) {
            const ver = rules.match(/_rules_([0-9.]+)\.playtest\.md$/i)[1];
            ops.push({
                type: 'rename', absFrom: path.join(targetDir, rules), absTo: path.join(targetDir, `${name}_rules_${ver}.prototype.md`),
                desc: `Rename ${rules} → ${name}_rules_${ver}.prototype.md`,
            });
        }
        if (!entries.some(n => /\.info\.md$/i.test(n))) {
            ops.push({
                type: 'create', abs: path.join(targetDir, `${name}.info.md`), content: infoSeed(name),
                desc: `Create ${name}.info.md`,
            });
        }
    } else if (from === '5_prototype') {
        // Rename every file that starts with the working title to the release title;
        // the rules file also switches its stage suffix to .production.md.
        for (const fn of entries) {
            if (fn !== name && !fn.startsWith(`${name}.`) && !fn.startsWith(`${name}_`)) continue;
            let renamed = newName + fn.slice(name.length);
            renamed = renamed.replace(/_rules_([0-9.]+)\.prototype\.md$/i, '_rules_$1.production.md');
            if (renamed !== fn) {
                ops.push({
                    type: 'rename', absFrom: path.join(targetDir, fn), absTo: path.join(targetDir, renamed),
                    desc: `Rename ${fn} → ${renamed}`,
                });
            }
        }
    }
    // 6_production -> 7_archive: move only (no renames).

    return { from, to, ops, needs };
}

async function executePromotion(plan) {
    for (const op of plan.ops) {
        if (op.type === 'mkdir') {
            await fs.mkdir(op.abs, { recursive: true });
        } else if (op.type === 'move' || op.type === 'rename') {
            await fs.mkdir(path.dirname(op.absTo), { recursive: true });
            await fs.rename(op.absFrom, op.absTo);
        } else if (op.type === 'create') {
            if (!existsSync(op.abs)) await fs.writeFile(op.abs, op.content ?? '', 'utf-8');
        }
    }
}

// Move a project straight to 7_archive (a discard shortcut, separate from Promote).
async function archiveProject(project) {
    if (project.status === '7_archive') throw httpError(400, 'Project is already archived.');
    const archiveDir = path.join(PROJECT_ROOT, '7_archive');
    const dest = path.join(archiveDir, project.name);
    if (existsSync(dest)) throw httpError(409, `7_archive/${project.name} already exists.`);
    await fs.mkdir(archiveDir, { recursive: true });
    if (project.kind === 'file') {
        if (!existsSync(project.ideaFile)) throw httpError(404, 'Idea file is missing.');
        await fs.mkdir(dest, { recursive: true });
        await fs.rename(project.ideaFile, path.join(dest, `${project.name}.idea.md`));
    } else {
        const variants = await getVariants(project);
        if (!existsSync(project.folderDir) && !variants.length) throw httpError(404, 'Project folder is missing.');
        if (existsSync(project.folderDir)) await fs.rename(project.folderDir, dest);
        for (const v of variants) {
            const vDest = path.join(archiveDir, v.folderName);
            if (existsSync(vDest)) throw httpError(409, `7_archive/${v.folderName} already exists.`);
            await fs.rename(v.dir, vDest);
        }
    }
    return `7_archive/${project.name}`;
}

// ---------- Generated-PDF tracking ----------
async function scanPdfs() {
    const found = new Map();
    async function walk(dir) {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
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

// ---------- HTTP helpers ----------
function httpError(status, message) {
    const e = new Error(message);
    e.httpStatus = status;
    return e;
}

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
async function runScriptSSE(res, { optionIndex, project }) {
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

    sse('start', { label: option.label, folder: project.name });

    const pdfsBefore = await scanPdfs();

    const child = spawn('node', [option.script, IMAGE_PATH, project.relPath, project.name], {
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
        // --- Config ---
        if (pathname === '/api/config' && req.method === 'GET') {
            const image = await readImagePath();
            IMAGE_PATH = image.path;
            return sendJson(res, 200, {
                imagePath: image.path,
                imagePathValid: image.valid,
                actions: MENU_OPTIONS.map((o, i) => ({ index: i, label: o.label, description: o.description || '', group: o.group || 'Other' })),
                statusFolders: STATUS_FOLDERS.map(f => ({ ...f, canGenerate: GENERATE_FOLDERS.has(f.key) })),
            });
        }

        // Native folder picker (Windows). The server runs on the user's own
        // machine, so we can pop a FolderBrowserDialog and return the chosen path.
        if (pathname === '/api/pick-folder' && req.method === 'GET') {
            if (process.platform !== 'win32') {
                return sendJson(res, 400, { error: 'The folder picker is only available on Windows.' });
            }
            const ps = "Add-Type -AssemblyName System.Windows.Forms; " +
                "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
                "$d.Description = 'Choose the master image folder'; $d.ShowNewFolderButton = $true; " +
                "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($d.SelectedPath) }";
            const child = spawn('powershell', ['-NoProfile', '-STA', '-Command', ps]);
            let out = '';
            child.stdout.on('data', (d) => { out += d.toString(); });
            child.on('error', (err) => sendJson(res, 500, { error: err.message }));
            child.on('close', () => sendJson(res, 200, { path: out.trim() }));
            return;
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
            await writeConfigValue('paths.images', folderPath);
            IMAGE_PATH = folderPath.replace(/\\/g, '/');
            return sendJson(res, 200, { ok: true, imagePath: IMAGE_PATH });
        }

        // --- Projects ---
        if (pathname === '/api/projects' && req.method === 'GET') {
            return sendJson(res, 200, await listProjects());
        }

        if (pathname === '/api/project-overview' && req.method === 'GET') {
            const project = resolveProject(url.searchParams.get('id'));
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            return sendJson(res, 200, await projectOverview(project));
        }

        if (pathname === '/api/project-files' && req.method === 'GET') {
            const project = resolveProject(url.searchParams.get('id'));
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            const files = await listProjectFiles(project);
            return sendJson(res, 200, { id: project.id, name: project.name, status: project.status, canGenerate: project.canGenerate, files });
        }

        if (pathname === '/api/project-images' && req.method === 'GET') {
            const project = resolveProject(url.searchParams.get('id'));
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            return sendJson(res, 200, await listProjectImages(project));
        }

        if (pathname === '/api/template-cards' && req.method === 'GET') {
            const project = resolveProject(url.searchParams.get('id'));
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            const template = (url.searchParams.get('template') || '').trim();
            const lang = url.searchParams.get('lang') || '';
            return sendJson(res, 200, { cards: await templateCardsFor(project, template, lang) });
        }

        if (pathname === '/api/card-amount' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const project = resolveProject(body.id);
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            const cardId = String(body.cardId || '');
            const amount = Number(body.amount);
            if (!/^[A-Za-z0-9_\-.]+$/.test(cardId)) return sendJson(res, 400, { error: 'Invalid card id.' });
            if (!Number.isInteger(amount) || amount < 0) return sendJson(res, 400, { error: 'Amount must be a non-negative whole number.' });
            await setCardAmount(project, cardId, amount);
            return sendJson(res, 200, { ok: true });
        }

        if (pathname === '/api/archive' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const project = resolveProject(body.id);
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            const id = await archiveProject(project);
            return sendJson(res, 200, { ok: true, id });
        }

        if (pathname === '/api/add-project' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const id = await scaffoldProject((body.status || '').trim(), (body.title || '').trim());
            return sendJson(res, 200, { ok: true, id });
        }

        if (pathname === '/api/promote-preview' && req.method === 'GET') {
            const project = resolveProject(url.searchParams.get('id'));
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            const plan = await planPromotion(project, { releaseTitle: url.searchParams.get('releaseTitle') || '' });
            return sendJson(res, 200, {
                from: plan.from, to: plan.to, needs: plan.needs, blocked: plan.blocked || null,
                ops: plan.ops.map(o => ({ type: o.type, desc: o.desc })),
            });
        }

        if (pathname === '/api/promote' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const project = resolveProject(body.id);
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            const plan = await planPromotion(project, { releaseTitle: (body.releaseTitle || '').trim() });
            if (plan.blocked) return sendJson(res, 409, { error: plan.blocked });
            if (!plan.to || !plan.ops.length) return sendJson(res, 400, { error: 'Nothing to promote.' });
            await executePromotion(plan);
            // Derive the new id from the move op's destination.
            const moveOp = plan.ops.find(o => o.type === 'move');
            const newName = moveOp ? path.basename(plan.from === '1_idea' ? path.dirname(moveOp.absTo) : moveOp.absTo) : project.name;
            return sendJson(res, 200, { ok: true, id: `${plan.to}/${newName}`, from: plan.from, to: plan.to });
        }

        // --- File editor (generalized) ---
        if (pathname === '/api/file' && req.method === 'GET') {
            const project = resolveProject(url.searchParams.get('id'));
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            const abs = resolveProjectFile(project, url.searchParams.get('path') || '', url.searchParams.get('lang') || '');
            if (!abs) return sendJson(res, 400, { error: 'Invalid file path.' });
            try {
                const content = await fs.readFile(abs, 'utf-8');
                return sendJson(res, 200, { path: url.searchParams.get('path'), content });
            } catch {
                return sendJson(res, 404, { error: 'File not found.' });
            }
        }

        if (pathname === '/api/file' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const project = resolveProject(body.id);
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            const abs = resolveProjectFile(project, (body.path || '').trim(), body.lang || '');
            if (!abs) return sendJson(res, 400, { error: 'Invalid file path.' });
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, body.content ?? '', 'utf-8');
            return sendJson(res, 200, { ok: true, path: body.path });
        }

        // Render markdown to a full HTML document (matches the rules HTML generator)
        if (pathname === '/api/render-markdown' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req) || '{}');
            const html = renderMarkdownDocument(body.content ?? '', body.title || '');
            return sendJson(res, 200, { html });
        }

        // Serve files from <project>/design so the live card preview can resolve relative assets.
        // URL: /api/design-asset/<status>/<name>/<asset...>
        if (pathname.startsWith('/api/design-asset/') && req.method === 'GET') {
            const rest = pathname.slice('/api/design-asset/'.length).split('/');
            if (rest.length < 3) { res.writeHead(404).end('Not found'); return; }
            const id = `${decodeURIComponent(rest[0])}/${decodeURIComponent(rest[1])}`;
            const assetRel = rest.slice(2).map(decodeURIComponent).join('/');
            const project = resolveProject(id);
            if (!project || project.kind !== 'folder') { res.writeHead(404).end('Not found'); return; }
            const designDir = path.join(project.folderDir, 'design');
            const filePath = path.join(designDir, assetRel);
            if (!filePath.startsWith(designDir) || !existsSync(filePath) || !(await fs.stat(filePath)).isFile()) {
                res.writeHead(404).end('Not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            return createReadStream(filePath).pipe(res);
        }

        // Serve a project's card images from the master image folder (Preview Images grid).
        // URL: /api/image/<status>/<name>/<file>
        if (pathname.startsWith('/api/image/') && req.method === 'GET') {
            const rest = pathname.slice('/api/image/'.length).split('/');
            if (rest.length < 3) { res.writeHead(404).end('Not found'); return; }
            const id = `${decodeURIComponent(rest[0])}/${decodeURIComponent(rest[1])}`;
            const fileName = rest.slice(2).map(decodeURIComponent).join('/');
            const project = resolveProject(id);
            const img = await readImagePath();
            if (!project || !img.valid || fileName.includes('..') || !IMAGE_EXT.has(path.extname(fileName).toLowerCase())) {
                res.writeHead(404).end('Not found');
                return;
            }
            const imgDir = path.join(img.path, project.name);
            const filePath = path.join(imgDir, fileName);
            if (!filePath.startsWith(imgDir) || !existsSync(filePath) || !(await fs.stat(filePath)).isFile()) {
                res.writeHead(404).end('Not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            return createReadStream(filePath).pipe(res);
        }

        // --- Run a generator (SSE) ---
        if (pathname === '/api/run' && req.method === 'GET') {
            const project = resolveProject(url.searchParams.get('id'));
            if (!project) return sendJson(res, 400, { error: 'Invalid project.' });
            if (!project.canGenerate) return sendJson(res, 400, { error: 'Generators are only available for test/playtest/prototype projects.' });
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
            return runScriptSSE(res, { optionIndex, project });
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
        sendJson(res, err.httpStatus || 500, { error: err.message });
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
        console.log(`\nbg_tools menu running at ${addr}`);
        console.log('Press Ctrl+C to stop.\n');
        if (process.env.MENU_NO_OPEN !== '1') {
            spawn('cmd', ['/c', 'start', '""', addr], { stdio: 'ignore', detached: true }).unref();
        }
    });
}

await ensureConfig();
start(PORT);
