// Scraper shootnbox.fr + smakk.fr → data/scraped/*.md
// Usage : node scraper.js
import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import path from 'path';

const SITES = [
  { domain: 'shootnbox.fr', sitemapIndex: 'https://shootnbox.fr/sitemap.xml' },
  { domain: 'smakk.fr',     sitemapIndex: 'https://smakk.fr/sitemap.xml' }
];

const OUT_DIR = 'data/scraped';
const MANIFEST = 'data/manifest.json';

// Patterns à skipper (pages SEO ville répétitives, on en garde 1 comme template)
const SEO_PATTERNS = [
  /\/location-photobooth-[a-z-]+\/$/,        // shootnbox SEO villes
  /\/location-photo-booth-mariage-[a-z-]+\/$/, // smakk SEO villes
  /\/photo-booth-mariage-[a-z-]+\/$/,
];

const seoTemplatesKept = new Map(); // pattern → 1ère URL gardée

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'VoixBot/1.0 (Shootnbox)' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

async function getAllUrls(sitemapIndexUrl) {
  const xml = await fetchText(sitemapIndexUrl);
  const subs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const allUrls = [];
  for (const sub of subs) {
    if (sub.endsWith('.xml')) {
      const subXml = await fetchText(sub);
      const urls = [...subXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
      allUrls.push(...urls);
    } else {
      allUrls.push(sub);
    }
  }
  return allUrls;
}

function shouldKeep(url) {
  for (const pat of SEO_PATTERNS) {
    if (pat.test(url)) {
      if (seoTemplatesKept.has(pat.source)) return false;
      seoTemplatesKept.set(pat.source, url);
      return true; // on garde la 1ère seulement
    }
  }
  // skip pages techniques
  if (/\/(author|tag|category|kit-presse|dossier-de-presse|communique)/.test(url)) return false;
  return true;
}

function extractContent(html, url) {
  const $ = cheerio.load(html);

  // Vire le bruit massif — IMPORTANT : ne JAMAIS toucher à body/html
  $('script, style, noscript, iframe, form, link, meta').remove();
  $('nav, header, footer, aside').remove();
  // Selecteurs ciblés, on évite [class*="header"] qui matchait body
  $('div[class*="navigation"], div[class*="sidebar"], div[class*="cookie"], div[class*="popup"], div[class*="related"], div[class*="comments"]').remove();
  $('[id*="navigation"], [id*="menu-main"], [id*="sidebar"], [id*="footer"], [id*="header"]').remove();
  $('.elementor-post, [class*="post-grid"], [class*="post-list"]').remove(); // related posts WordPress
  $('.menu, .nav, .breadcrumb, .widget').remove();

  const title = ($('h1').first().text() || $('title').text() || '').trim();
  const description = ($('meta[name="description"]').attr('content') || '').trim();

  // Détection moteur : Elementor (smakk) vs custom (shootnbox)
  let main;
  const elementorContent = $('.elementor-widget-theme-post-content').first();
  if (elementorContent.length) {
    main = elementorContent;
  } else {
    // Fallback : tout le body après nettoyage
    main = $('main, article, .entry-content, .post-content, body').first();
  }

  const lines = [];
  const seen = new Set();
  main.find('h1, h2, h3, h4, h5, p, li, td, th, blockquote').each((_, el) => {
    const $el = $(el);
    const txt = $el.text().replace(/\s+/g, ' ').trim();
    if (!txt || txt.length < 10) return;       // skip lignes trop courtes
    if (txt.length > 2000) return;             // skip blocs anormaux (probablement bug)
    if (seen.has(txt)) return;                 // dedup
    seen.add(txt);
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1') lines.push(`\n# ${txt}`);
    else if (tag === 'h2') lines.push(`\n## ${txt}`);
    else if (tag === 'h3') lines.push(`\n### ${txt}`);
    else if (tag === 'h4' || tag === 'h5') lines.push(`\n#### ${txt}`);
    else if (tag === 'li') lines.push(`- ${txt}`);
    else lines.push(txt);
  });

  return {
    title,
    description,
    url,
    content: lines.join('\n').trim()
  };
}

function slugFromUrl(url) {
  const u = new URL(url);
  let slug = u.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '_') || 'index';
  return slug.slice(0, 80);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const manifest = { generated_at: new Date().toISOString(), sites: {} };

  for (const site of SITES) {
    console.log(`\n[${site.domain}] récupération sitemap...`);
    let urls;
    try {
      urls = await getAllUrls(site.sitemapIndex);
    } catch (err) {
      console.error(`  ✗ Sitemap KO : ${err.message}`);
      continue;
    }
    const kept = urls.filter(shouldKeep);
    console.log(`  ${urls.length} URLs → ${kept.length} après filtrage`);

    const siteDir = path.join(OUT_DIR, site.domain);
    await fs.mkdir(siteDir, { recursive: true });

    const pages = [];
    let ok = 0, ko = 0;

    // Limite concurrence à 5
    const queue = [...kept];
    async function worker() {
      while (queue.length) {
        const url = queue.shift();
        try {
          const html = await fetchText(url);
          const data = extractContent(html, url);
          if (!data.content || data.content.length < 100) {
            ko++;
            continue;
          }
          const slug = slugFromUrl(url);
          const filePath = path.join(siteDir, slug + '.md');
          const yamlEscape = (s) => '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
          const md = `---\nurl: ${yamlEscape(url)}\ntitle: ${yamlEscape(data.title)}\ndescription: ${yamlEscape(data.description)}\n---\n\n${data.content}\n`;
          await fs.writeFile(filePath, md, 'utf8');
          pages.push({ url, slug, title: data.title, file: filePath, chars: data.content.length });
          ok++;
          if (ok % 10 === 0) process.stdout.write(`  ${ok} pages...\r`);
        } catch (err) {
          ko++;
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker(), worker()]);

    console.log(`  ✓ ${ok} pages scrapées, ${ko} ignorées`);
    manifest.sites[site.domain] = { total: urls.length, kept: kept.length, scraped: ok, pages };
  }

  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`\n✓ Manifest écrit dans ${MANIFEST}`);
  const totalPages = Object.values(manifest.sites).reduce((s, x) => s + (x.scraped || 0), 0);
  console.log(`✓ Total : ${totalPages} pages scrapées dans ${OUT_DIR}/\n`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
