// --- State ---
let config = null;
let selectedFolderIndex = null;
let selectedOptionIndex = null;
let currentStream = null;

// --- Elements ---
const el = (id) => document.getElementById(id);
const setupCard = el('setup');
const menuCard = el('menu');
const consoleCard = el('console-card');
const folderList = el('folder-list');
const optionList = el('option-list');
const consoleEl = el('console');
const statusBadge = el('status-badge');
const stopBtn = el('stop-btn');
const clearBtn = el('clear-btn');
const generateBtn = el('generate-btn');
const actionDescription = el('action-description');

// --- Load config ---
async function loadConfig() {
    const res = await fetch('/api/config');
    config = await res.json();
    renderImagePathBar();

    if (!config.imagePathValid) {
        setupCard.classList.remove('hidden');
        menuCard.classList.add('hidden');
        el('image-path-input').value = config.imagePath || '';
        el('image-path-input').focus();
    } else {
        setupCard.classList.add('hidden');
        menuCard.classList.remove('hidden');
        renderFolders();
        renderOptions();
    }
}

function renderImagePathBar() {
    const bar = el('image-path-bar');
    if (config.imagePathValid) {
        bar.innerHTML = `📁 <span title="${escapeHtml(config.imagePath)}">${escapeHtml(config.imagePath)}</span>` +
            `<span class="edit-link" id="edit-path">change</span>`;
        bar.querySelector('#edit-path').onclick = showSetup;
    } else {
        bar.innerHTML = `<span style="color:var(--red)">⚠ image folder not set</span>`;
    }
}

function showSetup() {
    setupCard.classList.remove('hidden');
    el('image-path-input').value = config.imagePath || '';
    el('image-path-input').focus();
}

// --- Render folders ---
function renderFolders() {
    folderList.innerHTML = '';
    if (!config.folders.length) {
        el('no-folders').classList.remove('hidden');
        return;
    }
    el('no-folders').classList.add('hidden');
    config.folders.forEach((f, i) => {
        const li = document.createElement('li');
        li.innerHTML = `${escapeHtml(f.name)}<span class="group-label">${escapeHtml(f.root)}</span>`;
        if (i === selectedFolderIndex) li.classList.add('selected');
        li.onclick = () => {
            selectedFolderIndex = i;
            renderFolders();
            renderOptions();
        };
        folderList.appendChild(li);
    });
}

// --- Render action options ---
function renderOptions() {
    optionList.innerHTML = '';
    const hasFolder = selectedFolderIndex !== null;
    el('option-hint').classList.toggle('hidden', hasFolder);
    config.options.forEach((o) => {
        const li = document.createElement('li');
        li.textContent = o.label;
        if (!hasFolder) li.classList.add('disabled');
        if (o.index === selectedOptionIndex) li.classList.add('selected');
        li.onclick = () => {
            if (!hasFolder) return;
            selectAction(o.index);
        };
        optionList.appendChild(li);
    });
    // The editor buttons are only usable once a project is selected.
    el('edit-templates-btn').disabled = !hasFolder;
    el('edit-markdown-btn').disabled = !hasFolder;
}

// --- Save image path ---
async function savePath() {
    const errEl = el('setup-error');
    errEl.textContent = '';
    const value = el('image-path-input').value.trim();
    if (!value) { errEl.textContent = 'Please enter a path.'; return; }
    const res = await fetch('/api/image-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: value }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Failed to save.'; return; }
    await loadConfig();
}

// --- Select an action: open the bottom section with its description (does not run) ---
function selectAction(index) {
    if (currentStream) { currentStream.close(); currentStream = null; }
    selectedOptionIndex = index;
    renderOptions();

    const folder = config.folders[selectedFolderIndex];
    const option = config.options[index];

    consoleCard.classList.remove('hidden');
    el('console-title').textContent = `${option.label} — ${folder.name}`;
    actionDescription.textContent = option.description || '';
    actionDescription.classList.remove('hidden');

    // Reset to the pre-run state: show Generate, hide console/stop/clear/results.
    generateBtn.classList.remove('hidden');
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate';
    consoleEl.classList.add('hidden');
    consoleEl.textContent = '';
    clearBtn.classList.add('hidden');
    stopBtn.classList.add('hidden');
    el('pdf-results').classList.add('hidden');
    el('pdf-list').innerHTML = '';
    setStatus('');
    consoleCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- Run a script (SSE) ---
function runAction() {
    if (selectedOptionIndex === null || selectedFolderIndex === null) return;
    if (currentStream) currentStream.close();

    const folder = config.folders[selectedFolderIndex];
    const option = config.options[selectedOptionIndex];

    consoleCard.classList.remove('hidden');
    el('console-title').textContent = `${option.label} — ${folder.name}`;
    consoleEl.classList.remove('hidden');
    consoleEl.textContent = '';
    clearBtn.classList.remove('hidden');
    el('pdf-results').classList.add('hidden');
    el('pdf-list').innerHTML = '';
    setStatus('running');
    generateBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    consoleCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const url = `/api/run?option=${selectedOptionIndex}&folder=${selectedFolderIndex}`;
    const es = new EventSource(url);
    currentStream = es;

    es.addEventListener('start', (e) => {
        const d = JSON.parse(e.data);
        appendConsole(`▶ Running: ${d.label}  [${d.folder}]\n\n`);
    });
    es.addEventListener('output', (e) => {
        appendConsole(JSON.parse(e.data).text);
    });
    es.addEventListener('error', (e) => {
        if (e.data) appendConsole(JSON.parse(e.data).message + '\n');
    });
    es.addEventListener('pdfs', (e) => {
        renderPdfs(JSON.parse(e.data).pdfs);
    });
    es.addEventListener('done', (e) => {
        const d = JSON.parse(e.data);
        appendConsole(`\n${d.code === 0 ? '✔ Finished successfully.' : `✖ Exited with code ${d.code}.`}\n`);
        setStatus(d.code === 0 ? 'ok' : 'fail');
        finishRun();
        es.close();
        currentStream = null;
    });
    es.onerror = () => {
        // Connection dropped (server closed stream or network issue).
        if (currentStream) {
            appendConsole('\n⚠ Connection closed.\n');
            setStatus('fail');
            finishRun();
            es.close();
            currentStream = null;
        }
    };
}

// Restore the Generate button after a run ends so it can be re-run.
function finishRun() {
    stopBtn.classList.add('hidden');
    generateBtn.classList.remove('hidden');
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate again';
}

function renderPdfs(pdfs) {
    if (!pdfs || !pdfs.length) return;
    const list = el('pdf-list');
    list.innerHTML = '';
    pdfs.forEach((p) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = p.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '📄 ' + p.relPath;
        const meta = document.createElement('span');
        meta.className = 'pdf-meta';
        meta.textContent = p.sizeKB + ' KB';
        li.appendChild(a);
        li.appendChild(meta);
        list.appendChild(li);
    });
    el('pdf-results').classList.remove('hidden');
}

function setStatus(state) {
    statusBadge.className = 'badge ' + state;
    statusBadge.textContent =
        state === 'running' ? 'Running…' :
        state === 'ok' ? 'Done' :
        state === 'fail' ? 'Failed' : '';
}

function appendConsole(text) {
    const atBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 40;
    consoleEl.textContent += text;
    if (atBottom) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// --- Wire up ---
el('save-path-btn').onclick = savePath;
el('image-path-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePath(); });
el('clear-btn').onclick = () => { consoleEl.textContent = ''; };
generateBtn.onclick = () => runAction();
el('edit-templates-btn').onclick = () => {
    if (selectedFolderIndex === null) return;
    window.open(`templates.html?folder=${selectedFolderIndex}`, '_blank');
};
el('edit-markdown-btn').onclick = () => {
    if (selectedFolderIndex === null) return;
    window.open(`markdown.html?folder=${selectedFolderIndex}`, '_blank');
};
stopBtn.onclick = () => {
    if (currentStream) {
        currentStream.close();
        currentStream = null;
        appendConsole('\n⏹ Stopped by user.\n');
        setStatus('fail');
        finishRun();
    }
};

loadConfig();
