# Voix Shootnbox — Assistant vocal

Assistant vocal pour shootnbox.fr, smakk.fr et l'app MyShootnbox. Tu parles, il répond en voix réaliste.

## Stack

- **STT** (toi qui parles) : Web Speech API du navigateur — gratuit, intégré Chrome/Edge/Safari
- **Cerveau (LLM)** : Groq (Llama 3.3 70B) — gratuit avec quotas généreux, ultra-rapide
- **Voix (TTS)** : 3 options selon ton budget
  - `edge` — Microsoft Edge TTS, gratuit, voix neurales très naturelles (Denise, Henri…)
  - `openai` — OpenAI TTS-1-HD, ~5€/mois pour 1000 conversations, voix `nova` quasi-humaine
  - `google` — Google Translate TTS, gratuit mais voix robotique (fallback de secours)

## Démarrage rapide

```powershell
npm install
# Edite .env : ajoute ta clé Groq (gratuite) sur https://console.groq.com/keys
npm start
# Ouvre http://localhost:3000
```

## Configuration `.env`

| Variable | Valeur |
|---|---|
| `GROQ_API_KEY` | Clé Groq gratuite — https://console.groq.com/keys |
| `GEMINI_API_KEY` | Alternative gratuite — https://aistudio.google.com/apikey |
| `TTS_PROVIDER` | `edge` (défaut, gratuit) / `openai` (premium) / `google` (fallback) |
| `TTS_VOICE` | Voix Edge : `fr-FR-DeniseNeural`, `fr-FR-EloiseNeural`, `fr-FR-HenriNeural`… |
| `OPENAI_API_KEY` | Si `TTS_PROVIDER=openai` — https://platform.openai.com/api-keys |
| `OPENAI_VOICE` | `nova`, `shimmer`, `alloy`, `echo`, `onyx`, `fable` |

## Endpoints API

- `GET /health` — statut serveur
- `POST /chat` — `{message, history?, voice?}` → `{text, audio_base64, audio_mime}`
- `POST /tts` — `{text, voice?}` → stream audio MP3

## Structure

```
Voix/
├── server.js          # API Express (LLM + TTS)
├── public/index.html  # Page de test web
├── .env               # Tes clés (ne pas commit)
└── package.json
```

## Coûts estimés (usage modéré : 500 conv/mois × 300 chars)

| Combo | Coût/mois |
|---|---|
| Groq + Edge TTS | **0€** |
| Groq + OpenAI TTS HD | ~2€ |
| Claude Haiku + OpenAI TTS HD | ~3€ |

## TODO

- [x] MVP backend Node.js (LLM + TTS)
- [x] Page web de test
- [ ] Scraper shootnbox.fr + smakk.fr
- [ ] RAG (embeddings + recherche sémantique)
- [ ] Widget JS embeddable pour shootnbox.fr
- [ ] Intégration Flutter dans MyShootnbox
- [ ] Déploiement Coolify → voix.swipego.app
