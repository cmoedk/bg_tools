// ===== bg_tools workspace =====
// Three panes: left = projects grouped by status folder (+ Add / Promote),
// middle = inline file editor, right = live preview + generator actions.

const NEW_FILE = '__new__';
const CARD_W = 750;   // card preview renders at the generator's true viewport, then scales
const CARD_H = 1125;

// --- State ---
let config = null;            // { imagePath, imagePathValid, actions, statusFolders }
let projects = { folders: [] };
let selectedId = null;        // "<status>/<name>"
let currentProject = null;    // { id, name, status, canGenerate, files }
let files = [];               // file descriptors of the current project
let currentKind = null;       // 'markdown' | 'json5' | 'text' | 'html' | 'css'
let cardHtmlBase = null;      // { name, content } HTML used as base for card/CSS preview
let currentStream = null;     // EventSource for a running generator
let previewTimer = null;
let modalOnOk = null;

// --- Elements ---
const el = (id) => document.getElementById(id);
const code = el('code');
const consoleEl = el('console');
const stopBtn = el('stop-btn');

// --- Init ---
async function init() {
    await loadConfig();
    await loadProjects();
}

async function loadConfig() {
    const res = await fetch('/api/config');
    config = await res.json();
    renderImagePathBar();
}

async function loadProjects() {
    const res = await fetch('/api/projects');
    projects = await res.json();
    renderProjects();
}

// --- Image path bar ---
function renderImagePathBar() {
    const bar = el('image-path-bar');
    if (config.imagePathValid) {
        bar.innerHTML = `📁 <span title="${escapeHtml(config.imagePath)}">${escapeHtml(config.imagePath)}</span>` +
            `<span class="edit-link" id="edit-path">change</span>`;
        bar.querySelector('#edit-path').onclick = openImagePathModal;
    } else {
        bar.innerHTML = `<span style="color:var(--red)">⚠ image folder not set</span>` +
            `<span class="edit-link" id="edit-path">set</span>`;
        bar.querySelector('#edit-path').onclick = openImagePathModal;
    }
}

// --- Left: projects ---
function statusLabel(key) {
    const f = (config?.statusFolders || []).find(s => s.key === key);
    return f ? f.label : key;
}

function renderProjects() {
    const host = el('project-groups');
    host.innerHTML = '';
    projects.folders.forEach((group) => {
        const section = document.createElement('div');
        section.className = 'project-group';

        const head = document.createElement('div');
        head.className = 'group-head';
        const title = document.createElement('span');
        title.className = 'group-title';
        const num = group.key.split('_')[0];
        title.textContent = `${num} · ${group.label}`;
        const addBtn = document.createElement('button');
        addBtn.className = 'add-btn ghost';
        addBtn.textContent = '+ Add';
        addBtn.onclick = () => addProject(group.key);
        head.appendChild(title);
        head.appendChild(addBtn);
        section.appendChild(head);

        const ul = document.createElement('ul');
        ul.className = 'list';
        if (!group.projects.length) {
            const empty = document.createElement('li');
            empty.className = 'group-empty';
            empty.textContent = '—';
            ul.appendChild(empty);
        }
        group.projects.forEach((p) => {
            const li = document.createElement('li');
            li.className = 'project-item';
            if (p.id === selectedId) li.classList.add('selected');
            const nm = document.createElement('span');
            nm.className = 'project-item-name';
            nm.textContent = p.name;
            li.appendChild(nm);
            if (group.key !== '7_archive') {
                const promo = document.createElement('button');
                promo.className = 'promote-btn';
                promo.title = 'Promote to the next folder';
                promo.textContent = '▲';
                promo.onclick = (e) => { e.stopPropagation(); promoteProject(p.id); };
                li.appendChild(promo);
            }
            li.onclick = () => selectProject(p.id);
            ul.appendChild(li);
        });
        section.appendChild(ul);
        host.appendChild(section);
    });
}

// --- Select a project ---
async function selectProject(id) {
    selectedId = id;
    cardHtmlBase = null;
    renderProjects();
    el('editor-empty').classList.add('hidden');
    el('editor-main').classList.remove('hidden');
    const res = await fetch(`/api/project-files?id=${encodeURIComponent(id)}`);
    if (!res.ok) { setEditorError('Could not load project.'); return; }
    currentProject = await res.json();
    files = currentProject.files;
    el('project-name').textContent = currentProject.name;
    el('project-status').textContent = statusLabel(currentProject.status);
    renderFileSelect();
    renderActions();
    const def = files.find(f => f.default) || files[0];
    if (def) selectFile(def.path);
    else startNewFile();
}

function renderFileSelect() {
    const sel = el('file-select');
    sel.innerHTML = '';
    files.forEach((f) => {
        const opt = document.createElement('option');
        opt.value = f.path;
        opt.textContent = f.path;
        sel.appendChild(opt);
    });
    const nw = document.createElement('option');
    nw.value = NEW_FILE;
    nw.textContent = '＋ New file…';
    sel.appendChild(nw);
}

function kindFromPath(p) {
    const ext = (p.split('.').pop() || '').toLowerCase();
    return ({ md: 'markdown', json5: 'json5', txt: 'text', html: 'html', css: 'css' })[ext] || null;
}

async function selectFile(path) {
    el('file-select').value = path;
    const res = await fetch(`/api/file?id=${encodeURIComponent(selectedId)}&path=${encodeURIComponent(path)}`);
    if (!res.ok) { setEditorError('Could not load file.'); return; }
    const data = await res.json();
    setEditorError('');
    el('file-name').value = path;
    el('file-name').readOnly = true;
    code.value = data.content;
    currentKind = kindFromPath(path);
    if (currentKind === 'html') cardHtmlBase = { name: path, content: data.content };
    setSaveStatus('');
    renderPreview();
}

function startNewFile() {
    el('file-select').value = NEW_FILE;
    el('file-name').value = '';
    el('file-name').readOnly = false;
    el('file-name').focus();
    code.value = '';
    currentKind = null;
    setSaveStatus('');
    renderPreview();
}

async function saveFile() {
    setEditorError('');
    const name = el('file-name').value.trim();
    if (!/\.(md|json5|txt|html|css)$/i.test(name)) {
        setEditorError('Filename must end in .md, .json5, .txt, .html or .css');
        return;
    }
    setSaveStatus('saving');
    const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, path: name, content: code.value }),
    });
    const data = await res.json();
    if (!res.ok) { setSaveStatus(''); setEditorError(data.error || 'Save failed.'); return; }
    setSaveStatus('saved');
    currentKind = kindFromPath(name);
    if (currentKind === 'html') cardHtmlBase = { name, content: code.value };
    await reloadFiles(name);
    renderPreview();
}

async function reloadFiles(selectPath) {
    const res = await fetch(`/api/project-files?id=${encodeURIComponent(selectedId)}`);
    if (!res.ok) return;
    currentProject = await res.json();
    files = currentProject.files;
    renderFileSelect();
    if (selectPath && files.some(f => f.path === selectPath)) {
        el('file-select').value = selectPath;
        el('file-name').value = selectPath;
        el('file-name').readOnly = true;
    }
}

// --- Right: preview ---
function hideAllPreviews() {
    el('md-preview').classList.add('hidden');
    el('card-stage').classList.add('hidden');
    el('preview-empty').classList.add('hidden');
    el('preview-note').textContent = '';
}

function renderPreview() {
    hideAllPreviews();
    if (currentKind === 'markdown') renderMarkdownPreview();
    else if (currentKind === 'html') renderCardPreview(code.value);
    else if (currentKind === 'css') renderCssPreview();
    else el('preview-empty').classList.remove('hidden');
}

async function renderMarkdownPreview() {
    const frame = el('md-preview');
    frame.classList.remove('hidden');
    const res = await fetch('/api/render-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: code.value, title: currentProject?.name || '' }),
    });
    if (!res.ok) return;
    const data = await res.json();
    frame.srcdoc = data.html;
}

function idPath() {
    return selectedId.split('/').map(encodeURIComponent).join('/');
}

function injectBase(html) {
    const base = `<base href="${location.origin}/api/design-asset/${idPath()}/">`;
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + base);
    return `<head>${base}</head>` + html;
}

function injectLiveCss(html, css) {
    const style = `<style id="__live_preview_css">\n${css}\n</style>`;
    if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, style + '</head>');
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + style);
    return style + html;
}

function renderCardPreview(html) {
    cardHtmlBase = { name: el('file-name').value, content: html };
    el('card-stage').classList.remove('hidden');
    el('card-preview').srcdoc = injectBase(html);
    fitPreview();
}

function renderCssPreview() {
    if (!cardHtmlBase || !cardHtmlBase.content) {
        el('preview-empty').classList.remove('hidden');
        el('preview-note').textContent = 'Open an HTML template to preview this CSS.';
        return;
    }
    el('card-stage').classList.remove('hidden');
    el('card-preview').srcdoc = injectBase(injectLiveCss(cardHtmlBase.content, code.value));
    el('preview-note').textContent = `· base: ${cardHtmlBase.name}`;
    fitPreview();
}

function fitPreview() {
    const stage = el('card-stage');
    if (stage.classList.contains('hidden')) return;
    const scaler = el('preview-scaler');
    const frame = el('card-preview');
    const margin = 16;
    const availW = Math.max(0, stage.clientWidth - margin);
    const availH = Math.max(0, stage.clientHeight - margin);
    const scale = Math.min(availW / CARD_W, availH / CARD_H) || 0;
    frame.style.transform = `scale(${scale})`;
    scaler.style.width = `${CARD_W * scale}px`;
    scaler.style.height = `${CARD_H * scale}px`;
}
window.addEventListener('resize', fitPreview);

function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        if (currentKind === 'markdown') renderMarkdownPreview();
        else if (currentKind === 'html') renderCardPreview(code.value);
        else if (currentKind === 'css') renderCssPreview();
    }, 250);
}

// --- Right: actions (generators) ---
function renderActions() {
    const list = el('action-list');
    list.innerHTML = '';
    const hint = el('action-hint');
    if (!currentProject) { hint.textContent = 'Select a project.'; return; }
    if (!currentProject.canGenerate) {
        hint.textContent = 'Generators are available for Test, Playtest and Prototype projects.';
        return;
    }
    hint.textContent = config.imagePathValid ? '' : '⚠ Set the master image folder to generate.';
    config.actions.forEach((a) => {
        const li = document.createElement('li');
        li.textContent = a.label;
        li.title = a.description || '';
        li.onclick = () => runAction(a.index);
        list.appendChild(li);
    });
}

function runAction(optionIndex) {
    if (!currentProject || !currentProject.canGenerate) return;
    if (!config.imagePathValid) { openImagePathModal(); return; }
    if (currentStream) currentStream.close();
    const action = config.actions[optionIndex];

    openConsole(`${action.label} — ${currentProject.name}`);
    consoleEl.textContent = '';
    el('pdf-results').classList.add('hidden');
    el('pdf-list').innerHTML = '';
    setRunStatus('running');
    stopBtn.classList.remove('hidden');

    const url = `/api/run?option=${optionIndex}&id=${encodeURIComponent(selectedId)}`;
    const es = new EventSource(url);
    currentStream = es;

    es.addEventListener('start', (e) => {
        const d = JSON.parse(e.data);
        appendConsole(`▶ Running: ${d.label}  [${d.folder}]\n\n`);
    });
    es.addEventListener('output', (e) => appendConsole(JSON.parse(e.data).text));
    es.addEventListener('error', (e) => { if (e.data) appendConsole(JSON.parse(e.data).message + '\n'); });
    es.addEventListener('pdfs', (e) => renderPdfs(JSON.parse(e.data).pdfs));
    es.addEventListener('done', (e) => {
        const d = JSON.parse(e.data);
        appendConsole(`\n${d.code === 0 ? '✔ Finished successfully.' : `✖ Exited with code ${d.code}.`}\n`);
        setRunStatus(d.code === 0 ? 'ok' : 'fail');
        stopBtn.classList.add('hidden');
        es.close();
        currentStream = null;
    });
    es.onerror = () => {
        if (currentStream) {
            appendConsole('\n⚠ Connection closed.\n');
            setRunStatus('fail');
            stopBtn.classList.add('hidden');
            es.close();
            currentStream = null;
        }
    };
}

function openConsole(title) {
    el('console-title').textContent = title;
    el('console-drawer').classList.remove('hidden');
}
function closeConsole() {
    if (currentStream) { currentStream.close(); currentStream = null; }
    el('console-drawer').classList.add('hidden');
}

function renderPdfs(pdfs) {
    if (!pdfs || !pdfs.length) return;
    const list = el('pdf-list');
    list.innerHTML = '';
    pdfs.forEach((p) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = '📄 ' + p.relPath;
        const meta = document.createElement('span');
        meta.className = 'pdf-meta';
        meta.textContent = p.sizeKB + ' KB';
        li.appendChild(a); li.appendChild(meta);
        list.appendChild(li);
    });
    el('pdf-results').classList.remove('hidden');
}

// --- Add project ---
function addProject(status) {
    const wrap = document.createElement('div');
    const label = document.createElement('p');
    label.className = 'muted';
    label.textContent = `New project in “${statusLabel(status)}” (${status}). Enter a working title:`;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input modal-input';
    input.placeholder = 'Working Title';
    wrap.appendChild(label);
    wrap.appendChild(input);
    openModal({
        title: 'Add Project', okLabel: 'Create', body: wrap, onOk: async () => {
            const title = input.value.trim();
            if (!title) { setModalError('Enter a title.'); return; }
            const res = await fetch('/api/add-project', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, title }),
            });
            const data = await res.json();
            if (!res.ok) { setModalError(data.error || 'Could not create project.'); return; }
            closeModal();
            await loadProjects();
            selectProject(data.id);
        },
    });
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') el('modal-ok').click(); });
}

// --- Promote project ---
async function promoteProject(id) {
    const res = await fetch(`/api/promote-preview?id=${encodeURIComponent(id)}`);
    const plan = await res.json();
    if (!res.ok) { openAlert('Promote', plan.error || 'Could not preview promotion.'); return; }
    if (plan.blocked) { openAlert('Cannot promote', plan.blocked); return; }

    const wrap = document.createElement('div');
    const heading = document.createElement('p');
    heading.innerHTML = `Promote from <strong>${escapeHtml(plan.from)}</strong> to <strong>${escapeHtml(plan.to)}</strong>:`;
    wrap.appendChild(heading);
    const ul = document.createElement('ul');
    ul.className = 'ops-list';
    const fillOps = (ops) => {
        ul.innerHTML = '';
        ops.forEach((o) => { const li = document.createElement('li'); li.textContent = o.desc; ul.appendChild(li); });
    };
    fillOps(plan.ops);
    wrap.appendChild(ul);

    let releaseInput = null;
    const need = (plan.needs || []).find(n => n.field === 'releaseTitle');
    if (need) {
        const lbl = document.createElement('p');
        lbl.className = 'muted';
        lbl.textContent = 'Release title (the filenames above use this):';
        releaseInput = document.createElement('input');
        releaseInput.type = 'text';
        releaseInput.className = 'name-input modal-input';
        releaseInput.value = need.default || '';
        wrap.appendChild(lbl);
        wrap.appendChild(releaseInput);
        releaseInput.addEventListener('change', async () => {
            const r = await fetch(`/api/promote-preview?id=${encodeURIComponent(id)}&releaseTitle=${encodeURIComponent(releaseInput.value.trim())}`);
            const p = await r.json();
            if (r.ok && !p.blocked) fillOps(p.ops);
        });
    }

    openModal({
        title: 'Promote project', okLabel: 'Promote', body: wrap, onOk: async () => {
            const releaseTitle = releaseInput ? releaseInput.value.trim() : '';
            const r = await fetch('/api/promote', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, releaseTitle }),
            });
            const d = await r.json();
            if (!r.ok) { setModalError(d.error || 'Promote failed.'); return; }
            closeModal();
            await loadProjects();
            selectProject(d.id);
        },
    });
}

// --- Image path modal ---
function openImagePathModal() {
    const wrap = document.createElement('div');
    const lbl = document.createElement('p');
    lbl.className = 'muted';
    lbl.textContent = 'Enter the full path to the master image folder:';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input modal-input';
    input.placeholder = 'e.g. D:\\images\\master';
    input.value = config.imagePath || '';
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    openModal({
        title: 'Master image folder', okLabel: 'Save', body: wrap, onOk: async () => {
            const value = input.value.trim();
            if (!value) { setModalError('Enter a path.'); return; }
            const res = await fetch('/api/image-path', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: value }),
            });
            const data = await res.json();
            if (!res.ok) { setModalError(data.error || 'Failed to save.'); return; }
            closeModal();
            await loadConfig();
            renderActions();
        },
    });
    setTimeout(() => input.focus(), 50);
}

// --- Modal primitives ---
function openModal({ title, body, okLabel = 'OK', onOk }) {
    el('modal-title').textContent = title;
    const mb = el('modal-body');
    mb.innerHTML = '';
    if (typeof body === 'string') mb.innerHTML = body;
    else if (body) mb.appendChild(body);
    el('modal-error').textContent = '';
    el('modal-ok').textContent = okLabel;
    modalOnOk = onOk;
    el('modal-overlay').classList.remove('hidden');
}
function closeModal() {
    el('modal-overlay').classList.add('hidden');
    el('modal-body').innerHTML = '';
    modalOnOk = null;
}
function setModalError(m) { el('modal-error').textContent = m; }
function openAlert(title, message) {
    openModal({ title, body: `<p>${escapeHtml(message)}</p>`, okLabel: 'OK', onOk: closeModal });
}

// --- Status badges / console ---
function setSaveStatus(state) {
    const b = el('save-status');
    b.className = 'badge ' + (state === 'saved' ? 'ok' : state === 'saving' ? 'running' : '');
    b.textContent = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : '';
    if (state === 'saved') setTimeout(() => { if (b.textContent === 'Saved') setSaveStatus(''); }, 2000);
}
function setRunStatus(state) {
    const b = el('run-status');
    b.className = 'badge ' + state;
    b.textContent = state === 'running' ? 'Running…' : state === 'ok' ? 'Done' : state === 'fail' ? 'Failed' : '';
}
function appendConsole(text) {
    const atBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 40;
    consoleEl.textContent += text;
    if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
}
function setEditorError(m) { el('editor-error').textContent = m; }

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// --- Wire up static controls ---
el('file-select').addEventListener('change', () => {
    const v = el('file-select').value;
    if (v === NEW_FILE) startNewFile();
    else selectFile(v);
});
code.addEventListener('input', () => { setSaveStatus(''); schedulePreview(); });
el('save-btn').onclick = saveFile;
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (el('editor-main').classList.contains('hidden')) return;
        e.preventDefault();
        saveFile();
    }
    if (e.key === 'Escape' && !el('modal-overlay').classList.contains('hidden')) closeModal();
});
el('modal-ok').onclick = async () => { if (modalOnOk) await modalOnOk(); };
el('modal-cancel').onclick = closeModal;
el('modal-overlay').addEventListener('click', (e) => { if (e.target === el('modal-overlay')) closeModal(); });
stopBtn.onclick = () => {
    if (currentStream) {
        currentStream.close();
        currentStream = null;
        appendConsole('\n⏹ Stopped by user.\n');
        setRunStatus('fail');
        stopBtn.classList.add('hidden');
    }
};
el('clear-btn').onclick = () => { consoleEl.textContent = ''; };
el('close-console-btn').onclick = closeConsole;

init();
