// Toute la configuration passe par des variables d'environnement (Render > Environment).
const crypto = require('crypto');
const env = process.env;

function warnDefault(name, value) {
  console.warn(`[config] ${name} non défini — valeur de dev utilisée. À définir sur Render.`);
  return value;
}

const cfg = {
  port: Number(env.PORT || 3000),
  isProd: env.NODE_ENV === 'production',

  // Accès
  teamCode: env.TEAM_CODE || 'equipe75', // code de 1re connexion, avant création du code personnel
  sessionSecret: env.SESSION_SECRET || warnDefault('SESSION_SECRET', crypto.randomBytes(32).toString('hex')),
  managerIds: (env.MANAGER_IDS || '').split(',').map(s => s.trim()).filter(Boolean), // ids (slug du nom) forcés manager
  cronSecret: env.CRON_SECRET || '',

  // IA
  xaiKey: env.XAI_API_KEY || env.GROK_API_KEY || '',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  geminiKey: env.GEMINI_API_KEY || '',
  aiModel: env.AI_MODEL || '',

  // Google
  spreadsheetId: env.SHEET_ID || '1XadHVOTsClpsgFd_H1DrpHEih0G04CG1dJF9z-SeF3I',
  tabs: {
    minutes: env.SHEET_TAB_MINUTES || 'Minute_Securite',
    faq: env.SHEET_TAB_FAQ || 'Chatbot_FAQ',
    techs: env.SHEET_TAB_TECHS || 'Techniciens',
    quiz: env.SHEET_TAB_QUIZ || 'Quiz',
  },
  driveFolderId: env.DRIVE_FOLDER_ID || '1mVc9wmnMaaq23gFMQ8BXr6Qh77486Bqr',
  serviceAccount: (() => {
    const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) return null;
    try { return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); }
    catch { console.error('[config] GOOGLE_SERVICE_ACCOUNT_JSON illisible'); return null; }
  })(),

  // Diffusion
  teamsWebhookUrl: env.TEAMS_WEBHOOK_URL || '',
  brevoKey: env.BREVO_API_KEY || '',
  mailFrom: env.MAIL_FROM || 'tk.elevator.france@gmail.com',
  smsSender: (env.SMS_SENDER || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 11), // vide = SMS désactivés
  mailFromName: env.MAIL_FROM_NAME || 'SafetyLift TKE',
  incidentEmails: (env.INCIDENT_EMAILS || 'eric.barnier@tkelevator.com,sebastien.bachir@tkelevator.com').split(',').map(s => s.trim()).filter(Boolean),
  sendDay: 1, // lundi
  sendTime: env.SEND_TIME || '08:35',
  appUrl: (env.APP_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),

  // Liens
  formUrl: env.FORM_URL || 'https://docs.google.com/forms/d/e/1FAIpQLSf3YdbMS0ZEtJCN7be3U364ioUfmQCiU89Xa0B09WuOi7zx4A/viewform?usp=header',
  teamsChannelUrl: env.TEAMS_CHANNEL_URL || 'https://teams.microsoft.com/l/channel/19%3A204bb34375e34070b8c60b568e78cc2a%40thread.tacv2/SafetyLift%20copilot?groupId=dd7fb13d-8e29-4d35-a93a-db1de7f2162b&tenantId=84d9a216-e285-4aac-b163-0dfd0c074546',
};
cfg.driveFolderUrl = `https://drive.google.com/drive/folders/${cfg.driveFolderId}`;
// Fournisseur IA : AI_PROVIDER force le choix, sinon Grok > Claude > Gemini selon les clés présentes
cfg.aiProvider = (() => {
  const forced = (env.AI_PROVIDER || '').toLowerCase();
  const has = { grok: !!cfg.xaiKey, claude: !!cfg.anthropicKey, gemini: !!cfg.geminiKey };
  if (forced && has[forced]) return forced;
  return ['grok', 'claude', 'gemini'].find(p => has[p]) || null;
})();

module.exports = cfg;
