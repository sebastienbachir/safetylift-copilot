const express = require('express');
const path = require('path');
const cfg = require('./config');
const store = require('./store');
const auth = require('./auth');
const google = require('./google');
const kb = require('./knowledge');
const ai = require('./ai');
const dispatch = require('./dispatch');
const { isoWeek, minuteNumberForWeek, uid } = require('./util');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; frame-ancestors 'none'" });
  next();
});
app.use(auth.attachUser);

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(`[${req.method} ${req.path}]`, e); res.status(500).json({ error: e.message || 'Erreur serveur' }); });
const { requireUser: U, requireManager: M } = auth;
const pub = t => ({ id: t.id, nom: t.nom, fonction: t.fonction, binome: t.binome, tel: t.tel, email: t.email, secteur: t.secteur, actif: t.actif !== false });

/* ---------- Public ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true, ai: cfg.aiProvider, db: !!process.env.DATABASE_URL, time: new Date().toISOString() }));
app.post('/api/login', wrap(auth.login));
app.post('/api/logout', auth.logout);

/* ---------- Appli ---------- */
app.get('/api/bootstrap', U, wrap(async (req, res) => {
  const wk = isoWeek();
  const [techs, minutes, faq, quiz, myRead, myScore] = await Promise.all([
    store.list('techs'), store.list('minutes'), store.list('faq'), store.list('quiz'),
    store.get('reads', `${wk.key}:${req.user.id}`), store.get('quizscores', `${wk.key}:${req.user.id}`),
  ]);
  res.json({
    me: { ...pub(req.user), role: req.user.role, canManage: req.user.canManage },
    week: { ...wk, minute: minuteNumberForWeek(wk.week) },
    techs: techs.map(pub).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    minutes: minutes.sort((a, b) => a.id - b.id), faq, quiz,
    myRead: !!myRead, myScore,
    links: { form: cfg.formUrl, teams: cfg.teamsChannelUrl, drive: cfg.driveFolderUrl },
    ai: cfg.aiProvider, docs: kb.stats().docChunks,
  });
}));

app.post('/api/minutes/read', U, wrap(async (req, res) => {
  const wk = isoWeek();
  await store.put('reads', `${wk.key}:${req.user.id}`, { weekKey: wk.key, minute: minuteNumberForWeek(wk.week), uid: req.user.id, at: new Date().toISOString() });
  res.json({ ok: true });
}));

// Copilote
const chatHits = new Map();
app.post('/api/chat', U, wrap(async (req, res) => {
  const now = Date.now(); const h = (chatHits.get(req.user.id) || []).filter(t => now - t < 5 * 60000);
  if (h.length >= 30) return res.status(429).json({ error: 'Trop de questions en peu de temps, patiente une minute.' });
  h.push(now); chatHits.set(req.user.id, h);
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: 'Message vide' });
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
  try { res.json(await ai.chat({ user: req.user, message, history })); }
  catch (e) {
    console.error('[chat]', e.message);
    const fiche = await kb.matchFiche(message);
    res.json(fiche ? { reply: `**${fiche.titre}**\n\n${fiche.reponse}`, mode: 'fiche', sources: [], degraded: true }
      : { reply: "L'IA ne répond pas pour le moment. En cas de doute : consigne l'installation et appelle ton LTA.", mode: 'fallback', sources: [], degraded: true });
  }
}));

// Rectifications → règles (validées par un manager avant d'être utilisées)
app.post('/api/rules/propose', U, wrap(async (req, res) => {
  const correction = String(req.body?.correction || '').trim().slice(0, 2000);
  if (correction.length < 5) return res.status(400).json({ error: 'Précise la bonne information.' });
  let r; try { r = await ai.extractRule({ previous: req.body?.previous, correction }); } catch { r = { topic: correction.slice(0, 60), knowledge: correction, category: 'technique', keywords: [] }; }
  const isMgr = req.user.role === 'manager';
  const rule = { id: uid('r-'), topic: r.topic, category: r.category || 'technique', wrong: r.wrong || '', knowledge: r.knowledge || correction, keywords: r.keywords || [],
    status: isMgr ? 'actif' : 'en_attente', author: req.user.nom, raw: correction, createdAt: new Date().toISOString(), validatedBy: isMgr ? req.user.nom : null };
  await store.put('rules', rule.id, rule);
  if (isMgr) await kb.rebuild();
  res.json(rule);
}));
app.get('/api/rules', U, wrap(async (req, res) => {
  const all = await store.list('rules');
  res.json(req.user.role === 'manager' ? all : all.filter(r => r.status === 'actif' || r.author === req.user.nom));
}));
app.patch('/api/rules/:id', U, M, wrap(async (req, res) => {
  const r = await store.get('rules', req.params.id); if (!r) return res.status(404).json({ error: 'Règle introuvable' });
  const b = req.body || {};
  const next = { ...r, ...(b.topic ? { topic: b.topic } : {}), ...(b.knowledge ? { knowledge: b.knowledge } : {}), ...(b.status ? { status: b.status, validatedBy: req.user.nom } : {}) };
  await store.put('rules', r.id, next); await kb.rebuild(); res.json(next);
}));
app.delete('/api/rules/:id', U, M, wrap(async (req, res) => { await store.del('rules', req.params.id); await kb.rebuild(); res.json({ ok: true }); }));

// Situations dangereuses / presqu'accidents
app.post('/api/incidents', U, wrap(async (req, res) => {
  const b = req.body || {};
  const inc = { id: uid('i-'), at: new Date().toISOString(), author: req.user.nom, authorId: req.user.id,
    site: String(b.site || '').slice(0, 200), marque: String(b.marque || '').slice(0, 40), danger: String(b.danger || '').slice(0, 200),
    gravite: ['Faible', 'Moyenne', 'Élevée', 'Critique'].includes(b.gravite) ? b.gravite : 'Moyenne',
    description: String(b.description || '').slice(0, 3000), mesures: String(b.mesures || '').slice(0, 1000),
    photo: /^data:image\/(jpeg|png|webp);base64,/.test(b.photo || '') && b.photo.length < 3e6 ? b.photo : null, statut: 'Nouveau' };
  if (!inc.site || !inc.description) return res.status(400).json({ error: 'Adresse/appareil et description sont obligatoires.' });
  inc.analysis = await ai.analyzeIncident(inc);
  await store.put('incidents', inc.id, inc);
  const mail = await dispatch.sendMail({ to: cfg.incidentEmails,
    subject: `🚨 Situation dangereuse (${inc.gravite}) — ${inc.site}`,
    text: `${inc.author} déclare une situation à risque.\nAppareil : ${inc.site} (${inc.marque})\nDanger : ${inc.danger}\nGravité : ${inc.gravite}\n\n${inc.description}\n\nMesures prises : ${inc.mesures || '—'}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px">${['Déclarant', inc.author, 'Appareil / adresse', inc.site, 'Marque', inc.marque, 'Danger', inc.danger, 'Gravité', inc.gravite].reduce((a, v, i, arr) => i % 2 ? a : a + `<p style="margin:4px 0"><b>${arr[i]} :</b> ${dispatch.esc(arr[i + 1])}</p>`, '<h2 style="color:#c62828">Situation dangereuse déclarée</h2>')}
      <p style="background:#f6f6f6;padding:12px;border-radius:6px;white-space:pre-line">${dispatch.esc(inc.description)}</p>
      <p><b>Mesures conservatoires :</b> ${dispatch.esc(inc.mesures || '—')}</p>
      <p><b>Actions suggérées :</b><br>${(inc.analysis.actions || []).map(a => '• ' + dispatch.esc(a)).join('<br>')}</p>
      ${cfg.appUrl ? `<p><a href="${cfg.appUrl}/#pilotage">Ouvrir dans SafetyLift</a></p>` : ''}</div>` });
  const { photo, ...light } = inc;
  res.json({ ...light, hasPhoto: !!photo, notified: mail.ok });
}));
app.get('/api/incidents', U, wrap(async (req, res) => {
  let list = await store.list('incidents');
  if (req.user.role !== 'manager') list = list.filter(i => i.authorId === req.user.id);
  res.json(list.sort((a, b) => b.at.localeCompare(a.at)).map(({ photo, ...i }) => ({ ...i, hasPhoto: !!photo })));
}));
app.get('/api/incidents/:id/photo', U, wrap(async (req, res) => {
  const i = await store.get('incidents', req.params.id);
  if (!i?.photo || (req.user.role !== 'manager' && i.authorId !== req.user.id)) return res.status(404).end();
  const [meta, b64] = i.photo.split(','); res.type(meta.slice(5, meta.indexOf(';'))).send(Buffer.from(b64, 'base64'));
}));
app.patch('/api/incidents/:id', U, M, wrap(async (req, res) => {
  const i = await store.get('incidents', req.params.id); if (!i) return res.status(404).json({ error: 'Introuvable' });
  const statut = ['Nouveau', 'En analyse', 'Action en cours', 'Clôturé'].includes(req.body?.statut) ? req.body.statut : i.statut;
  const next = { ...i, statut, note: req.body?.note ?? i.note, updatedBy: req.user.nom, updatedAt: new Date().toISOString() };
  await store.put('incidents', i.id, next); const { photo, ...light } = next; res.json({ ...light, hasPhoto: !!photo });
}));

// Quiz
app.post('/api/quiz/score', U, wrap(async (req, res) => {
  const wk = isoWeek(); const score = Number(req.body?.score) || 0, total = Number(req.body?.total) || 0;
  const prev = await store.get('quizscores', `${wk.key}:${req.user.id}`);
  const best = !prev || score >= prev.score ? { weekKey: wk.key, uid: req.user.id, nom: req.user.nom, score, total, at: new Date().toISOString() } : prev;
  await store.put('quizscores', `${wk.key}:${req.user.id}`, best); res.json(best);
}));

/* ---------- Pilotage manager ---------- */
app.get('/api/admin/overview', U, M, wrap(async (req, res) => {
  const wk = isoWeek();
  const [techs, reads, scores, incidents, rules, logs, sched, sheets, drive] = await Promise.all([
    store.list('techs'), store.list('reads'), store.list('quizscores'), store.list('incidents'), store.list('rules'), store.list('dispatchlog'),
    dispatch.scheduleState(), store.kv.get('sheetsSync'), store.kv.get('driveIndex')]);
  const active = techs.filter(t => t.actif !== false);
  const readSet = new Map(reads.filter(r => r.weekKey === wk.key).map(r => [r.uid, r.at]));
  const scoreMap = new Map(scores.filter(s => s.weekKey === wk.key).map(s => [s.uid, s]));
  res.json({
    week: { ...wk, minute: minuteNumberForWeek(wk.week) },
    team: active.map(t => ({ id: t.id, nom: t.nom, readAt: readSet.get(t.id) || null, quiz: scoreMap.get(t.id) || null })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    schedule: { ...sched, next: dispatch.nextSend(), sendTime: cfg.sendTime },
    logs: logs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12),
    incidents: { open: incidents.filter(i => i.statut !== 'Clôturé').length, total: incidents.length },
    rulesPending: rules.filter(r => r.status === 'en_attente').length,
    channels: { teams: !!cfg.teamsWebhookUrl, mail: !!cfg.brevoKey, ai: cfg.aiProvider, google: !!cfg.serviceAccount, db: !!process.env.DATABASE_URL, cron: !!cfg.cronSecret },
    sheets, drive, index: kb.stats(),
  });
}));
app.post('/api/admin/dispatch', U, M, wrap(async (req, res) => {
  const b = req.body || {};
  const entry = await dispatch.dispatchMinute({ week: b.week ? Number(b.week) : undefined, by: req.user.nom, test: !!b.test, teamsToo: !!b.teamsToo, user: req.user });
  if (!b.test && !b.week && (entry.teams.ok || entry.mail.ok)) {
    const s = await dispatch.scheduleState(); await store.kv.set('schedule', { ...s, lastWeekKey: isoWeek().key, lastAt: entry.at, lastResult: { teams: entry.teams.ok, mail: entry.mail.ok, minute: entry.minute } });
  }
  res.json(entry);
}));
app.post('/api/admin/schedule', U, M, wrap(async (req, res) => {
  const s = await dispatch.scheduleState(); const next = { ...s, enabled: !!req.body?.enabled }; await store.kv.set('schedule', next); res.json(next);
}));
app.post('/api/admin/sync-sheets', U, M, wrap(async (req, res) => { const r = await google.syncSheets(); await kb.rebuild(); res.json(r); }));
app.post('/api/admin/reindex', U, M, wrap(async (req, res) => {
  if (!cfg.serviceAccount) return res.status(400).json({ error: 'Ajoute GOOGLE_SERVICE_ACCOUNT_JSON sur Render et partage le dossier Drive avec le compte de service.' });
  google.reindexDrive({ full: !!req.body?.full }); res.json({ started: true });
}));
app.post('/api/admin/quiz', U, M, wrap(async (req, res) => {
  if (!cfg.aiProvider) return res.status(400).json({ error: 'Aucune IA configurée.' });
  const theme = String(req.body?.theme || '').slice(0, 200) || 'Sécurité en intervention';
  const q = { id: uid('gen-'), ...(await ai.generateQuiz(theme)), theme, by: req.user.nom };
  await store.put('quiz', q.id, q); res.json(q);
}));
app.delete('/api/admin/quiz/:id', U, M, wrap(async (req, res) => { await store.del('quiz', req.params.id); res.json({ ok: true }); }));
app.get('/api/admin/causerie', U, M, wrap(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
  const [incidents, logs, reads, scores, techs, minutes, rules] = await Promise.all(['incidents', 'dispatchlog', 'reads', 'quizscores', 'techs', 'minutes', 'rules'].map(c => store.list(c)));
  const inMonth = x => (x.at || x.createdAt || '').startsWith(month);
  const monthIncidents = incidents.filter(inMonth).map(({ photo, ...i }) => i);
  const sent = logs.filter(l => inMonth(l) && !l.test && (l.teams?.ok || l.mail?.ok));
  const sentMinutes = [...new Set(sent.map(l => l.minute))].map(n => minutes.find(m => m.id === n)).filter(Boolean);
  const active = techs.filter(t => t.actif !== false).length;
  const monthReads = reads.filter(inMonth); const monthScores = scores.filter(inMonth);
  const stats = {
    month, team: active,
    incidents: monthIncidents.length, bySeverity: ['Critique', 'Élevée', 'Moyenne', 'Faible'].map(g => [g, monthIncidents.filter(i => i.gravite === g).length]),
    topIncidents: monthIncidents.sort((a, b) => (b.analysis?.riskScore || 0) - (a.analysis?.riskScore || 0)).slice(0, 3)
      .map(i => ({ site: i.site, marque: i.marque, danger: i.danger, gravite: i.gravite, description: i.description.slice(0, 300), action: i.analysis?.actions?.[0], statut: i.statut })),
    minutes: sentMinutes.map(m => ({ id: m.id, theme: m.theme, risque: m.risque })),
    readRate: sentMinutes.length && active ? Math.round(100 * monthReads.length / (sentMinutes.length * active)) : null,
    quiz: monthScores.length ? { participants: new Set(monthScores.map(s => s.uid)).size, avg: Math.round(100 * monthScores.reduce((a, s) => a + s.score / (s.total || 1), 0) / monthScores.length) } : null,
    newRules: rules.filter(r => r.status === 'actif' && inMonth(r)).map(r => r.topic),
  };
  stats.synthesis = req.query.ai === '1' ? await ai.causerieSynthesis(stats) : null;
  res.json(stats);
}));

/* ---------- Déclencheur externe (n8n, Render Cron, UptimeRobot…) ---------- */
app.all('/api/cron/weekly', wrap(async (req, res) => {
  if (!cfg.cronSecret || req.query.key !== cfg.cronSecret) return res.status(403).json({ error: 'clé invalide' });
  res.json(await dispatch.checkSchedule('déclencheur externe'));
}));

/* ---------- Front ---------- */
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, p) => { if (/sw\.js$|index\.html$|manifest/.test(p)) res.set('Cache-Control', 'no-cache'); },
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

(async () => {
  await store.init();
  await google.seedIfEmpty();
  await kb.rebuild();
  app.listen(cfg.port, () => console.log(`SafetyLift Copilot sur :${cfg.port} — IA : ${cfg.aiProvider || 'aucune'}`));
  google.syncSheets().then(() => kb.rebuild()).catch(e => console.warn('[sheets]', e.message));
  setInterval(() => google.syncSheets().then(() => kb.rebuild()).catch(() => {}), 6 * 3600e3);
  if (cfg.serviceAccount) { setTimeout(() => google.reindexDrive(), 30000); setInterval(() => google.reindexDrive(), 24 * 3600e3); }
  dispatch.startScheduler();
})().catch(e => { console.error('Démarrage impossible :', e); process.exit(1); });
