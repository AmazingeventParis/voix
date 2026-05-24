// Log toutes les conversations dans data/conversations.jsonl (1 ligne JSON par échange)
// + détection des "réponses faibles" (à enrichir en FAQ)
import { promises as fs } from 'fs';
import path from 'path';

const LOG_FILE = 'data/conversations.jsonl';

// Patterns qui révèlent une réponse "faible" (l'assistant n'a pas vraiment répondu)
const WEAK_PATTERNS = [
  /je vous invite/i,
  /demander un devis/i,
  /nous contacter/i,
  /contactez[- ]nous/i,
  /je ne (sais|peux) pas/i,
  /pour cette info pr[ée]cise/i,
  /sur shootnbox\.fr/i,
  /n'h[ée]sit[eez]/i
];

function isWeakAnswer(text) {
  if (!text || text.length < 30) return true;
  let weakCount = 0;
  for (const p of WEAK_PATTERNS) if (p.test(text)) weakCount++;
  return weakCount >= 1;
}

let _writeQueue = Promise.resolve();

export function logExchange({ message, reply, source, faq_id, multi_question, follow_up, sources, faq_hints }) {
  const entry = {
    ts: new Date().toISOString(),
    message,
    reply,
    source,            // 'faq' | 'llm'
    faq_id: faq_id || null,
    multi_question: !!multi_question,
    follow_up: !!follow_up,
    weak: isWeakAnswer(reply),
    rag_sources: (sources || []).slice(0, 3).map(s => ({ title: s.title, url: s.url })),
    faq_hints: (faq_hints || []).slice(0, 3).map(f => ({ id: f.id, question: f.question }))
  };
  // Append non-bloquant (queue pour éviter les écritures concurrentes)
  _writeQueue = _writeQueue.then(() =>
    fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8').catch(err => console.error('[log]', err.message))
  );
}

export async function readRecent(limit = 50, filter = 'all') {
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    const raw = await fs.readFile(LOG_FILE, 'utf8').catch(() => '');
    const lines = raw.trim().split('\n').filter(Boolean);
    const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    let filtered = all;
    if (filter === 'weak') filtered = all.filter(e => e.weak);
    if (filter === 'faq')  filtered = all.filter(e => e.source === 'faq');
    if (filter === 'llm')  filtered = all.filter(e => e.source === 'llm');
    return filtered.slice(-limit).reverse(); // plus récent d'abord
  } catch {
    return [];
  }
}

export async function stats() {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf8').catch(() => '');
    const lines = raw.trim().split('\n').filter(Boolean);
    const all = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return {
      total: all.length,
      faq_direct: all.filter(e => e.source === 'faq').length,
      llm: all.filter(e => e.source === 'llm').length,
      weak: all.filter(e => e.weak).length,
      multi_q: all.filter(e => e.multi_question).length,
      follow_up: all.filter(e => e.follow_up).length
    };
  } catch {
    return { total: 0, faq_direct: 0, llm: 0, weak: 0, multi_q: 0, follow_up: 0 };
  }
}

export async function clearLogs() {
  await fs.writeFile(LOG_FILE, '', 'utf8');
}
