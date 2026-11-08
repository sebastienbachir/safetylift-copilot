# SafetyLift Copilot v2 — Équipe 75

Fusion des deux versions précédentes (`safetylift-tke` vanilla + `safetylift` React/AI Studio) en une seule PWA :
front HTML/CSS/JS sans build, serveur Express, base Neon, mails Brevo, déploiement GitHub → Render.

## Ce que fait l'appli

Connexion : adresse e-mail de l'annuaire (onglet Techniciens) + code d'accès.

**Technicien** (code équipe)
- Accueil : minute sécurité de la semaine + bouton « J'ai lu », appel direct de son binôme / LTA / 112, accès rapides.
- Fiches réflexes (toit, consignation, cuvette, UBC, shunts, EPI, SIF, 10 règles, 5 pièges…) : **disponibles hors ligne**.
- Copilote IA : répond à partir des fiches, des règles validées et de la **doc technique du Drive** (recherche dans le contenu des PDF/Docs), cite ses sources, n'invente pas de valeurs. Dictée vocale, lecture à voix haute, bouton « Corriger ».
- Signaler : formulaire rapide (photo possible), analyse de risque immédiate, mail aux managers. Hors réseau : gardé et renvoyé automatiquement.
- Quiz de 4 questions par semaine, annuaire avec appel en un tap, programme des 52 minutes.

**Manager** (code manager, profils LTA / RSC)
- Pilotage : qui a lu la minute, diffusion du lundi (auto on/off, diffuser maintenant, test mail, test carte Teams, historique et erreurs).
- Suivi des signalements (statuts, note de suivi, photo).
- Validation des corrections proposées par les techniciens avant que le copilote les utilise.
- Génération de questions de quiz, synchro du classeur, indexation du Drive.
- Causerie mensuelle : diaporama généré à partir des vraies données du mois.

## Ce qui a changé par rapport aux deux versions

| Avant | Maintenant |
|---|---|
| Clé Gemini et URL Power Automate en clair dans le JS client | Tout est côté serveur, en variables Render |
| Code manager `TKE2026` / `1968` / `bachir` vérifié dans le navigateur | Session signée vérifiée par le serveur, anti force brute |
| Toute correction d'un technicien devenait « vérité absolue » de l'IA | Correction → règle **en attente**, validée par un manager |
| Données dans un fichier JSON (perdu à chaque redéploiement Render) | Neon Postgres |
| Envoi Teams depuis le navigateur (dépendait d'un téléphone ouvert) | Planificateur serveur lundi 08:35 + rattrapage dans la semaine |
| Chatbot qui « dit » connaître le Drive | Indexation réelle du dossier Drive (PDF, Docs, Word, Sheets) |
| Chiffres décoratifs (100 % d'ouverture…) | Vraies lectures et scores par technicien |

## Mise en service

1. **Neon** : créer un projet `safetylift` (région Francfort), copier l'URL de connexion → `DATABASE_URL`. La table se crée toute seule.
2. **GitHub** : nouveau dépôt, pousser ce dossier.
3. **Render** : New → Blueprint sur le dépôt (lit `render.yaml`), puis saisir les variables marquées « sync: false » (voir `.env.example`).
4. **Google** (pour le copilote sur la doc + classeur privé) :
   - Google Cloud Console → créer un projet → activer *Google Drive API* et *Google Sheets API*.
   - Créer un compte de service → Clés → JSON. Coller tout le JSON dans `GOOGLE_SERVICE_ACCOUNT_JSON`.
   - Partager le dossier de doc technique **et** le classeur `SafetyLift_Database` avec l'e-mail du compte de service (lecteur).
   - Sans compte de service : le classeur est lu en CSV s'il est partagé « toute personne disposant du lien », mais la doc Drive n'est pas indexée.
5. **Teams** : coller l'URL du flux Power Automate dans `TEAMS_WEBHOOK_URL`. La charge utile contient à la fois une carte adaptative et des champs simples (`titre`, `theme`, `message`, `risque`, `semaine`, `lienApp`).
6. **Réveil du lundi** (Render gratuit s'endort) : dans n8n, un nœud *Schedule* lundi 08:30 → *HTTP Request* `GET https://<app>/api/cron/weekly?key=<CRON_SECRET>`. Sans ça, l'envoi part au premier réveil du serveur dans la semaine (rattrapage).
7. Se connecter avec son nom + `MANAGER_CODE`, ouvrir **Pilotage** → « M'envoyer un test », puis « Synchroniser » et « Indexer ».

## Classeur SafetyLift_Database (onglets lus)

| Onglet | Colonnes (ligne 1 = en-têtes) |
|---|---|
| `Minute_Securite` | n° · thème · message · risque · (date) · (statut) |
| `Chatbot_FAQ` | mots-clés (séparés par virgules) · titre · réponse |
| `Techniciens` | nom · fonction · binôme · e-mail · téléphone · secteur · actif (OUI/NON) |
| `Quiz` | id · question · A · B · C · bonne (A/B/C) · explication |

Les noms d'onglets se changent via `SHEET_TAB_*`. Est manager toute personne dont la fonction contient LTA, RSC, manager, responsable, superviseur, chef (ou listée dans `MANAGER_IDS`).

## Local

```
npm install
npm run dev     # http://localhost:3000 — codes de dev : equipe75 / manager75
```
Sans `DATABASE_URL`, les données vont dans `data/store.json`.

## Structure

```
server/index.js      routes API + démarrage
server/auth.js       sessions et rôles
server/ai.js         Grok / Claude / Gemini, prompts, extraction de règles, analyse des signalements
server/knowledge.js  recherche BM25 (fiches, règles, extraits Drive)
server/google.js     synchro Sheets + indexation Drive
server/dispatch.js   Teams, Brevo, planification du lundi
server/seed.js       contenu par défaut (52 minutes, fiches, quiz, annuaire)
public/              PWA (index.html, app.js, app.css, sw.js, manifest)
```
