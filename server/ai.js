// IA : Claude (ANTHROPIC_API_KEY) en priorité, sinon Gemini (GEMINI_API_KEY). Sans clé : réponses issues des fiches et de la doc.
const cfg = require('./config');
const store = require('./store');
const kb = require('./knowledge');

async function complete({ system, messages, maxTokens = 1200, json = false }) {
  if (cfg.aiProvider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.aiModel || 'claude-sonnet-5-5', max_tokens: maxTokens, system, messages }),
    });
    if (!r.ok) throw new Error(`Claude ${r.status} : ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.content.filter(c => c.type === 'text').map(c => c.text).join('');
  }
  if (cfg.aiProvider === 'gemini') {
    const model = cfg.aiModel || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
    if (!r.ok) throw new Error(`Gemini ${r.status} : ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  }
  throw new Error('Aucune IA configurée');
}

function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Réponse IA non JSON');
  return JSON.parse(m[0]);
}

async function teamBlock() {
  const techs = (await store.list('techs')).filter(t => t.actif !== false);
  return techs.map(t => `- ${t.nom} — ${t.fonction}${t.secteur ? ', ' + t.secteur : ''}${t.binome ? ', binôme : ' + t.binome : ''}${t.tel ? ', tél ' + t.tel : ''}`).join('\n');
}

function systemPrompt({ user, team, sources }) {
  return `Tu es SafetyLift Copilot, l'équipier sécurité et technique des techniciens d'ascenseurs de l'Équipe 75 (SAV TK Elevator, Paris). Tu réponds en français, tu tutoies avec respect professionnel.

Tu parles à : ${user.nom} (${user.fonction || 'technicien'}${user.binome ? ', binôme ' + user.binome : ''}). Il est probablement sur le terrain, sur téléphone : va droit au but, phrases courtes, étapes numérotées quand c'est une procédure.

RÈGLES ABSOLUES
1. Les SOURCES ci-dessous (fiches réflexes TKE, règles validées par les managers, extraits de la documentation technique du Drive) priment sur tes connaissances générales. Quand tu t'appuies sur un extrait de doc, cite-le entre crochets : [Doc : nom du fichier]. Pour une fiche : [Fiche : titre].
2. N'invente jamais une valeur technique (tension, code défaut, paramètre, réglage, couple, cote) absente des sources. Si l'info n'y est pas, dis-le clairement, donne la démarche générale de diagnostic en sécurité et oriente vers la notice constructeur ou le LTA.
3. Rappelle les règles vitales concernées (STOP toit/cuvette, inspection, consignation + VAT, retrait des shunts, EPI, 3 points d'appui) quand la question implique une intervention.
4. Danger grave ou imminent (risque de chute, électrocution, écrasement, appareil remis en service avec défaut de sécurité) : commence par « STOP — » et demande de sécuriser puis d'appeler un manager.
5. Ne termine pas par une formule de politesse ou une relance du type « N'hésite pas ».

ÉQUIPE 75
${team}

SOURCES
${sources || '(aucune source pertinente trouvée pour cette question)'}`;
}

function formatSources(hits) {
  return hits.map(h => {
    const label = h.kind === 'doc' ? `[Doc : ${h.title}${h.part ? ' — extrait ' + h.part : ''}]` : h.kind === 'regle' ? `[Règle validée : ${h.title}]` : `[Fiche : ${h.title}]`;
    return `${label}\n${h.text.slice(0, 1400)}`;
  }).join('\n\n---\n\n');
}

async function chat({ user, message, history = [] }) {
  const context = [...history.slice(-4).filter(h => h.role === 'user').map(h => h.content), message].join(' ');
  const hits = kb.search(context, 7);
  const sources = [...new Map(hits.filter(h => h.kind === 'doc').map(h => [h.title, { name: h.title, link: h.link }])).values()];

  if (!cfg.aiProvider) {
    const fiche = await kb.matchFiche(message);
    if (fiche) return { reply: `**${fiche.titre}**\n\n${fiche.reponse}`, mode: 'fiche', ficheId: fiche.id, sources: [] };
    const top = hits.find(h => h.kind === 'doc');
    if (top) return { reply: `Extrait le plus proche dans la documentation :\n\n${top.text.slice(0, 700)}…`, mode: 'doc', sources: [{ name: top.title, link: top.link }] };
    return { reply: "Je n'ai pas de consigne correspondante. En cas de doute sur le terrain : consigne l'installation et appelle ton LTA ou ton binôme.", mode: 'fallback', sources: [] };
  }

  const system = systemPrompt({ user, team: await teamBlock(), sources: formatSources(hits) });
  const messages = [...history.slice(-10).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 4000) })), { role: 'user', content: message }];
  while (messages.length && messages[0].role !== 'user') messages.shift();
  // Fusion des tours consécutifs de même rôle
  const merged = [];
  for (const m of messages) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else merged.push({ ...m }); }
  const reply = await complete({ system, messages: merged });
  const cited = sources.filter(s => reply.includes(s.name));
  return { reply, mode: 'ia', sources: cited.length ? cited : sources.slice(0, 3) };
}

// Transforme une rectification d'un technicien en règle structurée (validée ensuite par un manager)
async function extractRule({ previous, correction }) {
  if (!cfg.aiProvider) return { topic: correction.slice(0, 60), category: 'technique', knowledge: correction, wrong: '', keywords: [] };
  const text = await complete({
    system: 'Tu extrais une règle métier durable à partir de la correction d\'un technicien ascensoriste. Réponds uniquement en JSON.',
    messages: [{ role: 'user', content: `Réponse précédente du copilote :\n"""${(previous || '').slice(0, 1500)}"""\n\nCorrection du technicien :\n"""${correction}"""\n\nJSON attendu : {"topic": "titre court et précis", "category": "technique|securite|equipe|procedure|general", "wrong": "ce qui était faux (ou vide)", "knowledge": "la règle exacte à retenir, formulée de façon autonome", "keywords": ["mots-clés", "de rappel"]}` }],
    maxTokens: 500, json: true,
  });
  return parseJSON(text);
}

async function analyzeIncident(inc) {
  const fallback = {
    riskScore: { Critique: 90, Élevée: 70, Moyenne: 45, Faible: 20 }[inc.gravite] || 50,
    actions: ["Mettre l'appareil à l'arrêt si la sécurité est compromise", 'Baliser les accès paliers', 'Prévenir le manager du secteur'],
    prevention: 'Contrôler l\'organe concerné à la prochaine visite et partager le retour d\'expérience en causerie.',
    epi: ['Casquette coquée', 'Gants anti-coupure', 'Chaussures S3'], source: 'règles',
  };
  if (!cfg.aiProvider) return fallback;
  try {
    const text = await complete({
      system: 'Tu es préventeur sécurité dans la maintenance d\'ascenseurs (TK Elevator). Réponds uniquement en JSON, en français, de façon concrète.',
      messages: [{ role: 'user', content: `Situation dangereuse déclarée :\n- Lieu/appareil : ${inc.site}\n- Marque : ${inc.marque}\n- Danger : ${inc.danger}\n- Gravité ressentie : ${inc.gravite}\n- Description : ${inc.description}\n\nJSON : {"riskScore": 1-100, "actions": ["3 ou 4 actions immédiates"], "prevention": "conseil de prévention pour l'équipe", "epi": ["EPI indispensables"]}` }],
      maxTokens: 600, json: true,
    });
    return { ...parseJSON(text), source: 'ia' };
  } catch (e) { console.warn('[ai] analyse incident :', e.message); return fallback; }
}

async function generateQuiz(theme) {
  const text = await complete({
    system: 'Tu crées des questions de quiz sécurité pour techniciens d\'ascenseurs TKE. Réponds uniquement en JSON.',
    messages: [{ role: 'user', content: `Thème : ${theme}. Une question qui teste un réflexe vital de terrain, 3 réponses dont une seule juste, distracteurs crédibles. JSON : {"question": "...", "options": ["...", "...", "..."], "bonne": index 0-2, "explication": "..."}` }],
    maxTokens: 500, json: true,
  });
  const q = parseJSON(text);
  if (!Array.isArray(q.options) || q.options.length !== 3) throw new Error('Question mal formée');
  return q;
}

async function causerieSynthesis(stats) {
  if (!cfg.aiProvider) return null;
  try {
    return await complete({
      system: 'Tu prépares les points clés d\'une causerie sécurité mensuelle pour une équipe SAV ascenseurs. Français, 5 puces maximum, ton direct, pas de titre.',
      messages: [{ role: 'user', content: JSON.stringify(stats).slice(0, 6000) }], maxTokens: 500,
    });
  } catch { return null; }
}

module.exports = { chat, extractRule, analyzeIncident, generateQuiz, causerieSynthesis };
