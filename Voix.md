# Voix Shootnbox — Documentation complète (handoff)

> Ce document permet à n'importe qui (humain ou IA) de **reprendre le projet de zéro**.
> Lis-le en entier avant de toucher au code. Dernière mise à jour : 2026-05-28.

---

## 1. Résumé en 30 secondes

**Voix** est un assistant vocal pour le groupe Shootnbox (location de photobooths).
Le client **parle** (micro), l'assistant **comprend**, cherche dans une base de connaissances (site + FAQ + catalogue), **répond par texte ET en voix réaliste**, et **pose des questions de qualification** comme un vrai commercial.

- **En prod** : https://voix.swipego.app (protégé par mot de passe)
- **Repo** : https://github.com/AmazingeventParis/voix (public, sans secrets)
- **Hébergement** : Coolify sur serveur OVH `217.182.89.133`
- **Coût réel** : ~0-2 €/mois (LLM gratuit + voix OpenAI à l'usage)

---

## 2. Vision & objectif

But final : intégrer cet assistant à **2 endroits** (pas encore fait) :
1. **Widget sur shootnbox.fr** (site web public)
2. **App Flutter MyShootnbox** (mobile, déjà en prod sur stores)

Le backend est **unique et centralisé** : les deux fronts appelleront la même API. Pour l'instant on a un MVP complet + page web + page d'entraînement, déployé et fonctionnel, mais **pas encore branché sur le site ni l'app**.

---

## 3. Accès rapide (où est quoi)

| Ressource | Valeur |
|---|---|
| URL prod | https://voix.swipego.app |
| Repo GitHub | https://github.com/AmazingeventParis/voix (public) |
| Dossier local | `C:\Users\asche\Downloads\claude\Voix` |
| Coolify UI | https://coolify.swipego.app (ou IP directe `http://217.182.89.133:8000`) |
| App UUID Coolify | `x12u3ebbfc6bmsn7iuh77jo2` |
| Serveur UUID | `s0cw4wsowg8wkok4wkwsko44` |
| Projet UUID | `c4gw0sos0o4cgws4404s4cwk` |
| Mot de passe admin/chat | dans `.env` local (`ADMIN_PASSWORD`) — aussi dans CLAUDE.md global |

### Pages disponibles (toutes protégées par mot de passe)
- `/` — chat de test (micro + voix)
- `/train` — entraînement vocal mobile (créer des FAQ depuis le téléphone)
- `/admin` — gestion FAQ + conversations loguées + catalogue

### Où sont les secrets (clés API)
**JAMAIS dans le repo** (le repo est public). Ils vivent à 2 endroits :
1. **`.env` local** (dans le dossier, gitignored) — pour le dev local
2. **Variables d'environnement Coolify** (panel de l'app) — pour la prod

Clés nécessaires : `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ADMIN_PASSWORD`.
Voir `.env.example` pour la liste complète et où les obtenir.

---

## 4. Stack technique (et pourquoi)

| Couche | Techno | Pourquoi ce choix |
|---|---|---|
| **STT** (parole→texte) | Web Speech API navigateur | Gratuit, intégré Chrome/Edge/Safari, 0 clé, marche sur mobile |
| **Cerveau (LLM)** | Groq Llama 3.3 70B → Gemini → OpenAI GPT-4o-mini | Chain de fallback (voir §7). Groq = gratuit + ultra-rapide |
| **Voix (TTS)** | OpenAI TTS-1-HD voix `coral` | Voix féminine quasi-humaine. ~0,001 €/réponse |
| **TTS fallback** | Edge TTS (gratuit) → Google Translate TTS | Si on veut du 100% gratuit (voix moins bonnes) |
| **Recherche (RAG)** | MiniSearch (BM25 full-text) | Pas besoin d'embeddings → 0 coût, 0 dépendance externe |
| **Connaissances** | 405 pages scrapées shootnbox.fr + smakk.fr | Réponses sourcées sur le vrai contenu |
| **FAQ** | JSON éditable via /admin | Réponses officielles prioritaires sur le LLM |
| **Catalogue** | JSON structuré (bornes/tarifs) | Source de vérité injectée intelligemment |
| **Backend** | Node.js 24 + Express (ESM) | Léger, déployable Coolify via Dockerfile |
| **Hébergement** | Coolify (PaaS self-hosted) + Traefik SSL | Même infra que les autres projets du groupe |

---

## 5. Architecture & flux d'une requête

```
[Navigateur : micro Web Speech API → texte]
         │  POST /chat {message, history, voice}  + header x-admin-token
         ▼
┌──────────────────────── server.js ────────────────────────┐
│                                                            │
│  1. requireAuth (vérifie le mot de passe)                  │
│                                                            │
│  2. isMultiQuestion(message) ?  isFollowUp(message) ?      │
│                                                            │
│  3. SI question simple + match FAQ très fort (score≥30)    │
│        → réponse FAQ directe (SKIP LLM, gratuit, instant)  │
│                                                            │
│  4. SINON :                                                 │
│     a. buildSearchQuery() — enrichit avec l'historique     │
│        si c'est un follow-up                               │
│     b. ragSearch() — top chunks du site (MiniSearch)       │
│     c. faq.searchFaq() — FAQ proches                       │
│     d. buildSystemPrompt() — assemble :                    │
│          prompt de base + catalogue contextualisé          │
│          + FAQ + extraits site                             │
│     e. askLLM() — chain Groq→Gemini→OpenAI                 │
│                                                            │
│  5. textToSpeech(reply) — OpenAI Coral → MP3              │
│  6. logger.logExchange() — log dans conversations.jsonl    │
│                                                            │
└────────────────────────────────────────────────────────────┘
         │  {text, audio_base64, source, sources}
         ▼
[Navigateur : affiche le texte + joue l'audio]
```

---

## 6. Structure des fichiers

```
Voix/
├── server.js          # API Express — CŒUR DU PROJET (646 lignes)
├── rag.js             # Recherche MiniSearch sur les pages scrapées (130 l)
├── faq.js             # Store FAQ : load/search/add/update/delete (126 l)
├── logger.js          # Log conversations + détection réponses faibles (84 l)
├── scraper.js         # Crawl shootnbox.fr + smakk.fr → data/scraped/ (178 l)
├── Dockerfile         # Image de prod (node:24-alpine)
├── .dockerignore
├── .gitignore         # exclut .env, node_modules, conversations.jsonl
├── .env               # SECRETS (local, gitignored) — clés API + mot de passe
├── .env.example       # Template des variables d'env
├── package.json       # deps : express, cors, dotenv, msedge-tts, minisearch, gray-matter, cheerio
├── README.md          # Quickstart
├── Voix.md            # CE FICHIER
│
├── public/
│   ├── index.html     # Page chat (micro + voix + login)
│   ├── admin.html     # Admin 3 onglets : FAQ / Conversations / Catalogue
│   └── train.html     # Entraînement vocal mobile-first
│
└── data/
    ├── scraped/       # 405 fichiers .md (205 shootnbox + 200 smakk)
    │   ├── shootnbox.fr/
    │   └── smakk.fr/
    ├── manifest.json  # Index du scraping (URLs + métadonnées)
    ├── faq.json       # FAQ personnalisées (éditable via /admin)
    ├── catalogue.json # Catalogue bornes/tarifs/options
    └── conversations.jsonl  # Logs (généré au runtime, gitignored)
```

### Rôle de chaque fichier JS

- **server.js** — Tout le backend. Routes, auth, chain LLM, TTS, assemblage du prompt, détection multi-question/follow-up. C'est le fichier à comprendre en priorité.
- **rag.js** — Charge les .md, les découpe en chunks (~800 chars), construit un index MiniSearch (BM25), expose `search(query, topK)`.
- **faq.js** — Gère `data/faq.json`. `findStrongMatch()` = match direct (seuil 30 + ratio top1/top2 ≥ 2.5 pour éviter les faux positifs). `searchFaq()` = recherche souple pour le contexte LLM.
- **logger.js** — Append chaque échange dans `conversations.jsonl`. Détecte les "réponses faibles" (regex : "je vous invite", "demander un devis"…) pour repérer ce qu'il faut enrichir.
- **scraper.js** — À relancer si le site change. Récupère les sitemaps, filtre les pages SEO ville redondantes, détecte le moteur (Elementor pour smakk, thème custom pour shootnbox), extrait le contenu en Markdown.

---

## 7. La chain LLM (point critique)

Dans `server.js`, `askLLM()` essaie 3 cerveaux dans l'ordre. Si l'un échoue avec une erreur **récupérable** (429 quota, 503, 5xx), il passe au suivant :

```
1. Groq Llama 3.3 70B    → gratuit, rapide, excellent mode commercial
        ↓ (si 429/503/5xx)
2. Gemini 2.5 Flash      → gratuit  ⚠️ ATTENTION : la clé actuelle renvoie
                            "limit: 0" / 403. À re-créer (voir §11)
        ↓ (si erreur)
3. OpenAI GPT-4o-mini    → payant ~0,15$/1M tokens (≈0,03 cent/req)
                            très fiable, bon mode commercial
```

**Pourquoi 3 niveaux** : Groq a un quota gratuit serré (100k tokens/jour ≈ 50 questions). Pour ne jamais couper le service, on bascule automatiquement. En pratique Groq fait 95% du boulot → coût ≈ 0.

Modèles utilisés (à connaître pour les mettre à jour) :
- Groq : `llama-3.3-70b-versatile`
- Gemini : `gemini-2.5-flash`
- OpenAI (cerveau) : `gpt-4o-mini`
- OpenAI (voix) : `tts-1-hd`, voix `coral`

---

## 8. Fonctionnalités développées (chronologie)

Construites dans cet ordre, du 2026-05-23 au 2026-05-28 :

1. **MVP backend** — API `/chat` + `/tts`, Groq + Edge TTS
2. **Page web de test** (`index.html`) — micro Web Speech API + chat + lecture audio
3. **Choix de la voix** — Edge TTS bloqué en sandbox → bascule OpenAI. 11 voix testables, **Coral** choisie
4. **Scraper** — 405 pages shootnbox.fr + smakk.fr en Markdown
5. **RAG MiniSearch** — 6716 chunks indexés, réponses sourcées
6. **Système FAQ** — `data/faq.json` + match prioritaire + `/admin`
7. **Multi-questions** — détecte "et", "aussi", 2+ "?" → répond à chaque sous-question
8. **Mémoire conversationnelle** — follow-up ("Et son prix ?") garde le contexte (ex: Vegas)
9. **Catalogue produits** — `data/catalogue.json`, injecté intelligemment (seulement les bornes citées)
10. **Logging + apprentissage** — toutes les convs loguées, bouton "Convertir en FAQ" dans /admin
11. **Page /train** — entraînement vocal mobile : pose une question, donne la bonne réponse (texte ou vocal), génère 4 variantes auto via LLM, sauve en FAQ
12. **Mode commercial actif** — le bot POSE des questions de qualification (lieu/date/type/invités/durée) avant de chiffrer
13. **Déploiement Coolify** — prod sur voix.swipego.app
14. **Auth** — mot de passe sur chat + admin + train
15. **Optimisation tokens** — ~5k → ~2k tokens/req (catalogue light, prompt compressé, historique limité à 6 messages)
16. **Chain LLM 3 niveaux** — Groq → Gemini → OpenAI, fallback auto

### Comportements clés à connaître

- **Match FAQ direct** : si question simple + score FAQ ≥ 30 + top1 nettement > top2 → réponse FAQ sans appeler le LLM (gratuit, instantané). Désactivé pour les follow-ups et multi-questions.
- **Mode commercial** : piloté par le `SYSTEM_PROMPT_BASE`. Le bot demande lieu/date/type/invités/durée avant un tarif. Ne redemande pas une info déjà donnée (lit l'historique).
- **Catalogue contextualisé** : `buildCatalogueSnippet()` n'injecte que les bornes mentionnées dans la question ou détectées dans les chunks RAG (économie de tokens).

---

## 9. Endpoints API

| Route | Méthode | Auth | Description |
|---|---|---|---|
| `/` | GET | – | Page chat |
| `/train` | GET | – | Page entraînement |
| `/admin` | GET | – | Page admin |
| `/health` | GET | – | Statut (LLM, voix, stats RAG) |
| `/api/login` | POST | – | Valide un mot de passe `{password}` |
| `/chat` | POST | ✅ | `{message, history, voice}` → `{text, audio_base64, source, sources}` |
| `/tts` | POST | ✅ | `{text, voice}` → MP3 (preview voix) |
| `/search` | POST | ✅ | `{query, topK}` → debug RAG |
| `/api/variants` | POST | ✅ | `{question}` → 4 reformulations générées par LLM |
| `/api/train/test` | POST | ✅ | `{message, history}` → réponse SANS audio (mode train, économie) |
| `/api/faq` | GET/POST | ✅ | Liste / ajoute une FAQ |
| `/api/faq/:id` | PUT/DELETE | ✅ | Modifie / supprime |
| `/api/conversations` | GET/DELETE | ✅ | Logs + stats / vide les logs |
| `/api/catalogue` | GET/PUT | ✅ | Lit / écrit `data/catalogue.json` |

Auth = header `x-admin-token: <ADMIN_PASSWORD>` ou `?token=...`

---

## 10. Développer en local

```powershell
cd C:\Users\asche\Downloads\claude\Voix
npm install                  # 1ère fois
# Crée .env à partir de .env.example et remplis les clés
node server.js               # → http://localhost:3000
```

Re-scraper le site (si shootnbox.fr/smakk.fr change) :
```powershell
node scraper.js              # régénère data/scraped/ + manifest.json
# puis redémarre le serveur pour réindexer
```

Tester un endpoint :
```powershell
curl http://localhost:3000/health
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -H "x-admin-token: <PASSWORD>" -d '{"message":"prix vegas mariage lyon"}'
```

---

## 11. Déploiement (Coolify)

Le repo GitHub est connecté à Coolify. **Workflow de déploiement** :

```powershell
git add . && git commit -m "mon changement"
git push
# Puis déclencher le build Coolify :
curl "http://217.182.89.133:8000/api/v1/deploy?uuid=x12u3ebbfc6bmsn7iuh77jo2&force=true" -H "Authorization: Bearer <TOKEN_COOLIFY>"
```

Le `<TOKEN_COOLIFY>` est dans le CLAUDE.md global de l'utilisateur (infra partagée).

Le build prend ~20-60s. Vérifier ensuite :
```powershell
curl https://voix.swipego.app/health
```

### ⚠️ Important sur le déploiement
- Le repo doit être **public** OU avoir une deploy key SSH configurée dans Coolify (actuellement public car aucun secret dans le code).
- Les **données scrapées** (`data/scraped/`) DOIVENT être commitées (sinon RAG = 0 chunks en prod). Elles sont volontairement retirées du `.gitignore`.
- Les **secrets** sont en variables d'env Coolify (pas dans le repo). Pour en ajouter une :
  ```
  POST http://217.182.89.133:8000/api/v1/applications/x12u3ebbfc6bmsn7iuh77jo2/envs
  Body JSON : {"key":"NOM","value":"valeur","is_preview":false,"is_literal":true}
  ```
  ⚠️ ne PAS envoyer le champ `is_build_time` (rejeté par l'API).

### API Coolify : note
L'API ne répond QUE sur l'IP directe `http://217.182.89.133:8000`, **pas** sur `https://coolify.swipego.app` (problème de routage Traefik à ce jour).

---

## 12. Problèmes rencontrés & solutions (pour ne pas refaire les erreurs)

| Problème | Cause | Solution appliquée |
|---|---|---|
| **Edge TTS échoue** (Connect Error) | Sandbox Claude Code bloque le WebSocket vers `speech.platform.bing.com` | Bascule sur OpenAI TTS. Edge marche sur une vraie machine mais peu fiable, on l'a abandonné en prod |
| **Scraper smakk : 391 chars partout** | smakk utilise Elementor, mauvais sélecteur CSS | Détection `.elementor-widget-theme-post-content` |
| **Scraper shootnbox : 16 pages au lieu de 205** | Le `<body>` a la classe `header-layout-logo-menu` → mes filtres `[class*="header"]` viraient tout le body | Sélecteurs ciblés sur `div[...]` + `[id*=...]`, jamais sur le body |
| **RAG plante au boot** | `:` dans les titres cassait le YAML frontmatter | Échapper les valeurs frontmatter avec guillemets |
| **FAQ "Vegas" matche Aircam** | fuzzy matching trop permissif (score 26 sur seuil 8) | Seuil monté à 30 + ratio top1/top2 ≥ 2.5 + AND au lieu de OR |
| **/train ne garde pas le contexte** | `/api/train/test` n'envoyait pas l'historique | Ajout du paramètre `history` + maintien côté client |
| **Quota Groq explosé (97k/100k)** | ~37 requêtes de test × ~6k tokens (catalogue entier injecté) | Optimisation : catalogue contextualisé, prompt compressé → ~2k tokens/req |
| **Clé Gemini "limit: 0" / 403** | Projet Google AI Studio bloqué/sans accès free tier | **NON RÉSOLU** — la clé Gemini actuelle ne marche pas. Fallback OpenAI prend le relais. À refaire : créer un nouveau projet Google AI Studio + nouvelle clé |

---

## 13. Coûts

Hypothèse usage modéré (quelques centaines de questions/mois) :

| Poste | Coût |
|---|---|
| Groq (cerveau, 95% des requêtes) | **0 €** |
| Gemini (fallback) | 0 € (quand ça marche) |
| OpenAI GPT-4o-mini (fallback ultime) | ~0,3 €/mois pire cas |
| OpenAI TTS Coral (voix) | ~1-2 €/mois selon volume |
| Serveur OVH + Coolify | déjà payé (infra partagée) |
| **TOTAL** | **~1-2 €/mois** |

Astuce : un bon remplissage de la FAQ réduit les appels LLM (match direct gratuit) ET améliore la qualité.

---

## 14. Ce qui reste à faire (roadmap)

- [ ] **Widget JS embeddable** pour shootnbox.fr (bouton micro flottant `<script src=...>`)
- [ ] **Intégration Flutter** dans MyShootnbox (package Dart : `speech_to_text` + http + `just_audio`)
- [ ] **Recréer une clé Gemini fonctionnelle** (la clé actuelle est bloquée)
- [ ] **Remplir le catalogue** avec les vrais tarifs (`data/catalogue.json` a des placeholders sur les prix)
- [ ] **Enrichir la FAQ** (objectif 50-100 entrées via /train)
- [ ] (Bonus) **Branchement Supabase** pour réponses dynamiques : dispo réelle d'une date, statut commande, créneau de livraison réel d'un client
- [ ] (Bonus) **Persistance des conversations** (actuellement l'historique vit dans le navigateur, perdu au refresh)

---

## 15. Checklist pour reprendre le projet

Si tu es un nouveau dev / Claude qui reprend :

1. **Lis ce fichier en entier.**
2. Clone le repo : `git clone https://github.com/AmazingeventParis/voix`
3. Récupère les secrets : demande à l'utilisateur le `.env` (ou les clés). Sans clés LLM, rien ne marche.
4. `npm install` puis `node server.js` → teste sur http://localhost:3000
5. Pour comprendre le code, commence par **server.js** (le flux `/chat`), puis rag.js, faq.js.
6. Pour modifier le comportement commercial : édite `SYSTEM_PROMPT_BASE` dans server.js.
7. Pour déployer : `git push` + appel API Coolify (voir §11).
8. **Prochaine grosse étape logique** : le widget JS pour shootnbox.fr (front simple qui appelle `/chat`), puis l'intégration Flutter.

### Détails métier importants
- Shootnbox = location photobooths (Vegas, AirCam 360, Ring, Spinner, Fashion Box, Photobooth, Karaoké, Photocall)
- Smakk = marque mariage du même groupe (smakk.fr)
- MyShootnbox = app mobile pour les invités (photos, défis, galerie)
- Le ton doit être **commercial chaleureux**, qualifier avant de chiffrer, toujours finir par un CTA (devis sur shootnbox.fr)
- Voix par défaut : **Coral** (OpenAI), féminine chaleureuse

---

*Fin du document. Pour toute question sur l'infra partagée (serveur, Coolify, Supabase), voir le CLAUDE.md global de l'utilisateur.*
