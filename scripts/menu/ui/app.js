// ===== bg_tools workspace =====
// Left: projects (compact links, + Add) and a Settings button.
// Middle: one of — project overview | action runner | file editor | settings.
// Right: Actions (project/action view) or Preview (editor view).

const NEW_FILE = '__new__';
const CARD_W = 750;   // card preview renders at the generator's true viewport, then scales
const CARD_H = 1125;
const ACTION_GROUP_ORDER = ['Rules', 'Images', 'Templates', 'Other'];

// --- State ---
let config = null;            // { imagePath, imagePathValid, actions, statusFolders }
let projects = { folders: [] };
let selectedId = null;        // "<status>/<name>"
let currentProject = null;    // { id, name, status, canGenerate }
let currentLang = '';         // overview language ('' = Default/base, 'en' = the .en variant)
let currentView = 'empty';    // 'empty' | 'project' | 'action' | 'editor' | 'settings'
let currentActionIndex = null;
let files = [];               // file descriptors (editor)
let currentFilePath = null;
let currentFileLang = '';     // '' = base project, 'en'/'da'/... = translation variant
let currentKind = null;       // 'markdown' | 'json5' | 'text' | 'html' | 'css'
let currentJson5Mode = null;  // for json5: 'cards' (line→image) | 'text' (cursor→template) | null
let lastCursorLine = -1;
let cursorTimer = null;
let previewSeq = 0;           // guards async previews against stale cursor moves
let currentFileMtime = 0;     // mtime of the open file (external-change detection)
let lastTextKey = '';         // last card rendered in the .cards.text preview (de-blink)
let lastLineImg = '';         // last image rendered in the .cards.json5 line preview
let conflictOpen = false;     // an external-change conflict modal is showing
let currentActionOutput = ''; // output subfolder of the open action (e.g. 'tts')
let cardHtmlBase = null;      // { name, content } base HTML for card/CSS preview
let templateCards = [];       // cards (id + values) that use the previewed template
let selectedCardId = null;    // which card's values fill the template preview
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
    await restoreLocation();
    setInterval(checkExternalChange, 2500);
    window.addEventListener('focus', checkExternalChange);
}

// --- Remember where the user is (project / file), restore on reload ---
const LOC_KEY = 'bg_tools.location';
function saveLocation() {
    try {
        localStorage.setItem(LOC_KEY, JSON.stringify({
            id: selectedId, view: currentView, file: currentFilePath, lang: currentFileLang,
        }));
    } catch { /* storage unavailable */ }
}
async function restoreLocation() {
    let loc;
    try { loc = JSON.parse(localStorage.getItem(LOC_KEY) || 'null'); } catch { loc = null; }
    if (!loc || !loc.id) return;
    const exists = projects.folders.some(g => g.projects.some(p => p.id === loc.id));
    if (!exists) return;
    await selectProject(loc.id);
    if (loc.view === 'editor') {
        await openEditor();
        if (loc.file && files.some(f => f.path === loc.file && (f.lang || '') === (loc.lang || ''))) {
            await selectFile(loc.file, loc.lang || '');
        }
    }
}

async function loadConfig() {
    const res = await fetch('/api/config');
    config = await res.json();
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
    el('mid-settings').classList.toggle('hidden', v !== 'settings');
    el('right-actions').classList.toggle('hidden', !(v === 'project' || v === 'action'));
    el('right-preview').classList.toggle('hidden', v !== 'editor');
    el('workspace').classList.toggle('editor-mode', v === 'editor');
    saveLocation();
}

// --- External-change detection (items 2/3) ---
async function reloadCurrentFileFromDisk() {
    const res = await fetch(`/api/file?id=${encodeURIComponent(selectedId)}&path=${encodeURIComponent(currentFilePath)}&lang=${encodeURIComponent(currentFileLang)}`);
    if (!res.ok) return;
    const data = await res.json();
    code.value = data.content;
    currentFileMtime = data.mtimeMs || 0;
    dirty = false;
    lastTextKey = '';
    lastLineImg = '';
    setSaveStatus('');
    renderPreview();
}

async function checkExternalChange() {
    if (currentView !== 'editor' || !currentFilePath || conflictOpen) return;
    let d;
    try {
        const r = await fetch(`/api/file-stat?id=${encodeURIComponent(selectedId)}&path=${encodeURIComponent(currentFilePath)}&lang=${encodeURIComponent(currentFileLang)}`);
        if (!r.ok) return;
        d = await r.json();
    } catch { return; }
    if (!d.exists || d.mtimeMs <= currentFileMtime + 1) return; // unchanged on disk

    if (!dirty) { await reloadCurrentFileFromDisk(); return; }

    // Local edits + external change -> ask the user.
    conflictOpen = true;
    const finish = () => { currentFileMtime = d.mtimeMs; conflictOpen = false; closeModal(); };
    openModal({
        title: 'File changed on disk',
        body: `<p>“${escapeHtml(currentFilePath)}” was changed by another program, but you have unsaved edits.</p>`,
        onDismiss: () => { currentFileMtime = d.mtimeMs; conflictOpen = false; },
        buttons: [
            btnGhost('Cancel', finish), // keep editing mine, leave disk as-is
            btnGhost('Keep disk', async () => { finish(); await reloadCurrentFileFromDisk(); }),
            btnPrimary('Overwrite disk', async () => { conflictOpen = false; closeModal(); await saveFile(); }),
        ],
    });
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
        title.textContent = `${group.key.split('_')[0]} · ${group.label} (${group.projects.length})`;
        if (group.description) title.title = group.description;
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
    currentLang = '';
    cardHtmlBase = null;
    renderProjects();
    const ov = await fetchOverview();
    if (!ov) { setView('empty'); return; }
    renderOverview(ov); // sets currentProject (incl. asset flags) + renders the action list
    setView('project');
    saveLocation();
}

async function fetchOverview() {
    const res = await fetch(`/api/project-overview?id=${encodeURIComponent(selectedId)}&lang=${encodeURIComponent(currentLang)}`);
    return res.ok ? res.json() : null;
}

// Re-fetch + re-render the overview (after a language switch or a generate run).
async function refreshOverview() {
    const ov = await fetchOverview();
    if (ov) renderOverview(ov);
}

function renderLanguageSelect(ov) {
    const host = el('ov-lang');
    host.innerHTML = '';
    if (!ov.languages || ov.languages.length <= 1) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');
    const label = document.createElement('label');
    label.textContent = 'Language: ';
    const sel = document.createElement('select');
    sel.className = 'select';
    ov.languages.forEach((l) => {
        const o = document.createElement('option');
        o.value = l.code; o.textContent = capitalize(l.label);
        sel.appendChild(o);
    });
    sel.value = currentLang;
    sel.onchange = () => { currentLang = sel.value; refreshOverview(); };
    label.appendChild(sel);
    host.appendChild(label);
}

function renderInfo(info) {
    const host = el('ov-info');
    host.innerHTML = '';
    if (!info) return;
    if (info.oneLiner) { const p = document.createElement('p'); p.className = 'ov-oneliner'; p.textContent = info.oneLiner; host.appendChild(p); }
    if (info.description) { const p = document.createElement('p'); p.className = 'ov-desc'; p.textContent = info.description; host.appendChild(p); }
    const meta = [['Players', info.playerCount], ['Ages', info.ages], ['Duration', info.duration], ['Language', info.language]]
        .filter(([, v]) => v);
    if (meta.length) {
        const dl = document.createElement('dl');
        dl.className = 'details';
        meta.forEach(([k, v]) => {
            const dt = document.createElement('dt'); dt.textContent = k;
            const dd = document.createElement('dd'); dd.textContent = v;
            dl.appendChild(dt); dl.appendChild(dd);
        });
        host.appendChild(dl);
    }
}

function renderOverview(ov) {
    currentProject = {
        id: ov.id, name: ov.name, status: ov.status, canGenerate: ov.canGenerate,
        hasImages: !!(ov.images && ov.images.hasFolder && ov.images.count > 0),
        hasText: !!ov.hasText,
    };
    el('ov-status').textContent = statusLabel(ov.status);
    el('ov-name').textContent = ov.name;
    el('ov-promote-btn').classList.toggle('hidden', ov.status === '7_archive');
    el('ov-archive-btn').classList.toggle('hidden', ov.status === '7_archive');
    renderLanguageSelect(ov);
    renderInfo(ov.info);
    renderActions();

    const dl = el('ov-details');
    dl.innerHTML = '';
    const row = (k, v) => {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.appendChild(dt); dl.appendChild(dd);
    };
    row('Folder', ov.status);
    row('Created', ov.createdMs ? new Date(ov.createdMs).toLocaleString() : '—');

    const batchHost = el('ov-batches');
    batchHost.classList.add('hidden');
    batchHost.innerHTML = '';
    el('ov-preview-images-btn').classList.add('hidden');
    el('ov-preview-template-btn').classList.add('hidden');

    // Cards / Images only matter once a game has components (3_test onward).
    if (ov.showAssets) {
        if (ov.cards === null) row('Cards', '— (no .cards.json5)');
        else if (ov.cards.error) row('Cards', `Could not parse ${ov.cards.file}`);
        else row('Cards', `${ov.cards.unique} unique · ${ov.cards.total} total · ${ov.cards.file}`);

        if (!ov.images.configured) row('Images', '— (master image folder not set)');
        else if (!ov.images.hasFolder) row('Images', `No folder “${ov.name}” in the image path`);
        else row('Images', `${ov.images.count} image(s) found`);

        if (ov.templateImages && ov.templateImages.exists) {
            row('Template images', `${ov.templateImages.count} JPG(s) in _dist/${ov.name}/template_jpg`);
        }

        if (ov.cards && !ov.cards.error && ov.cards.batches && ov.cards.batches.length) {
            renderBatchTable(batchHost, ov.cards);
            batchHost.classList.remove('hidden');
        }
        if (ov.images.configured && ov.images.hasFolder && ov.images.count > 0) {
            el('ov-preview-images-btn').classList.remove('hidden');
        }
        if (ov.templateImages && ov.templateImages.exists) {
            el('ov-preview-template-btn').classList.remove('hidden');
        }
    }
}

function renderBatchTable(host, cards) {
    const table = document.createElement('table');
    table.className = 'batches';
    table.innerHTML = '<thead><tr><th>Batch</th><th>Unique</th><th>Total</th></tr></thead>';
    const tb = document.createElement('tbody');
    cards.batches.forEach((b) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(b.name)}</td><td>${b.unique}</td><td>${b.total}</td>`;
        tb.appendChild(tr);
    });
    table.appendChild(tb);
    const tf = document.createElement('tfoot');
    tf.innerHTML = `<tr><th>Total</th><th>${cards.unique}</th><th>${cards.total}</th></tr>`;
    table.appendChild(tf);
    host.appendChild(table);
}

// --- Right: actions (grouped) ---
function renderActions() {
    const host = el('action-groups');
    host.innerHTML = '';
    const hint = el('action-hint');
    if (!currentProject) { hint.textContent = 'Select a project.'; return; }

    // Editing is always available (rules / templates).
    host.appendChild(actionGroup('Editing', [{ label: '📝 Edit Files', onClick: openEditor }]));

    if (currentProject.canGenerate) {
        hint.textContent = config.imagePathValid ? '' : '⚠ Set the master image folder to generate.';
        const byGroup = {};
        config.actions.forEach((a) => { (byGroup[a.group] = byGroup[a.group] || []).push(a); });
        ACTION_GROUP_ORDER.forEach((g) => {
            if (!byGroup[g]) return;
            // Images need card images in the master folder; Templates need a .cards.text file.
            if (g === 'Images' && !currentProject.hasImages) return;
            if (g === 'Templates' && !currentProject.hasText) return;
            host.appendChild(actionGroup(g, byGroup[g].map((a) => ({
                label: a.label, title: a.description, onClick: () => openAction(a.index),
            }))));
        });
    } else {
        hint.textContent = 'Generators are available for Test, Playtest and Prototype projects.';
    }
}

function actionGroup(title, items) {
    const wrap = document.createElement('div');
    wrap.className = 'action-group';
    const h = document.createElement('div');
    h.className = 'action-group-title';
    h.textContent = title;
    wrap.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'list';
    items.forEach((it) => {
        const li = document.createElement('li');
        li.textContent = it.label;
        if (it.title) li.title = it.title;
        li.onclick = it.onClick;
        ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
}

// --- Action View ---
function openAction(index) {
    currentActionIndex = index;
    const a = config.actions[index];
    currentActionOutput = a.output || '';
    el('act-title').textContent = a.label;
    el('act-desc').textContent = a.description || '';
    const assetName = `${currentProject.name}${currentLang ? '.' + currentLang : ''}`;
    el('act-output-path').textContent = `_dist/${assetName}/${currentActionOutput ? currentActionOutput + '/' : ''}`;
    consoleEl.textContent = '';
    el('pdf-results').classList.add('hidden');
    el('pdf-list').innerHTML = '';
    setRunStatus('');
    stopBtn.classList.add('hidden');
    const runBtn = el('run-btn');
    runBtn.classList.remove('hidden');
    runBtn.disabled = false;
    runBtn.textContent = 'Generate';
    setView('action');
}

// Decide whether to run from templates or from previously-rendered JPGs (item 13).
async function startRun() {
    if (currentActionIndex === null || !currentProject || !currentProject.canGenerate) return;
    const action = config.actions[currentActionIndex];
    if (action.hasImageAlt) {
        let has = false;
        try {
            const r = await fetch(`/api/has-template-jpgs?id=${encodeURIComponent(selectedId)}`);
            if (r.ok) has = (await r.json()).has;
        } catch { /* ignore */ }
        if (has) {
            openModal({
                title: 'Use existing template JPGs?',
                body: `<p>This project has JPGs already rendered from templates in
                    <code>_dist/${escapeHtml(currentProject.name)}/template_jpg</code>.</p>
                    <p>Generate from those (fast), or render anew from the HTML templates?</p>`,
                buttons: [
                    btnCancel(),
                    btnGhost('Render anew', () => { closeModal(); runAction(''); }),
                    btnPrimary('Use JPGs', () => { closeModal(); runAction('jpgs'); }),
                ],
            });
            return;
        }
    }
    runAction('');
}

function runAction(source) {
    if (currentActionIndex === null || !currentProject || !currentProject.canGenerate) return;
    const action = config.actions[currentActionIndex];
    // Only the Images generators need the master image folder.
    if (action.group === 'Images' && source !== 'jpgs' && !config.imagePathValid) { openSettings(); return; }
    if (currentStream) currentStream.close();

    consoleEl.textContent = '';
    el('pdf-results').classList.add('hidden');
    el('pdf-list').innerHTML = '';
    setRunStatus('running');
    el('run-btn').classList.add('hidden');
    stopBtn.classList.remove('hidden');
    // Show progress immediately, rather than waiting for the first server event.
    appendConsole(`▶ Running: ${action.label}  [${currentProject.name}]${source === 'jpgs' ? '  (from existing JPGs)' : ''}\n\n`);

    const url = `/api/run?option=${currentActionIndex}&id=${encodeURIComponent(selectedId)}${source ? `&source=${source}` : ''}${currentLang ? `&lang=${encodeURIComponent(currentLang)}` : ''}`;
    const es = new EventSource(url);
    currentStream = es;

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
    runBtn.textContent = 'Generate again';
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

// --- Archive (discard shortcut) ---
async function archiveProject() {
    if (!selectedId || !currentProject) return;
    if (!window.confirm(`Archive “${currentProject.name}”?\nIt will be moved to 7_archive.`)) return;
    const res = await fetch('/api/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId }),
    });
    const data = await res.json();
    if (!res.ok) { openAlert('Archive', data.error || 'Could not archive.'); return; }
    await loadProjects();
    selectProject(data.id);
}

// --- Preview Images (full-screen grid) ---
let gridImages = [];
let gridSource = 'image';
async function previewImages(source = 'image') {
    gridSource = source;
    const res = await fetch(`/api/project-images?id=${encodeURIComponent(selectedId)}&source=${source}&lang=${encodeURIComponent(currentLang)}`);
    const data = await res.json();
    if (!res.ok || !data.images || !data.images.length) { openAlert('Images', 'No images found for this project.'); return; }
    gridImages = data.images;
    renderImageGrid();
    el('image-grid-overlay').classList.remove('hidden');
}

function renderImageGrid() {
    const title = el('image-grid-title');
    const kind = gridSource === 'template' ? 'Template images' : 'Images';
    title.textContent = `${kind} — ${currentProject.name} (${gridImages.length}) — `;
    const link = document.createElement('a');
    link.className = 'edit-link';
    link.textContent = '📂 Open folder';
    link.onclick = () => fetch(`/api/open-images?id=${encodeURIComponent(selectedId)}&source=${gridSource}&lang=${encodeURIComponent(currentLang)}`);
    title.appendChild(link);

    const grid = el('image-grid');
    grid.innerHTML = '';
    gridCells = [];
    const idp = idPathFor(selectedId);
    gridImages.forEach((im, index) => {
        const cell = document.createElement('figure');
        cell.className = 'image-cell';
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = `/api/image/${idp}/${encodeURIComponent(im.file)}?source=${gridSource}&lang=${encodeURIComponent(currentLang)}`;
        img.alt = im.id;
        img.title = 'Click to view full size';
        img.style.cursor = 'zoom-in';
        img.onclick = () => toggleImageDetail(index);
        cell.appendChild(img);
        gridCells.push(cell);

        const cap = document.createElement('figcaption');
        const idEl = document.createElement('span');
        idEl.className = 'img-id';
        idEl.textContent = im.id;
        const nameEl = document.createElement('span');
        nameEl.className = 'img-name';
        nameEl.textContent = im.file;
        cap.appendChild(idEl);
        cap.appendChild(nameEl);

        if (im.isBack) {
            const back = document.createElement('span');
            back.className = 'img-amount';
            back.textContent = '(back)';
            cap.appendChild(back);
        } else {
            // Editable amount (mod): writes back into .cards.json5
            const amtRow = document.createElement('label');
            amtRow.className = 'img-amount-row';
            amtRow.innerHTML = '<span>×</span>';
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.className = 'img-amount-input';
            input.value = im.amount == null ? 0 : im.amount;
            input.onchange = () => updateCardAmount(im, input);
            amtRow.appendChild(input);
            cap.appendChild(amtRow);
        }
        cell.appendChild(cap);
        grid.appendChild(cell);
    });
    detailIndex = -1;
    detailFile = null;
    updateGridFoot();
}

async function updateCardAmount(im, input) {
    const amount = parseInt(input.value, 10);
    if (!Number.isInteger(amount) || amount < 0) { input.value = im.amount ?? 0; return; }
    const res = await fetch('/api/card-amount', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, cardId: im.id, amount }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { input.value = im.amount ?? 0; openAlert('Amount', data.error || 'Could not update amount.'); return; }
    im.amount = amount;
    updateGridFoot();
}

function updateGridFoot() {
    const total = gridImages.reduce((s, im) => s + (im.amount || 0), 0);
    el('image-grid-foot').textContent = `${gridImages.length} unique · ${total} total`;
}

// Right-side full-size detail panel. Clicking the same thumbnail again closes it;
// arrow keys move the selection; the shown thumbnail is highlighted.
let gridCells = [];
let detailIndex = -1;
let detailFile = null;

function toggleImageDetail(index) {
    if (detailIndex === index) { closeImageDetail(); return; }
    showImageDetail(index);
}
function showImageDetail(index) {
    if (index < 0 || index >= gridImages.length) return;
    detailIndex = index;
    const im = gridImages[index];
    detailFile = im.file;
    el('image-detail-img').src = `/api/image/${idPathFor(selectedId)}/${encodeURIComponent(im.file)}?source=${gridSource}&lang=${encodeURIComponent(currentLang)}`;
    el('image-detail-name').textContent = im.file;
    el('image-detail').classList.remove('hidden');
    gridCells.forEach((c, i) => c.classList.toggle('selected', i === index));
    if (gridCells[index]) gridCells[index].scrollIntoView({ block: 'nearest' });
}
function closeImageDetail() {
    detailIndex = -1;
    detailFile = null;
    el('image-detail').classList.add('hidden');
    el('image-detail-img').removeAttribute('src');
    gridCells.forEach(c => c.classList.remove('selected'));
}
// Number of thumbnails in the first grid row (for up/down navigation).
function gridColumns() {
    if (!gridCells.length) return 1;
    const top = gridCells[0].offsetTop;
    let n = 0;
    for (const c of gridCells) { if (c.offsetTop === top) n++; else break; }
    return Math.max(1, n);
}
function moveImageDetail(delta) {
    if (detailIndex < 0) return;
    const next = detailIndex + delta;
    if (next >= 0 && next < gridImages.length) showImageDetail(next);
}

function closeImageGrid() {
    el('image-grid-overlay').classList.add('hidden');
    el('image-grid').innerHTML = '';
    el('image-grid-foot').textContent = '';
    closeImageDetail();
    gridImages = [];
    gridCells = [];
}

// --- Native folder picker for Settings ---
async function pickFolder() {
    const res = await fetch('/api/pick-folder');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { el('settings-error').textContent = data.error || 'Folder picker unavailable.'; return; }
    if (data.path) el('settings-image-path').value = data.path;
}

// --- Settings ---
function openSettings() {
    selectedId = null;       // Settings is not a project — clear the left-list highlight.
    renderProjects();
    el('settings-image-path').value = config.imagePath || '';
    el('settings-error').textContent = '';
    setSettingsStatus('');
    setView('settings');
    setTimeout(() => el('settings-image-path').focus(), 30);
}
async function saveSettings() {
    el('settings-error').textContent = '';
    const value = el('settings-image-path').value.trim();
    if (!value) { el('settings-error').textContent = 'Enter a path.'; return; }
    setSettingsStatus('saving');
    const res = await fetch('/api/image-path', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: value }),
    });
    const data = await res.json();
    if (!res.ok) { setSettingsStatus(''); el('settings-error').textContent = data.error || 'Failed to save.'; return; }
    setSettingsStatus('saved');
    await loadConfig();
}
function setSettingsStatus(state) {
    const b = el('settings-status');
    b.className = 'badge ' + (state === 'saved' ? 'ok' : state === 'saving' ? 'running' : '');
    b.textContent = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : '';
    if (state === 'saved') setTimeout(() => { if (b.textContent === 'Saved') setSettingsStatus(''); }, 2000);
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
    if (def) selectFile(def.path, def.lang || '');
    else startNewFile();
}

async function closeEditor() {
    if (!(await guardUnsaved())) return;
    setView('project');
}

function fileValue(f) { return `${f.lang || ''}|${f.path}`; }

// The "official" Moe & Spil files (rules/cards/info/notes/changelog/idea).
function isOfficialFile(p) {
    return /(_rules[_.]|\.cards\.json5$|\.cards\.text\.json5$|\.cards\.errata\.json5$|\.info\.(md|json5)$|\.notes\.md$|\.changelog\.md$|\.idea\.md$)/i.test(p);
}
// Drop the leading "<title>" from official filenames for a cleaner label.
function fileLabel(f) {
    const name = currentProject ? currentProject.name : '';
    if (isOfficialFile(f.path) && f.path.startsWith(name)) return f.path.slice(name.length);
    return f.path;
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function langName(code) { return capitalize((config.languageNames && config.languageNames[code]) || code); }

function renderFileSelect() {
    const sel = el('file-select');
    sel.innerHTML = '';
    const addGroup = (label, items) => {
        if (!items.length) return;
        const og = document.createElement('optgroup');
        og.label = label;
        items.forEach((f) => {
            const o = document.createElement('option');
            o.value = fileValue(f);
            o.textContent = fileLabel(f);
            og.appendChild(o);
        });
        sel.appendChild(og);
    };
    // Official base files, then Design templates, then a group per language, then the rest.
    addGroup('Files', files.filter(f => !f.lang && isOfficialFile(f.path)));
    addGroup('Design', files.filter(f => !f.lang && f.group === 'template'));
    [...new Set(files.filter(f => f.lang).map(f => f.lang))]
        .forEach(code => addGroup(langName(code), files.filter(f => f.lang === code)));
    addGroup('Misc.', files.filter(f => !f.lang && !isOfficialFile(f.path) && f.group !== 'template'));
    // Idea projects are a single file — no "New file" option.
    if (!currentProject || currentProject.status !== '1_idea') {
        const nw = document.createElement('option');
        nw.value = NEW_FILE;
        nw.textContent = '＋ New file…';
        sel.appendChild(nw);
    }
}

function kindFromPath(p) {
    const ext = (p.split('.').pop() || '').toLowerCase();
    return ({ md: 'markdown', json5: 'json5', txt: 'text', html: 'html', css: 'css' })[ext] || null;
}

// For json5 files, decide which contextual preview to show.
function json5ModeForPath(p) {
    if (!/\.json5$/i.test(p)) return null;
    if (/\.text\.json5$/i.test(p)) return 'text';      // *.cards.text.json5 -> template preview
    if (/\.cards\.json5$/i.test(p)) return 'cards';    // *.cards.json5 -> per-line master image
    return null;
}

function cursorLine() { return code.value.slice(0, code.selectionStart).split('\n').length - 1; }
function currentLineText() { return code.value.split('\n')[cursorLine()] || ''; }

async function selectFile(path, lang = '') {
    el('file-select').value = `${lang || ''}|${path}`;
    const res = await fetch(`/api/file?id=${encodeURIComponent(selectedId)}&path=${encodeURIComponent(path)}&lang=${encodeURIComponent(lang)}`);
    if (!res.ok) { setEditorError('Could not load file.'); return; }
    const data = await res.json();
    setEditorError('');
    currentFilePath = path;
    currentFileLang = lang;
    currentFileMtime = data.mtimeMs || 0;
    el('file-name').textContent = path;
    code.value = data.content;
    currentKind = kindFromPath(path);
    currentJson5Mode = json5ModeForPath(path);
    lastCursorLine = -1;
    lastTextKey = '';
    lastLineImg = '';
    dirty = false;
    setSaveStatus('');
    updateBumpButton();
    if (currentKind === 'html') {
        cardHtmlBase = { name: path, content: data.content, path, lang };
        await loadTemplateCards(path, lang);
    } else if (currentKind === 'css') {
        await loadCssCards(path, lang);
    }
    renderPreview();
    saveLocation();
}

// --- Bump version (rules files, 3_test and above) ---
function isRulesFile(p) { return /_rules_[0-9]/i.test(p) && /\.md$/i.test(p); }
function updateBumpButton() {
    const show = currentProject
        && ['3_test', '4_playtest', '5_prototype', '6_production'].includes(currentProject.status)
        && currentFilePath && isRulesFile(currentFilePath);
    el('bump-btn').classList.toggle('hidden', !show);
}
function bumpVersion() {
    if (!currentFilePath || !isRulesFile(currentFilePath)) return;
    const cur = (currentFilePath.match(/_rules_([0-9][0-9.]*)/i) || [, ''])[1];
    const wrap = document.createElement('div');
    const lbl = document.createElement('p');
    lbl.className = 'muted';
    lbl.textContent = `New version for ${currentFilePath}:`;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input modal-input';
    input.value = cur;
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    const doBump = async () => {
        const version = input.value.trim();
        if (!/^[0-9][0-9.]*$/.test(version)) { setModalError('Version must be digits and dots (e.g. 2.6).'); return; }
        const r = await fetch('/api/bump-version', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selectedId, path: currentFilePath, lang: currentFileLang, version }),
        });
        const d = await r.json();
        if (!r.ok) { setModalError(d.error || 'Could not rename.'); return; }
        closeModal();
        await reloadFiles(d.path, currentFileLang);
        selectFile(d.path, currentFileLang);
    };
    openModal({ title: 'Bump version', body: wrap, buttons: [btnCancel(), btnPrimary('Rename', doBump)] });
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doBump(); });
}

// Load the cards that use this template (for the preview card selector).
async function loadTemplateCards(templatePath, lang) {
    templateCards = [];
    selectedCardId = null;
    const base = templatePath.split('/').pop();
    try {
        const res = await fetch(`/api/template-cards?id=${encodeURIComponent(selectedId)}&template=${encodeURIComponent(base)}&lang=${encodeURIComponent(lang || '')}`);
        if (res.ok) templateCards = (await res.json()).cards || [];
    } catch { /* none */ }
    const sel = el('card-select');
    sel.innerHTML = '';
    templateCards.forEach((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name ? `${c.id}: ${c.name}` : c.id;
        sel.appendChild(o);
    });
    selectedCardId = templateCards.length ? templateCards[0].id : null;
    if (selectedCardId) sel.value = selectedCardId;
}

// Replace {key} placeholders in a template with the selected card's values.
function applyCardValues(html) {
    if (!selectedCardId) return html;
    const card = templateCards.find(c => c.id === selectedCardId);
    return substituteValues(html, { id: selectedCardId, ...((card && card.values) || {}) });
}

// "+ New file" prompts for a filename, then opens an empty (unsaved) buffer.
function startNewFile() {
    const wrap = document.createElement('div');
    const lbl = document.createElement('p');
    lbl.className = 'muted';
    lbl.textContent = 'New file name (e.g. notes.md, design/card.html):';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input modal-input';
    input.placeholder = 'filename.md';
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    const revert = () => { closeModal(); el('file-select').value = currentFilePath === null ? NEW_FILE : `${currentFileLang || ''}|${currentFilePath}`; };
    const create = () => {
        const name = input.value.trim();
        if (!/\.(md|json5|txt|html|css)$/i.test(name) || name.includes('..')) {
            setModalError('Filename must end in .md, .json5, .txt, .html or .css'); return;
        }
        closeModal();
        currentFilePath = name;
        currentFileLang = '';
        currentFileMtime = 0;
        el('file-name').textContent = name;
        el('file-select').value = NEW_FILE;
        code.value = '';
        currentKind = kindFromPath(name);
        currentJson5Mode = json5ModeForPath(name);
        lastTextKey = ''; lastLineImg = '';
        dirty = true;
        setSaveStatus('');
        updateBumpButton();
        renderPreview();
        code.focus();
    };
    openModal({ title: 'New file', body: wrap, buttons: [btnGhost('Cancel', revert), btnPrimary('Create', create)] });
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
}

// Returns true on success.
async function saveFile() {
    setEditorError('');
    const name = currentFilePath;
    if (!name || !/\.(md|json5|txt|html|css)$/i.test(name)) { setEditorError('No file to save.'); return false; }
    // Re-indent json5 on save (preserving comments).
    if (/\.json5$/i.test(name)) {
        const reindented = reindentJson5(code.value, config.editorIndent || 2);
        if (reindented != null) code.value = reindented;
    }
    setSaveStatus('saving');
    const res = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, path: name, content: code.value, lang: currentFileLang }),
    });
    const data = await res.json();
    if (!res.ok) { setSaveStatus(''); setEditorError(data.error || 'Save failed.'); return false; }
    setSaveStatus('saved');
    dirty = false;
    currentFileMtime = data.mtimeMs || 0;
    currentKind = kindFromPath(name);
    currentJson5Mode = json5ModeForPath(name);
    if (currentKind === 'html') cardHtmlBase = { name, content: code.value, path: name, lang: currentFileLang };
    updateBumpButton();
    await reloadFiles(name, currentFileLang);
    renderPreview();
    return true;
}

async function reloadFiles(selectPath, selectLang = '') {
    const res = await fetch(`/api/project-files?id=${encodeURIComponent(selectedId)}`);
    if (!res.ok) return;
    const data = await res.json();
    files = data.files;
    renderFileSelect();
    if (selectPath && files.some(f => f.path === selectPath && (f.lang || '') === selectLang)) {
        el('file-select').value = `${selectLang || ''}|${selectPath}`;
        el('file-name').textContent = selectPath;
    }
}

// --- Rename / Delete the current file ---
function renameFile() {
    if (!currentFilePath) return;
    const wrap = document.createElement('div');
    const lbl = document.createElement('p');
    lbl.className = 'muted';
    lbl.textContent = `Rename ${currentFilePath} to:`;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input modal-input';
    input.value = currentFilePath.split('/').pop();
    wrap.appendChild(lbl);
    wrap.appendChild(input);
    const doRename = async () => {
        const newName = input.value.trim();
        if (!/\.(md|json5|txt|html|css)$/i.test(newName) || newName.includes('/') || newName.includes('..')) {
            setModalError('Enter a simple filename ending in .md, .json5, .txt, .html or .css'); return;
        }
        const r = await fetch('/api/rename-file', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selectedId, path: currentFilePath, lang: currentFileLang, newName }),
        });
        const d = await r.json();
        if (!r.ok) { setModalError(d.error || 'Could not rename.'); return; }
        closeModal();
        await reloadFiles(d.path, currentFileLang);
        selectFile(d.path, currentFileLang);
    };
    openModal({ title: 'Rename file', body: wrap, buttons: [btnCancel(), btnPrimary('Rename', doRename)] });
    setTimeout(() => input.focus(), 50);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); });
}

async function deleteFile() {
    if (!currentFilePath) return;
    if (!window.confirm(`Delete “${currentFilePath}”?\nThis cannot be undone.`)) return;
    const r = await fetch('/api/delete-file', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, path: currentFilePath, lang: currentFileLang }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { openAlert('Delete file', d.error || 'Could not delete.'); return; }
    dirty = false;
    await reloadFiles(null, '');
    const def = files.find(f => f.default) || files[0];
    if (def) selectFile(def.path, def.lang || '');
    else startNewFile();
}

// Re-indent a json5 document by brace/bracket depth (preserves content & comments).
// Returns the reindented string, or null if structure looks unbalanced (then skip).
function reindentJson5(text, size) {
    const unit = ' '.repeat(Math.max(1, size || 2));
    const lines = text.split('\n');
    const out = [];
    let depth = 0, inBlockComment = false;
    for (let raw of lines) {
        const line = raw.replace(/\s+$/, '');
        const trimmed = line.trim();
        if (inBlockComment) {
            out.push(line); // leave comment bodies untouched
            if (trimmed.includes('*/')) inBlockComment = false;
            continue;
        }
        // A line that starts by closing a bracket is indented one level less.
        const startsClosing = /^[}\]]/.test(trimmed);
        const indent = Math.max(0, depth - (startsClosing ? 1 : 0));
        out.push(trimmed ? unit.repeat(indent) + trimmed : '');
        // Update depth from this line's brackets, ignoring strings and comments.
        let inStr = null;
        for (let i = 0; i < trimmed.length; i++) {
            const c = trimmed[i];
            if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
            if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
            if (c === '/' && trimmed[i + 1] === '/') break; // line comment
            if (c === '/' && trimmed[i + 1] === '*') { inBlockComment = true; break; }
            if (c === '{' || c === '[') depth++;
            else if (c === '}' || c === ']') depth = Math.max(0, depth - 1);
        }
    }
    if (depth !== 0) return null; // unbalanced — don't risk mangling
    return out.join('\n');
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
// Build the card list to preview while editing a CSS file: cards from the
// templates that import this CSS (falling back to the first template), with each
// card carrying the template's HTML so the preview can apply the live CSS.
async function loadCssCards(cssPath, cssLang = '') {
    templateCards = [];
    selectedCardId = null;
    const cssName = cssPath.split('/').pop();
    const htmls = files.filter(f => f.kind === 'html')
        .sort((a, b) => ((b.lang || '') === cssLang) - ((a.lang || '') === cssLang)); // same-language first

    const fetchHtml = async (h) => {
        const r = await fetch(`/api/file?id=${encodeURIComponent(selectedId)}&path=${encodeURIComponent(h.path)}&lang=${encodeURIComponent(h.lang || '')}`);
        return r.ok ? (await r.json()).content : null;
    };

    let importing = [];
    for (const h of htmls) {
        const html = await fetchHtml(h);
        if (html != null && htmlImportsCss(html, cssName)) importing.push({ h, html });
    }
    if (!importing.length && htmls.length) { // fall back to the first template
        const html = await fetchHtml(htmls[0]);
        if (html != null) importing = [{ h: htmls[0], html }];
    }

    for (const { h, html } of importing) {
        const tr = await fetch(`/api/template-cards?id=${encodeURIComponent(selectedId)}&template=${encodeURIComponent(h.path.split('/').pop())}&lang=${encodeURIComponent(h.lang || '')}`);
        const cards = tr.ok ? (await tr.json()).cards : [];
        if (cards.length) {
            for (const c of cards) templateCards.push({ id: c.id, name: c.name, values: c.values, htmlContent: html });
        } else {
            templateCards.push({ id: h.path.split('/').pop(), name: '', values: {}, htmlContent: html });
        }
    }

    selectedCardId = templateCards.length ? templateCards[0].id : null;
    const sel = el('card-select');
    sel.innerHTML = '';
    templateCards.forEach((c) => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.name ? `${c.id}: ${c.name}` : c.id;
        sel.appendChild(o);
    });
    if (selectedCardId) sel.value = selectedCardId;
}

// --- Preview ---
function hideAllPreviews() {
    el('md-preview').classList.add('hidden');
    el('card-stage').classList.add('hidden');
    el('line-image-stage').classList.add('hidden');
    el('preview-empty').classList.add('hidden');
    el('card-preview-bar').classList.add('hidden');
    el('edit-template-btn').classList.add('hidden');
    el('preview-note').textContent = '';
}

// Show a centered message in the preview pane, optionally with action button(s).
function showPreviewMessage(text, actions) {
    el('card-stage').classList.add('hidden');
    el('line-image-stage').classList.add('hidden');
    const host = el('preview-empty');
    host.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    host.appendChild(p);
    for (const a of [].concat(actions || [])) {
        const b = document.createElement('button');
        b.textContent = a.label;
        b.onclick = a.onClick;
        host.appendChild(b);
    }
    host.classList.remove('hidden');
}

async function addMissingTemplate(name) {
    const res = await fetch('/api/add-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, name }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { openAlert('Add template', d.error || 'Could not create template.'); return; }
    await reloadFiles(currentFilePath, currentFileLang); // surface the new design/ file in the list
    lastTextKey = '';
    renderPreview();
}

async function addAllMissingTemplates() {
    let missing = [];
    try {
        const r = await fetch('/api/missing-templates', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selectedId, content: code.value }),
        });
        if (r.ok) missing = (await r.json()).missing || [];
    } catch { /* ignore */ }
    for (const name of missing) {
        await fetch('/api/add-template', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selectedId, name }),
        });
    }
    await reloadFiles(currentFilePath, currentFileLang);
    lastTextKey = '';
    renderPreview();
}

function renderPreview() {
    hideAllPreviews();
    if (currentKind === 'markdown') renderMarkdownPreview();
    else if (currentKind === 'html') renderCardPreview(code.value);
    else if (currentKind === 'css') renderCssPreview();
    else if (currentKind === 'json5' && currentJson5Mode === 'cards') renderLineImagePreview();
    else if (currentKind === 'json5' && currentJson5Mode === 'text') renderTextCardPreview();
    else showPreviewMessage('No preview for this file type.');
}

// Replace {key} placeholders in template HTML with a card's values.
function substituteValues(html, values) {
    let out = html;
    for (const [k, v] of Object.entries(values)) out = out.split(`{${k}}`).join(String(v));
    return out;
}

// .cards.json5: show the master image for the card id on the cursor's line.
async function renderLineImagePreview() {
    const seq = ++previewSeq;
    const line = currentLineText();
    const candidates = [];
    const keyM = line.match(/^\s*["']?([A-Za-z0-9_\-.]+)["']?\s*:/);
    if (keyM && !keyM[1].startsWith('_')) candidates.push(keyM[1]);
    for (const m of line.matchAll(/"([^"]+)"/g)) candidates.push(m[1]);

    const langQ = `&lang=${encodeURIComponent(currentFileLang)}`;
    let resolved = null;
    for (const c of candidates) {
        const r = await fetch(`/api/resolve-card-image?id=${encodeURIComponent(selectedId)}&cardId=${encodeURIComponent(c)}&source=image${langQ}`);
        if (seq !== previewSeq) return; // cursor moved on — abandon
        if (r.ok) { const d = await r.json(); if (d.file) { resolved = { cardId: c, file: d.file }; break; } }
    }
    if (seq !== previewSeq) return;
    if (resolved) {
        const src = `/api/image/${idPathFor(selectedId)}/${encodeURIComponent(resolved.file)}?source=image${langQ}`;
        el('preview-empty').classList.add('hidden');
        el('line-image-stage').classList.remove('hidden');
        if (src !== lastLineImg) { el('line-image').src = src; lastLineImg = src; } // skip if unchanged (no blink)
        el('preview-note').textContent = resolved.cardId;
    } else {
        lastLineImg = '';
        el('line-image').removeAttribute('src');
        showPreviewMessage(candidates.length ? `No image for “${candidates[0]}”` : 'No card on this line');
    }
}

// .cards.text.json5: render the template of the card block the cursor is in.
async function renderTextCardPreview() {
    const seq = ++previewSeq;
    const res = await fetch('/api/text-card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, content: code.value, line: cursorLine() }),
    });
    const d = await res.json().catch(() => ({}));
    if (seq !== previewSeq) return;
    if (!res.ok || !d.cardId || !d.template) {
        lastTextKey = '';
        showPreviewMessage(d && d.error === 'parse'
            ? 'Fix the JSON5 to preview a card'
            : 'Place the cursor inside a card block to preview it');
        return;
    }
    // Same card already rendered (cursor moved within the same block) — leave it
    // alone so the preview doesn't blink.
    const key = `${d.cardId}|${d.template}|${JSON.stringify(d.values || {})}`;
    if (key === lastTextKey && !el('card-stage').classList.contains('hidden')) {
        el('preview-note').textContent = `card: ${d.cardId} · ${d.template}`;
        return;
    }
    const templatePath = 'design/' + d.template;
    const tr = await fetch(`/api/file?id=${encodeURIComponent(selectedId)}&path=${encodeURIComponent(templatePath)}&lang=`);
    if (seq !== previewSeq) return;
    if (!tr.ok) {
        lastTextKey = '';
        const actions = [{ label: 'Add Missing Template', onClick: () => addMissingTemplate(d.template) }];
        try {
            const mr = await fetch('/api/missing-templates', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: selectedId, content: code.value }),
            });
            if (mr.ok && ((await mr.json()).missing || []).length > 1) {
                actions.push({ label: 'Add All Missing Templates', onClick: addAllMissingTemplates });
            }
        } catch { /* ignore */ }
        if (seq !== previewSeq) return;
        showPreviewMessage(`Template not found: ${templatePath}`, actions);
        return;
    }
    const html = (await tr.json()).content;
    if (seq !== previewSeq) return;
    el('preview-empty').classList.add('hidden');
    el('card-stage').classList.remove('hidden');
    el('card-preview').srcdoc = injectBase(substituteValues(html, { id: d.cardId, ...(d.values || {}) }));
    el('preview-note').textContent = `card: ${d.cardId} · ${d.template}`;
    lastTextKey = key;
    // Edit Template: jump to the template file in the editor.
    el('card-preview-bar').classList.remove('hidden');
    el('card-select-label').classList.add('hidden');
    el('card-select').classList.add('hidden');
    const editBtn = el('edit-template-btn');
    editBtn.classList.remove('hidden');
    editBtn.onclick = () => selectFile(templatePath, '');
    fitPreview();
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
    frame.srcdoc = data.html; // 'load' fires -> syncMdScroll() restores position
}

// Keep the markdown preview scrolled to the same relative position as the editor.
let mdScrollRatio = 0;
function syncMdScroll() {
    const win = el('md-preview').contentWindow;
    const doc = win && win.document && win.document.documentElement;
    if (!doc) return;
    const max = doc.scrollHeight - win.innerHeight;
    win.scrollTo(0, max > 0 ? mdScrollRatio * max : 0);
}

function idPathFor(id) {
    return id.split('/').map(encodeURIComponent).join('/');
}
function idPath() { return idPathFor(selectedId); }

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

// Show the card <select> in the preview bar (html/css modes), hide Edit Template.
function showCardSelectBar() {
    el('card-select-label').classList.remove('hidden');
    el('card-select').classList.remove('hidden');
    el('edit-template-btn').classList.add('hidden');
}

function renderCardPreview(html) {
    cardHtmlBase = { name: currentFilePath, content: html, path: currentFilePath, lang: currentFileLang };
    showCardSelectBar();
    el('card-preview-bar').classList.toggle('hidden', templateCards.length === 0);
    el('card-stage').classList.remove('hidden');
    el('card-preview').srcdoc = injectBase(applyCardValues(html));
    fitPreview();
}

function renderCssPreview() {
    showCardSelectBar();
    el('card-preview-bar').classList.toggle('hidden', templateCards.length === 0);
    if (!templateCards.length) { showPreviewMessage('No HTML template imports this CSS.'); return; }
    const card = templateCards.find(c => c.id === selectedCardId) || templateCards[0];
    const html = substituteValues(card.htmlContent, { id: card.id, ...(card.values || {}) });
    el('card-stage').classList.remove('hidden');
    el('card-preview').srcdoc = injectBase(injectLiveCss(html, code.value));
    el('preview-note').textContent = `card: ${card.id}`;
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

// For the contextual json5 previews, re-render in place (no hideAllPreviews) so the
// card/image preview doesn't blank-then-redraw on every change.
function rerunContextualPreview() {
    if (currentJson5Mode === 'text') renderTextCardPreview();
    else if (currentJson5Mode === 'cards') renderLineImagePreview();
}
function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        if (currentKind === 'json5' && currentJson5Mode) rerunContextualPreview();
        else renderPreview();
    }, 250);
}

// Re-run the contextual json5 previews when the cursor moves to a different line.
function scheduleCursorPreview() {
    if (currentKind !== 'json5' || !currentJson5Mode) return;
    const ln = cursorLine();
    if (ln === lastCursorLine) return;
    lastCursorLine = ln;
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(rerunContextualPreview, 120);
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

// --- Unsaved-changes guard ---
function guardUnsaved() {
    return new Promise((resolve) => {
        if (!(currentView === 'editor' && dirty)) return resolve(true);
        openModal({
            title: 'Unsaved changes',
            body: `<p>Save changes to “${escapeHtml(currentFilePath || 'this file')}” before closing?</p>`,
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
el('card-select').onchange = () => { selectedCardId = el('card-select').value; renderPreview(); };
el('settings-btn').onclick = async () => { if (await guardUnsaved()) openSettings(); };
el('settings-browse-btn').onclick = pickFolder;
el('settings-save-btn').onclick = saveSettings;
el('settings-image-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveSettings(); });
el('ov-promote-btn').onclick = () => { if (selectedId) promoteProject(selectedId); };
el('ov-archive-btn').onclick = archiveProject;
el('ov-preview-images-btn').onclick = () => previewImages('image');
el('ov-preview-template-btn').onclick = () => previewImages('template');
el('image-grid-close').onclick = closeImageGrid;
el('image-detail-close').onclick = closeImageDetail;
el('act-open-dist').onclick = () => {
    if (selectedId) fetch(`/api/open-dist?id=${encodeURIComponent(selectedId)}&sub=${encodeURIComponent(currentActionOutput)}&lang=${encodeURIComponent(currentLang)}`);
};
el('delete-output-btn').onclick = async () => {
    if (!selectedId) return;
    const folder = `_dist/${currentProject.name}${currentLang ? '.' + currentLang : ''}/${currentActionOutput ? currentActionOutput + '/' : ''}`;
    if (!window.confirm(`Delete the output folder?\n${folder}\nThis cannot be undone.`)) return;
    const r = await fetch('/api/delete-output', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, sub: currentActionOutput, lang: currentLang }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); openAlert('Delete output', d.error || 'Could not delete.'); }
};
el('act-back').onclick = () => { refreshOverview(); setView('project'); };
el('run-btn').onclick = startRun;
el('close-editor-btn').onclick = closeEditor;
el('save-btn').onclick = saveFile;
el('bump-btn').onclick = bumpVersion;
el('rename-btn').onclick = renameFile;
el('delete-file-btn').onclick = deleteFile;

el('file-select').addEventListener('change', async () => {
    const v = el('file-select').value;
    if (!(await guardUnsaved())) {
        el('file-select').value = currentFilePath === null ? NEW_FILE : `${currentFileLang || ''}|${currentFilePath}`;
        return;
    }
    if (v === NEW_FILE) { startNewFile(); return; }
    const i = v.indexOf('|');
    selectFile(v.slice(i + 1), v.slice(0, i));
});
code.addEventListener('input', () => { dirty = true; setSaveStatus(''); schedulePreview(); });
code.addEventListener('keyup', scheduleCursorPreview);
code.addEventListener('click', scheduleCursorPreview);
code.addEventListener('scroll', () => {
    if (currentKind !== 'markdown') return;
    const denom = code.scrollHeight - code.clientHeight;
    mdScrollRatio = denom > 0 ? code.scrollTop / denom : 0;
    syncMdScroll();
});
el('md-preview').addEventListener('load', syncMdScroll);
code.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const indent = ' '.repeat(config.editorIndent || 2);
        const s = code.selectionStart, en = code.selectionEnd;
        code.value = code.value.slice(0, s) + indent + code.value.slice(en);
        code.selectionStart = code.selectionEnd = s + indent.length;
        dirty = true;
        setSaveStatus('');
        schedulePreview();
    }
});
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
    // Arrow-key navigation of the image preview detail panel.
    if (detailIndex >= 0 && !el('image-grid-overlay').classList.contains('hidden')) {
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -gridColumns(), ArrowDown: gridColumns() }[e.key];
        if (delta !== undefined) { e.preventDefault(); moveImageDetail(delta); return; }
    }
    if (e.key === 'Escape') {
        if (!el('image-detail').classList.contains('hidden')) closeImageDetail();
        else if (!el('image-grid-overlay').classList.contains('hidden')) closeImageGrid();
        else if (!el('modal-overlay').classList.contains('hidden')) closeModal(true);
    }
});
el('modal-overlay').addEventListener('click', (e) => { if (e.target === el('modal-overlay')) closeModal(true); });
window.addEventListener('beforeunload', (e) => {
    if (currentView === 'editor' && dirty) { e.preventDefault(); e.returnValue = ''; }
});

init();
