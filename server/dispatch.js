// Diffusion de la minute sécurité : Teams (webhook Power Automate) + e-mail (Brevo), planifiée le lundi 08:35.
const cfg = require('./config');
const store = require('./store');
const { parisParts, isoWeek, minuteNumberForWeek, uid } = require('./util');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function teamsPayload(m, { test = false } = {}) {
  const title = `${test ? '[TEST] ' : ''}Minute sécurité — semaine ${m.id}/52`;
  const appLink = cfg.appUrl ? `${cfg.appUrl}/#minute` : null;
  const actions = [
    ...(appLink ? [{ type: 'Action.OpenUrl', title: '✅ Lire et valider dans SafetyLift', url: appLink }] : []),
    { type: 'Action.OpenUrl', title: '🚨 Déclarer une situation dangereuse', url: appLink ? `${cfg.appUrl}/#signaler` : cfg.formUrl },
  ];
  return {
    // champs simples pour un flux Power Automate personnalisé
    title, titre: title, theme: m.theme, message: m.message, consigne: m.message, risque: m.risque, semaine: m.id,
    date: new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }), lienFormulaire: cfg.formUrl, lienApp: appLink,
    text: `🦺 **${title}**\n\n**${m.theme}**\n\n${m.message}\n\n⚠️ Risque : ${m.risque}`,
    // carte adaptative (flux "Publier une carte" ou webhook entrant)
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
        body: [
          { type: 'TextBlock', text: `🦺 ${title.toUpperCase()}`, weight: 'Bolder', color: 'Warning', size: 'Medium' },
          { type: 'TextBlock', text: m.theme, weight: 'Bolder', size: 'Large', wrap: true },
          { type: 'TextBlock', text: m.message, wrap: true, spacing: 'Medium' },
          { type: 'FactSet', facts: [{ title: '⚠️ Risque ciblé', value: m.risque }, { title: 'Équipe', value: 'SAV Équipe 75' }] },
        ],
        actions,
      },
    }],
  };
}

async function sendTeams(m, opts) {
  if (!cfg.teamsWebhookUrl) return { ok: false, configured: false, error: 'TEAMS_WEBHOOK_URL non défini' };
  try {
    const r = await fetch(cfg.teamsWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(teamsPayload(m, opts)) });
    const body = (await r.text()).slice(0, 200);
    return r.ok ? { ok: true, configured: true, status: r.status } : { ok: false, configured: true, status: r.status, error: `HTTP ${r.status} ${body}` };
  } catch (e) { return { ok: false, configured: true, error: e.message }; }
}

async function sendMail({ to, subject, html, text }) {
  if (!cfg.brevoKey) return { ok: false, configured: false, error: 'BREVO_API_KEY non défini' };
  const list = [...new Set(to.filter(e => /@/.test(e)))];
  if (!list.length) return { ok: false, configured: true, error: 'aucun destinataire' };
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'content-type': 'application/json', 'api-key': cfg.brevoKey },
      body: JSON.stringify({ sender: { name: cfg.mailFromName, email: cfg.mailFrom }, to: [{ email: cfg.mailFrom, name: 'Équipe 75' }], bcc: list.map(email => ({ email })), subject, htmlContent: html, textContent: text }),
    });
    return r.ok ? { ok: true, configured: true, count: list.length } : { ok: false, configured: true, error: `Brevo ${r.status} ${(await r.text()).slice(0, 200)}` };
  } catch (e) { return { ok: false, configured: true, error: e.message }; }
}

/* ---------- SMS (Brevo, crédits SMS requis) ---------- */
const plain = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").replace(/[«»“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '');
function toIntl(tel) {
  let d = String(tel || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^0[67]\d{8}$/.test(d)) d = '33' + d.slice(1);
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}
function minuteSms(m, test) {
  const link = cfg.appUrl ? ` Lire : ${cfg.appUrl}/#minute` : '';
  const head = `${test ? '[TEST] ' : ''}Minute secu S${m.id} : `;
  const body = plain(`${m.theme}. Risque : ${m.risque}.`);
  const room = 160 - head.length - link.length;
  return head + (body.length > room ? body.slice(0, room - 3).trimEnd() + '...' : body) + link;
}
async function sendSms({ tels, content }) {
  if (!cfg.brevoKey || !cfg.smsSender) return { ok: false, configured: false, error: 'SMS non activés (SMS_SENDER)' };
  const list = [...new Set(tels.map(toIntl).filter(Boolean))];
  if (!list.length) return { ok: false, configured: true, error: 'aucun numéro valide' };
  let sent = 0; const errors = [];
  for (const recipient of list) {
    try {
      const r = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': cfg.brevoKey },
        body: JSON.stringify({ sender: cfg.smsSender, recipient, content, type: 'transactional', tag: 'minute-securite', unicodeEnabled: false }),
      });
      if (r.ok) sent++; else errors.push(`${r.status} ${(await r.text()).slice(0, 160)}`);
    } catch (e) { errors.push(e.message); }
  }
  return sent ? { ok: true, configured: true, count: sent, ...(errors.length ? { error: `${errors.length} échec(s) : ${errors[0]}` } : {}) } : { ok: false, configured: true, error: errors[0] || 'échec' };
}

function minuteMail(m, test) {
  const link = cfg.appUrl ? `${cfg.appUrl}/#minute` : '';
  return {
    subject: `${test ? '[TEST] ' : ''}🦺 Minute sécurité S${String(m.id).padStart(2, '0')} — ${m.theme}`,
    text: `Minute sécurité — semaine ${m.id}/52\n\n${m.theme}\n\n${m.message}\n\nRisque ciblé : ${m.risque}\n\n${link ? 'Valider la lecture : ' + link : ''}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e2e2e2;border-radius:10px;overflow:hidden">
      <div style="background:#1d1d1b;color:#fff;padding:16px 20px;border-bottom:4px solid #f5a300">
        <div style="font-size:12px;color:#f5a300">SafetyLift · Équipe 75</div>
        <div style="font-size:18px;font-weight:bold;margin-top:4px">Minute sécurité — semaine ${m.id}/52</div></div>
      <div style="padding:20px">
        <h2 style="margin:0 0 10px;font-size:20px;color:#1d1d1b">${esc(m.theme)}</h2>
        <p style="font-size:15px;line-height:1.6;color:#333">${esc(m.message)}</p>
        <p style="background:#fff4e0;border-left:4px solid #f5a300;padding:10px 12px;font-size:14px;color:#5a3b00"><b>Risque ciblé :</b> ${esc(m.risque)}</p>
        ${link ? `<p style="text-align:center;margin-top:22px"><a href="${link}" style="background:#f5a300;color:#1d1d1b;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">J'ai lu la minute</a></p>` : ''}
      </div></div>`,
  };
}

// test = e-mail au manager seul ; teamsToo = publie aussi la carte [TEST] dans le canal
async function dispatchMinute({ week, by = 'Automatique', test = false, teamsToo = false, user = null } = {}) {
  const n = minuteNumberForWeek(week ?? isoWeek().week);
  const m = await store.get('minutes', n);
  if (!m) throw new Error(`Minute ${n} introuvable`);
  const techs = (await store.list('techs')).filter(t => t.actif !== false);
  const recipients = test ? [user?.email].filter(Boolean) : techs.map(t => t.email);
  const teams = (!test || teamsToo) ? await sendTeams(m, { test }) : { ok: false, configured: !!cfg.teamsWebhookUrl, skipped: true };
  const mail = await sendMail({ to: recipients, ...minuteMail(m, test) });
  const tels = test ? [user?.tel].filter(Boolean) : techs.map(t => t.tel);
  const sms = cfg.smsSender ? await sendSms({ tels, content: minuteSms(m, test) }) : { ok: false, configured: false, skipped: true };
  const entry = { id: uid('d-'), at: new Date().toISOString(), minute: m.id, theme: m.theme, by, test, teams, mail, sms, recipients: recipients.length };
  await store.put('dispatchlog', entry.id, entry);
  if (!test && (teams.ok || mail.ok || sms.ok)) await store.put('minutes', m.id, { ...m, lastSent: entry.at });
  return entry;
}

/* ---------- Planification : lundi 08:35 (heure de Paris), avec rattrapage dans la semaine ---------- */
async function scheduleState() {
  return store.kv.get('schedule', { enabled: true, lastWeekKey: null, lastAt: null, lastResult: null });
}

async function checkSchedule(reason = 'horloge') {
  const s = await scheduleState();
  if (!s.enabled) return { skipped: 'désactivé' };
  const p = parisParts(); const wk = isoWeek();
  if (s.lastWeekKey === wk.key) return { skipped: 'déjà envoyée cette semaine' };
  const [hh, mm] = cfg.sendTime.split(':').map(Number);
  const isoDow = p.dow || 7; // 1 = lundi … 7 = dimanche
  const afterTime = isoDow > 1 || p.hour > hh || (p.hour === hh && p.minute >= mm);
  if (!afterTime || isoDow > 5) return { skipped: 'hors créneau' }; // pas de rattrapage le week-end
  if (!cfg.teamsWebhookUrl && !cfg.brevoKey) return { skipped: 'aucun canal configuré' };
  // Premier démarrage en cours de semaine : on ne diffuse pas par surprise, on attend lundi
  if (!s.initialized && isoDow > 1) {
    await store.kv.set('schedule', { ...s, initialized: true, lastWeekKey: wk.key });
    return { skipped: 'initialisation : premier envoi lundi prochain' };
  }
  // Après un échec, nouvel essai toutes les 15 min (pas à chaque minute)
  if (s.lastFailAt && Date.now() - new Date(s.lastFailAt) < 15 * 60000) return { skipped: 'nouvel essai bientôt' };
  const label = isoDow === 1 ? `Lundi ${cfg.sendTime}` : `Rattrapage (${reason})`;
  const entry = await dispatchMinute({ week: wk.week, by: label });
  const delivered = entry.teams.ok || entry.mail.ok || entry.sms.ok;
  await store.kv.set('schedule', { ...s, initialized: true, lastWeekKey: delivered ? wk.key : s.lastWeekKey, lastFailAt: delivered ? null : entry.at, lastAt: entry.at, lastResult: { teams: entry.teams.ok, mail: entry.mail.ok, sms: entry.sms.ok, minute: entry.minute } });
  console.log(`[planif] ${label} — minute ${entry.minute} : Teams ${entry.teams.ok ? 'OK' : 'KO'}, mail ${entry.mail.ok ? 'OK' : 'KO'}, SMS ${entry.sms.ok ? 'OK' : '—'}`);
  return entry;
}

function nextSend() {
  const [hh, mm] = cfg.sendTime.split(':').map(Number);
  const p = parisParts(); const isoDow = p.dow || 7;
  let days = (8 - isoDow) % 7;
  if (days === 0 && (p.hour > hh || (p.hour === hh && p.minute >= mm))) days = 7;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.day + days));
  return { date: d.toISOString().slice(0, 10), time: cfg.sendTime, inDays: days, week: isoWeek(new Date(Date.now() + days * 86400000)).week };
}

function startScheduler() {
  setTimeout(() => checkSchedule('démarrage').catch(e => console.error('[planif]', e.message)), 15000);
  setInterval(() => checkSchedule().catch(e => console.error('[planif]', e.message)), 60000);
}

module.exports = { dispatchMinute, sendTeams, sendMail, sendSms, minuteSms, toIntl, checkSchedule, scheduleState, nextSend, startScheduler, esc };
