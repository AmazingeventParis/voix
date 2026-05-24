# Voix Shootnbox — Documentation complète

Assistant vocal pour le groupe Shootnbox. Le client parle, l'assistant répond en voix réaliste avec des infos sourcées du vrai site shootnbox.fr / smakk.fr et des FAQ personnalisées.

---

## 🎯 Vision

Un assistant vocal **gratuit ou low-cost** (~2€/mois) intégrable à deux endroits :
- **Widget JS** sur shootnbox.fr (web)
- **Bouton micro** dans l'app Flutter MyShootnbox (mobile)

Pour répondre instantanément aux questions des clients : tarifs, types de bornes, livraison, utilisation de l'app, etc.

---

## 🧱 Stack technique

| Couche | Choix | Pourquoi |
|---|---|---|
| **STT** (toi qui parles) | Web Speech API du navigateur | Gratuit, intégré Chrome/Edge/Safari, marche sans clé |
| **Cerveau (LLM)** | Groq (Llama 3.3 70B) | Gratuit avec quotas généreux, **ultra-rapide** (~500 tok/s) — critique pour réduire la latence vocale |
| **LLM fallback** | Gemini 2.0 Flash | Aussi gratuit, sert si Groq indispo |
| **Voix (TTS)** | OpenAI TTS-1-HD voix `coral` | Voix féminine chaleureuse, quasi-humaine. ~2€/mois pour 500 conversations |
| **TTS fallback gratuit** | Microsoft Edge TTS, sinon Google Translate TTS | Si jamais on veut basculer 100% gratuit |
| **Knowledge base** | 405 pages scrapées (shootnbox.fr + smakk.fr) | Indexées en local pour réponses sourcées |
| **Recherche** | MiniSearch (BM25) sur 6716 chunks | Pas d'embeddings nécessaire → 0 coût d'indexation |
| **FAQ personnalisée** | JSON éditable via admin web | Réponses officielles prioritaires sur le LLM |
| **Backend** | Node.js 24 + Express | Léger, déployable Coolify |

---

## 🏗️ Architecture

```
                  ┌──────────────────────┐
                  │  Front : shootnbox.fr │
                  │  ou app MyShootnbox   │
                  └──────────┬───────────┘
                             │ POST /chat
                             ▼
              ┌─────────────────────────────┐
              │      API Node.js Express     │
              │                              │
              │  1. searchFaq(question)      │
              │     ├─ Match fort ? ─────────┼──→ Réponse FAQ directe (skip LLM)
              │     └─ Sinon ─────┐          │
              │                   ▼          │
              │  2. ragSearch(question)      │
              │     → top 4 chunks site      │
              │                              │
              │  3. askLLM(question + ctx)   │
              │     → Groq Llama 3.3         │
              │                              │
              │  4. textToSpeech(réponse)    │
              │     → OpenAI Coral           │
              └──────────────┬───────────────┘
                             │ {text, audio_base64, sources}
                             ▼
                    Lecture audio navigateur
```

### Flux de décision

| Cas | Action |
|---|---|
| **Question simple** + match FAQ très fort (score ≥ 8) | **Réponse FAQ directe**. Pas d'appel LLM. Gratuit, instantané, cohérent. |
| **Question multiple** (cf. détection ci-dessous) | LLM appelé avec **top 5 FAQ + top 8 RAG** pour couvrir tous les sujets |
| Question simple proche d'une FAQ | LLM avec les FAQ comme exemples + RAG du site |
| Question sans FAQ pertinente | LLM + RAG sur les 405 pages scrapées |
| Hors sujet (recette, météo…) | Le prompt système redirige poliment vers Shootnbox |

### Mémoire conversationnelle (follow-up)

L'assistant garde le contexte des questions précédentes. Si tu enchaînes :

```
Toi : C'est quoi le Vegas ?
Bot : Le Vegas est notre borne photo la plus populaire, idéale pour…
Toi : Et son prix ?
Bot : Le prix du Vegas dépend de la durée, des options…  ← comprend "le Vegas"
Toi : Pour combien de personnes ?
Bot : Le Vegas accueille jusqu'à…                         ← suit toujours le contexte
```

Comment ça marche :
- **Côté client** : la page web maintient un tableau `history` envoyé à chaque appel
- **Côté serveur** :
  - L'historique est passé au LLM (mémoire conversation classique)
  - **Plus important** : la requête de recherche RAG/FAQ est **enrichie** avec le dernier échange si la question courante est un follow-up détecté
  - Heuristique follow-up : question courte (< 60 chars) commençant par *"Et …"*, *"Son …"*, *"Le …"*, *"Comment …"*, etc.
  - Si follow-up détecté → on désactive le raccourci FAQ direct (la FAQ matchée pourrait être hors contexte)

⚠️ **Limite actuelle** : l'historique vit dans le navigateur. Si tu rafraîchis la page, la mémoire repart à zéro. (À terme : ajouter localStorage ou stockage serveur par session.)

### Détection multi-question

Une heuristique détecte si l'utilisateur pose plusieurs questions dans le même message. Cas détectés :

- **2+ points d'interrogation** : *"C'est cher ? Vous livrez à Lyon ?"*
- **Coordination** : *"et est-ce que…"*, *"et combien…"*, *"et aussi…"*, *"ainsi que…"*, *"et puis…"*
- **"Aussi/également" + mot interrogatif** : *"tarifs et aussi quels types…"*
- **2+ mots interrogatifs** dans un message > 40 chars : *"combien ça coûte avec quelles options…"*
- **2+ phrases avec marqueurs interrogatifs** séparées par `.` ou `;`

Si multi-question détectée :
- Le **raccourci FAQ direct est désactivé** (sinon on ne répondrait qu'à la 1ère question)
- On monte le `topK` du RAG (4 → 8) et de la FAQ (2 → 5)
- Le LLM compose une réponse qui répond à **chaque sous-question** dans l'ordre, avec des transitions naturelles (*"Alors, pour… Et concernant…"*)

---

## 📂 Structure du projet

```
C:\Users\asche\Downloads\claude\Voix\
├── server.js              # API Express : /chat /tts /search /admin /api/faq
├── rag.js                 # MiniSearch sur les pages scrapées
├── faq.js                 # Store FAQ : load, search, add, update, delete
├── scraper.js             # Crawl shootnbox.fr + smakk.fr → data/scraped/*.md
├── package.json
├── .env                   # Clés API (GROQ, OPENAI, ADMIN_PASSWORD)
├── .env.example
├── README.md
├── Voix.md                # Ce document
│
├── public/
│   ├── index.html         # Page de test client (chat + micro)
│   ├── admin.html         # Interface admin FAQ
│   └── nova_test.mp3      # (échantillon audio test)
│
└── data/
    ├── scraped/           # 405 fichiers .md scrapés
    │   ├── shootnbox.fr/  # 205 pages
    │   └── smakk.fr/      # 200 pages
    ├── manifest.json      # Index du scraping
    └── faq.json           # Tes Q/R personnalisées
```

---

## 🔌 Endpoints API

| Route | Méthode | Auth | Description |
|---|---|---|---|
| `/` | GET | – | Page de test web (chat + micro) |
| `/admin` | GET | – | Interface admin FAQ |
| `/health` | GET | – | Statut serveur (LLM, voix, RAG stats) |
| `/chat` | POST | – | `{message, history?, voice?}` → `{text, audio_base64, source, sources?}` |
| `/tts` | POST | – | `{text, voice?}` → MP3 stream (utile pour preview voix) |
| `/search` | POST | – | `{query, topK}` → debug du RAG sur le site |
| `/api/faq` | GET | token | Liste toutes les FAQ |
| `/api/faq` | POST | token | Ajoute une FAQ `{questions[], answer, tags[]}` |
| `/api/faq/:id` | PUT | token | Modifie une FAQ |
| `/api/faq/:id` | DELETE | token | Supprime une FAQ |

Auth admin : header `x-admin-token: <ADMIN_PASSWORD>` ou `?token=...`

---

## 🔐 Système FAQ personnalisée

### Pourquoi ?

Le RAG sur le site est bon pour les infos générales, mais :
- ❌ Peut louper une formulation inhabituelle
- ❌ Le LLM peut être prudent et rediriger vers un devis au lieu de répondre
- ❌ Coût LLM + délai de réponse à chaque question

La FAQ comble ces trous : **tes** réponses, dans **ton** ton, avec **tes** infos exactes.

### Comment ça marche

Chaque entrée FAQ a :
- **Plusieurs variantes** de question (plus il y en a, mieux c'est)
- **Une réponse** (1-3 phrases orales)
- **Des tags** optionnels pour le tri

À chaque question utilisateur :
1. L'API tokenise la question (sans accents, sans stopwords)
2. Cherche dans toutes les FAQ via MiniSearch (BM25 + fuzzy match)
3. Si meilleur score ≥ **seuil 8** → réponse FAQ directe (skip LLM, économie totale)
4. Sinon → top 2 FAQ injectées dans le prompt comme exemples + RAG normal

### Comment ajouter une FAQ

1. Va sur **http://localhost:3000/admin**
2. Mot de passe par défaut : `shootnbox2026` (modifiable dans `.env` → `ADMIN_PASSWORD=`)
3. Remplis le formulaire :
   - **Questions** : une par ligne, **mets plusieurs variantes** !
   - **Réponse** : phrases orales, 1 à 3 phrases max
   - **Tags** : optionnel, pour t'organiser
4. Clic "Ajouter cette Q/R" → l'index se recharge instantanément, la réponse est dispo

### Bonnes pratiques

✅ **À faire**
- 3-5 variantes par question minimum (formulations différentes)
- Réponses courtes, orales, naturelles
- Toujours inclure un CTA quand pertinent (devis, contact)
- Tag par thème (tarif, livraison, app, mariage, etc.)

❌ **À éviter**
- Réponses personnalisées à un client précis ("votre créneau 13h-16h") — ça sera lu à tous
- Markdown, listes à puces — c'est de l'oral
- Phrases trop longues — coupe court
- Faire des FAQ avec une seule formulation — tu rates 80% des reformulations clients

### Exemple bien construit

```json
{
  "id": 5,
  "questions": [
    "Combien de temps dure la location ?",
    "C'est pour combien d'heures ?",
    "Durée de location",
    "On garde la borne combien de temps ?",
    "Plage horaire de la location"
  ],
  "answer": "La durée standard est de 4 heures de prestation effective, mais on peut étendre selon ton événement. Pour une demande précise, fais ton devis sur shootnbox.fr.",
  "tags": ["durée", "horaire", "location"]
}
```

---

## 🌐 Sites scrapés

| Domaine | Pages scrapées | Pages totales sitemap |
|---|---|---|
| shootnbox.fr | 205 | 385 (–180 SEO villes redondantes) |
| smakk.fr | 200 | 208 |
| **Total** | **405** | **593** |

Le scraper :
- Récupère les sitemaps automatiquement
- Skip les pages SEO ville répétitives (garde 1 template)
- Skip auteurs/catégories/tags techniques
- Détecte le moteur (Elementor pour smakk, thème custom pour shootnbox)
- Extrait le contenu principal en Markdown

Pour re-scraper après modification du site :
```powershell
cd C:\Users\asche\Downloads\claude\Voix
node scraper.js
# Puis redémarre le serveur pour réindexer
```

---

## 🚀 Lancer en local

```powershell
cd C:\Users\asche\Downloads\claude\Voix
npm install        # première fois uniquement
node server.js
# → http://localhost:3000        (chat)
# → http://localhost:3000/admin  (admin FAQ)
```

### Configuration `.env`

```bash
# CERVEAU
GROQ_API_KEY=gsk_xxx           # gratuit https://console.groq.com/keys
GEMINI_API_KEY=                # optionnel fallback

# VOIX
TTS_PROVIDER=openai            # edge | openai | google
OPENAI_API_KEY=sk-proj-xxx     # https://platform.openai.com/api-keys ($5 minimum)
OPENAI_VOICE=coral             # coral | nova | shimmer | sage | alloy | ash | echo | ballad | onyx | fable | verse
TTS_VOICE=fr-FR-DeniseNeural   # (utilisé si TTS_PROVIDER=edge)

# ADMIN
ADMIN_PASSWORD=shootnbox2026   # accès à /admin

PORT=3000
```

---

## 💰 Coûts mensuels estimés

Hypothèse : **500 conversations/mois** × 300 caractères de réponse en moyenne.

| Combo | Coût/mois |
|---|---|
| Groq + Edge TTS | **0€** (mais Edge TTS peut casser sans préavis) |
| Groq + Google Translate TTS | **0€** (voix robotique) |
| **Groq + OpenAI Coral HD** ✅ | **~2€** (notre setup actuel) |
| Claude Haiku + OpenAI Coral HD | ~3€ |
| Claude Sonnet + ElevenLabs | ~15€ |

⚠️ Avec des **FAQ bien remplies**, ~40% des questions sont matchées directement → **divisé par 2** la conso OpenAI réelle.

---

## 📦 État actuel (24 mai 2026)

### ✅ Fait
- [x] Backend Node.js + Express (server.js)
- [x] LLM Groq Llama 3.3 70B avec fallback Gemini (askLLM)
- [x] TTS 3 providers : Edge (gratuit) / OpenAI HD (premium) / Google (fallback)
- [x] 11 voix OpenAI configurables (coral par défaut)
- [x] Page web de test (`/` — chat + micro Web Speech API)
- [x] Scraper shootnbox.fr + smakk.fr : 405 pages en Markdown
- [x] RAG MiniSearch BM25 : 6716 chunks indexés, cite ses sources
- [x] Système FAQ personnalisée (`data/faq.json` + `faq.js`)
- [x] Interface admin web (`/admin`) protégée par mot de passe
- [x] Match FAQ prioritaire (skip LLM si match fort)

### ⏳ À faire
- [ ] **Déploiement Coolify** → `https://voix.swipego.app` (prérequis pour les 2 intégrations)
- [ ] **Widget JS embeddable** pour shootnbox.fr (bouton micro flottant)
- [ ] **Package Flutter** pour MyShootnbox (bouton micro dans l'app)
- [ ] (Bonus) Branchement Supabase pour réponses dynamiques (créneau livraison réel, statut commande, etc.)

---

## 🛣️ Roadmap

### Phase 1 : Pilot local — ✅ FAIT
Backend complet, RAG, FAQ, admin, test en local sur PC.

### Phase 2 : Mise en prod — EN COURS
1. Deploy Coolify sur nouveau serveur (217.182.89.133)
2. Sous-domaine `voix.swipego.app` (Traefik SSL auto)
3. Test public depuis mobile

### Phase 3 : Intégration shootnbox.fr
Widget JS auto-chargé via `<script src="https://voix.swipego.app/widget.js">` dans le footer WordPress. Bouton micro flottant en bas à droite, ouvre une modale chat.

### Phase 4 : Intégration MyShootnbox (Flutter)
Nouvel onglet "Assistant" ou bouton micro dans le menu principal. Utilise `speech_to_text` (STT natif iOS/Android) + http POST `/chat` + `just_audio` pour lecture MP3.

### Phase 5 : Données dynamiques (optionnel)
Branchement Supabase pour répondre avec les vraies infos client : créneau réservé, statut commande, lien galerie événement, etc. Demande un système d'auth par téléphone ou token de réservation.

---

## 🔧 Commandes utiles

```powershell
# Démarrer
node server.js

# Tester un endpoint
curl http://localhost:3000/health
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"message\":\"prix borne mariage\"}"

# Re-scraper (après modif site)
node scraper.js

# Voir ce que le RAG remonte pour une question
curl -X POST http://localhost:3000/search -H "Content-Type: application/json" -d "{\"query\":\"aircam 360\",\"topK\":3}"
```

---

## 🐛 Problèmes connus

- **Edge TTS échoue dans la sandbox Claude Code** → bloqué au niveau WebSocket vers `speech.platform.bing.com`. Sur ta machine en dehors de Claude, ça devrait marcher. Pour l'instant on bypasse en utilisant OpenAI TTS.
- **Variantes manquantes en FAQ** → si tu ajoutes une FAQ avec une seule formulation, le matching fuzzy n'attrapera pas les reformulations clients. Mets-en plusieurs.
- **Pas de mémoire long terme** → l'historique est passé client → serveur à chaque appel (paramètre `history` de `/chat`). Pas de stockage des conversations côté serveur pour l'instant.
