import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import readline from 'readline/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// Setup paths.
// PROJECT_ROOT is the game project bg_tools is launched from (its working
// directory); GENERATE_DIR is bg_tools' own generator scripts. See server.mjs.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = process.cwd();
const GENERATE_DIR = path.join(__dirname, '..', 'generate');
const IMAGE_PATH_FILE = path.join(PROJECT_ROOT, 'image_path.txt');

// Define root folders and menu scripts
const ROOTFOLDERS = ['3_test', '4_playtest', '5_prototype'];
const MENU_OPTIONS = [
    { label: 'Generate rules HTML', script: path.join(GENERATE_DIR, 'generate_html.mjs') },
    { label: 'Generate rules PDF', script: path.join(PROJECT_ROOT, 'generate_rules_pdf.js') },
    { label: 'Generate Print-and-Play PDF', script: path.join(GENERATE_DIR, 'generate_pnp_pdf.mjs') },
    { label: 'Generate Tabletop Simulator Files', script: path.join(GENERATE_DIR, 'generate_tts_files.mjs') },
    { label: 'Generate Boardgamemakers.com files', script: path.join(GENERATE_DIR, 'generate_bgm_files.mjs') },
    { label: 'Generate Print-and-Play Test PDF (text only)', script: path.join(GENERATE_DIR, 'generate_template_pnp_pdf.mjs') },
];

// Reusable readline interface for question prompts only
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
});

// Read image path from file and validate
async function readImagePath() {
    try {
        const data = await fs.readFile(IMAGE_PATH_FILE, 'utf-8');
        const selectedPath = data.split(/\r?\n/)[0].replace(/\\/g, '/');
        const stat = await fs.stat(selectedPath);
        if (!stat.isDirectory()) {
            throw new Error(`ERROR: Path in image_path.txt is not a directory:\n${selectedPath}`);
        }
        return selectedPath;
    } catch (err) {
        console.error(err.message || 'ERROR: Could not read image_path.txt');
        process.exit(1);
    }
}

/**
 * 
 * @returns {Promise<{ name: string, relPath?: string}[]>}
 */
async function getFolderOptions() {
    const options = [];
    for (const root of ROOTFOLDERS) {
        const fullRootPath = path.join(PROJECT_ROOT, root);
        if (!existsSync(fullRootPath)) continue;

        const subdirs = (await fs.readdir(fullRootPath, { withFileTypes: true }))
            .filter(d => d.isDirectory())
            .map(d => ({ name: d.name, relPath: path.join(root, d.name) }));
        options.push(...subdirs);
    }
    return options;
}

// Run a child node process with arguments, inherit stdio
async function runScript(script, imagePath, subFolderPath, subFolderName) {
    return new Promise((resolve) => {
        const node = spawn('node', [script, imagePath, subFolderPath, subFolderName], { stdio: 'inherit' });
        node.on('close', () => resolve());
    });
}

// --------- Interactive menu helper ---------

// Print menu with highlighted selectedIndex
function printMenu(options, selectedIndex, title) {
    console.clear();
    hideCursor();
    console.log(`=== ${title} ===\n`);
    options.forEach((opt, i) => {
        if (i === selectedIndex) {
            process.stdout.write('> ');
            process.stdout.write('\x1b[7m'); // inverse color
            console.log(opt.label || opt.name);
            process.stdout.write('\x1b[0m'); // reset
        } else {
            console.log('  ' + (opt.label || opt.name));
        }
    });
    console.log('\nUse arrow keys to navigate and Enter to select.');
}

// Await a single keypress from stdin in raw mode
function keypress() {
    return new Promise((resolve) => {
        process.stdin.setRawMode(true);
        process.stdin.once('data', (chunk) => {
            process.stdin.setRawMode(false);
            resolve(chunk);
        });
    });
}

// Generic interactive menu with arrow keys + enter
async function interactiveMenu(options, title) {
    if (options.length === 0) return null;
    let selectedIndex = 0;
    printMenu(options, selectedIndex, title);

    while (true) {
        const key = await keypress();

        if (key.length === 1) {
            // Enter key (CR or LF)
            if (key[0] === 13 || key[0] === 10) {
                return selectedIndex;
            }
            // Esc key to cancel (optional)
            if (key[0] === 27) return null;
        } else if (key.length === 3) {
            // Arrow keys (ESC [ A/B/C/D)
            if (key[0] === 27 && key[1] === 91) {
                switch (key[2]) {
                    case 65: // up
                        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
                        printMenu(options, selectedIndex, title);
                        break;
                    case 66: // down
                        selectedIndex = (selectedIndex + 1) % options.length;
                        printMenu(options, selectedIndex, title);
                        break;
                    // left/right keys can be handled if needed
                }
            }
        }
    }
}

// --------- Menus ---------

async function submenu(imagePath, folder) {
    const backOption = { label: 'Back' };
    const quitOption = { label: 'Quit' };
    const options = [...MENU_OPTIONS, backOption, quitOption];

    while (true) {
        const choice = await interactiveMenu(options, `${folder.name} Menu`);
        if (choice === null) continue; // no valid selection, show menu again
        if (choice === options.length - 2) return;         // Back
        if (choice === options.length - 1) process.exit(0); // Quit

        const selected = MENU_OPTIONS[choice];
        if (selected) {
            console.log(`Running: ${selected.label}`);
            await runScript(selected.script, imagePath, folder.relPath, folder.name);
            console.log('Press any key to continue...');
            await keypress();
        }
    }
}

async function main() {
    const imagePath = await readImagePath();
    console.log(`Image path OK: ${imagePath}`);

    const quitOption = { name: 'Quit' };

    while (true) {
        const options = await getFolderOptions();
        if (options.length === 0) {
            console.log('No subfolders found in root folders.');
            console.log('Press any key to exit...');
            await keypress();
            break;
        }

        options.push(quitOption);

        const choice = await interactiveMenu(options, 'Main Menu');
        if (choice === null) continue;
        if (choice === options.length - 1) break;

        await submenu(imagePath, options[choice]);
    }

    rl.close();
    process.on('exit', () => {
       showCursor();
    });
    process.on('SIGINT', () => {
        showCursor();
        process.exit();
    });
    console.log('Goodbye!');
}

function hideCursor() {
  process.stdout.write('\x1B[?25l'); // ANSI escape code to hide cursor
}

function showCursor() {
  process.stdout.write('\x1B[?25h'); // ANSI escape code to show cursor
}

main();
