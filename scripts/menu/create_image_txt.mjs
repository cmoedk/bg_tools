import fs from 'fs';
import readline from 'readline';
import path from 'path';

const filePath = path.resolve('image_path.txt');

async function promptFolderPath() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query) =>
    new Promise((resolve) => rl.question(query, resolve));

  let folderPath = '';

  while (true) {
    folderPath = await question('Enter the full path to the master image folder: ');
    folderPath = folderPath.trim();

    if (!folderPath) {
      console.log('No folder path entered. Please try again.');
      continue;
    }

    try {
      const stats = fs.statSync(folderPath);
      if (stats.isDirectory()) {
        break; // valid directory, exit loop
      } else {
        console.log('The path entered is not a directory. Please try again.');
      }
    } catch {
      console.log('The path entered does not exist. Please try again.');
    }
  }

  rl.close();
  return folderPath;
}

async function main() {
  if (!fs.existsSync(filePath)) {
    console.log('image_path.txt not found. Creating it...');

    const folderPath = await promptFolderPath();

    fs.writeFileSync(filePath, folderPath, 'utf-8');

    console.log('image_path.txt has been created with the folder path.');
  } else {
    console.log('image_path.txt already exists.');
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
