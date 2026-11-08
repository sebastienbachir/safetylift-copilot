// Google : synchro du classeur SafetyLift_Database + indexation du dossier Drive de doc technique.
// Avec un compte de service (GOOGLE_SERVICE_ACCOUNT_JSON) : accès privé Sheets + Drive.
// Sans : lecture CSV publique du classeur (partagé "toute personne disposant du lien"), pas d'index Drive.
const cfg = require('./config');
const store = require('./store');
const { parseCSV, norm } = require('./util');
const { MINUTES, FAQ, QUIZ, TECHS, slug } = require('./seed');

let authClient = null;
async function token() {
  if (!cfg.serviceAccount) return null;
  if (!authClient) {
    const { JWT } = require('google-auth-library');
    authClient = new JWT({
      email: cfg.serviceAccount.client_email,
      key: cfg.serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
  }
  const t = await authClient.getAccessToken();
  return t.token;
}
async function gfetch(url, asBuffer = false) {
  const t = await token();
  const r = await fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!r.ok) throw new Error(`Google ${r.status} : ${(await r.text()).slice(0, 200)}`);
  return asBuffer ? Buffer.from(await r.arrayBuffer()) : r;
}

/* ---------------- Sheets ---------------- */
async function readTab(tab) {
  if (cfg.serviceAccount) {
    const r = await gfetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}/values/${encodeURIComponent(tab)}`);
    return (await r.json()).values || [];
  }
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`);
  if (!r.ok) throw new Error(`CSV ${r.status}`);
  const text = await r.text();
  if (text.trim().startsWith('<')) throw new Error('classeur non partagé publiquement');
  return parseCSV(text);
}

const cell = (r, i) => (r[i] ?? '').toString().trim();

async function syncSheets() {
  const report = { at: new Date().toISOString(), ok: [], errors: [] };

  // Minutes : id | thème | message | risque | (date envoi) | (statut)
  try {
    const rows = (await readTab(cfg.tabs.minutes)).slice(1).filter(r => cell(r, 1) && cell(r, 2));
    if (rows.length) {
      const list = rows.map((r, i) => ({ id: parseInt(cell(r, 0), 10) || i + 1, theme: cell(r, 1), message: cell(r, 2), risque: cell(r, 3) || 'Sécurité opérationnelle' }));
      const old = Object.fromEntries((await store.list('minutes')).map(m => [m.id, m]));
      await store.replaceAll('minutes', list.map(m => ({ ...m, lastSent: old[m.id]?.lastSent || null })));
      report.ok.push(`${list.length} minutes`);
    }
  } catch (e) { report.errors.push(`Minutes : ${e.message}`); }

  // FAQ : mots-clés | titre | réponse — fusionnée avec les fiches réflexes intégrées
  try {
    const rows = (await readTab(cfg.tabs.faq)).slice(1).filter(r => cell(r, 1) && cell(r, 2));
    if (rows.length) {
      const byTitle = new Map(FAQ.map(f => [norm(f.titre).replace(/[^a-z0-9]/g, ''), f]));
      for (const r of rows) {
        const titre = cell(r, 1).replace(/^[^\p{L}\p{N}]+/u, '');
        const k = norm(titre).replace(/[^a-z0-9]/g, '');
        const prev = byTitle.get(k);
        byTitle.set(k, { id: prev?.id || 'sheet-' + slug(titre), icon: prev?.icon || 'doc', tag: prev?.tag || 'Consigne', titre, motsCles: cell(r, 0), reponse: cell(r, 2).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '') });
      }
      await store.replaceAll('faq', [...byTitle.values()]);
      report.ok.push(`${byTitle.size} fiches`);
    }
  } catch (e) { report.errors.push(`FAQ : ${e.message}`); }

  // Techniciens : nom | fonction | binôme | email | tél | secteur | (actif OUI/NON)
  try {
    const rows = (await readTab(cfg.tabs.techs)).slice(1).filter(r => cell(r, 0));
    if (rows.length) {
      const list = rows.map(r => ({ id: slug(cell(r, 0)), nom: cell(r, 0), fonction: cell(r, 1), binome: cell(r, 2), email: cell(r, 3), tel: cell(r, 4).replace(/\s/g, ''), secteur: cell(r, 5), actif: cell(r, 6).toUpperCase() !== 'NON' }));
      await store.replaceAll('techs', list);
      report.ok.push(`${list.length} membres`);
    }
  } catch (e) { report.errors.push(`Techniciens : ${e.message}`); }

  // Quiz : id | question | A | B | C | bonne (A/B/C) | explication
  try {
    const rows = (await readTab(cfg.tabs.quiz)).slice(1).filter(r => cell(r, 1) && cell(r, 2));
    if (rows.length) {
      const list = rows.map((r, i) => ({ id: cell(r, 0) || `S${i + 1}`, question: cell(r, 1), options: [cell(r, 2), cell(r, 3), cell(r, 4)].filter(Boolean), bonne: Math.max(0, 'ABC'.indexOf(cell(r, 5).toUpperCase())), explication: cell(r, 6) }));
      const generated = (await store.list('quiz')).filter(q => String(q.id).startsWith('gen-'));
      await store.replaceAll('quiz', [...list, ...generated]);
      report.ok.push(`${list.length} questions`);
    }
  } catch (e) { report.errors.push(`Quiz : ${e.message}`); }

  await store.kv.set('sheetsSync', report);
  console.log('[sheets]', report.ok.join(', ') || '—', report.errors.length ? '| erreurs : ' + report.errors.join(' ; ') : '');
  return report;
}

async function seedIfEmpty() {
  if (!(await store.count('minutes'))) await store.replaceAll('minutes', MINUTES.map(m => ({ ...m, lastSent: null })));
  if (!(await store.count('faq'))) await store.replaceAll('faq', FAQ);
  if (!(await store.count('quiz'))) await store.replaceAll('quiz', QUIZ);
  if (!(await store.count('techs'))) await store.replaceAll('techs', TECHS);
}

/* ---------------- Drive : indexation de la doc technique ---------------- */
const MIME = {
  folder: 'application/vnd.google-apps.folder',
  gdoc: 'application/vnd.google-apps.document',
  gsheet: 'application/vnd.google-apps.spreadsheet',
  gslides: 'application/vnd.google-apps.presentation',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

async function listFolder(folderId, depth = 0, out = []) {
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const r = await gfetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? '&pageToken=' + pageToken : ''}`);
    const j = await r.json();
    for (const f of j.files || []) {
      if (f.mimeType === MIME.folder) { if (depth < 4) await listFolder(f.id, depth + 1, out); }
      else out.push(f);
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken && out.length < 800);
  return out;
}

async function extractText(f) {
  const base = `https://www.googleapis.com/drive/v3/files/${f.id}`;
  if (f.mimeType === MIME.gdoc || f.mimeType === MIME.gslides) return (await gfetch(`${base}/export?mimeType=text/plain`)).text();
  if (f.mimeType === MIME.gsheet) return (await gfetch(`${base}/export?mimeType=text/csv`)).text();
  if (Number(f.size || 0) > 15e6) return '';
  if (f.mimeType === MIME.pdf) {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    return (await pdf(await gfetch(`${base}?alt=media&supportsAllDrives=true`, true))).text;
  }
  if (f.mimeType === MIME.docx) {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer: await gfetch(`${base}?alt=media&supportsAllDrives=true`, true) })).value;
  }
  if (/^text\//.test(f.mimeType)) return (await gfetch(`${base}?alt=media&supportsAllDrives=true`)).text();
  return null; // format non pris en charge (images, vidéos…)
}

function chunk(text, size = 1200, overlap = 200) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const out = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    out.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return out.filter(c => c.replace(/\s/g, '').length > 60);
}

let indexing = false;
async function reindexDrive({ full = false } = {}) {
  if (!cfg.serviceAccount) return { error: 'Compte de service Google non configuré (GOOGLE_SERVICE_ACCOUNT_JSON).' };
  if (indexing) return { error: 'Indexation déjà en cours.' };
  indexing = true;
  const status = { startedAt: new Date().toISOString(), files: 0, indexed: 0, skipped: [], errors: [], chunks: 0 };
  try {
    const files = await listFolder(cfg.driveFolderId);
    status.files = files.length;
    const existing = Object.fromEntries((await store.list('docs')).map(d => [d.id, d]));
    const seen = new Set();
    for (const f of files) {
      seen.add(f.id);
      const prev = existing[f.id];
      if (!full && prev && prev.modifiedTime === f.modifiedTime) { status.chunks += prev.chunks.length; continue; }
      try {
        const text = await extractText(f);
        if (text == null) { status.skipped.push(f.name); continue; }
        const chunks = chunk(text);
        if (!chunks.length) { status.skipped.push(`${f.name} (vide ou scanné)`); continue; }
        await store.put('docs', f.id, { id: f.id, name: f.name, link: f.webViewLink, modifiedTime: f.modifiedTime, chunks });
        status.indexed++; status.chunks += chunks.length;
      } catch (e) { status.errors.push(`${f.name} : ${e.message.slice(0, 120)}`); }
    }
    for (const id of Object.keys(existing)) if (!seen.has(id)) await store.del('docs', id);
  } catch (e) { status.errors.push(e.message); }
  finally { indexing = false; }
  status.finishedAt = new Date().toISOString();
  await store.kv.set('driveIndex', status);
  require('./knowledge').rebuild().catch(() => {});
  console.log(`[drive] ${status.files} fichiers, ${status.indexed} (ré)indexés, ${status.chunks} extraits, ${status.errors.length} erreurs`);
  return status;
}

module.exports = { syncSheets, seedIfEmpty, reindexDrive };
