// RAG simple : indexe data/scraped/*.md avec MiniSearch (BM25)
// + recherche top-K chunks pour une question donnée
import MiniSearch from 'minisearch';
import matter from 'gray-matter';
import { promises as fs } from 'fs';
import path from 'path';

const SCRAPED_DIR = 'data/scraped';

// Stopwords français (mots vides à ignorer)
const STOPWORDS = new Set([
  'le','la','les','un','une','des','de','du','et','ou','à','au','aux','en','dans',
  'sur','pour','par','avec','sans','mais','est','sont','être','avoir','ai','as','a',
  'on','je','tu','il','elle','nous','vous','ils','elles','ce','cette','ces','mon','ma',
  'mes','ton','ta','tes','son','sa','ses','notre','nos','votre','vos','leur','leurs',
  'que','qui','quoi','dont','où','y','se','si','plus','très','aussi','tout','tous',
  'toute','toutes','peut','peux','va','vas','ne','pas','plus','jamais','rien','déjà',
  'comme','car','donc','alors','puis','aussi','même','autre','autres','quelque','quel',
  'the','of','to','in','for','and','or','is','are','be'
]);

// Découpe un texte en chunks de ~maxChars, en essayant de couper aux paragraphes
function chunkText(text, maxChars = 800) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n\n' + p).length > maxChars) {
      if (current) chunks.push(current.trim());
      // Si paragraphe seul trop long, le couper aux phrases
      if (p.length > maxChars) {
        const sentences = p.match(/[^.!?]+[.!?]+/g) || [p];
        let buf = '';
        for (const s of sentences) {
          if ((buf + s).length > maxChars) {
            if (buf) chunks.push(buf.trim());
            buf = s;
          } else buf += s;
        }
        current = buf;
      } else {
        current = p;
      }
    } else {
      current = current ? current + '\n\n' + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Charge tous les .md, parse frontmatter + chunke
export async function loadDocuments() {
  const docs = [];
  let id = 0;
  const sites = await fs.readdir(SCRAPED_DIR);
  for (const site of sites) {
    const sitePath = path.join(SCRAPED_DIR, site);
    const stat = await fs.stat(sitePath);
    if (!stat.isDirectory()) continue;
    const files = await fs.readdir(sitePath);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const raw = await fs.readFile(path.join(sitePath, file), 'utf8');
      const { data: meta, content } = matter(raw);
      const chunks = chunkText(content, 800);
      for (let i = 0; i < chunks.length; i++) {
        docs.push({
          id: id++,
          site,
          url: meta.url || '',
          title: meta.title || file,
          chunkIndex: i,
          text: chunks[i]
        });
      }
    }
  }
  return docs;
}

// Construit l'index MiniSearch
let _index = null;
let _docs = null;

export async function buildIndex() {
  console.log('[RAG] Chargement des documents...');
  _docs = await loadDocuments();
  console.log(`[RAG] ${_docs.length} chunks indexés depuis ${SCRAPED_DIR}`);

  _index = new MiniSearch({
    fields: ['title', 'text'],
    storeFields: ['title', 'url', 'site', 'text', 'chunkIndex'],
    searchOptions: {
      boost: { title: 2 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'OR'
    },
    processTerm: (term) => {
      term = term.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève accents
        .replace(/[^a-z0-9]/g, '');
      if (term.length < 2 || STOPWORDS.has(term)) return null;
      return term;
    },
    tokenize: (text) => text.split(/[\s\-_,;:.!?()\[\]{}"'`]+/).filter(Boolean)
  });
  _index.addAll(_docs);
  return { count: _docs.length };
}

export function search(query, topK = 5) {
  if (!_index) throw new Error('Index non construit. Appeler buildIndex() au démarrage.');
  const results = _index.search(query, { boost: { title: 2 } });
  return results.slice(0, topK).map(r => ({
    title: r.title,
    url: r.url,
    site: r.site,
    text: r.text,
    score: r.score
  }));
}

export function getStats() {
  return {
    documents: _docs ? _docs.length : 0,
    indexBuilt: !!_index
  };
}
