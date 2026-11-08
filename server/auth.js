// Connexion : adresse e-mail + code personnel.
// 1re connexion : e-mail + code équipe (TEAM_CODE) → création obligatoire d'un code personnel.
// Le rôle manager vient de la fonction dans l'annuaire (LTA, RSC…) ou de MANAGER_IDS.
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');

const COOKIE = 'sl_session';
const MAX_AGE = 90 * 24 * 3600 * 1000; // 90 jours : appli terrain, on reste connecté
const SETUP_AGE = 15 * 60 * 1000;      // 15 min pour créer son code
const MIN_LEN = 6;

const sign = data => crypto.createHmac('sha256', cfg.sessionSecret).update(data).digest('base64url');
function makeToken(payload, age = MAX_AGE) {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + age })).toString('base64url');
  return `${data}.${sign(data)}`;
}
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [data, sig] = tok.split('.');
  const expected = sign(data);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { const p = JSON.parse(Buffer.from(data, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
const setCookie = (res, payload, age) => res.cookie(COOKIE, makeToken(payload, age), { httpOnly: true, sameSite: 'lax', secure: cfg.isProd, maxAge: age || MAX_AGE });

const MANAGER_RX = /\b(lta|rsc|manager|responsable|superviseur|chef|leader)\b/i;
const canBeManager = tech => cfg.managerIds.includes(tech.id) || MANAGER_RX.test(tech.fonction || '');

/* ----- Codes personnels (scrypt) ----- */
const hashCode = (code, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(code, salt, 32).toString('hex') });
function checkCode(code, cred) {
  const h = crypto.scryptSync(code, cred.salt, 32);
  return crypto.timingSafeEqual(h, Buffer.from(cred.hash, 'hex'));
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Anti force brute : 8 essais / 15 min, par IP et par adresse
const attempts = new Map();
function tooMany(...keys) {
  const now = Date.now();
  return keys.some(k => { const a = (attempts.get(k) || []).filter(t => now - t < 15 * 60000); attempts.set(k, a); return a.length >= 8; });
}
const fail = (...keys) => keys.forEach(k => (attempts.get(k) || attempts.set(k, []).get(k)).push(Date.now()));

async function findByEmail(email) {
  const mail = String(email || '').trim().toLowerCase();
  if (!mail) return null;
  const tech = (await store.list('techs')).find(t => (t.email || '').toLowerCase() === mail);
  return tech && tech.actif !== false ? tech : null;
}

async function login(req, res) {
  const { email, code } = req.body || {};
  const key = 'm:' + String(email || '').trim().toLowerCase();
  if (tooMany(req.ip, key)) return res.status(429).json({ error: 'Trop d\'essais. Réessaie dans 15 minutes.' });
  const tech = await findByEmail(email);
  const c = String(code || '').trim();
  if (!tech || !c) { fail(req.ip, key); return res.status(401).json({ error: 'Adresse e-mail ou code incorrect.' }); }

  const cred = await store.get('creds', tech.id);
  if (cred) {
    if (!checkCode(c, cred)) { fail(req.ip, key); return res.status(401).json({ error: 'Adresse e-mail ou code incorrect.' }); }
    setCookie(res, { uid: tech.id });
    return res.json({ ok: true });
  }
  // Pas encore de code personnel : seul le code équipe est accepté, puis création du code
  if (!safeEq(c, cfg.teamCode)) { fail(req.ip, key); return res.status(401).json({ error: 'Première connexion : utilise le code équipe.' }); }
  setCookie(res, { uid: tech.id, setup: true }, SETUP_AGE);
  res.json({ ok: true, needPassword: true, prenom: tech.nom.split(' ')[0] });
}

// Création (1re connexion) ou changement du code personnel
async function setPassword(req, res) {
  const p = readToken(cookies(req)[COOKIE]);
  const tech = p && (await store.get('techs', p.uid));
  if (!tech || tech.actif === false) return res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
  const { password, current } = req.body || {};
  const pw = String(password || '');
  if (!p.setup) {
    const cred = await store.get('creds', tech.id);
    if (cred && !checkCode(String(current || ''), cred)) return res.status(400).json({ error: 'Code actuel incorrect.' });
  }
  if (pw.length < MIN_LEN) return res.status(400).json({ error: `Au moins ${MIN_LEN} caractères.` });
  if (safeEq(pw.trim(), cfg.teamCode)) return res.status(400).json({ error: 'Choisis un code différent du code équipe.' });
  await store.put('creds', tech.id, { uid: tech.id, ...hashCode(pw), at: new Date().toISOString() });
  setCookie(res, { uid: tech.id });
  res.json({ ok: true });
}

// Un manager efface le code d'un collègue (oubli) : il se reconnectera avec le code équipe
async function resetPassword(req, res) {
  const tech = await store.get('techs', req.params.id);
  if (!tech) return res.status(404).json({ error: 'Membre introuvable.' });
  await store.del('creds', tech.id);
  res.json({ ok: true });
}

function logout(req, res) { res.clearCookie(COOKIE); res.json({ ok: true }); }

async function attachUser(req, res, next) {
  const p = readToken(cookies(req)[COOKIE]);
  if (p && !p.setup) {
    const tech = await store.get('techs', p.uid);
    if (tech && tech.actif !== false) {
      const mgr = canBeManager(tech);
      req.user = { ...tech, role: mgr ? 'manager' : 'tech', canManage: mgr };
    }
  }
  next();
}
const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Session expirée, reconnecte-toi.' });
const requireManager = (req, res, next) => req.user?.role === 'manager' ? next() : res.status(403).json({ error: 'Réservé aux managers.' });

module.exports = { login, logout, setPassword, resetPassword, attachUser, requireUser, requireManager, canBeManager };
