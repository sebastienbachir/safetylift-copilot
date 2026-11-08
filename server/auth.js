// Sessions signées (cookie httpOnly) + rôles technicien / manager, vérifiés côté serveur.
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');

const COOKIE = 'sl_session';
const MAX_AGE = 90 * 24 * 3600 * 1000; // 90 jours : appli terrain, on reste connecté

const sign = data => crypto.createHmac('sha256', cfg.sessionSecret).update(data).digest('base64url');
function makeToken(payload) {
  const data = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + MAX_AGE })).toString('base64url');
  return `${data}.${sign(data)}`;
}
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [data, sig] = tok.split('.');
  const expected = sign(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { const p = JSON.parse(Buffer.from(data, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

const MANAGER_RX = /\b(lta|rsc|manager|responsable|superviseur|chef|leader)\b/i;
const canBeManager = tech => cfg.managerIds.includes(tech.id) || MANAGER_RX.test(tech.fonction || '');

// Anti force brute : 8 essais / 15 min / IP
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(); const a = (attempts.get(ip) || []).filter(t => now - t < 15 * 60000);
  attempts.set(ip, a); return a.length >= 8;
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function login(req, res) {
  const ip = req.ip;
  if (tooMany(ip)) return res.status(429).json({ error: 'Trop d\'essais. Réessayez dans 15 minutes.' });
  const { userId, code } = req.body || {};
  const tech = await store.get('techs', userId);
  if (!tech || tech.actif === false) return res.status(400).json({ error: 'Choisissez votre nom dans la liste.' });
  let role = null;
  if (code && safeEq(code.trim(), cfg.managerCode) && canBeManager(tech)) role = 'manager';
  else if (code && safeEq(code.trim(), cfg.teamCode)) role = 'tech';
  if (!role) {
    attempts.get(ip).push(Date.now());
    return res.status(401).json({ error: safeEq((code || '').trim(), cfg.managerCode) ? 'Ce profil n\'a pas les droits manager.' : 'Code incorrect.' });
  }
  res.cookie(COOKIE, makeToken({ uid: tech.id, role }), { httpOnly: true, sameSite: 'lax', secure: cfg.isProd, maxAge: MAX_AGE });
  res.json({ ok: true, role });
}

function logout(req, res) { res.clearCookie(COOKIE); res.json({ ok: true }); }

async function attachUser(req, res, next) {
  const p = readToken(cookies(req)[COOKIE]);
  if (p) {
    const tech = await store.get('techs', p.uid);
    if (tech && tech.actif !== false) req.user = { ...tech, role: p.role, canManage: canBeManager(tech) };
  }
  next();
}
const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
const requireManager = (req, res, next) => req.user?.role === 'manager' ? next() : res.status(403).json({ error: 'Réservé aux managers.' });

module.exports = { login, logout, attachUser, requireUser, requireManager, canBeManager };
