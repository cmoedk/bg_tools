// ===== bg_tools workspace =====
// Left: projects (compact links, + Add). Middle: one of three views —
//   project overview | action runner | file editor.
// Right: Actions (project/action view) or Preview (editor view).

const NEW_FILE = '__new__';
const CARD_W = 750;   // card preview renders at the generator's true viewport, then scales
const CARD_H = 1125;

// --- State ---
let config = null;            // { imagePath, imagePathValid, actions, statusFolders }
let projects = { folders: [] };
let selectedId = null;        // "<status>/<name>"
let currentProject = null;    // { id, name, status, canGenerate }
let currentView = 'empty';    // 'empty' | 'project' | 'action' | 'editor'
let currentActionIndex = null;
let files = [];               // file descriptors (editor)
let currentFilePath = null;
let currentKind = null;       // 'markdown' | 'json5' | 'text' | 'html' | 'css'
let cardHtmlBase = null;      // { name, content } base HTML for card/CSS preview
let dirty = false;            // unsaved edits in the editor
let currentStream = null;     // EventSource for a running generator
let previewTimer = null;
let modalOnDismiss = null;

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

// --- View switching ---
function setView(v) {
    currentView = v;
    el('mid-empty').classList.toggle('hidden', v !== 'empty');
    el('mid-project').classList.toggle('hidden', v !== 'project');
    el('mid-action').classList.toggle('hidden', v !== 'action');
    el('mid-editor').classList.toggle('hidden', v !== 'editor');
    el('right-actions').classList.toggle('hidden', !(v === 'project' || v === 'action'));
    el('right-preview').classList.toggle('hidden', v !== 'editor');
    el('workspace').classList.toggle('editor-mode', v === 'editor');
}

// --- Image path bar ---
function renderImagePathBar() {
    const bar = el('image-path-bar');
    const label = config.imagePathValid
        ? `📁 <span title="${escapeHtml(config.imagePath)}">${escapeHtml(config.imagePath)}</span><span class="edit-link" id="edit-path">change</span>`
        : `<span style="color:var(--red)">⚠ image folder not set</span><span class="edit-link" id="edit-path">set</span>`;
    bar.innerHTML = label;
    bar.querySelector('#edit-path').onclick = openImagePathModal;
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
        title.textContent = `${group.key.split('_')[0]} · ${group.label}`;
        const addBtn = document.createElement('button');
        addBtn.className = 'add-btn ghost';
        addBtn.textContent = '+ Add';
        addBtn.onclick = () => addProject(group.key);
        head.appendChild(title);
        head.appendChild(addBtn);
        section.appendChild(head);

        const ul = document.createElement('ul');
        ul.className = 'project-link-list';
        if (!group.projects.length) {
            const empty = document.createElement('li');
            empty.className = 'project-link group-empty';
            empty.textContent = '—';
            ul.appendChild(empty);
        }
        group.projects.forEach((p) => {
            const li = document.createElement('li');
            li.className = 'project-link';
            if (p.id === selectedId) li.classList.add('selected');
            li.textContent = p.name;
            li.title = p.name;
            li.onclick = () => selectProject(p.id);
            ul.appendChild(li);
        });
        section.appendChild(ul);
        host.appendChild(section);
    });
}

// --- Select a project -> Project View ---
async function selectProject(id) {
    if (!(await guardUnsaved())) return;
    selectedId = id;
    cardHtmlBase = null;
    renderProjects();
    const res = await fetch(`/api/project-overview?id=${encodeURIComponent(id)}`);
    if (!res.ok) { setView('empty'); return; }
    const ov = await res.json();
    currentProject = { id: ov.id, name: ov.name, status: ov.status, canGenerate: ov.canGenerate };
    renderOverview(ov);
    renderActions();
    setView('project');
}

function renderOverview(ov) {
    el('ov-status').textContent = statusLabel(ov.status);
    el('ov-name').textContent = ov.name;
    el('ov-promote-btn').classList.toggle('hidden', ov.status === '7_archive');
    const dl = el('ov-details');
    dl.innerHTML = '';
    const row = (k, v) => {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.appendChild(dt); dl.appendChild(dd);
    };
    row('Folder', ov.status);
    row('Created', ov.createdMs ? new Date(ov.createdMs).toLocaleString() : '—');
    if (ov.cards === null) row('Cards', '— (no .cards.json5)');
    else if (ov.cards.error) row('Cards', `Could not parse ${ov.cards.file}`);
    else row('Cards', `${ov.cards.defined} card(s) in ${ov.cards.batches} batch(es) · ${ov.cards.file}`);
    if (!ov.images.configured) row('Images', '— (master image folder not set)');
    else if (!ov.images.hasFolder) row('Images', `No folder “${ov.name}” in the image path`);
    else row('Images', `${ov.images.count} image(s) found`);
}

// --- Right: actions ---
function renderActions() {
    const list = el('action-list');
    list.innerHTML = '';
    const hint = el('action-hint');
    if (!currentProject) { hint.textContent = 'Select a project.'; return; }

    // Edit Files is always the first action.
    const edit = document.createElement('li');
    edit.textContent = '📝 Edit Files';
    edit.onclick = openEditor;
    list.appendChild(edit);

    if (currentProject.canGenerate) {
        hint.textContent = config.imagePathValid ? '' : '⚠ Set the master image folder to generate.';
        config.actions.forEach((a) => {
            const li = document.createElement('li');
            li.textContent = a.label;
            li.title = a.description || '';
            li.onclick = () => openAction(a.index);
            list.appendChild(li);
        });
    } else {
        hint.textContent = 'Generators are available for Test, Playtest and Prototype projects.';
    }
}

// --- Action View ---
function openAction(index) {
    currentActionIndex = index;
    const a = config.actions[index];
    el('act-title').textContent = a.label;
    el('act-desc').textContent = a.description || '';
    consoleEl.classList.add('hidden');
    consoleEl.textContent = '';
    el('pdf-results').classList.add('hidden');
    el('pdf-list').innerHTML = '';
    setRunStatus('');
    stopBtn.classList.add('hidden');
    const runBtn = el('run-btn');
    runBtn.classList.remove('hidden');
    runBtn.disabled = false;
    runBtn.textContent = 'Run';
    setView('action');
}

function runAction() {
    if (currentActionIndex === null || !currentProject || !currentProject.canGenerate) return;
    if (!config.imagePathValid) { openImagePathModal(); return; }
    if (currentStream) currentStream.close();
    const action = config.actions[currentActionIndex];

    consoleEl.classList.remove('hidden');
    consoleEl.textContent = '';
    el('pdf-results').classList.add('hidden');
    el('pdf-list').innerHTML = '';
    setRunStatus('running');
    el('run-btn').classList.add('hidden');
    stopBtn.classList.remove('hidden');

    const url = `/api/run?option=${currentActionIndex}&id=${encodeURIComponent(selectedId)}`;
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
        finishRun();
        es.close();
        currentStream = null;
    });
    es.onerror = () => {
        if (currentStream) {
            appendConsole('\n⚠ Connection closed.\n');
            setRunStatus('fail');
            finishRun();
            es.close();
            currentStream = null;
        }
    };
}

function finishRun() {
    stopBtn.classList.add('hidden');
    const runBtn = el('run-btn');
    runBtn.classList.remove('hidden');
    runBtn.disabled = false;
    runBtn.textContent = 'Run again';
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

// --- Editor View ---
async function openEditor() {
    const res = await fetch(`/api/project-files?id=${encodeURIComponent(selectedId)}`);
    if (!res.ok) return;
    const data = await res.json();
    files = data.files;
    currentProject = { id: data.id, name: data.name, status: data.status, canGenerate: data.canGenerate };
    cardHtmlBase = null;
    el('ed-status').textContent = statusLabel(data.status);
    el('ed-name').textContent = data.name;
    renderFileSelect();
    dirty = false;
    setView('editor');
    const def = files.find(f => f.default) || files[0];
    if (def) selectFile(def.path);
    else startNewFile();
}

async function closeEditor() {
    if (!(await guardUnsaved())) return;
    setView('project');
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
    currentFilePath = path;
    el('file-name').value = path;
    el('file-name').readOnly = true;
    code.value = data.content;
    currentKind = kindFromPath(path);
    dirty = false;
    setSaveStatus('');
    if (currentKind === 'html') cardHtmlBase = { name: path, content: data.content };
    else if (currentKind === 'css') await resolveCssBase(path);
    renderPreview();
}

function startNewFile() {
    el('file-select').value = NEW_FILE;
    currentFilePath = null;
    el('file-name').value = '';
    el('file-name').readOnly = false;
    el('file-name').focus();
    code.value = '';
    currentKind = null;
    dirty = false;
    setSaveStatus('');
    renderPreview();
}

// Returns true on success.
async function saveFile() {
    setEditorError('');
    const name = el('file-name').value.trim();
    if (!/\.(md|json5|txt|html|css)$/i.test(name)) {
        setEditorError('Filename must end in .md, .json5, .txt, .html or .css');
        return false;
    }
    setSaveStatus('saving');
    const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, path: name, content: code.value }),
    });
    const data = await res.json();
    if (!res.ok) { setSaveStatus(''); setEditorError(data.error || 'Save failed.'); return false; }
    setSaveStatus('saved');
    dirty = false;
    currentFilePath = name;
    currentKind = kindFromPath(name);
    if (currentKind === 'html') cardHtmlBase = { name, content: code.value };
    await reloadFiles(name);
    renderPreview();
    return true;
}

async function reloadFiles(selectPath) {
    const res = await fetch(`/api/project-files?id=${encodeURIComponent(selectedId)}`);
    if (!res.ok) return;
    const data = await res.json();
    files = data.files;
    renderFileSelect();
    if (selectPath && files.some(f => f.path === selectPath)) {
        el('file-select').value = selectPath;
        el('file-name').value = selectPath;
        el('file-name').readOnly = true;
    }
}

// --- CSS preview base: first HTML template that imports this CSS ---
function refBasename(href) {
    return href.split(/[?#]/)[0].split(/[\\/]/).pop().toLowerCase();
}
function htmlImportsCss(html, cssName) {
    const base = cssName.toLowerCase();
    let m;
    const linkRe = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
    while ((m = linkRe.exec(html)) !== null) if (refBasename(m[1]) === base) return true;
    const importRe = /@import\s+(?:url\(\s*)?["']?([^"')]+)["']?\s*\)?/gi;
    while ((m = importRe.exec(html)) !== null) if (refBasename(m[1]) === base) return true;
    return false;
}
async function resolveCssBase(cssPath) {
    cardHtmlBase = null;
    const cssName = cssPath.split('/').pop();
    const htmls = files.filter(f => f.kind === 'html');
    let firstHtml = null;
    for (const h of htmls) {
        const r = await fetch(`/api/file?id=${encodeURIComponent(selectedId)}&path=${encodeURIComponent(h.path)}`);
        if (!r.ok) continue;
        const d = await r.json();
        if (firstHtml === null) firstHtml = { name: h.path, content: d.content };
        if (htmlImportsCss(d.content, cssName)) { cardHtmlBase = { name: h.path, content: d.content }; return; }
    }
    if (firstHtml) cardHtmlBase = firstHtml; // fall back to the first template
}

// --- Preview ---
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
        el('preview-note').textContent = 'No HTML template imports this CSS.';
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
    const create = async () => {
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
    };
    openModal({ title: 'Add Project', body: wrap, buttons: [btnCancel(), btnPrimary('Create', create)] });
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
}

// --- Promote ---
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

    const promote = async () => {
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
    };
    openModal({ title: 'Promote project', body: wrap, buttons: [btnCancel(), btnPrimary('Promote', promote)] });
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
    const save = async () => {
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
    };
    openModal({ title: 'Master image folder', body: wrap, buttons: [btnCancel(), btnPrimary('Save', save)] });
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

// --- Unsaved-changes guard ---
function guardUnsaved() {
    return new Promise((resolve) => {
        if (!(currentView === 'editor' && dirty)) return resolve(true);
        openModal({
            title: 'Unsaved changes',
            body: `<p>Save changes to “${escapeHtml(el('file-name').value || 'this file')}” before closing?</p>`,
            onDismiss: () => resolve(false),
            buttons: [
                btnGhost('Cancel', () => { closeModal(); resolve(false); }),
                btnGhost('Discard', () => { closeModal(); dirty = false; resolve(true); }),
                btnPrimary('Save', async () => { if (await saveFile()) { closeModal(); resolve(true); } }),
            ],
        });
    });
}

// --- Modal primitives ---
function btnPrimary(label, onClick) { return { label, kind: 'primary', onClick }; }
function btnGhost(label, onClick) { return { label, kind: 'ghost', onClick }; }
function btnCancel() { return { label: 'Cancel', kind: 'ghost', onClick: closeModal }; }

function openModal({ title, body, buttons, onDismiss = null }) {
    el('modal-title').textContent = title;
    const mb = el('modal-body');
    mb.innerHTML = '';
    if (typeof body === 'string') mb.innerHTML = body;
    else if (body) mb.appendChild(body);
    el('modal-error').textContent = '';
    const actions = el('modal-actions');
    actions.innerHTML = '';
    (buttons || [btnCancel(), btnPrimary('OK', closeModal)]).forEach((b) => {
        const btn = document.createElement('button');
        if (b.kind === 'ghost') btn.className = 'ghost';
        btn.textContent = b.label;
        btn.onclick = b.onClick;
        actions.appendChild(btn);
    });
    modalOnDismiss = onDismiss;
    el('modal-overlay').classList.remove('hidden');
}
function closeModal(viaDismiss = false) {
    el('modal-overlay').classList.add('hidden');
    el('modal-body').innerHTML = '';
    const d = modalOnDismiss;
    modalOnDismiss = null;
    if (viaDismiss === true && d) d();
}
function setModalError(m) { el('modal-error').textContent = m; }
function openAlert(title, message) {
    openModal({ title, body: `<p>${escapeHtml(message)}</p>`, buttons: [btnPrimary('OK', () => closeModal())] });
}

// --- Status / console ---
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

// --- Wire up ---
el('file-select').addEventListener('change', async () => {
    const v = el('file-select').value;
    if (!(await guardUnsaved())) { el('file-select').value = currentFilePath || NEW_FILE; return; }
    if (v === NEW_FILE) startNewFile();
    else selectFile(v);
});
code.addEventListener('input', () => { dirty = true; setSaveStatus(''); schedulePreview(); });
code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const s = code.selectionStart, en = code.selectionEnd;
        code.value = code.value.slice(0, s) + '    ' + code.value.slice(en);
        code.selectionStart = code.selectionEnd = s + 4;
        dirty = true;
        setSaveStatus('');
        schedulePreview();
    }
});
el('save-btn').onclick = saveFile;
el('close-editor-btn').onclick = closeEditor;
el('ov-promote-btn').onclick = () => { if (selectedId) promoteProject(selectedId); };
el('act-back').onclick = () => setView('project');
el('run-btn').onclick = runAction;
el('clear-btn').onclick = () => { consoleEl.textContent = ''; };
stopBtn.onclick = () => {
    if (currentStream) {
        currentStream.close();
        currentStream = null;
        appendConsole('\n⏹ Stopped by user.\n');
        setRunStatus('fail');
        finishRun();
    }
};
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        if (currentView !== 'editor') return;
        e.preventDefault();
        saveFile();
    }
    if (e.key === 'Escape' && !el('modal-overlay').classList.contains('hidden')) closeModal(true);
});
el('modal-overlay').addEventListener('click', (e) => { if (e.target === el('modal-overlay')) closeModal(true); });
window.addEventListener('beforeunload', (e) => {
    if (currentView === 'editor' && dirty) { e.preventDefault(); e.returnValue = ''; }
});

init();
