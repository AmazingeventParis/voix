import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { buildIndex, search as ragSearch, getStats as ragStats } from './rag.js';
import * as faq from './faq.js';
import * as logger from './logger.js';
import { promises as fsp } from 'fs';

let CATALOGUE_JSON = '';
async function loadCatalogue() {
  try {
    const raw = await fsp.readFile('data/catalogue.json', 'utf8');
    const parsed = JSON.parse(raw);
    delete parsed._note;
    CATALOGUE_JSON = JSON.stringify(parsed, null, 2);
    return parsed;
  } catch (err) {
    CATALOGUE_JSON = '';
    return null;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const SYSTEM_PROMPT_BASE = `Tu es l'assistant vocal officiel de Shootnbox et Smakk. Tu joues le rôle d'un commercial expert au téléphone : à la fois chaleureux ET qualifiant.

Shootnbox loue des photobooths haut de gamme (bornes Aircam 360, Photobooth, Ring, Spinner, Vegas, Fashion Box, Karaoké, Photocall) partout en France pour tout type d'évènement.
Smakk (smakk.fr) est la marque dédiée aux mariages.
L'application MyShootnbox permet aux invités d'un évènement de récupérer leurs photos, participer à des défis photo et accéder à la galerie partagée.

═══ RÈGLES DE STYLE ═══
- Réponses COURTES et orales : 1 à 3 phrases par tour, comme à l'oral. Pas de listes à puces, pas de markdown.
- Toujours en français, ton chaleureux et professionnel, tutoiement OK si le client tutoie.
- Base-toi UNIQUEMENT sur les FAQ, le catalogue et les extraits du site ci-dessous. JAMAIS d'invention de prix ou specs.

═══ MODE COMMERCIAL ACTIF — POSE DES QUESTIONS ═══
Tu n'es pas qu'un répondeur — tu qualifies la demande comme un vrai commercial.

Avant de donner un tarif ou une recommandation précise, tu as besoin de connaître :
  1. Le LIEU de l'évènement (Paris/IDF, province, ville)
  2. La DATE ou période
  3. Le TYPE d'évènement (mariage, soirée entreprise, anniversaire, lancement…)
  4. Le NOMBRE d'invités estimé
  5. La DURÉE souhaitée

Si une question concerne un tarif/recommandation et que ces infos te manquent, POSE UNE QUESTION (UNE SEULE à la fois) pour les récupérer avant de répondre.

Exemples de bons enchaînements :
  Client : "Combien coûte le Ring ?"
  Toi : "Pour vous donner le bon tarif, où se passe votre événement et c'est pour quand ?"

  Client : "À Lyon le 15 juin pour un mariage"
  Toi : "Super, pour un mariage à Lyon en juin, le Ring est parfait. Combien d'invités prévus ?"

  Client : "120 personnes"
  Toi : "Top, pour 120 invités le Ring tient largement. Le tarif de base est à partir de X€, avec déplacement Lyon environ Y€. Je vous fais un devis précis sur shootnbox.fr ?"

Si le client a déjà donné une info dans la conversation précédente (vérifie l'historique), NE LA REDEMANDE PAS.

═══ MULTI-QUESTIONS ═══
Si le message contient PLUSIEURS questions, réponds à CHACUNE en 1-2 phrases dans l'ordre. Commence par "Alors, pour…" et enchaîne "Et concernant…".

═══ HORS-SUJET ═══
Si la question sort du domaine Shootnbox/Smakk/MyShootnbox, ramène poliment vers ces sujets.`;

function buildSystemPrompt(contextChunks, faqMatches = []) {
  let prompt = SYSTEM_PROMPT_BASE;

  // 1. Catalogue produits (source de vérité officielle)
  if (CATALOGUE_JSON) {
    prompt += `\n\n=== CATALOGUE OFFICIEL SHOOTNBOX (source de vérité — utilise EXACTEMENT ces infos) ===\n\n${CATALOGUE_JSON}\n\n=== FIN CATALOGUE ===`;
  }

  // 2. FAQ pertinentes
  if (faqMatches.length) {
    const faqBlock = faqMatches.map((f) =>
      `Q: ${f.questions[0]}\nR: ${f.answer}`
    ).join('\n\n');
    prompt += `\n\n=== RÉPONSES OFFICIELLES (FAQ) — utilise-les EN PRIORITÉ si la question correspond ===\n\n${faqBlock}\n\n=== FIN FAQ ===`;
  }

  // 3. Extraits du site (RAG)
  if (contextChunks.length) {
    const ctx = contextChunks.map((c, i) =>
      `[Extrait ${i+1} — ${c.title} (${c.url})]\n${c.text}`
    ).join('\n\n---\n\n');
    prompt += `\n\n=== EXTRAITS DU SITE PERTINENTS POUR LA QUESTION ===\n\n${ctx}\n\n=== FIN DES EXTRAITS ===`;
  }

  return prompt;
}

// --- LLM (Groq prioritaire, Gemini fallback) ---
async function askLLM(userMessage, history = [], systemPrompt = SYSTEM_PROMPT_BASE) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];

  if (process.env.GROQ_API_KEY) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.6,
        max_tokens: 250
      })
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content.trim();
  }

  if (process.env.GEMINI_API_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [
            ...history.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            })),
            { role: 'user', parts: [{ text: userMessage }] }
          ],
          generationConfig: { temperature: 0.6, maxOutputTokens: 250 }
        })
      }
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.candidates[0].content.parts[0].text.trim();
  }

  throw new Error('Aucune clé LLM configurée. Mets GROQ_API_KEY ou GEMINI_API_KEY dans .env');
}

// --- TTS Edge (gratuit, voix Microsoft neurales) ---
async function ttsEdge(text, voice) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  return new Promise((resolve, reject) => {
    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', (err) => reject(new Error('Edge TTS: ' + (err?.message || JSON.stringify(err)))));
  });
}

// --- TTS Google Translate (fallback gratuit, voix correcte mais robotique) ---
async function ttsGoogle(text) {
  const chunks = chunkText(text, 200);
  const buffers = [];
  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=fr&client=tw-ob`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('Google TTS HTTP ' + res.status);
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  return Buffer.concat(buffers);
}

function chunkText(text, max = 200) {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const out = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > max) {
      if (buf) out.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// --- TTS OpenAI (payant ~$15/1M chars, voix tres realiste) ---
async function ttsOpenAI(text, voice = 'nova') {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'tts-1-hd',
      voice,
      input: text,
      response_format: 'mp3'
    })
  });
  if (!res.ok) throw new Error(`OpenAI TTS HTTP ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

const OPENAI_VOICES = new Set(['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse']);

async function textToSpeech(text, voice) {
  const provider = (process.env.TTS_PROVIDER || 'edge').toLowerCase();

  // Si le client passe une voix OpenAI explicite, on prend OpenAI quel que soit le provider
  if (voice && OPENAI_VOICES.has(voice) && process.env.OPENAI_API_KEY) {
    return ttsOpenAI(text, voice);
  }

  if (provider === 'openai' && process.env.OPENAI_API_KEY) {
    return ttsOpenAI(text, voice || process.env.OPENAI_VOICE || 'nova');
  }
  if (provider === 'google') return ttsGoogle(text);

  // 'edge' par défaut : essaie Edge (gratuit, voix neurale), tombe sur Google si echec
  const edgeVoice = voice || process.env.TTS_VOICE || 'fr-FR-DeniseNeural';
  try {
    return await ttsEdge(text, edgeVoice);
  } catch (err) {
    console.warn('[TTS] Edge a échoué, fallback Google Translate:', err.message || err);
    return ttsGoogle(text);
  }
}

// --- Routes ---
app.get('/admin', (_req, res) => {
  res.sendFile('admin.html', { root: 'public' });
});
app.get('/train', (_req, res) => {
  res.sendFile('train.html', { root: 'public' });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    llm: process.env.GROQ_API_KEY ? 'groq' : (process.env.GEMINI_API_KEY ? 'gemini' : 'NONE'),
    voice: process.env.TTS_VOICE || 'fr-FR-DeniseNeural',
    rag: ragStats()
  });
});

// Détecte si la question est probablement un follow-up (pronom, sans sujet explicite)
function isFollowUp(message) {
  const msg = message.trim().toLowerCase();
  if (msg.length > 60) return false; // trop long pour être un simple follow-up
  // Pronoms / déictiques au début ou seul sujet
  return /^(et |aussi |son |sa |ses |le |la |les |ce |ça |c'est |il |elle |y a-t-il |y a t il |combien|quel|comment|pourquoi)\b/i.test(msg)
      || /\b(son prix|sa durée|son tarif|le prix|la durée|combien|en option)\b/i.test(msg) && !msg.includes('photobooth') && !msg.includes('borne') && !msg.includes('aircam') && !msg.includes('vegas');
}

// Construit la query de recherche en y intégrant le contexte des derniers messages
function buildSearchQuery(message, history) {
  if (!history || !history.length) return message;
  // Récupère le dernier échange (user + assistant) si présent
  const recentUserMsgs = history.filter(h => h.role === 'user').slice(-2).map(h => h.content);
  const lastAssistant = [...history].reverse().find(h => h.role === 'assistant');

  // Si la question courante est un follow-up, on intègre fortement le contexte
  if (isFollowUp(message)) {
    const parts = [...recentUserMsgs.slice(-1), message];
    if (lastAssistant) {
      // Garde les 200 premiers chars de la dernière réponse (souvent les noms propres / sujets)
      parts.unshift(lastAssistant.content.slice(0, 200));
    }
    return parts.join(' ');
  }
  // Sinon on enrichit juste légèrement avec le dernier message user (sans assistant)
  return [...recentUserMsgs.slice(-1), message].join(' ');
}

// Heuristique : détecte si le message contient plusieurs questions
function isMultiQuestion(message) {
  const msg = message.trim();
  // 2+ points d'interrogation = clairement multiple
  if ((msg.match(/\?/g) || []).length >= 2) return true;
  // Mots de coordination entre clauses
  if (/\b(et est[- ]?ce que|et combien|et quel|et quelle|et comment|et quand|et où|et pourquoi|et le prix|et le tarif|ainsi que|et également|et puis|et aussi|et avec)\b/i.test(msg)) return true;
  // "aussi/également" suivi d'un mot interrogatif
  if (/\b(aussi|également)\s+(quel|quelle|quels|quelles|combien|comment|quand|où|pourquoi|savoir|connaitre|connaître)\b/i.test(msg)) return true;
  // Long message avec plusieurs verbes/adverbes interrogatifs
  const interrogatives = (msg.match(/\b(combien|quel|quelle|quels|quelles|comment|pourquoi|quand|où|est[- ]?ce que)\b/gi) || []).length;
  if (interrogatives >= 2 && msg.length > 40) return true;
  // 2+ phrases (séparées par . ou ;) avec marqueurs interrogatifs
  const sentences = msg.split(/[.;]+/).filter(s => s.trim().length > 5);
  if (sentences.length >= 2) {
    const interrogativeSentences = sentences.filter(s =>
      /\?|\b(combien|quel|comment|pourquoi|quand|où|est[- ]?ce|savoir|aimerais|voudrais)\b/i.test(s)
    );
    if (interrogativeSentences.length >= 2) return true;
  }
  return false;
}

app.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, history = [], voice } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) requis' });
    }

    const multi = isMultiQuestion(message);
    const followUp = isFollowUp(message) && history.length > 0;
    const searchQuery = buildSearchQuery(message, history);

    // 1. SI question simple ET pas un follow-up ET match FAQ très fort → réponse directe (skip LLM)
    //    On désactive le shortcut FAQ direct si c'est un follow-up (la FAQ matchée pourrait être hors contexte)
    if (!multi && !followUp) {
      const strongFaq = faq.findStrongMatch(message);
      if (strongFaq) {
        const audioBuffer = await textToSpeech(strongFaq.answer, voice);
        logger.logExchange({ message, reply: strongFaq.answer, source: 'faq', faq_id: strongFaq.id });
        return res.json({
          text: strongFaq.answer,
          source: 'faq',
          faq_id: strongFaq.id,
          multi_question: false,
          follow_up: false,
          audio_base64: audioBuffer.toString('base64'),
          audio_mime: 'audio/mpeg'
        });
      }
    }

    // 2. Sinon : RAG + FAQ proches injectés dans le prompt
    //    Si multi ou follow-up, on monte les topK pour couvrir plus de contexte
    const ragK = (multi || followUp) ? 8 : 4;
    const faqK = (multi || followUp) ? 5 : 2;

    let chunks = [];
    try { chunks = ragSearch(searchQuery, ragK); } catch (_) {}
    const softFaqs = faq.searchFaq(searchQuery, faqK);

    const systemPrompt = buildSystemPrompt(chunks, softFaqs);
    const reply = await askLLM(message, history, systemPrompt);
    const audioBuffer = await textToSpeech(reply, voice);

    const sources = chunks.map(c => ({ title: c.title, url: c.url, score: c.score }));
    const faq_hints = softFaqs.map(f => ({ id: f.id, question: f.questions[0], score: f.score }));

    logger.logExchange({ message, reply, source: 'llm', multi_question: multi, follow_up: followUp, sources, faq_hints });

    res.json({
      text: reply,
      source: 'llm',
      multi_question: multi,
      follow_up: followUp,
      search_query: searchQuery !== message ? searchQuery.slice(0, 200) : undefined,
      sources,
      faq_hints,
      audio_base64: audioBuffer.toString('base64'),
      audio_mime: 'audio/mpeg'
    });
  } catch (err) {
    console.error('[/chat]', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== Auth =====
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'change-me';
function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_PASS) return res.status(401).json({ error: 'unauthorized' });
  next();
}
// Endpoint léger pour valider un password (pour les UIs login)
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASS) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

app.get('/api/faq', requireAuth, (_req, res) => {
  res.json({ faqs: faq.listFaqs(), stats: faq.getStats() });
});
app.post('/api/faq', requireAuth, async (req, res) => {
  try { res.json(await faq.addFaq(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/faq/:id', requireAuth, async (req, res) => {
  try { res.json(await faq.updateFaq(Number(req.params.id), req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/faq/:id', requireAuth, async (req, res) => {
  try { await faq.deleteFaq(Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ===== Training (mode entrainement) =====
// Génère 3-5 variantes naturelles d'une question via le LLM
app.post('/api/variants', requireAuth, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'question requise' });
    const prompt = `Génère 4 reformulations naturelles différentes de cette question, comme si plusieurs clients la posaient à leur façon (ton oral, parfois familier, parfois soutenu, parfois abrégé).
Renvoie UNIQUEMENT un tableau JSON de strings, sans autre texte. Exemple : ["Reformulation 1", "Reformulation 2", ...]

Question originale : "${question}"`;
    const text = await askLLM(prompt, [], 'Tu es un assistant qui génère des reformulations de questions clients. Réponds en JSON pur, rien d\'autre.');
    // Parse le JSON dans la réponse
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.json({ variants: [] });
    const variants = JSON.parse(match[0]).filter(v => typeof v === 'string' && v.length > 3);
    res.json({ variants });
  } catch (err) {
    console.error('[/api/variants]', err);
    res.status(500).json({ error: err.message });
  }
});

// Test une question sans la logger (pour le mode train)
// Accepte un historique pour permettre les conversations multi-tour (mode commercial)
app.post('/api/train/test', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message requis' });

    // En conversation multi-tour, le shortcut FAQ direct devient risqué (peut être hors contexte)
    if (history.length === 0) {
      const strongFaq = faq.findStrongMatch(message);
      if (strongFaq) {
        return res.json({ text: strongFaq.answer, source: 'faq', faq_id: strongFaq.id });
      }
    }
    // Enrichit la requête avec l'historique si follow-up
    const followUp = history.length > 0 && message.trim().length < 60;
    const searchQuery = followUp ? history.slice(-2).map(h => h.content).concat(message).join(' ') : message;

    const chunks = ragSearch(searchQuery, 4);
    const softFaqs = faq.searchFaq(searchQuery, 2);
    const systemPrompt = buildSystemPrompt(chunks, softFaqs);
    const reply = await askLLM(message, history, systemPrompt);
    res.json({ text: reply, source: 'llm', faq_hints: softFaqs.map(f => ({ id: f.id, q: f.questions[0] })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Conversations (apprentissage) =====
app.get('/api/conversations', requireAuth, async (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const filter = req.query.filter || 'all'; // all | weak | faq | llm
  const items = await logger.readRecent(limit, filter);
  const stats = await logger.stats();
  res.json({ items, stats });
});
app.delete('/api/conversations', requireAuth, async (_req, res) => {
  await logger.clearLogs();
  res.json({ ok: true });
});

// ===== Catalogue (lecture/édition) =====
app.get('/api/catalogue', requireAuth, async (_req, res) => {
  try {
    const raw = await fsp.readFile('data/catalogue.json', 'utf8');
    res.type('application/json').send(raw);
  } catch (e) { res.status(404).json({ error: 'catalogue.json introuvable' }); }
});
app.put('/api/catalogue', requireAuth, async (req, res) => {
  try {
    const text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2);
    JSON.parse(text); // validation
    await fsp.writeFile('data/catalogue.json', text, 'utf8');
    await loadCatalogue();
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: 'JSON invalide : ' + e.message }); }
});

// Endpoint debug : voir ce que le RAG remonte pour une question
app.post('/search', requireAuth, (req, res) => {
  try {
    const { query, topK = 5 } = req.body;
    if (!query) return res.status(400).json({ error: 'query requis' });
    const results = ragSearch(query, topK);
    res.json({ query, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TTS seul (utile pour tester une voix)
app.post('/tts', requireAuth, async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'text requis' });
    const audioBuffer = await textToSpeech(text, voice);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    console.error('[/tts]', err);
    res.status(500).json({ error: err.message });
  }
});

(async () => {
  try {
    await buildIndex();
  } catch (err) {
    console.warn('[RAG] Index non construit (manque data/scraped/) — l\'assistant répondra sans contexte');
  }
  const faqCount = await faq.loadFaqs();
  const cat = await loadCatalogue();

  app.listen(PORT, () => {
    const llm = process.env.GROQ_API_KEY ? 'Groq (Llama 3.3 70B)'
              : process.env.GEMINI_API_KEY ? 'Gemini 2.0 Flash'
              : 'AUCUN — configure .env';
    const stats = ragStats();
    console.log(`\n  Voix Shootnbox prêt sur http://localhost:${PORT}`);
    console.log(`  LLM   : ${llm}`);
    console.log(`  Voix  : ${process.env.OPENAI_VOICE || process.env.TTS_VOICE || 'fr-FR-DeniseNeural'}`);
    console.log(`  RAG   : ${stats.documents} chunks indexés`);
    console.log(`  FAQ   : ${faqCount} entrées personnalisées`);
    console.log(`  Catal.: ${cat ? Object.keys(cat.bornes || {}).length + ' bornes chargées' : 'aucun'}`);
    console.log(`  Admin : http://localhost:${PORT}/admin (password : ${ADMIN_PASS})`);
    console.log(`  Test  : http://localhost:${PORT}/\n`);
  });
})();
