// --- Read folder index from query string ---
const params = new URLSearchParams(location.search);
const folderIndex = params.get('folder');

const el = (id) => document.getElementById(id);
const select = el('md-select');
const nameInput = el('md-name');
const code = el('code');
const preview = el('preview');
const saveStatus = el('save-status');
const errorEl = el('editor-error');

let folderName = '';
let previewTimer = null;
let scrollRatio = 0;

// --- Load the list of markdown files ---
async function loadFiles() {
    const res = await fetch(`/api/markdown-files?folder=${encodeURIComponent(folderIndex)}`);
    if (!res.ok) { errorEl.textContent = 'Could not load markdown files (invalid folder?).'; return; }
    const data = await res.json();
    folderName = data.folder;
    el('folder-name').textContent = `— ${data.folder}`;
    document.title = `Edit Markdown — ${data.folder}`;

    select.innerHTML = '';
    data.files.forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });

    if (!data.files.length) {
        errorEl.textContent = 'No markdown files found in this project.';
        return;
    }
    const initial = data.defaultFile || data.files[0];
    select.value = initial;
    await loadFile(initial);
}

// --- Load one file ---
async function loadFile(name) {
    const res = await fetch(`/api/markdown?folder=${encodeURIComponent(folderIndex)}&name=${encodeURIComponent(name)}`);
    if (!res.ok) { errorEl.textContent = 'Could not load file.'; return; }
    const data = await res.json();
    errorEl.textContent = '';
    nameInput.value = data.name;
    code.value = data.content;
    code.scrollTop = 0;
    scrollRatio = 0;
    await updatePreview();
}

// --- Render markdown (server-side, matching the rules HTML generator) ---
async function updatePreview() {
    const res = await fetch('/api/render-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: code.value, title: folderName }),
    });
    if (!res.ok) return;
    const data = await res.json();
    preview.srcdoc = data.html; // 'load' fires -> syncScroll() restores position
}

function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 250);
}

// --- Synced scrolling: the textarea drives the preview ---
function syncScroll() {
    const win = preview.contentWindow;
    const doc = win && win.document && win.document.documentElement;
    if (!doc) return;
    const max = doc.scrollHeight - win.innerHeight;
    win.scrollTo(0, max > 0 ? scrollRatio * max : 0);
}

code.addEventListener('scroll', () => {
    const denom = code.scrollHeight - code.clientHeight;
    scrollRatio = denom > 0 ? code.scrollTop / denom : 0;
    syncScroll();
});
preview.addEventListener('load', syncScroll);

// --- Save ---
async function save() {
    errorEl.textContent = '';
    const name = nameInput.value.trim();
    if (!/^[\w.\- ]+\.md$/i.test(name)) { errorEl.textContent = 'Invalid markdown filename.'; return; }
    setStatus('saving');
    const res = await fetch('/api/markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderIndex, name, content: code.value }),
    });
    const data = await res.json();
    if (!res.ok) { setStatus(''); errorEl.textContent = data.error || 'Save failed.'; return; }
    setStatus('saved');
}

function setStatus(state) {
    saveStatus.className = 'badge ' + (state === 'saved' ? 'ok' : state === 'saving' ? 'running' : '');
    saveStatus.textContent = state === 'saved' ? 'Saved' : state === 'saving' ? 'Saving…' : '';
    if (state === 'saved') setTimeout(() => { if (saveStatus.textContent === 'Saved') setStatus(''); }, 2000);
}

// --- Wire up ---
select.addEventListener('change', () => loadFile(select.value));
code.addEventListener('input', () => { schedulePreview(); setStatus(''); });
el('save-btn').addEventListener('click', save);
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
    }
});

if (folderIndex === null) {
    errorEl.textContent = 'No folder specified.';
} else {
    loadFiles();
}
