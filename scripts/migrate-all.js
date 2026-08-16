// Processa as categorias do Acervo em lote, direto do Google Drive (autenticado,
// via rclone) pro Backblaze B2 -- sem passar pelo disco local. Gera o manifest.json
// a partir de uma listagem (rclone lsjson -R), sem baixar nada pra montar a arvore.
//
// Uso: node scripts/migrate-all.js
// Requer variavel de ambiente RCLONE apontando pro executavel.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CATEGORIA_HTML = path.join(ROOT, 'categoria-acervo.html');
const BUCKET = 'oficina3d-acervo';
const PUBLIC_BASE = 'https://f005.backblazeb2.com/file';
const RCLONE = process.env.RCLONE || 'rclone';
const B2CLI = process.env.B2CLI || 'b2';
const GDRIVE_REMOTE = 'gdrive:';
const B2_REMOTE = 'b2acervo:';
const PAUSE_BETWEEN_MS = 8000;
// Uso: node migrate-all.js <shardIndex 0-based> <totalShards>
// Ex: node migrate-all.js 0 4   (primeiro de 4 processos paralelos)
const SHARD = Number(process.argv[2] || 0);
const TOTAL_SHARDS = Number(process.argv[3] || 1);
const MODE = `shard${SHARD}`;
// 'master' se estiver rodando no worktree principal (branch master de verdade);
// 'HEAD:master' se estiver num worktree separado (branch soltinha, precisa
// mandar o HEAD pra master no remoto). Controlado explicitamente por env var
// pra nao depender do numero do shard.
const PUSH_REF = process.env.MIGRATE_PUSH_REF || 'HEAD:master';

const CATEGORIES = [
  ['ANIMAIS', '14AxcgXdrDa8FZFlrE_9Z5m4a2-4nocQR', 'animais'],
  ['ANIMES', '1kywC-T8y2Lqgkz_lp3TMDxf8sRhv9fzr', 'animes'],
  ['ARTICULADOS', '192ciV8Bj0bJIIR6-cRvFeHKv5wRPc-eS', 'articulados'],
  ['BRINQUEDOS', '1Bo9UQporeBZfFzye9THAtxxhoyvcyrzH', 'brinquedos'],
  ['BUSTOS', '1x8qHYYHtm7fzJcTYdaveoQoSPQ1DqNFI', 'bustos'],
  ['CENÁRIOS', '1x_CmWOShR1rXF3f3R1jN8Be0Y4EiLwqt', 'cenarios'],
  ['CHIBIS', '1S1TrkDla81s0tv02R88l2474ME8oYC-x', 'chibis'],
  ['CHAVEIROS', '16eFrKqqUXBnLViAJWgH8IpOgQeG82XPY', 'chaveiros'],
  ['COSPLAY', '1XuQKid-NGkiJe-qKEoD4ZJBHbcuZHYZY', 'cosplay'],
  ['DC', '1ntT3znm4H58fnTX_g-qXznywaMeD0T6s', 'dc'],
  ['DECORAÇÃO', '13nE2BQu1LCk1Kfr9GUqPLOom-xZb7IGt', 'decoracao'],
  ['DESENHOS ANIMADOS', '1d0BLr5rnj8oS2omBHAc6gyKw90fgW9eH', 'desenhos-animados'],
  ['DIORAMA', '1I9Ug71Ttw3jTnCgAt40KjQlOvMKVqsFD', 'diorama'],
  ['DISNEY', '187M6Mgh24dGzWykaeEejhUs0PWBkZLhf', 'disney'],
  ['DOBRÁVEIS', '1sZa6T1XeK25yeHRqIGO6IysfRMLETyn6', 'dobraveis'],
  ['ESCULTURAS', '1e-aTud-1ppDP3E8PLKQ3Z3t3GiULqhA4', 'esculturas'],
  ['ESTÁDIOS', '1Nm88DufMOS3XPtEwU1BW3DiMYjVISgdD', 'estadios'],
  ['FILMES', '1kfOXhbPd3TbAq6R7HEcmo8btmCMgAPM_', 'filmes'],
  ['FUNKOS', '1UxLcT7qkMkVPMCHpKB6DMHS708LoRKlO', 'funkos'],
  ['GAMES', '17Qc42J0iNqqyLWNmEclNQdr7J-b2ZiW8', 'games'],
  ['LUMINÁRIAS', '1_WtKIT9raCWa2CP2jIqqVnW6mV6MMfph', 'luminarias'],
  ['MARVEL', '1hEJnL5p_sATQQ3cKM1WR9Vn9me_eZR7-', 'marvel'],
  ['MASCOTES', '1zp6PSbdzvAo97SirN35VsgUFG2wAffde', 'mascotes'],
  ['MINI MUNDO', '1nYmYLXMh7SoA8ofwj_jARdpDoMF84FEj', 'mini-mundo'],
  ['MITOLOGIA', '1KqReDzskWI-zrrpkSjlpa0v1Z8HwQ9aQ', 'mitologia'],
  ['MULTIPARTES', '1pH8GeRaUTjvSYY_Q_q3VNI5SoVuALErG', 'multipartes'],
  ['OUTROS', '1L852oR8R_9Ho8K451Nk2-F9a2szvilRQ', 'outros'],
  ['PERSONALIDADES', '1J6X-8rRaXxtEwtyP1O2efy_fjXyK5LMj', 'personalidades'],
  ['PLAKITS', '1MF9gV1jlr3Uv4CGMu5fuAtP4WvjeVSok', 'plakits'],
  ['PORTA ANÉIS', '1sJa5umzPAyYULsLsTZUZKN4-bnT-4yB9', 'porta-aneis'],
  ['RPG', '1JfdAhzEim1pPst3DHRCo9XQATqj8zSue', 'rpg'],
  ['SÉRIES', '1m5RkHJtlzZJu4-ZvVWgCn5VC0KXMoS9x', 'series'],
  ['SUPORTES', '1UWLSvNmixokyv_4HLMMbYBIDwyCuwN06', 'suportes'],
  ['TABULEIROS', '1-GYZ6jB1QIKgz12b0OYl_dED-C1mEQii', 'tabuleiros'],
  ['UTENSÍLIOS', '1VdeT7N7bqDFbWCVaxVmNX8KkzsNJO60q', 'utensilios'],
  ['VASOS', '1VdeT7N7bqDFbWCVaxVmNX8KkzsNJO60q', 'vasos'],
  ['VEÍCULOS', '1KTrGsqUpiDFPYPqVq12C2Qe5j-hZ1Wey', 'veiculos'],
  ['COLEÇÃO DE NATAL', '11eAZdiOIstSa7Te9ubRWBFNb_OaWQc39', 'colecao-de-natal'],
  ['AMIGURUMIS 3D', '1OpFWns94ybJarR51zTrhlkXYbOCR34QG', 'amigurumis-3d'], // reprocessada por ultimo (deu rate-limit no gdown antes)
];

const LOG_FILE = process.env.MIGRATE_LOG || path.join(ROOT, 'scripts', 'migrate.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] [${MODE}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function rclone(args) {
  const withRetry = [...args, '--retries', '8', '--low-level-retries', '30', '--retries-sleep', '10s'];
  return execFileSync(RCLONE, withRetry, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 200 });
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
function isImage(name) { return IMAGE_EXT.has(path.extname(name).toLowerCase()); }
function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB']; let i = -1;
  do { bytes /= 1024; i++; } while (bytes >= 1024 && i < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[i];
}
function fileLabel(filename) {
  const base = path.basename(filename, path.extname(filename));
  const cleaned = base.replace(/^\d+_/, '').replace(/[_+]/g, ' ').replace(/US[a-z0-9]+_\d+_/i, '').trim();
  return { ext: path.extname(filename).toLowerCase(), label: cleaned || base };
}

// Constroi a arvore {name, path, cover, folders, files} a partir da listagem
// plana do `rclone lsjson -R` (cada item tem Path relativo, IsDir, Size).
function buildTreeFromListing(items, rootName) {
  const byPath = new Map();
  byPath.set('', { name: rootName, path: '', folders: [], files: [], _images: [] });

  function ensureDir(p) {
    if (byPath.has(p)) return byPath.get(p);
    const parent = ensureDir(path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p));
    const node = { name: path.posix.basename(p), path: p, folders: [], files: [], _images: [] };
    parent.folders.push(node);
    byPath.set(p, node);
    return node;
  }

  // diretorios primeiro, pra existirem quando os arquivos forem inseridos
  items.filter(i => i.IsDir).forEach(i => ensureDir(i.Path.replace(/\\/g, '/')));

  items.filter(i => !i.IsDir).forEach(i => {
    const p = i.Path.replace(/\\/g, '/');
    const dir = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
    const node = ensureDir(dir);
    if (isImage(i.Name)) {
      node._images.push({ name: i.Name, rel: p });
    } else {
      const { ext, label } = fileLabel(i.Name);
      node.files.push({ name: i.Name, rel: p, ext, label, size: humanSize(i.Size || 0) });
    }
  });

  function finalize(node) {
    if (node._images.length) {
      node.cover = (node._images.find(im => /cover/i.test(im.name)) || node._images[0]).rel;
    } else {
      node.cover = null;
    }
    delete node._images;
    node.folders.forEach(finalize);
    return node;
  }

  return finalize(byPath.get(''));
}

// true = já tinha sido migrada (por este processo ou pelo outro), nada a fazer
function jaMigrada(name, html) {
  const re = new RegExp(`href="\\./galeria\\.html\\?[^"]*"[^>]*>\\s*<span class="item-name">${name}</span>`, 'u');
  return re.test(html);
}

function updateCategoriaHtml(name, driveId, manifestUrl) {
  let html = fs.readFileSync(CATEGORIA_HTML, 'utf8');
  if (jaMigrada(name, html)) return false; // outro processo (ou tentativa anterior) ja fez

  const escapedId = driveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<a class="item-card" href="https://drive\\.google\\.com/drive/folders/${escapedId}[^"]*"[^>]*>\\s*<span class="item-name">${name}</span>\\s*<span class="item-go">[^<]*</span>\\s*</a>`,
    'u'
  );
  if (!re.test(html)) throw new Error(`Nao encontrei o card de "${name}" (id ${driveId}) no HTML`);
  const replacement = `<a class="item-card" href="./galeria.html?data=${encodeURIComponent(manifestUrl)}&voltar=./categoria-acervo.html">\n        <span class="item-name">${name}</span>\n        <span class="item-go">Ver modelos →</span>\n      </a>`;
  fs.writeFileSync(CATEGORIA_HTML, html.replace(re, replacement));
  return true;
}

function processCategory(name, driveId, slug) {
  log(`=== Iniciando: ${name} (${slug}) ===`);

  log(`Listando estrutura no Drive...`);
  const raw = rclone(['lsjson', '-R', '--drive-root-folder-id', driveId, GDRIVE_REMOTE]);
  const items = JSON.parse(raw);
  log(`Itens encontrados: ${items.length}`);

  const tree = buildTreeFromListing(items, name);

  const tmpManifest = path.join(os.tmpdir(), `manifest-${slug}.json`);
  fs.writeFileSync(tmpManifest, JSON.stringify(tree, null, 2));

  log(`Transferindo arquivos direto Drive -> Backblaze (sem disco local)...`);
  rclone(['copy', '--drive-root-folder-id', driveId, GDRIVE_REMOTE, `${B2_REMOTE}${BUCKET}/${slug}`, '--transfers', '8', '--checkers', '16', '--fast-list']);

  log(`Subindo manifest.json...`);
  execFileSync(B2CLI, ['file', 'upload', '--no-progress', BUCKET, tmpManifest, `${slug}/manifest.json`], { encoding: 'utf8' });
  fs.rmSync(tmpManifest, { force: true });

  const manifestUrl = `${PUBLIC_BASE}/${BUCKET}/${slug}/manifest.json`;

  // Publica no git com retry: sincroniza antes de editar (pra nao perder a
  // mudanca do outro processo), e tenta de novo se o push for rejeitado
  // (outro processo publicou primeiro) ou se esbarrar num lock do git.
  let publicado = false;
  for (let tentativa = 1; tentativa <= 6 && !publicado; tentativa++) {
    try {
      try { execFileSync('git', ['pull', '--rebase', 'origin', 'master'], { cwd: ROOT }); } catch (e) {}

      log(`Atualizando categoria-acervo.html...`);
      const mudou = updateCategoriaHtml(name, driveId, manifestUrl);
      if (!mudou) { log(`Ja estava publicada (outro processo chegou primeiro)`); publicado = true; break; }

      execFileSync('git', ['add', 'categoria-acervo.html'], { cwd: ROOT });
      try {
        execFileSync('git', ['commit', '-m', `Migra categoria ${name} pro Backblaze B2`], { cwd: ROOT });
      } catch (e) {
        // nada pra commitar (raro, mas nao e erro fatal)
      }
      execFileSync('git', ['push', 'origin', PUSH_REF], { cwd: ROOT });
      publicado = true;
    } catch (e) {
      log(`Publicacao no git esbarrou em conflito (tentativa ${tentativa}/6), tentando de novo...`);
      execFileSync('powershell', ['-Command', 'Start-Sleep -Seconds 5'], { stdio: 'ignore' });
    }
  }
  if (!publicado) log(`Aviso: nao consegui publicar ${name} no git apos varias tentativas`);

  log(`=== Concluido: ${name} ===`);
}

// Le o HTML atual e pula categorias que ja foram migradas (por qualquer
// shard, em qualquer execucao anterior) -- assim nao precisa gerenciar
// manualmente quem ja terminou, o proprio arquivo publicado e a fonte da verdade.
try { execFileSync('git', ['pull', '--rebase', 'origin', 'master'], { cwd: ROOT }); } catch (e) {}
const htmlAtual = fs.readFileSync(CATEGORIA_HTML, 'utf8');
// Categorias que outro processo ja esta processando (ainda nao publicadas,
// mas nao devem ser pegas de novo aqui) -- passadas por MIGRATE_EXCLUDE.
const excluidas = new Set((process.env.MIGRATE_EXCLUDE || '').split('|').map(s => s.trim()).filter(Boolean));
const pendentes = CATEGORIES.filter(([name]) => !jaMigrada(name, htmlAtual) && !excluidas.has(name));
log(`${pendentes.length} de ${CATEGORIES.length} categorias ainda pendentes (${excluidas.size} excluidas por ja estarem em andamento em outro processo).`);

// Distribui as pendentes entre os N shards por rodizio (indice % total),
// pra misturar categorias grandes e pequenas entre os processos.
const FILA = pendentes.filter((_, i) => i % TOTAL_SHARDS === SHARD);
log(`Shard ${SHARD}/${TOTAL_SHARDS}: processando ${FILA.length} categorias.`);

let ok = 0, fail = 0;
for (const [name, driveId, slug] of FILA) {
  let done = false;
  for (let attempt = 1; attempt <= 2 && !done; attempt++) {
    try {
      processCategory(name, driveId, slug);
      ok++;
      done = true;
    } catch (err) {
      if (attempt === 1) {
        log(`Falhou (tentativa 1) em ${name}, esperando rede normalizar e tentando de novo...`);
        execFileSync('powershell', ['-Command', 'Start-Sleep -Seconds 30'], { stdio: 'ignore' });
      } else {
        fail++;
        log(`ERRO em ${name}: ${err.message.split('\n').slice(0, 5).join(' | ')}`);
      }
    }
  }
  execFileSync('powershell', ['-Command', `Start-Sleep -Milliseconds ${PAUSE_BETWEEN_MS}`], { stdio: 'ignore' });
}

log(`FIM DO LOTE. Sucesso: ${ok}, Falhas: ${fail}`);
