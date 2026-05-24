// FAQ store : chargement + recherche fuzzy + sauvegarde
import MiniSearch from 'minisearch';
import { promises as fs } from 'fs';

const FAQ_FILE = 'data/faq.json';
const MATCH_THRESHOLD = 30;        // score MiniSearch absolu mini pour match fort
const MATCH_RATIO_THRESHOLD = 2.5; // top1 doit être au moins X fois plus fort que top2

let _faqs = [];
let _index = null;
let _nextId = 1;

function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildIndex() {
  _index = new MiniSearch({
    fields: ['searchText'],
    storeFields: ['id', 'questions', 'answer', 'tags'],
    searchOptions: { prefix: false, fuzzy: 0.15, combineWith: 'AND' },
    processTerm: t => normalize(t),
    tokenize: (text) => text.split(/[\s\-_,;:.!?()\[\]{}"'`]+/).filter(Boolean)
  });
  for (const faq of _faqs) {
    _index.add({
      id: faq.id,
      searchText: [faq.questions.join(' '), faq.answer, (faq.tags||[]).join(' ')].join(' '),
      questions: faq.questions,
      answer: faq.answer,
      tags: faq.tags || []
    });
  }
}

export async function loadFaqs() {
  try {
    const raw = await fs.readFile(FAQ_FILE, 'utf8');
    const data = JSON.parse(raw);
    _faqs = data.faqs || [];
    _nextId = _faqs.reduce((max, f) => Math.max(max, f.id || 0), 0) + 1;
  } catch (err) {
    _faqs = [];
    _nextId = 1;
  }
  buildIndex();
  return _faqs.length;
}

export async function saveFaqs() {
  await fs.writeFile(FAQ_FILE, JSON.stringify({ faqs: _faqs }, null, 2), 'utf8');
  buildIndex();
}

export function searchFaq(query, topK = 3) {
  if (!_index) return [];
  // En recherche "soft" (pour le contexte LLM), on retombe en OR si rien trouvé
  let results = _index.search(query);
  if (!results.length) results = _index.search(query, { combineWith: 'OR', fuzzy: 0.25 });
  return results.slice(0, topK).map(r => ({
    id: r.id,
    questions: r.questions,
    answer: r.answer,
    tags: r.tags,
    score: r.score
  }));
}

// Retourne directement la meilleure réponse si :
// - score >= MATCH_THRESHOLD (absolu)
// - ET top1 est nettement supérieur à top2 (évite les faux positifs ambigus)
export function findStrongMatch(query) {
  if (!_index) return null;
  const results = _index.search(query); // AND par défaut, strict
  if (!results.length) return null;
  const top1 = results[0];
  if (top1.score < MATCH_THRESHOLD) return null;
  const top2 = results[1];
  if (top2 && (top1.score / top2.score) < MATCH_RATIO_THRESHOLD) return null;
  return {
    id: top1.id,
    questions: top1.questions,
    answer: top1.answer,
    tags: top1.tags,
    score: top1.score
  };
}

export function listFaqs() {
  return _faqs;
}

export async function addFaq({ questions, answer, tags = [] }) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('questions[] requis');
  if (!answer) throw new Error('answer requis');
  const faq = { id: _nextId++, questions, answer, tags };
  _faqs.push(faq);
  await saveFaqs();
  return faq;
}

export async function updateFaq(id, { questions, answer, tags }) {
  const idx = _faqs.findIndex(f => f.id === id);
  if (idx === -1) throw new Error('FAQ introuvable');
  if (questions !== undefined) _faqs[idx].questions = questions;
  if (answer !== undefined) _faqs[idx].answer = answer;
  if (tags !== undefined) _faqs[idx].tags = tags;
  await saveFaqs();
  return _faqs[idx];
}

export async function deleteFaq(id) {
  const before = _faqs.length;
  _faqs = _faqs.filter(f => f.id !== id);
  if (_faqs.length === before) throw new Error('FAQ introuvable');
  await saveFaqs();
  return true;
}

export function getStats() {
  return { count: _faqs.length, threshold: MATCH_THRESHOLD };
}
