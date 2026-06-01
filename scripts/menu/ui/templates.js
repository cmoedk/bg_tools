// --- Read folder index from query string ---
const params = new URLSearchParams(location.search);
const folderIndex = params.get('folder');

const NEW_VALUE = '__new__';
// The generator renders every template in a fixed 750x1125 Puppeteer viewport
// (see templateRenderer.mjs). The preview must use the same logical size and
// just scale it down, or fixed-px / vmax units won't match the JPEG/PDF.
const CARD_W = 750;
const CARD_H = 1125;
const BOILERPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { margin: 0; }
    .card {
      width: 64.1vmax; height: 100vmax;
      max-width: 100vw; max-height: 100vh;
      box-sizing: border-box; padding: 4.5vmax;
      background: #fdfdfd; color: #222;
      font-family: 'Segoe UI', sans-serif;
    }
    .title { font-size: 5vmax; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">{title}</div>
  </div>
</body>
</html>
`;

const el = (id) => document.getElementById(id);
const select = el('template-select');
const nameInput = el('template-name');
const code = el('code');
const preview = el('preview');
const saveStatus = el('save-status');
const errorEl = el('editor-error');
const noticeEl = el('editor-notice');
const previewBaseEl = el('preview-base');
const previewScaler = el('preview-scaler');

let templates = [];
let previewTimer = null;

// What's being edited, and which HTML drives the preview.
let mode = 'html';                 // 'html' | 'css'
let currentHtmlName = null;        // HTML file used as the preview base
let currentHtmlContent = '';       // its content (kept while editing a CSS file)

const isCss = (name) => /\.css$/i.test(name);

// --- Load list of templates ---
async function loadTemplates(selectName) {
    const res = await fetch(`/api/templates?folder=${encodeURIComponent(folderIndex)}`);
    if (!res.ok) {
        errorEl.textContent = 'Could not load templates (invalid folder?).';
        return;
    }
    const data = await res.json();
    el('folder-name').textContent = `— ${data.folder}`;
    document.title = `Edit Templates — ${data.folder}`;
    templates = data.templates;

    select.innerHTML = '';
    templates.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
    const newOpt = document.createElement('option');
    newOpt.value = NEW_VALUE;
    newOpt.textContent = '＋ New template…';
    select.appendChild(newOpt);

    // Prefer an HTML file as the initial selection so the preview has a base.
    const firstHtml = templates.find((n) => !isCss(n));
    const initial = (selectName && templates.includes(selectName)) ? selectName : (firstHtml || templates[0]);
    if (initial) {
        select.value = initial;
        await loadTemplate(initial);
    } else {
        startNew();
    }
}

// --- Load one template's content (HTML or CSS) ---
async function loadTemplate(name) {
    const res = await fetch(`/api/template?folder=${encodeURIComponent(folderIndex)}&name=${encodeURIComponent(name)}`);
    if (!res.ok) { errorEl.textContent = 'Could not load file.'; return; }
    const data = await res.json();
    errorEl.textContent = '';
    nameInput.value = data.name;
    nameInput.readOnly = true;
    code.value = data.content;

    if (isCss(name)) {
        mode = 'css';
        // Keep the current HTML as the preview base; just check linkage.
        checkCssLinkage(name);
    } else {
        mode = 'html';
        currentHtmlName = name;
        currentHtmlContent = data.content;
        clearNotice();
    }
    updatePreview();
}

// --- Begin a new template ---
function startNew() {
    select.value = NEW_VALUE;
    nameInput.value = '';
    nameInput.readOnly = false;
    nameInput.focus();
    code.value = BOILERPLATE;
    mode = 'html';
    currentHtmlName = null;       // unsaved; preview uses live editor content
    currentHtmlContent = BOILERPLATE;
    errorEl.textContent = '';
    clearNotice();
    updatePreview();
}

// --- Inject a <base> so relative asset paths resolve to the design folder ---
function injectBase(html) {
    const base = `<base href="${location.origin}/api/design-asset/${encodeURIComponent(folderIndex)}/">`;
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => m + base);
    }
    return `<head>${base}</head>` + html;
}

// Append a live <style> block to override/preview the CSS being edited.
function injectLiveCss(html, css) {
    const style = `<style id="__live_preview_css">\n${css}\n</style>`;
    if (/<\/head>/i.test(html)) {
        return html.replace(/<\/head>/i, style + '</head>');
    }
    if (/<head[^>]*>/i.test(html)) {
        return html.replace(/<head[^>]*>/i, (m) => m + style);
    }
    return style + html;
}

function updatePreview() {
    if (mode === 'css') {
        if (currentHtmlContent) {
            preview.srcdoc = injectBase(injectLiveCss(currentHtmlContent, code.value));
            previewBaseEl.textContent = currentHtmlName ? `· base: ${currentHtmlName}` : '';
        } else {
            preview.srcdoc = '';
            previewBaseEl.textContent = '';
        }
    } else {
        // Editing HTML: it IS the preview, and the preview base going forward.
        currentHtmlContent = code.value;
        preview.srcdoc = injectBase(code.value);
        previewBaseEl.textContent = '';
    }
}

// Scale the 750x1125 iframe down to fit the preview stage.
function fitPreview() {
    const stage = previewScaler.parentElement;
    const margin = 24;
    const availW = Math.max(0, stage.clientWidth - margin);
    const availH = Math.max(0, stage.clientHeight - margin);
    const scale = Math.min(availW / CARD_W, availH / CARD_H) || 0;
    preview.style.transform = `scale(${scale})`;
    previewScaler.style.width = `${CARD_W * scale}px`;
    previewScaler.style.height = `${CARD_H * scale}px`;
}

window.addEventListener('resize', fitPreview);
window.addEventListener('load', fitPreview);

// --- Notice when the preview HTML doesn't import the CSS being edited ---
function checkCssLinkage(cssName) {
    if (!currentHtmlContent) {
        showNotice('No HTML template loaded — select or create one to preview this CSS.');
        return;
    }
    if (htmlImportsCss(currentHtmlContent, cssName)) {
        clearNotice();
    } else {
        const action = currentHtmlName
            ? { label: `Add <link> to ${currentHtmlName}`, onClick: () => addLinkToHtml(cssName) }
            : null;
        showNotice(`Heads up: "${currentHtmlName || 'the current HTML'}" does not import "${cssName}". ` +
            `It's shown here for preview, but the generated card won't include it unless you add ` +
            `<link rel="stylesheet" href="${cssName}"> to the HTML.`, action);
    }
}

// One-click: insert a <link> for cssName into the current HTML and save it.
async function addLinkToHtml(cssName) {
    if (!currentHtmlName) return;
    let html = currentHtmlContent;
    if (htmlImportsCss(html, cssName)) { clearNotice(); return; }

    const linkTag = `<link rel="stylesheet" href="${cssName}">`;
    if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `  ${linkTag}\n</head>`);
    } else if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n  ${linkTag}`);
    } else {
        html = `<head>\n  ${linkTag}\n</head>\n` + html;
    }

    const res = await fetch('/api/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderIndex, name: currentHtmlName, content: html }),
    });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || 'Could not update HTML.'; return; }

    currentHtmlContent = html;
    clearNotice();
    updatePreview();
}

// Does the HTML reference cssName via <link href> or @import?
function htmlImportsCss(html, cssName) {
    const base = cssName.toLowerCase();
    const linkRe = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = linkRe.exec(html)) !== null) {
        if (refBasename(m[1]) === base) return true;
    }
    const importRe = /@import\s+(?:url\(\s*)?["']?([^"')]+)["']?\s*\)?/gi;
    while ((m = importRe.exec(html)) !== null) {
        if (refBasename(m[1]) === base) return true;
    }
    return false;
}

function refBasename(href) {
    return href.split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase();
}

function showNotice(text, action) {
    noticeEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = '⚠ ' + text;
    noticeEl.appendChild(span);
    if (action) {
        const btn = document.createElement('button');
        btn.className = 'notice-btn';
        btn.textContent = action.label;
        btn.onclick = action.onClick;
        noticeEl.appendChild(btn);
    }
    noticeEl.classList.remove('hidden');
}
function clearNotice() {
    noticeEl.innerHTML = '';
    noticeEl.classList.add('hidden');
}

function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 200);
}

// --- Save ---
async function save() {
    errorEl.textContent = '';
    const name = nameInput.value.trim();
    if (!/^[\w.\- ]+\.html$/i.test(name)) {
        errorEl.textContent = 'Filename must be simple and end in .html';
        return;
    }
    setStatus('saving');
    const res = await fetch('/api/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderIndex, name, content: code.value }),
    });
    const data = await res.json();
    if (!res.ok) {
        setStatus('');
        errorEl.textContent = data.error || 'Save failed.';
        return;
    }
    setStatus('saved');
    await loadTemplates(name);
}

function setStatus(state) {
    saveStatus.className = 'badge ' + (state === 'saved' ? 'ok' : state === 'saving' ? 'running' : '');
    saveStatus.textContent = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : '';
    if (state === 'saved') setTimeout(() => { if (saveStatus.textContent === 'Saved') setStatus(''); }, 2000);
}

// --- Wire up ---
select.addEventListener('change', () => {
    if (select.value === NEW_VALUE) startNew();
    else loadTemplate(select.value);
});
code.addEventListener('input', () => { schedulePreview(); setStatus(''); });
nameInput.addEventListener('input', () => setStatus(''));
el('save-btn').addEventListener('click', save);
// Ctrl/Cmd+S saves
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
    }
});

fitPreview();
if (folderIndex === null) {
    errorEl.textContent = 'No folder specified.';
} else {
    loadTemplates();
}
