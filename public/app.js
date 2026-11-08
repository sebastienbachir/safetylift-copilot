/* SafetyLift Copilot — PWA Équipe 75 */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const initials = n => String(n).split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const fmtTel = t => String(t || '').replace(/\D/g, '').replace(/(\d{2})(?=\d)/g, '$1 ');
const fmtDate = (d, o = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) => new Date(d).toLocaleString('fr-FR', o);

const S = {
  data: null,          // /api/bootstrap
  chat: JSON.parse(sessionStorage.getItem('sl_chat') || '[]'),
  voiceOut: localStorage.getItem('sl_voice') === '1',
  installEvt: null,
};

/* ---------------- Icônes ---------------- */
const ICONS = {
  roof: '<path d="M3 10l9-6 9 6M5 10v10h14V10M9 20v-6h6v6"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  pit: '<path d="M4 4v16h16V4M8 4v10M16 4v10M4 14h16M10 18h4"/>',
  people: '<path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M22 20a6 6 0 0 0-5-5.9"/>',
  stop: '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8zM8 12h8"/>',
  helmet: '<path d="M3 17h18M4 17a8 8 0 0 1 16 0M12 5v5M9 7v4M15 7v4"/>',
  stairs: '<path d="M3 20h5v-5h5v-5h5V5h3"/>',
  alert: '<path d="M12 3l10 18H2zM12 10v5M12 18h.01"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"/>',
  doc: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/>',
  phone: '<path d="M5 3h4l2 5-3 2a11 11 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  quiz: '<path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',
  calendar: '<path d="M4 6h16v15H4zM4 10h16M8 3v4M16 3v4"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  teams: '<path d="M4 6h11v12H4zM8 9h5M10.5 9v7M17 9h3v6a2 2 0 0 1-2 2h-1"/>',
  mic: '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M4 12l16-8-6 16-2-7z"/>',
};
const icon = (k, cls = 'ic') => `<span class="${cls}"><svg viewBox="0 0 24 24">${ICONS[k] || ICONS.doc}</svg></span>`;

/* ---------------- Texte enrichi (sous-ensemble markdown, échappé) ---------------- */
function md(text) {
  const lines = esc(text).split('\n');
  let html = '', list = null;
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[(Doc|Fiche|Règle validée) : ([^\]]+)\]/g, '<span class="cite">$1 · $2</span>');
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trim();
    let m;
    if ((m = l.match(/^(\d+)[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[2])}</li>`; }
    else if ((m = l.match(/^[-•*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h3>${inline(m[1])}</h3>`; }
    else if (!l) close();
    else { close(); html += `<p>${inline(l)}</p>`; }
  }
  close();
  return html;
}

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const r = await fetch(path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: opts.body ? { 'content-type': 'application/json' } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  if (r.status === 401 && !opts.noAuthRedirect) { showLogin(); throw new Error('Session expirée'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
  return j;
}

function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

function openSheet(title, bodyHtml, onMount) {
  const d = $('#sheet');
  d.innerHTML = `<div class="sheet-inner"><div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>${bodyHtml}</div>`;
  d.querySelector('[data-close]').onclick = () => d.close();
  d.onclick = e => { if (e.target === d) d.close(); };
  d.showModal(); onMount && onMount(d);
  return d;
}

function confirmSheet(title, text, okLabel) {
  return new Promise(res => {
    let done = false;
    const d = openSheet(title, `<p>${esc(text)}</p><div class="row" style="margin-top:14px"><button class="btn ghost block" id="cf-no">Annuler</button><button class="btn amber block" id="cf-ok">${esc(okLabel)}</button></div>`, d => {
      $('#cf-ok', d).onclick = () => { done = true; d.close(); res(true); };
      $('#cf-no', d).onclick = () => d.close();
    });
    d.addEventListener('close', () => { if (!done) res(false); }, { once: true });
  });
}

/* ---------------- Données & démarrage ---------------- */
async function boot() {
  applyTheme();
  registerSW();
  window.addEventListener('online', netState); window.addEventListener('offline', netState); netState();
  $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('#btn-menu').onclick = openMenu;
  window.addEventListener('hashchange', render);

  const cached = localStorage.getItem('sl_boot');
  if (cached) { S.data = JSON.parse(cached); afterData(); render(); }
  try {
    S.data = await api('/api/bootstrap', { noAuthRedirect: true });
    localStorage.setItem('sl_boot', JSON.stringify(S.data));
    afterData(); render(); flushOutbox();
  } catch (e) {
    if (/Session/.test(e.message) || !cached) {
      if (navigator.onLine) showLogin(); else if (!cached) $('#view').innerHTML = '<div class="empty">Première connexion impossible hors ligne.</div>';
    }
  }
}

function afterData() {
  document.body.classList.remove('logged-out');
  $('#app').hidden = false; $('#login')?.remove();
  $('#btn-pilotage').hidden = S.data.me.role !== 'manager';
}

function netState() { $('#net').hidden = navigator.onLine; if (navigator.onLine) flushOutbox(); }

function go(route) { if (location.hash === '#' + route) render(); else location.hash = route; }

function render() {
  if (!S.data) return;
  const h = location.hash.slice(1) || 'accueil', cut = h.indexOf('-');
  const route = cut < 0 ? h : h.slice(0, cut), arg = cut < 0 ? '' : h.slice(cut + 1);
  const views = { accueil: vAccueil, minute: vMinute, fiches: vFiches, fiche: vFiche, copilote: vCopilote, signaler: vSignaler, equipe: vEquipe, quiz: vQuiz, pilotage: vPilotage, causerie: vCauserie, signalements: vMesSignalements };
  const fn = views[route] || vAccueil;
  if ((route === 'pilotage' || route === 'causerie') && S.data.me.role !== 'manager') return go('accueil');
  const tab = { minute: 'accueil', quiz: 'accueil', fiche: 'fiches', signalements: 'signaler', causerie: 'accueil', pilotage: 'accueil' }[route] || route;
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.go === tab));
  document.querySelector('.composer')?.remove();
  window.scrollTo(0, 0);
  fn(arg);
  $('#view').focus({ preventScroll: true });
}

/* ---------------- Connexion ---------------- */
async function showLogin() {
  $('#app').hidden = true; document.body.classList.add('logged-out');
  if ($('#login')) return;
  const div = document.createElement('div');
  div.id = 'login'; div.className = 'login';
  div.innerHTML = `<form class="login-box" autocomplete="on">
    <h1>SafetyLift<small>Équipe 75 · TK Elevator</small></h1>
    <div class="stripe"></div>
    <div class="field"><label class="f" for="lg-mail">Adresse e-mail</label>
      <input id="lg-mail" class="input" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" required placeholder="prenom.nom@tkelevator.com"></div>
    <div class="field"><label class="f" for="lg-code">Code d'accès</label>
      <input id="lg-code" class="input" type="password" inputmode="text" autocomplete="current-password" required placeholder="Code équipe ou code manager"></div>
    <p class="err" id="lg-err"></p>
    <button class="btn amber block" type="submit">Entrer</button>
    <p class="small" style="color:#9aa3ad;margin-top:16px">Utilise ton adresse TKE. Le code équipe ouvre l'espace technicien ; les LTA et RSC utilisent le code manager pour le pilotage.</p>
  </form>`;
  document.body.appendChild(div);
  const last = localStorage.getItem('sl_last_mail'); if (last) { $('#lg-mail').value = last; setTimeout(() => $('#lg-code').focus(), 50); }
  div.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const email = $('#lg-mail').value.trim(), code = $('#lg-code').value;
    $('#lg-err').textContent = '';
    try {
      await api('/api/login', { body: { email, code }, noAuthRedirect: true });
      localStorage.setItem('sl_last_mail', email);
      S.data = await api('/api/bootstrap'); localStorage.setItem('sl_boot', JSON.stringify(S.data));
      afterData(); go('accueil'); render();
    } catch (err) { $('#lg-err').textContent = err.message; }
  };
}

/* ---------------- Outils d'équipe ---------------- */
const techs = () => S.data.techs.filter(t => t.actif);
function findBinome(me = S.data.me) {
  if (!me.binome) return null;
  const b = norm(me.binome);
  return techs().find(t => t.id !== me.id && (norm(t.nom) === b || norm(t.nom).startsWith(b + ' ') || norm(t.nom).split(' ').includes(b))) || null;
}
const managers = () => techs().filter(t => /\b(lta|rsc|manager|responsable|superviseur)\b/i.test(t.fonction || ''));
const currentMinute = () => S.data.minutes.find(m => m.id === S.data.week.minute) || S.data.minutes[0];

/* ================= VUES ================= */

function vAccueil() {
  const me = S.data.me, m = currentMinute(), bin = findBinome(), lta = managers().filter(t => t.id !== me.id).slice(0, 1)[0];
  const hour = new Date().getHours();
  const hi = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  const quizDone = S.data.myScore;
  $('#view').innerHTML = `
    <div class="hello"><h1>${hi} ${esc(me.nom.split(' ')[0])}</h1><div class="muted">Semaine ${S.data.week.week} · objectif zéro accident</div></div>

    <section class="minute-hero" aria-labelledby="mh-t">
      <div class="kicker"><span>Minute sécurité de la semaine</span></div>
      <div class="week-no" aria-hidden="true">${m.id}</div>
      <h1 id="mh-t">${esc(m.theme)}</h1>
      <p class="mh-msg">${esc(m.message)}</p>
      <div class="risk">${esc(m.risque)}</div>
      ${S.data.myRead ? `<div class="read-done">✓ Lue et validée</div>` : `<button class="btn amber block" id="btn-read">J'ai lu la minute</button>`}
      <button class="link-btn" style="color:#b8bec5" data-go2="minute">Programme des 52 semaines</button>
    </section>

    <section class="hazard" aria-label="Urgence">
      <div class="hazard-inner">
        <div class="title">Besoin d'aide maintenant</div>
        ${bin ? `<a class="call" href="tel:${esc(bin.tel)}"><b>${esc(bin.nom.split(' ')[0])}</b><span>Mon binôme · ${fmtTel(bin.tel)}</span></a>` : `<a class="call" data-go2="equipe" href="#equipe"><b>Annuaire</b><span>Appeler un collègue</span></a>`}
        ${lta ? `<a class="call" href="tel:${esc(lta.tel)}"><b>${esc(lta.nom.split(' ')[0])}</b><span>${esc((lta.fonction || '').split(' ')[0])} · ${fmtTel(lta.tel)}</span></a>` : ''}
        <a class="call red" href="tel:112" style="grid-column:1/-1"><b>Secours : 112</b><span>Blessé, malaise, incendie</span></a>
      </div>
    </section>

    <div class="section-title"><h2>Accès rapides</h2></div>
    <div class="quick-grid">
      <button class="tile accent" data-go2="signaler">${icon('alert')}<b>Signaler</b><span>Situation dangereuse</span></button>
      <button class="tile" data-go2="fiche-toit">${icon('roof')}<b>Toit cabine</b><span>Fiche réflexe</span></button>
      <button class="tile" data-go2="fiche-consignation">${icon('bolt')}<b>Consignation</b><span>Fiche réflexe</span></button>
      <button class="tile" data-go2="fiche-cuvette">${icon('pit')}<b>Cuvette</b><span>Fiche réflexe</span></button>
      <button class="tile" data-go2="fiche-ubc">${icon('people')}<b>Usagers bloqués</b><span>Fiche réflexe</span></button>
      <button class="tile" data-go2="fiche-shunt">${icon('stop')}<b>Shunts</b><span>Fiche réflexe</span></button>
      <button class="tile" data-go2="quiz">${icon('quiz')}<b>Quiz</b><span>${quizDone ? `Fait : ${quizDone.score}/${quizDone.total}` : '4 questions, 1 minute'}</span></button>
      <button class="tile" data-go2="copilote">${icon('brain')}<b>Copilote</b><span>${S.data.docs ? 'Doc technique + sécu' : 'Questions sécu'}</span></button>
    </div>

    <div class="section-title"><h2>Liens équipe</h2></div>
    <div class="row wrap">
      <a class="btn ghost sm" href="${esc(S.data.links.teams)}" target="_blank" rel="noopener">${icon('teams')} Canal Teams</a>
      <a class="btn ghost sm" href="${esc(S.data.links.drive)}" target="_blank" rel="noopener">${icon('folder')} Doc Drive</a>
      <a class="btn ghost sm" href="${esc(S.data.links.form)}" target="_blank" rel="noopener">${icon('doc')} Formulaire Google</a>
    </div>`;
  bindGo2();
  $('#btn-read')?.addEventListener('click', markRead);
}

async function markRead() {
  S.data.myRead = true; localStorage.setItem('sl_boot', JSON.stringify(S.data)); render();
  try { await api('/api/minutes/read', { body: {} }); toast('Merci, lecture enregistrée.'); }
  catch { queue({ type: 'read' }); toast('Enregistré, envoi dès le retour du réseau.'); }
}

function bindGo2(root = document) { $$('[data-go2]', root).forEach(b => b.addEventListener('click', e => { e.preventDefault(); go(b.dataset.go2); })); }

function vMinute(n) {
  const cur = S.data.week.minute; const sel = Number(n) || cur;
  const m = S.data.minutes.find(x => x.id === sel) || currentMinute();
  $('#view').innerHTML = `
    <button class="link-btn" data-go2="accueil">← Accueil</button>
    <h1 style="margin:6px 0 4px">Programme 52 minutes</h1>
    <p class="muted">Diffusée chaque lundi à 08:35 sur Teams et par e-mail, en complément de la réunion.</p>
    <div class="card stack" style="margin-top:12px">
      <div class="row spread"><span class="tag ${sel === cur ? '' : 'grey'}">Semaine ${m.id}${sel === cur ? ' · en cours' : ''}</span>
        ${m.lastSent ? `<span class="small muted">Diffusée le ${fmtDate(m.lastSent, { day: 'numeric', month: 'short' })}</span>` : ''}</div>
      <h2>${esc(m.theme)}</h2>
      <p class="fiche-body" style="font-size:17px">${esc(m.message)}</p>
      <p><span class="tag red">Risque</span> ${esc(m.risque)}</p>
      <div class="row wrap"><button class="btn ghost sm" id="cp">Copier pour SMS / mail</button>
        <button class="btn ghost sm" id="ask">Approfondir avec le copilote</button></div>
    </div>
    <div class="section-title"><h2>Toutes les semaines</h2></div>
    <div class="weeks">${S.data.minutes.map(x => `<button class="${x.id === cur ? 'now' : x.id < cur ? 'past' : ''} ${x.id === sel ? 'sel' : ''}" data-w="${x.id}" title="${esc(x.theme)}">${x.id}</button>`).join('')}</div>`;
  bindGo2();
  $$('[data-w]').forEach(b => b.onclick = () => go('minute-' + b.dataset.w));
  $('#cp').onclick = () => navigator.clipboard.writeText(`🦺 MINUTE SÉCURITÉ TKE — SEMAINE ${m.id}/52\n\n${m.theme}\n\n${m.message}\n\n⚠️ Risque : ${m.risque}\n\nÉquipe 75 · objectif zéro accident`).then(() => toast('Copiée.'));
  $('#ask').onclick = () => askCopilot(`Développe la minute sécurité « ${m.theme} » : pourquoi c'est important, les erreurs fréquentes et les bons gestes sur le terrain.`);
}

function vFiches() {
  const faq = S.data.faq;
  $('#view').innerHTML = `
    <h1 style="margin-bottom:4px">Fiches réflexes</h1>
    <p class="muted">Disponibles hors ligne, même en fond de gaine.</p>
    <input class="search" id="q" type="search" placeholder="Chercher : cuvette, VAT, harnais…" aria-label="Chercher une fiche">
    <div class="fiche-list" id="list" style="margin-top:12px"></div>
    <div class="section-title"><h2>Règles apprises</h2><button class="link-btn" id="rules">Voir</button></div>
    <p class="muted small">Corrections terrain validées par les managers, utilisées par le copilote.</p>`;
  const paint = q => {
    const qq = norm(q);
    const items = faq.filter(f => !qq || norm(f.titre + ' ' + f.motsCles + ' ' + f.reponse).includes(qq));
    $('#list').innerHTML = items.map(f => `<button class="fiche-item" data-go2="fiche-${esc(f.id)}">${icon(f.icon)}<span><b>${esc(f.titre)}</b><small>${esc(f.tag || 'Consigne')}</small></span></button>`).join('')
      || `<div class="empty">Aucune fiche pour « ${esc(q)} ».<br><button class="btn sm" style="margin-top:10px" id="askq">Demander au copilote</button></div>`;
    bindGo2($('#list'));
    $('#askq')?.addEventListener('click', () => askCopilot(q));
  };
  paint(''); $('#q').oninput = e => paint(e.target.value);
  $('#rules').onclick = showRules;
}

function vFiche(id) {
  const f = S.data.faq.find(x => x.id === id);
  if (!f) return go('fiches');
  $('#view').innerHTML = `
    <button class="link-btn" data-go2="fiches">← Fiches</button>
    <div class="row" style="margin:8px 0 14px">${icon(f.icon)}<span class="tag">${esc(f.tag || 'Consigne')}</span></div>
    <h1 style="margin-bottom:14px">${esc(f.titre)}</h1>
    <div class="card fiche-body">${md(f.reponse)}</div>
    <div class="row wrap" style="margin-top:14px">
      <button class="btn block" id="ask">Poser une question sur cette fiche</button>
      <button class="btn ghost block" data-go2="signaler">Signaler une situation dangereuse</button>
    </div>`;
  bindGo2();
  $('#ask').onclick = () => { go('copilote'); setTimeout(() => { const t = $('#cmp-in'); t.value = `À propos de « ${f.titre} » : `; t.focus(); }, 50); };
}

/* ---------------- Copilote ---------------- */
function saveChat() { sessionStorage.setItem('sl_chat', JSON.stringify(S.chat.slice(-30))); }
function askCopilot(q) { go('copilote'); setTimeout(() => sendChat(q), 30); }

const SUGGEST = ['Procédure accès toit cabine', 'Consignation et VAT', 'Accès cuvette', 'Dégagement usagers bloqués', 'Les 10 règles vitales', 'Qui travaille sur le secteur 16 ?'];

function vCopilote() {
  const empty = !S.chat.length;
  $('#view').innerHTML = `
    <div class="row spread"><h1>Copilote</h1>${S.chat.length ? '<button class="link-btn" id="clr">Nouvelle conversation</button>' : ''}</div>
    <p class="muted small" style="margin-top:4px">${S.data.ai ? `Répond à partir des fiches TKE${S.data.docs ? ' et de la doc technique du Drive' : ''}, en citant ses sources.` : 'Mode fiches : l\'IA n\'est pas activée sur le serveur.'}</p>
    ${empty ? `<div class="card" style="margin:14px 0"><p><b>Pose ta question comme à un collègue.</b></p><p class="muted small">Sécurité, dépannage, code défaut, réglage… S'il ne trouve pas la réponse dans la doc, il te le dit au lieu d'inventer.</p></div>` : ''}
    <div class="suggest" id="sg">${SUGGEST.map(s => `<button>${esc(s)}</button>`).join('')}</div>
    <div class="chat" id="chat" style="margin-top:14px"></div>
    <div class="chat-pad"></div>`;
  const comp = document.createElement('div');
  comp.className = 'composer';
  const hasMic = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  comp.innerHTML = `<form id="cmp">${hasMic ? `<button type="button" class="icon-btn" id="mic" aria-label="Dicter">${icon('mic')}</button>` : ''}
    <textarea id="cmp-in" rows="1" placeholder="Ta question…" aria-label="Ta question"></textarea>
    <button class="btn amber send" aria-label="Envoyer">${icon('send')}</button></form>`;
  document.body.appendChild(comp);
  S.chat.forEach(m => appendMsg(m));
  $$('#sg button').forEach(b => b.onclick = () => sendChat(b.textContent));
  $('#clr')?.addEventListener('click', () => { S.chat = []; saveChat(); render(); });
  const ta = $('#cmp-in');
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 700) { e.preventDefault(); $('#cmp').requestSubmit(); } };
  $('#cmp').onsubmit = e => { e.preventDefault(); const v = ta.value.trim(); if (v) { ta.value = ''; ta.style.height = 'auto'; sendChat(v); } };
  if (hasMic) setupMic();
  if (S.chat.length) setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30);
}

function appendMsg(m, i = S.chat.indexOf(m)) {
  const box = $('#chat'); if (!box) return;
  const div = document.createElement('div');
  div.className = `msg ${m.role === 'user' ? 'user' : 'bot'}${m.role !== 'user' && /^\s*\**STOP/.test(m.content) ? ' stop' : ''}`;
  if (m.role === 'user') div.textContent = m.content;
  else {
    const src = (m.sources || []).map(s => s.link ? `<a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)).join(' ');
    const label = { ia: 'IA', fiche: 'Fiche TKE', doc: 'Doc', fallback: 'Consigne' }[m.mode] || '';
    div.innerHTML = md(m.content) + `<div class="msg-meta">${label ? `<span class="tag grey">${label}</span>` : ''}${src}
      <span style="flex:1"></span><button data-act="speak">Écouter</button><button data-act="copy">Copier</button><button data-act="fix">Corriger</button></div>`;
    div.querySelector('[data-act=copy]').onclick = () => navigator.clipboard.writeText(m.content).then(() => toast('Copié.'));
    div.querySelector('[data-act=speak]').onclick = () => speak(m.content);
    div.querySelector('[data-act=fix]').onclick = () => proposeFix(m.content);
  }
  box.appendChild(div);
}

async function sendChat(text) {
  if (!$('#chat')) return;
  const history = S.chat.slice(-10).map(({ role, content }) => ({ role, content }));
  const um = { role: 'user', content: text }; S.chat.push(um); appendMsg(um); saveChat();
  const wait = document.createElement('div'); wait.className = 'msg bot'; wait.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  $('#chat').appendChild(wait); window.scrollTo(0, document.body.scrollHeight);
  let bm;
  if (!navigator.onLine) {
    const f = offlineFiche(text);
    bm = f ? { role: 'assistant', content: `**${f.titre}**\n\n${f.reponse}`, mode: 'fiche' } : { role: 'assistant', content: 'Hors ligne : je ne peux pas interroger la doc. Consulte les fiches réflexes, et en cas de doute consigne et appelle ton LTA.', mode: 'fallback' };
  } else {
    try { const r = await api('/api/chat', { body: { message: text, history } }); bm = { role: 'assistant', content: r.reply, mode: r.mode, sources: r.sources }; }
    catch (e) { bm = { role: 'assistant', content: `Je n'ai pas pu répondre (${e.message}).`, mode: 'fallback' }; }
  }
  wait.remove(); S.chat.push(bm); appendMsg(bm); saveChat();
  if (S.voiceOut) speak(bm.content);
  window.scrollTo(0, document.body.scrollHeight);
}

function offlineFiche(q) {
  const qq = norm(q);
  return S.data.faq.find(f => norm(f.motsCles).split(',').map(s => s.trim()).some(k => k.length > 2 && qq.includes(k)));
}

function speak(text) {
  if (!('speechSynthesis' in window)) return toast('Lecture vocale indisponible.');
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/\*\*|\[[^\]]+\]/g, '')); u.lang = 'fr-FR'; u.rate = 1.05; speechSynthesis.speak(u);
}

function setupMic() {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new R(); rec.lang = 'fr-FR'; rec.interimResults = true;
  const btn = $('#mic'), ta = $('#cmp-in'); let on = false;
  rec.onresult = e => { ta.value = [...e.results].map(r => r[0].transcript).join(''); };
  rec.onend = () => { on = false; btn.classList.remove('on'); if (ta.value.trim()) $('#cmp').requestSubmit(); };
  btn.onclick = () => { if (on) return rec.stop(); on = true; btn.classList.add('on'); ta.value = ''; try { rec.start(); } catch { on = false; btn.classList.remove('on'); } };
}

function proposeFix(previous) {
  const mgr = S.data.me.role === 'manager';
  openSheet('Corriger le copilote', `
    <p class="muted small">${mgr ? 'Ta correction devient immédiatement une règle utilisée par le copilote.' : 'Ta correction est envoyée aux managers. Une fois validée, le copilote l\'appliquera pour toute l\'équipe.'}</p>
    <div class="field"><label class="f" for="fx">La bonne information</label>
    <textarea id="fx" class="input" placeholder="Ex : sur ce type d'armoire, le contact de verrouillage est sur la borne X, pas Y…"></textarea></div>
    <button class="btn amber block" id="fx-go">${mgr ? 'Enregistrer la règle' : 'Envoyer pour validation'}</button>`, d => {
    $('#fx', d).focus();
    $('#fx-go', d).onclick = async () => {
      const correction = $('#fx', d).value.trim(); if (correction.length < 5) return;
      $('#fx-go', d).disabled = true;
      try { const r = await api('/api/rules/propose', { body: { previous, correction } }); d.close(); toast(r.status === 'actif' ? 'Règle ajoutée.' : 'Envoyée aux managers pour validation.'); }
      catch (e) { toast(e.message); $('#fx-go', d).disabled = false; }
    };
  });
}

async function showRules() {
  const d = openSheet('Règles apprises', '<div id="rl" class="stack"><div class="empty">Chargement…</div></div>');
  try {
    const rules = await api('/api/rules');
    $('#rl', d).innerHTML = rules.length ? rules.map(r => `<div class="card"><div class="row spread"><b>${esc(r.topic)}</b><span class="tag ${r.status === 'actif' ? 'green' : r.status === 'en_attente' ? '' : 'grey'}">${{ actif: 'Validée', en_attente: 'En attente', archive: 'Archivée' }[r.status]}</span></div><p style="margin-top:6px">${esc(r.knowledge)}</p><p class="small muted">${esc(r.author)} · ${fmtDate(r.createdAt, { day: 'numeric', month: 'short' })}</p></div>`).join('')
      : '<div class="empty">Aucune règle pour l\'instant. Utilise « Corriger » sous une réponse du copilote.</div>';
  } catch (e) { $('#rl', d).innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

/* ---------------- Signaler ---------------- */
const DANGERS = ['Serrure / porte palière', 'Chute de hauteur', 'Électrique', 'Mouvement inopiné', 'Accès / éclairage', 'Machinerie encombrée', 'Shunt trouvé', 'Agression / tiers', 'Autre'];
const MARQUES = ['TKE', 'Otis', 'Schindler', 'Kone', 'Orona', 'Sodimas', 'Autre'];

function vSignaler() {
  $('#view').innerHTML = `
    <h1 style="margin-bottom:4px">Signaler</h1>
    <p class="muted">Situation dangereuse ou presqu'accident. Les managers sont prévenus tout de suite.</p>
    <form id="sf" class="card" style="margin-top:12px" novalidate>
      <div class="field"><label class="f" for="s-site">Appareil ou adresse</label><input id="s-site" class="input" required placeholder="N° d'appareil, 12 rue de Rivoli…"></div>
      <div class="field"><span class="f">Type de danger</span><div class="chips" id="s-danger">${DANGERS.map(d => `<button type="button">${esc(d)}</button>`).join('')}</div></div>
      <div class="field"><span class="f">Marque</span><div class="chips" id="s-marque">${MARQUES.map(d => `<button type="button">${esc(d)}</button>`).join('')}</div></div>
      <div class="field"><span class="f">Gravité</span><div class="seg">${['Faible', 'Moyenne', 'Élevée', 'Critique'].map((g, i) => `<input type="radio" name="g" id="g${i}" value="${g}" ${i === 1 ? 'checked' : ''}><label for="g${i}" class="${i === 3 ? 'crit' : ''}">${g}</label>`).join('')}</div></div>
      <div class="field"><label class="f" for="s-desc">Ce que tu as constaté</label><textarea id="s-desc" class="input" required placeholder="Décris la situation…"></textarea></div>
      <div class="field"><label class="f" for="s-mes">Mesures déjà prises <span class="muted">(facultatif)</span></label><input id="s-mes" class="input" placeholder="Appareil arrêté, palier balisé…"></div>
      <div class="field"><label class="f" for="s-photo">Photo <span class="muted">(facultatif)</span></label><input id="s-photo" type="file" accept="image/*" capture="environment" class="input"><img id="s-prev" class="photo-prev" hidden alt="Aperçu"></div>
      <button class="btn red block" id="s-go">Envoyer le signalement</button>
    </form>
    <div class="row wrap" style="margin-top:12px">
      <button class="btn ghost sm" data-go2="signalements">Mes signalements</button>
      <a class="btn ghost sm" href="${esc(S.data.links.form)}" target="_blank" rel="noopener">Formulaire Google</a>
    </div>`;
  bindGo2();
  const pick = (id, multi) => $$(`#${id} button`).forEach(b => b.onclick = () => { if (!multi) $$(`#${id} button`).forEach(x => x !== b && x.classList.remove('on')); b.classList.toggle('on'); });
  pick('s-danger', true); pick('s-marque', false);
  let photo = null;
  $('#s-photo').onchange = async e => { const f = e.target.files[0]; if (!f) return; photo = await shrink(f); $('#s-prev').src = photo; $('#s-prev').hidden = false; };
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    const body = { site: $('#s-site').value.trim(), danger: $$('#s-danger .on').map(b => b.textContent).join(', '), marque: $('#s-marque .on')?.textContent || '',
      gravite: $('input[name=g]:checked').value, description: $('#s-desc').value.trim(), mesures: $('#s-mes').value.trim(), photo };
    if (!body.site || !body.description) return toast('Indique l\'appareil et décris la situation.');
    $('#s-go').disabled = true;
    if (!navigator.onLine) { queue({ type: 'incident', body }); toast('Hors ligne : signalement gardé, il partira dès le retour du réseau.', 4000); return go('accueil'); }
    try { const r = await api('/api/incidents', { body }); showIncidentResult(r); }
    catch (err) { queue({ type: 'incident', body }); toast('Envoi impossible, signalement gardé et renvoyé automatiquement.', 4000); go('accueil'); }
  };
}

function showIncidentResult(r) {
  const a = r.analysis || {};
  $('#view').innerHTML = `
    <div class="card stack" style="border-color:var(--green)">
      <h2>Signalement envoyé</h2>
      <p>${r.notified ? 'Les managers ont été prévenus par e-mail.' : 'Enregistré : les managers le verront dans le pilotage.'} Merci, c'est comme ça qu'on évite le prochain accident.</p>
      ${a.actions ? `<h3>À faire maintenant</h3><ol class="fiche-body" style="font-size:16px">${a.actions.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
      ${a.epi?.length ? `<p><b>EPI :</b> ${a.epi.map(esc).join(', ')}</p>` : ''}
      ${a.prevention ? `<p class="muted">${esc(a.prevention)}</p>` : ''}
      <button class="btn block" data-go2="accueil">Retour à l'accueil</button>
    </div>`;
  bindGo2();
}

function shrink(file, max = 1280) {
  return new Promise((ok, ko) => {
    const img = new Image(); img.onerror = ko;
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.72)); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(file);
  });
}

async function vMesSignalements() {
  $('#view').innerHTML = `<button class="link-btn" data-go2="signaler">← Signaler</button><h1 style="margin:6px 0 12px">Mes signalements</h1><div id="ml" class="stack"><div class="empty">Chargement…</div></div>`;
  bindGo2();
  const pending = JSON.parse(localStorage.getItem('sl_outbox') || '[]').filter(x => x.type === 'incident');
  try {
    const list = await api('/api/incidents');
    $('#ml').innerHTML = pending.map(p => `<div class="card inc"><b>${esc(p.body.site)}</b> <span class="tag">En attente de réseau</span></div>`).join('') +
      (list.map(incCard).join('') || '<div class="empty">Aucun signalement. Le moindre doute compte : signale-le.</div>');
  } catch (e) { $('#ml').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

const incCard = i => `<div class="card inc ${esc(i.gravite)}"><div class="row spread"><b>${esc(i.site)}</b><span class="tag ${i.statut === 'Clôturé' ? 'green' : i.statut === 'Nouveau' ? 'red' : ''}">${esc(i.statut)}</span></div>
  <p class="small muted" style="margin:4px 0 8px">${fmtDate(i.at)} · ${esc(i.gravite)}${i.marque ? ' · ' + esc(i.marque) : ''}${i.danger ? ' · ' + esc(i.danger) : ''}</p>
  <p>${esc(i.description)}</p>${i.note ? `<p class="small"><b>Suivi :</b> ${esc(i.note)}</p>` : ''}</div>`;

/* ---------------- Équipe ---------------- */
function vEquipe() {
  const me = S.data.me, bin = findBinome();
  const card = (t, cls = '') => `<div class="person ${cls}"><div class="avatar">${initials(t.nom)}</div><div class="who"><b>${esc(t.nom)}</b><small>${esc(t.fonction || '')}${t.secteur ? ' · ' + esc(t.secteur) : ''}</small>${t.binome ? `<small>Binôme : ${esc(t.binome)}</small>` : ''}</div>${t.tel ? `<a class="tel" href="tel:${esc(t.tel)}" aria-label="Appeler ${esc(t.nom)}">${icon('phone')}</a>` : ''}</div>`;
  $('#view').innerHTML = `
    <h1 style="margin-bottom:12px">Équipe 75</h1>
    ${bin ? `<p class="muted small">Ton binôme</p>${card(bin, 'me')}` : ''}
    <input class="search" id="q" type="search" placeholder="Nom, secteur (ex : 16)…" style="margin-top:16px" aria-label="Chercher un collègue">
    <div id="tl" class="stack" style="margin-top:12px"></div>`;
  const paint = q => { const qq = norm(q); $('#tl').innerHTML = techs().filter(t => t.id !== me.id && (!qq || norm(t.nom + ' ' + t.secteur + ' ' + t.fonction).includes(qq))).map(t => card(t)).join('') || '<div class="empty">Personne ne correspond.</div>'; };
  paint(''); $('#q').oninput = e => paint(e.target.value);
}

/* ---------------- Quiz de la semaine ---------------- */
function weekQuiz() {
  const all = S.data.quiz; if (!all.length) return [];
  const n = Math.min(4, all.length), start = (S.data.week.week * 3) % all.length;
  return Array.from({ length: n }, (_, i) => all[(start + i) % all.length]);
}
function vQuiz() {
  const qs = weekQuiz(); let i = 0, score = 0;
  const step = () => {
    if (i >= qs.length) {
      api('/api/quiz/score', { body: { score, total: qs.length } }).then(r => { S.data.myScore = r; localStorage.setItem('sl_boot', JSON.stringify(S.data)); }).catch(() => {});
      $('#view').innerHTML = `<div class="card stack" style="text-align:center"><h1 style="font-size:64px">${score}/${qs.length}</h1><p>${score === qs.length ? 'Sans faute. Les réflexes sont là.' : 'Relis les explications : ce sont les réflexes qui protègent.'}</p><button class="btn block" id="again">Refaire</button><button class="btn ghost block" data-go2="accueil">Accueil</button></div>`;
      bindGo2(); $('#again').onclick = render; return;
    }
    const q = qs[i];
    $('#view').innerHTML = `<div class="row spread"><h1>Quiz</h1><span class="muted">${i + 1}/${qs.length}</span></div>
      <div class="progress" style="margin:10px 0 18px"><i style="width:${100 * i / qs.length}%"></i></div>
      <h2 style="margin-bottom:16px;font-family:var(--body);font-size:20px;line-height:1.35">${esc(q.question)}</h2>
      <div id="opts">${q.options.map((o, k) => `<button class="q-opt" data-k="${k}">${esc(o)}</button>`).join('')}</div><div id="ex"></div>`;
    $$('.q-opt').forEach(b => b.onclick = () => {
      const k = +b.dataset.k; const ok = k === q.bonne; if (ok) score++;
      $$('.q-opt').forEach(x => { x.disabled = true; if (+x.dataset.k === q.bonne) x.classList.add('good'); });
      if (!ok) b.classList.add('bad');
      $('#ex').innerHTML = `<div class="card" style="margin-top:8px"><b>${ok ? 'Bien vu.' : 'Pas tout à fait.'}</b> ${esc(q.explication || '')}</div><button class="btn amber block" style="margin-top:12px" id="nx">${i + 1 < qs.length ? 'Question suivante' : 'Voir mon score'}</button>`;
      $('#nx').onclick = () => { i++; step(); };
    });
  };
  if (!qs.length) { $('#view').innerHTML = '<div class="empty">Pas encore de questions.</div>'; return; }
  step();
}

/* ---------------- Pilotage (manager) ---------------- */
async function vPilotage() {
  $('#view').innerHTML = `<h1>Pilotage</h1><div id="pl" class="stack" style="margin-top:12px"><div class="empty">Chargement…</div></div>`;
  let o; try { o = await api('/api/admin/overview'); } catch (e) { $('#pl').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const read = o.team.filter(t => t.readAt).length, m = S.data.minutes.find(x => x.id === o.week.minute) || {};
  const ch = o.channels, sc = o.schedule, last = o.logs[0];
  const nextLbl = sc.next.inDays === 0 ? `aujourd'hui ${sc.next.time}` : `lundi ${new Date(sc.next.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} à ${sc.next.time}`;
  $('#pl').innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${read}/${o.team.length}</b><span>ont lu la minute S${o.week.week}</span></div>
      <div class="kpi ${o.incidents.open ? 'warn' : ''}"><b>${o.incidents.open}</b><span>signalements ouverts</span></div>
      <div class="kpi ${o.rulesPending ? 'warn' : ''}"><b>${o.rulesPending}</b><span>règles à valider</span></div>
    </div>

    <div class="card stack">
      <div class="row spread"><h2>Diffusion du lundi</h2><label class="switch" title="Envoi automatique"><input type="checkbox" id="auto" ${sc.enabled ? 'checked' : ''}><span></span></label></div>
      <p>${sc.enabled ? `Prochain envoi : <b>${nextLbl}</b> — semaine ${sc.next.week}.` : '<b>Envoi automatique désactivé.</b>'} ${sc.lastWeekKey === o.week.key && sc.lastResult ? '<span class="tag green">Envoyée cette semaine</span>' : ''}</p>
      <p class="small muted">Cette semaine : S${m.id} « ${esc(m.theme)} ». Si le serveur dormait lundi, l'envoi est rattrapé dès son réveil dans la semaine.</p>
      <div>
        <div class="status-line"><span class="dot ${ch.teams ? 'ok' : 'ko'}"></span>Teams ${ch.teams ? 'configuré' : '— ajouter TEAMS_WEBHOOK_URL'}</div>
        <div class="status-line"><span class="dot ${ch.mail ? 'ok' : 'ko'}"></span>E-mail Brevo ${ch.mail ? 'configuré' : '— ajouter BREVO_API_KEY'}</div>
        <div class="status-line"><span class="dot ${ch.cron ? 'ok' : 'wait'}"></span>Réveil externe ${ch.cron ? 'possible (CRON_SECRET)' : 'non configuré : conseillé sur Render gratuit'}</div>
      </div>
      ${last ? `<p class="small">Dernier envoi : ${fmtDate(last.at)} · S${last.minute}${last.test ? ' (test)' : ''} · Teams ${last.teams.skipped ? '—' : last.teams.ok ? '✓' : '✗'} · e-mail ${last.mail.ok ? '✓ ' + last.mail.count : '✗'}${(!last.teams.ok && last.teams.error && !last.teams.skipped) ? `<br><span class="muted">${esc(last.teams.error)}</span>` : ''}${(!last.mail.ok && last.mail.error) ? `<br><span class="muted">${esc(last.mail.error)}</span>` : ''}</p>` : ''}
      <div class="row wrap">
        <button class="btn amber sm" id="d-now">Diffuser maintenant</button>
        <button class="btn ghost sm" id="d-test">M'envoyer un test</button>
        <button class="btn ghost sm" id="d-teams">Tester la carte Teams</button>
      </div>
    </div>

    <div class="card">
      <div class="row spread"><h2>Lecture S${o.week.week}</h2><button class="link-btn" id="cp-miss">Copier les absents</button></div>
      <table class="table">${o.team.map(t => `<tr><td>${esc(t.nom)}</td><td>${t.readAt ? `<span class="tag green">Lue ${fmtDate(t.readAt, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : '<span class="tag grey">Pas encore</span>'}</td><td class="small muted">${t.quiz ? `Quiz ${t.quiz.score}/${t.quiz.total}` : ''}</td></tr>`).join('')}</table>
    </div>

    <div class="section-title"><h2>Signalements</h2></div><div id="inc" class="stack"><div class="empty">…</div></div>

    <div class="section-title"><h2>Règles du copilote</h2></div><div id="rul" class="stack"><div class="empty">…</div></div>

    <div class="card stack">
      <h2>Causerie mensuelle</h2>
      <p class="muted small">Support prêt à projeter, construit à partir des signalements, des minutes diffusées, des lectures et du quiz du mois.</p>
      <button class="btn block" data-go2="causerie">Ouvrir la causerie</button>
    </div>

    <div class="card stack">
      <h2>Quiz</h2>
      <div class="row"><input id="qz-theme" class="input" placeholder="Thème (ex : ${esc(m.theme || 'cuvette')})"><button class="btn sm" id="qz-gen" ${ch.ai ? '' : 'disabled'}>Générer</button></div>
      <p class="small muted">${S.data.quiz.length} questions en rotation (4 par semaine). ${ch.ai ? 'La question générée est ajoutée à la rotation.' : 'Génération indisponible sans IA.'}</p>
    </div>

    <div class="card stack">
      <h2>Sources de données</h2>
      <div class="status-line"><span class="dot ${o.sheets?.errors?.length ? 'wait' : o.sheets ? 'ok' : 'ko'}"></span><span style="flex:1">Classeur SafetyLift_Database ${o.sheets ? `· ${fmtDate(o.sheets.at)}<br><span class="small muted">${esc(o.sheets.ok.join(', ') || 'rien lu')}${o.sheets.errors.length ? ' — ' + esc(o.sheets.errors.join(' ; ')) : ''}</span>` : ''}</span><button class="btn ghost sm" id="sync">Synchroniser</button></div>
      <div class="status-line"><span class="dot ${!ch.google ? 'ko' : o.drive?.errors?.length ? 'wait' : o.drive ? 'ok' : 'wait'}"></span><span style="flex:1">Doc technique Drive ${ch.google ? (o.drive ? `· ${o.drive.files} fichiers, ${o.index.docChunks} extraits indexés<br><span class="small muted">${o.drive.finishedAt ? fmtDate(o.drive.finishedAt) : 'en cours…'}${o.drive.skipped?.length ? ` · ${o.drive.skipped.length} ignorés (images/scans)` : ''}${o.drive.errors?.length ? ` · ${o.drive.errors.length} erreurs` : ''}</span>` : '· pas encore indexée') : '<br><span class="small muted">Ajouter GOOGLE_SERVICE_ACCOUNT_JSON et partager le dossier avec le compte de service.</span>'}</span><button class="btn ghost sm" id="reidx" ${ch.google ? '' : 'disabled'}>Indexer</button></div>
      <div class="status-line"><span class="dot ${ch.ai ? 'ok' : 'ko'}"></span>IA : ${ch.ai ? ({ grok: 'Grok (xAI)', claude: 'Claude', gemini: 'Gemini' }[ch.ai]) : 'aucune (mode fiches) — ajouter XAI_API_KEY'}</div>
      <div class="status-line"><span class="dot ${ch.db ? 'ok' : 'wait'}"></span>Base : ${ch.db ? 'Postgres' : 'fichier local (non persistant sur Render)'}</div>
    </div>`;
  bindGo2($('#pl'));
  $('#auto').onchange = async e => { await api('/api/admin/schedule', { body: { enabled: e.target.checked } }); toast(e.target.checked ? 'Envoi automatique activé.' : 'Envoi automatique désactivé.'); render(); };
  const disp = async (body, msg) => { try { const r = await api('/api/admin/dispatch', { body }); toast(`${msg} — Teams ${r.teams.skipped ? '—' : r.teams.ok ? '✓' : '✗'}, e-mail ${r.mail.ok ? '✓' : '✗'}`, 4500); render(); } catch (e) { toast(e.message); } };
  $('#d-now').onclick = () => confirmSheet('Diffuser maintenant ?', `La minute S${m.id} « ${m.theme} » part à toute l'équipe, sur Teams et par e-mail.`, 'Diffuser').then(ok => ok && disp({}, 'Diffusée'));
  $('#d-test').onclick = () => disp({ test: true }, 'Test envoyé à ' + S.data.me.email);
  $('#d-teams').onclick = () => confirmSheet('Tester la carte Teams', 'Une carte marquée [TEST] sera publiée dans le canal de l\'équipe.', 'Publier le test').then(ok => ok && disp({ test: true, teamsToo: true }, 'Test'));
  $('#cp-miss').onclick = () => navigator.clipboard.writeText(o.team.filter(t => !t.readAt).map(t => t.nom).join(', ')).then(() => toast('Liste copiée.'));
  $('#sync').onclick = async () => { $('#sync').disabled = true; try { const r = await api('/api/admin/sync-sheets', { body: {} }); toast(r.errors.length ? 'Synchro partielle : ' + r.errors[0] : 'Synchronisé : ' + r.ok.join(', '), 4500); S.data = await api('/api/bootstrap'); localStorage.setItem('sl_boot', JSON.stringify(S.data)); render(); } catch (e) { toast(e.message); $('#sync').disabled = false; } };
  $('#reidx').onclick = async () => { try { await api('/api/admin/reindex', { body: {} }); toast('Indexation lancée. Reviens dans quelques minutes.', 4000); } catch (e) { toast(e.message); } };
  $('#qz-gen').onclick = async () => { $('#qz-gen').disabled = true; try { const q = await api('/api/admin/quiz', { body: { theme: $('#qz-theme').value } }); S.data.quiz.push(q); openSheet('Question ajoutée', `<p><b>${esc(q.question)}</b></p><ol>${q.options.map((x, k) => `<li${k === q.bonne ? ' style="color:var(--green);font-weight:700"' : ''}>${esc(x)}</li>`).join('')}</ol><p class="muted">${esc(q.explication)}</p><button class="btn ghost block" id="qdel">Supprimer cette question</button>`, d => { $('#qdel', d).onclick = async () => { await api('/api/admin/quiz/' + q.id, { method: 'DELETE' }); S.data.quiz = S.data.quiz.filter(x => x.id !== q.id); d.close(); toast('Supprimée.'); }; }); } catch (e) { toast(e.message); } $('#qz-gen').disabled = false; };
  loadIncidents(); loadRules();
}

async function loadIncidents() {
  const box = $('#inc'); if (!box) return;
  const list = await api('/api/incidents').catch(() => []);
  const open = list.filter(i => i.statut !== 'Clôturé'), closed = list.filter(i => i.statut === 'Clôturé');
  box.innerHTML = list.length ? [...open, ...closed.slice(0, 5)].map(i => `<div class="card inc ${esc(i.gravite)}" data-id="${esc(i.id)}">
      <div class="row spread"><b>${esc(i.site)}</b><select class="input" style="width:auto;min-height:38px;padding:4px 8px" data-st>${['Nouveau', 'En analyse', 'Action en cours', 'Clôturé'].map(s => `<option ${s === i.statut ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <p class="small muted" style="margin:4px 0 8px">${fmtDate(i.at)} · ${esc(i.author)} · ${esc(i.gravite)}${i.marque ? ' · ' + esc(i.marque) : ''}${i.danger ? ' · ' + esc(i.danger) : ''}${i.analysis?.riskScore ? ` · risque ${i.analysis.riskScore}/100` : ''}</p>
      <p>${esc(i.description)}</p>${i.mesures ? `<p class="small"><b>Mesures :</b> ${esc(i.mesures)}</p>` : ''}
      ${i.analysis?.actions ? `<p class="small"><b>Actions suggérées :</b> ${i.analysis.actions.map(esc).join(' · ')}</p>` : ''}
      <div class="row wrap">${i.hasPhoto ? `<a class="btn ghost sm" href="/api/incidents/${esc(i.id)}/photo" target="_blank">Voir la photo</a>` : ''}<button class="btn ghost sm" data-note>${i.note ? 'Modifier le suivi' : 'Ajouter un suivi'}</button></div>
      ${i.note ? `<p class="small" style="margin-top:8px"><b>Suivi :</b> ${esc(i.note)}</p>` : ''}</div>`).join('') : '<div class="empty">Aucun signalement.</div>';
  $$('[data-st]', box).forEach(s => s.onchange = async () => { const id = s.closest('[data-id]').dataset.id; await api('/api/incidents/' + id, { method: 'PATCH', body: { statut: s.value } }); toast('Statut mis à jour.'); });
  $$('[data-note]', box).forEach(b => b.onclick = () => {
    const id = b.closest('[data-id]').dataset.id, inc = list.find(x => x.id === id);
    openSheet('Suivi du signalement', `<textarea id="nt" class="input" placeholder="Action décidée, retour au technicien…">${esc(inc.note || '')}</textarea><button class="btn block" style="margin-top:10px" id="ntg">Enregistrer</button>`, d => {
      $('#ntg', d).onclick = async () => { await api('/api/incidents/' + id, { method: 'PATCH', body: { note: $('#nt', d).value } }); d.close(); loadIncidents(); };
    });
  });
}

async function loadRules() {
  const box = $('#rul'); if (!box) return;
  const rules = await api('/api/rules').catch(() => []);
  const order = { en_attente: 0, actif: 1, archive: 2 };
  rules.sort((a, b) => order[a.status] - order[b.status]);
  box.innerHTML = rules.length ? rules.slice(0, 15).map(r => `<div class="card" data-id="${esc(r.id)}">
      <div class="row spread"><b>${esc(r.topic)}</b><span class="tag ${r.status === 'actif' ? 'green' : r.status === 'en_attente' ? '' : 'grey'}">${{ actif: 'Active', en_attente: 'À valider', archive: 'Archivée' }[r.status]}</span></div>
      ${r.wrong ? `<p class="small" style="margin-top:6px"><span class="tag red">Avant</span> ${esc(r.wrong)}</p>` : ''}
      <p style="margin-top:6px">${esc(r.knowledge)}</p>
      <p class="small muted">Proposée par ${esc(r.author)} · ${fmtDate(r.createdAt, { day: 'numeric', month: 'short' })}${r.raw && r.raw !== r.knowledge ? ` · texte d'origine : « ${esc(r.raw.slice(0, 160))} »` : ''}</p>
      <div class="row wrap">${r.status !== 'actif' ? '<button class="btn green sm" data-s="actif">Valider</button>' : '<button class="btn ghost sm" data-s="archive">Archiver</button>'}
        <button class="btn ghost sm" data-edit>Modifier</button><button class="btn ghost sm" data-del>Supprimer</button></div></div>`).join('')
    : '<div class="empty">Aucune correction proposée. Les techniciens peuvent corriger le copilote sous chaque réponse.</div>';
  $$('[data-s]', box).forEach(b => b.onclick = async () => { await api('/api/rules/' + b.closest('[data-id]').dataset.id, { method: 'PATCH', body: { status: b.dataset.s } }); loadRules(); toast(b.dataset.s === 'actif' ? 'Règle validée : le copilote l\'utilise.' : 'Archivée.'); });
  $$('[data-del]', box).forEach(b => b.onclick = async () => { if (!(await confirmSheet('Supprimer cette règle ?', 'Le copilote ne l\'utilisera plus.', 'Supprimer'))) return; await api('/api/rules/' + b.closest('[data-id]').dataset.id, { method: 'DELETE' }); loadRules(); });
  $$('[data-edit]', box).forEach(b => b.onclick = () => {
    const r = rules.find(x => x.id === b.closest('[data-id]').dataset.id);
    openSheet('Modifier la règle', `<div class="field"><label class="f" for="et">Sujet</label><input id="et" class="input" value="${esc(r.topic)}"></div><div class="field"><label class="f" for="ek">Règle</label><textarea id="ek" class="input">${esc(r.knowledge)}</textarea></div><button class="btn green block" id="eg">Enregistrer et valider</button>`, d => {
      $('#eg', d).onclick = async () => { await api('/api/rules/' + r.id, { method: 'PATCH', body: { topic: $('#et', d).value, knowledge: $('#ek', d).value, status: 'actif' } }); d.close(); loadRules(); };
    });
  });
}

/* ---------------- Causerie ---------------- */
async function vCauserie() {
  $('#view').innerHTML = `<button class="link-btn" data-go2="pilotage">← Pilotage</button><div id="cz" class="empty">Préparation de la causerie…</div>`;
  bindGo2();
  let c; try { c = await api('/api/admin/causerie?ai=1'); } catch (e) { $('#cz').textContent = e.message; return; }
  const monthName = new Date(c.month + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const slides = [
    `<p class="muted">Causerie sécurité · Équipe 75</p><h1>${esc(monthName)}</h1><p style="font-size:22px">La sécurité de chacun passe avant l'urgence du dépannage.<br><b style="color:var(--amber)">Danger non maîtrisé : on s'arrête et on sécurise.</b></p>`,
    `<p class="muted">Ce mois-ci</p><div class="row wrap" style="gap:28px"><div><div class="big">${c.incidents}</div><p>situations signalées</p></div><div><div class="big">${c.minutes.length}</div><p>minutes diffusées</p></div>${c.readRate != null ? `<div><div class="big">${c.readRate}%</div><p>de lecture</p></div>` : ''}${c.quiz ? `<div><div class="big">${c.quiz.avg}%</div><p>au quiz (${c.quiz.participants} part.)</p></div>` : ''}</div>`,
    `<h1>Retours terrain</h1>${c.topIncidents.length ? `<ul>${c.topIncidents.map(i => `<li><b>${esc(i.danger || i.site)}</b> — ${esc(i.gravite)}${i.marque ? ', ' + esc(i.marque) : ''}<br><span class="muted">${esc(i.description)}</span>${i.action ? `<br>→ ${esc(i.action)}` : ''}</li>`).join('')}</ul>` : '<p style="font-size:22px">Aucun signalement ce mois-ci. Un presqu\'accident non déclaré, c\'est un accident qui attend : on signale le moindre doute.</p>'}`,
    `<h1>Les minutes du mois</h1><ul>${c.minutes.map(m => `<li><b>S${m.id} · ${esc(m.theme)}</b><br><span class="muted">${esc(m.risque)}</span></li>`).join('') || '<li>Aucune minute diffusée ce mois.</li>'}</ul>${c.newRules.length ? `<p class="muted">Nouvelles règles validées : ${c.newRules.map(esc).join(', ')}</p>` : ''}`,
    ...(c.synthesis ? [`<h1>Points clés</h1><div style="font-size:21px">${md(c.synthesis)}</div>`] : []),
    `<h1>Tour de table</h1><ul><li>Des accès ou serrures dégradés croisés ce mois-ci ?</li><li>Vos EPI sont-ils en état (VAT testé, gants, casquette, DATI) ?</li><li>Un sujet pour les prochaines minutes sécurité ?</li></ul><p class="muted">We Get Home : chacun rentre chez soi le soir.</p>`,
  ];
  let k = 0;
  const show = () => { $('#cz').className = ''; $('#cz').innerHTML = `<div class="slide">${slides[k]}</div><div class="row spread" style="margin-top:12px"><button class="btn ghost" id="pv" ${k ? '' : 'disabled'}>Précédente</button><span class="muted">${k + 1}/${slides.length}</span><button class="btn amber" id="nx" ${k < slides.length - 1 ? '' : 'disabled'}>Suivante</button></div><button class="link-btn" id="fs">Plein écran</button>`;
    $('#pv').onclick = () => { k--; show(); }; $('#nx').onclick = () => { k++; show(); };
    $('#fs').onclick = () => document.documentElement.requestFullscreen?.(); };
  document.onkeydown = e => { if (!location.hash.startsWith('#causerie')) return; if (e.key === 'ArrowRight' && k < slides.length - 1) { k++; show(); } if (e.key === 'ArrowLeft' && k > 0) { k--; show(); } };
  show();
}

/* ---------------- Menu ---------------- */
function openMenu() {
  const me = S.data.me;
  openSheet(me.nom, `
    <p class="muted">${esc(me.fonction || '')} · ${me.role === 'manager' ? 'accès manager' : 'accès technicien'}</p>
    <div class="stack" style="margin-top:12px">
      <div class="status-line"><span style="flex:1">Thème</span><div class="chips" id="th">${[['auto', 'Auto'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => `<button data-v="${v}" class="${(localStorage.getItem('sl_theme') || 'auto') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="status-line"><span style="flex:1">Lire les réponses du copilote à voix haute</span><label class="switch"><input type="checkbox" id="vo" ${S.voiceOut ? 'checked' : ''}><span></span></label></div>
      <button class="btn ghost block" data-go2="minute">Programme des minutes</button>
      <button class="btn ghost block" data-go2="signalements">Mes signalements</button>
      <button class="btn ghost block" id="m-rules">Règles apprises</button>
      ${me.canManage && me.role !== 'manager' ? '<p class="small muted">Tu as un profil manager : reconnecte-toi avec le code manager pour ouvrir le pilotage.</p>' : ''}
      <button class="btn block" id="m-out">Se déconnecter</button>
    </div>`, d => {
    bindGo2(d); $$('[data-go2]', d).forEach(b => b.addEventListener('click', () => d.close()));
    $$('#th button', d).forEach(b => b.onclick = () => { localStorage.setItem('sl_theme', b.dataset.v); applyTheme(); $$('#th button', d).forEach(x => x.classList.toggle('on', x === b)); });
    $('#vo', d).onchange = e => { S.voiceOut = e.target.checked; localStorage.setItem('sl_voice', S.voiceOut ? '1' : '0'); };
    $('#m-rules', d).onclick = () => { d.close(); showRules(); };
    $('#m-out', d).onclick = async () => { await api('/api/logout', { body: {} }).catch(() => {}); localStorage.removeItem('sl_boot'); sessionStorage.clear(); S.data = null; S.chat = []; d.close(); showLogin(); };
  });
}

function applyTheme() {
  const t = localStorage.getItem('sl_theme') || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}

/* ---------------- File d'attente hors ligne ---------------- */
function queue(item) { const q = JSON.parse(localStorage.getItem('sl_outbox') || '[]'); q.push({ ...item, at: Date.now() }); localStorage.setItem('sl_outbox', JSON.stringify(q)); }
let flushing = false;
async function flushOutbox() {
  if (flushing || !navigator.onLine || !S.data) return;
  const q = JSON.parse(localStorage.getItem('sl_outbox') || '[]'); if (!q.length) return;
  flushing = true; const rest = [];
  for (const it of q) {
    try { if (it.type === 'incident') await api('/api/incidents', { body: it.body }); else if (it.type === 'read') await api('/api/minutes/read', { body: {} }); }
    catch { rest.push(it); }
  }
  localStorage.setItem('sl_outbox', JSON.stringify(rest)); flushing = false;
  if (rest.length < q.length) toast(`${q.length - rest.length} envoi(s) en attente transmis.`);
}

/* ---------------- PWA ---------------- */
function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; $('#btn-install').hidden = false; });
  $('#btn-install').onclick = async () => { if (!S.installEvt) return; S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; $('#btn-install').hidden = true; };
}

boot();
