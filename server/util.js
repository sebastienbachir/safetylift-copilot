// Outils partagés : dates Paris, CSV, normalisation de texte.

function parisParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const y = +p.year, m = +p.month, day = +p.day;
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 = dimanche
  return { y, m, day, hour: +p.hour % 24, minute: +p.minute, dow, dateKey: `${p.year}-${p.month}-${p.day}` };
}

// Semaine ISO (année ISO + n°), calculée sur la date de Paris
function isoWeek(d = new Date()) {
  const { y, m, day } = parisParts(d);
  const t = new Date(Date.UTC(y, m - 1, day));
  const dn = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dn);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - ys) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week, key: `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}
// Minute du programme correspondant à une semaine (53 → 52)
const minuteNumberForWeek = w => Math.min(Math.max(w, 1), 52);

function parseCSV(text) {
  const rows = []; let row = ['']; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"') { if (q && n === '"') { row[row.length - 1] += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) row.push('');
    else if ((c === '\n' || c === '\r') && !q) { if (c === '\r' && n === '\n') i++; rows.push(row); row = ['']; }
    else row[row.length - 1] += c;
  }
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const STOP = new Set('le la les un une des du de d l a au aux et ou en est sont pour par sur dans avec sans ce cet cette ces que qui quoi quel quelle quels quelles comment je tu il elle on nous vous ils elles me te se mon ma mes ton ta tes son sa ses leur leurs y ne pas plus faut faire fait doit dois peut peux quand si mais donc car tout tous toute toutes etre avoir ai as avez ont c qu n s j m t moi toi lui bonjour salut merci stp svp'.split(' '));
function tokens(s) {
  return norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !STOP.has(t)).map(t => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t));
}

const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

module.exports = { parisParts, isoWeek, minuteNumberForWeek, parseCSV, norm, tokens, uid };
