// Varre uma pasta baixada do Drive (ex: downloads/2026) e gera um manifest.json
// descrevendo a arvore inteira: subpastas, capa (imagem) de cada pasta, e arquivos pra baixar.
// Uso: node scripts/build-manifest.js <pasta-categoria> [titulo]
// Ex:  node scripts/build-manifest.js downloads/2026 "2026"

const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function isImage(name) {
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB'];
  let i = -1;
  do { bytes /= 1024; i++; } while (bytes >= 1024 && i < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[i];
}

function fileLabel(filename) {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename, path.extname(filename));
  const cleaned = base.replace(/^\d+_/, '').replace(/[_+]/g, ' ').replace(/US[a-z0-9]+_\d+_/i, '').trim();
  return { ext, label: cleaned || base };
}

function scanFolder(absPath, relPath) {
  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  const folders = [];
  const files = [];
  let cover = null;

  const images = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryAbs = path.join(absPath, entry.name);
    const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      folders.push(scanFolder(entryAbs, entryRel));
    } else if (isImage(entry.name)) {
      images.push({ name: entry.name, rel: entryRel });
    } else {
      const stat = fs.statSync(entryAbs);
      const { ext, label } = fileLabel(entry.name);
      files.push({
        name: entry.name,
        rel: entryRel,
        ext,
        label,
        size: humanSize(stat.size)
      });
    }
  }

  // Prefere uma imagem com "cover" no nome; senao pega a primeira imagem encontrada.
  if (images.length) {
    cover = (images.find(i => /cover/i.test(i.name)) || images[0]).rel;
  }

  return {
    name: path.basename(absPath),
    path: relPath,
    cover,
    folders,
    files
  };
}

const target = process.argv[2];
const title = process.argv[3] || (target ? path.basename(target) : null);

if (!target) {
  console.error('Uso: node scripts/build-manifest.js <pasta-categoria> [titulo]');
  process.exit(1);
}

const absTarget = path.resolve(target);
if (!fs.existsSync(absTarget)) {
  console.error('Pasta nao encontrada:', absTarget);
  process.exit(1);
}

const tree = scanFolder(absTarget, '');
tree.name = title;

const outPath = path.join(absTarget, 'manifest.json');
fs.writeFileSync(outPath, JSON.stringify(tree, null, 2));

function countFiles(node) {
  return node.files.length + node.folders.reduce((sum, f) => sum + countFiles(f), 0);
}

console.log(`Manifest gerado: ${outPath}`);
console.log(`Total de arquivos: ${countFiles(tree)}`);
console.log(`Subpastas no primeiro nivel: ${tree.folders.length}`);
