// Recherche BM25 en mémoire sur : fiches réflexes, règles validées par les managers, extraits de la doc Drive.
const store = require('./store');
const { tokens, norm } = require('./util');

let docs = []; // { kind, title, text, link, tf: Map, len }
let df = new Map(); let avgLen = 1;

async function rebuild() {
  const items = [];
  for (const f of await store.list('faq')) items.push({ kind: 'fiche', title: f.titre, text: `${f.titre}\n${f.motsCles}\n${f.reponse}`, id: f.id });
  for (const r of (await store.list('rules')).filter(r => r.status === 'actif')) items.push({ kind: 'regle', title: r.topic, text: `${r.topic}\n${(r.keywords || []).join(' ')}\n${r.knowledge}` });
  for (const d of await store.list('docs')) d.chunks.forEach((c, i) => items.push({ kind: 'doc', title: d.name, link: d.link, text: c, part: i + 1 }));
  df = new Map(); let total = 0;
  for (const it of items) {
    const tk = tokens(it.title + ' ' + it.title + ' ' + it.text); // titre compté double
    it.tf = new Map(); tk.forEach(t => it.tf.set(t, (it.tf.get(t) || 0) + 1));
    it.len = tk.length; total += tk.length;
    for (const t of it.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  avgLen = total / Math.max(items.length, 1);
  docs = items;
  return { items: items.length };
}

function search(query, k = 6, kinds = null) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const N = docs.length, k1 = 1.4, b = 0.75;
  const scored = [];
  for (const d of docs) {
    if (kinds && !kinds.includes(d.kind)) continue;
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t); if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avgLen));
    }
    if (s > 0) scored.push({ ...d, score: s, tf: undefined });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

// Correspondance directe sur les mots-clés d'une fiche (réponse instantanée sans IA)
async function matchFiche(query) {
  const q = norm(query);
  for (const f of await store.list('faq')) {
    const keys = norm(f.motsCles).split(',').map(s => s.trim()).filter(s => s.length > 2);
    if (keys.some(k => q.includes(k))) return f;
  }
  return null;
}

const stats = () => ({ items: docs.length, docChunks: docs.filter(d => d.kind === 'doc').length });

module.exports = { rebuild, search, matchFiche, stats };
