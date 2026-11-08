// Notifications push de la PWA (gratuites). Clés VAPID générées une fois et gardées en base.
const crypto = require('crypto');
const webpush = require('web-push');
const cfg = require('./config');
const store = require('./store');

let ready = null;
function init() {
  ready ||= (async () => {
    let keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
      : await store.kv.get('vapid');
    if (!keys) { keys = webpush.generateVAPIDKeys(); await store.kv.set('vapid', keys); console.log('[push] clés VAPID créées'); }
    webpush.setVapidDetails(`mailto:${cfg.mailFrom}`, keys.publicKey, keys.privateKey);
    return keys;
  })();
  return ready;
}

const subId = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

async function publicKey() { return (await init()).publicKey; }

async function subscribe(uid, sub, ua = '') {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Abonnement invalide');
  const id = subId(sub.endpoint);
  await store.put('pushsubs', id, { id, uid, sub: { endpoint: sub.endpoint, keys: sub.keys }, ua: String(ua).slice(0, 120), at: new Date().toISOString() });
  return id;
}
const unsubscribe = endpoint => store.del('pushsubs', subId(endpoint));

// Envoie à tous les appareils (ou à ceux d'une liste d'utilisateurs)
async function send(payload, uids = null) {
  await init();
  let subs = await store.list('pushsubs');
  if (uids) subs = subs.filter(s => uids.includes(s.uid));
  if (!subs.length) return { ok: false, configured: true, count: 0, error: 'aucun appareil abonné' };
  let sent = 0, gone = 0; const errors = [];
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'normal' }); sent++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { gone++; await store.del('pushsubs', s.id); }
      else errors.push(`${e.statusCode || ''} ${e.body || e.message}`.trim().slice(0, 140));
    }
  }));
  const people = new Set(subs.map(s => s.uid)).size;
  return sent ? { ok: true, configured: true, count: sent, people, ...(errors.length ? { error: errors[0] } : {}) }
    : { ok: false, configured: true, count: 0, error: errors[0] || (gone ? 'abonnements expirés' : 'échec') };
}

async function stats() {
  const subs = await store.list('pushsubs');
  return { devices: subs.length, people: [...new Set(subs.map(s => s.uid))] };
}

module.exports = { init, publicKey, subscribe, unsubscribe, send, stats };
