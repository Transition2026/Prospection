const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const EMAIL_PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'email-prompt.txt');

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const LOCALE_PARAMS = 'country=FR&search_lang=fr&ui_lang=fr-FR';

const DIRECTORY_EXCLUSIONS = [
  'wikipedia', 'societe.com', 'pappers', 'infogreffe', 'verif.com', 'manageo',
  'linkedin', 'facebook', 'twitter', 'instagram', 'pages-jaunes', 'pagesjaunes',
  'kompass', 'annuaire', 'annuaires', 'cylex', 'hoodspot', 'foursquare', 'yelp',
  'europages', 'mappy', 'justacoté', 'justacote', '118000', '118712',
  'laposte.fr/annuaire', 'infonet.fr', 'bilansgratuits', 'score3.fr',
  'corporama', 'b-reputation', 'bodacc', 'journal-officiel',
  'societeinfo', 'entreprises.lefigaro', 'dun', 'bfmtv.com', 'usine-digitale',
];

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nomTokens(nomNorm) {
  // Ignore les mots très courts et les formes juridiques qui polluent le matching
  const stop = new Set(['sas', 'sarl', 'sa', 'eurl', 'sasu', 'snc', 'scea', 'scp', 'sci', 'et', 'de', 'du', 'la', 'le', 'les']);
  return nomNorm.split(' ').filter((t) => t.length >= 4 && !stop.has(t));
}

async function braveSearch(query, apiKey) {
  const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=10&${LOCALE_PARAMS}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

// Fallback GPT : demande à gpt-4o-mini de choisir le meilleur candidat parmi une liste
// Retourne l'index choisi (number), ou null si aucun ne convient / erreur.
async function pickWithGPT(candidates, userPrompt) {
  const apiKey = process.env.GPT_API_KEY;
  if (!apiKey || candidates.length === 0) return null;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Tu évalues des résultats de recherche pour du matching B2B. Réponds uniquement en JSON valide.' },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 30,
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    const idx = parsed.index;
    if (typeof idx !== 'number' || idx < 0 || idx >= candidates.length) return null;
    return idx;
  } catch (err) {
    console.error('Erreur pickWithGPT:', err.message);
    return null;
  }
}

// Décide si le top score est "confiant" : assez haut ET net devant le 2ème
function isConfident(scored, minScore, minGap) {
  if (scored.length === 0) return false;
  if (scored[0].score < minScore) return false;
  if (scored.length === 1) return true;
  return scored[0].score - scored[1].score >= minGap;
}

// Construit les variantes de domaines plausibles à partir du nom de l'entreprise
function buildDomainVariants(nom) {
  const cleaned = normalize(nom).split(' ').filter((t) => t.length > 0);
  const stop = new Set(['sas', 'sarl', 'sa', 'eurl', 'sasu', 'snc', 'scea', 'scp', 'sci', 'et', 'de', 'du', 'la', 'le', 'les', 'des']);
  const tokens = cleaned.filter((t) => !stop.has(t));
  if (tokens.length === 0) return [];
  const hyphen = tokens.join('-');
  const joined = tokens.join('');
  const first = tokens[0];
  // Ordre = priorité : le nom complet passe avant le premier mot seul (plus ambigu)
  const variants = new Set([
    `${hyphen}.fr`,
    `${joined}.fr`,
    `${hyphen}.com`,
    `${joined}.com`,
    `${first}.fr`,
    `${first}.com`,
  ]);
  return [...variants];
}

// Domaines de parking / revente connus → à rejeter si la redirection y aboutit
const PARKING_HOSTS = [
  'hugedomains.com', 'sedo.com', 'sedoparking.com', 'dan.com', 'afternic.com',
  'bodis.com', 'parkingcrew.net', 'uniregistry.com', 'buydomains.com',
  'above.com', 'undeveloped.com', 'domain.com', 'parklogic.com', 'skenzo.com',
];
// Phrases typiques d'une page "domaine à vendre"
const PARKING_RE = /\b(for sale|à vendre|buy this domain|this domain (is|may be|could be) (for sale|available)|make (an )?offer|check availability|domain parking|is available for (purchase|sale))\b/i;

// Tente GET https://domain avec timeout, vérifie que le titre/contenu mentionne l'entreprise
// ET que la redirection finale ne pointe pas vers un service de parking.
async function probeDomain(domain, tokens) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`https://${domain}`, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectionBot/1.0)' },
    });
    if (!response.ok) return null;
    const finalUrl = new URL(response.url);
    const finalHost = finalUrl.hostname.toLowerCase();

    // 1. Rejeter si le final host est un service de parking connu
    if (PARKING_HOSTS.some((p) => finalHost === p || finalHost.endsWith(`.${p}`))) return null;

    // 2. Le hostname final doit matcher le domaine deviné (avec ou sans www/sous-domaine)
    //    OU contenir un token du nom. Ça gère les noms courts (BP, H&M) qui n'ont pas de token >= 4.
    const guessedBase = domain.toLowerCase();
    const matchesGuessed = finalHost === guessedBase || finalHost.endsWith(`.${guessedBase}`);
    const containsToken = tokens.some((t) => finalHost.includes(t));
    if (!matchesGuessed && !containsToken) return null;

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const titleRaw = titleMatch ? titleMatch[1] : '';

    // 3. Rejeter si le titre ressemble à une page de vente de domaine
    if (PARKING_RE.test(titleRaw)) return null;

    const title = normalize(titleRaw);
    const bodySample = normalize(html.slice(0, 3000));
    // 4. Au moins un token doit apparaître dans le titre ou le début du body
    const match = tokens.some((t) => title.includes(t) || bodySample.includes(t));
    if (!match) return null;

    return `${finalUrl.protocol}//${finalUrl.hostname}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Devine le site officiel en testant des variantes de domaines construites depuis le nom
async function guessOfficialDomain(nom) {
  const variants = buildDomainVariants(nom);
  if (variants.length === 0) return null;
  const tokens = nomTokens(normalize(nom));
  if (tokens.length === 0) return null;
  // Probes en parallèle, on privilégie l'ordre (.fr hyphen > .fr collé > .com hyphen > .com collé)
  const results = await Promise.all(variants.map((d) => probeDomain(d, tokens)));
  return results.find((r) => r !== null) || null;
}

// GET /api/claude/find-website?nom=COMPANY&ville=CITY&code_postal=59000&siren=123
router.get('/find-website', async (req, res) => {
  try {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'BRAVE_API_KEY non configurée dans le .env' });
    }

    const { nom, ville, code_postal } = req.query;
    if (!nom) return res.status(400).json({ error: 'Paramètre nom manquant' });

    // Étape 1 : devinette directe sur nom-entreprise.fr, nomentreprise.fr, .com — validée par le titre HTML
    const guessed = await guessOfficialDomain(nom);
    if (guessed) {
      return res.json({ found: true, site_web: guessed });
    }

    // Étape 2 : fallback sur Brave Search
    const query = [nom, ville, code_postal, 'site officiel'].filter(Boolean).join(' ');
    const { ok, status, data } = await braveSearch(query, apiKey);

    if (!ok) {
      return res.status(status).json({ error: data.message || 'Erreur Brave Search' });
    }

    const results = data.web?.results || [];
    if (results.length === 0) {
      return res.json({ found: false, site_web: null });
    }

    const nomNorm = normalize(nom);
    const villeNorm = normalize(ville);
    const tokens = nomTokens(nomNorm);

    const scored = results
      .map((item) => {
        let hostname = '';
        try {
          hostname = new URL(item.url).hostname.toLowerCase();
        } catch {
          return null;
        }
        // Exclusions annuaires / réseaux sociaux
        if (DIRECTORY_EXCLUSIONS.some((ex) => hostname.includes(ex) || item.url.includes(ex))) {
          return null;
        }
        const titleNorm = normalize(item.title);
        const descNorm = normalize(item.description);
        let score = 0;
        // Nom dans le hostname (signal le plus fort)
        for (const tok of tokens) {
          if (hostname.includes(tok)) score += 3;
        }
        // TLD .fr
        if (hostname.endsWith('.fr')) score += 2;
        // Nom dans le titre
        if (tokens.some((t) => titleNorm.includes(t))) score += 2;
        // Ville dans titre ou description
        if (villeNorm && (titleNorm.includes(villeNorm) || descNorm.includes(villeNorm))) score += 1;
        // Code postal dans description (forte discrimination)
        if (code_postal && descNorm.includes(code_postal)) score += 2;
        return { item, hostname, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return res.json({ found: false, site_web: null });
    }

    // Cas confiant : top score élevé et clairement détaché
    if (isConfident(scored, 4, 2)) {
      return res.json({ found: true, site_web: `https://${scored[0].hostname}` });
    }

    // Cas ambigu : on demande à GPT de trancher parmi le top 5
    const candidates = scored.slice(0, 5);
    const lines = candidates
      .map((c, i) => `${i}) ${c.item.url}\n   Titre: ${c.item.title || ''}\n   Desc: ${c.item.description || ''}`)
      .join('\n');
    const lieu = [ville, code_postal].filter(Boolean).join(' ');
    const prompt = `Entreprise : "${nom}"${lieu ? ` (${lieu})` : ''}

Parmi ces résultats de recherche, lequel est le site web officiel de cette entreprise ? Exclus les annuaires, réseaux sociaux et sites d'autres entreprises homonymes. Si aucun ne correspond, réponds null.

${lines}

Réponds en JSON : {"index": N} où N est le numéro du site officiel, ou {"index": null} si aucun ne convient.`;

    const gptIdx = await pickWithGPT(candidates, prompt);
    if (gptIdx !== null) {
      return res.json({ found: true, site_web: `https://${candidates[gptIdx].hostname}` });
    }

    // Fallback si GPT n'a pas tranché : on garde le top scoré s'il passe le seuil minimum
    if (scored[0].score >= 1) {
      return res.json({ found: true, site_web: `https://${scored[0].hostname}` });
    }
    return res.json({ found: false, site_web: null });
  } catch (err) {
    console.error('Erreur /api/find-website:', err.message);
    res.status(500).json({ error: err.message || 'Erreur interne du serveur' });
  }
});

// GET /api/claude/find-rh?nom=COMPANY&ville=CITY&code_postal=59000
router.get('/find-rh', async (req, res) => {
  try {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'BRAVE_API_KEY non configurée dans le .env' });
    }

    const { nom, ville, code_postal } = req.query;
    if (!nom) return res.status(400).json({ error: 'Paramètre nom manquant' });

    const lieu = [ville, code_postal].filter(Boolean).join(' ');
    const query = `"${nom}" ${lieu} (RH OR DRH OR "Ressources Humaines" OR recrutement) site:linkedin.com/in`;

    const { ok, status, data } = await braveSearch(query, apiKey);
    if (!ok) {
      return res.status(status).json({ error: data.message || 'Erreur Brave Search' });
    }

    const results = data.web?.results || [];
    if (results.length === 0) {
      return res.json({ found: false, contact_rh: null });
    }

    const nomNorm = normalize(nom);
    const villeNorm = normalize(ville);
    const tokens = nomTokens(nomNorm);
    const RH_REGEX = /\b(rh|drh|ressources humaines|chargee? rh|responsable rh|talent|recrutement|recruteur|people|hrbp|hr manager)\b/;

    const scored = results
      .map((item) => {
        const titleNorm = normalize(item.title);
        const descNorm = normalize(item.description);
        let score = 0;
        // Nom d'entreprise présent dans titre ou description (indispensable)
        const nomMatch = tokens.some((t) => titleNorm.includes(t) || descNorm.includes(t));
        if (nomMatch) score += 3;
        // Mots-clés RH dans le titre LinkedIn
        if (RH_REGEX.test(titleNorm)) score += 2;
        // Ville ou code postal
        if (villeNorm && (titleNorm.includes(villeNorm) || descNorm.includes(villeNorm))) score += 1;
        if (code_postal && descNorm.includes(code_postal)) score += 1;
        return { item, score };
      })
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return res.json({ found: false, contact_rh: null });
    }

    let chosen = null;

    // Cas confiant : top score élevé et détaché
    if (isConfident(scored, 5, 2)) {
      chosen = scored[0];
    } else {
      // Cas ambigu : GPT départage parmi le top 5
      const candidates = scored.slice(0, 5);
      const lines = candidates
        .map((c, i) => `${i}) ${c.item.url}\n   Titre: ${c.item.title || ''}\n   Desc: ${c.item.description || ''}`)
        .join('\n');
      const lieu = [ville, code_postal].filter(Boolean).join(' ');
      const prompt = `Entreprise : "${nom}"${lieu ? ` (${lieu})` : ''}

Parmi ces profils LinkedIn, lequel est le plus probablement un contact RH (Ressources Humaines, recrutement, talent) qui travaille ACTUELLEMENT chez cette entreprise ? Exclus les anciens employés, les candidats externes et les profils d'entreprises homonymes. Si aucun ne convient, réponds null.

${lines}

Réponds en JSON : {"index": N} où N est le numéro du profil, ou {"index": null} si aucun ne convient.`;

      const gptIdx = await pickWithGPT(candidates, prompt);
      if (gptIdx !== null) {
        chosen = candidates[gptIdx];
      } else if (scored[0].score >= 3) {
        // Fallback scoring si GPT abstient
        chosen = scored[0];
      }
    }

    if (!chosen) {
      return res.json({ found: false, contact_rh: null });
    }

    const titre = chosen.item.title || '';
    const description = chosen.item.description || '';
    const url = chosen.item.url || '';

    // Extraire le nom : partie avant le premier séparateur
    const separators = [' - ', ' – ', ' | ', ' · '];
    let nom_rh = titre;
    for (const sep of separators) {
      const idx = nom_rh.indexOf(sep);
      if (idx > 0) {
        nom_rh = nom_rh.substring(0, idx).trim();
        break;
      }
    }

    // Extraire le poste : entre le 1er et 2ème séparateur
    let poste_rh = '';
    const parts = titre.split(/ - | – | \| /);
    if (parts.length >= 2) {
      poste_rh = parts[1].trim();
    }

    return res.json({
      found: true,
      contact_rh: {
        nom: nom_rh,
        poste: poste_rh,
        url_linkedin: url,
        description,
      },
    });
  } catch (err) {
    console.error('Erreur /api/claude/find-rh:', err.message);
    res.status(500).json({ error: err.message || 'Erreur interne du serveur' });
  }
});

// POST /api/claude/classify-entreprises
// body: { entreprises: [{ nom, ville }] }
// returns: { classifications: ['pme'|'grande'|'non', ...] } dans le même ordre
router.post('/classify-entreprises', async (req, res) => {
  try {
    const apiKey = process.env.GPT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GPT_API_KEY non configurée dans le .env' });

    const list = req.body?.entreprises;
    if (!Array.isArray(list) || list.length === 0) {
      return res.status(400).json({ error: 'Liste entreprises manquante' });
    }
    if (list.length > 50) {
      return res.status(400).json({ error: 'Max 50 entreprises par requête' });
    }

    const numbered = list
      .map((e, i) => `${i + 1}) ${e.nom}${e.ville ? ` (${e.ville})` : ''}`)
      .join('\n');

    const prompt = `Ces entreprises ont été identifiées comme "Micro" (< 10 employés) d'après leurs déclarations INSEE. Je veux détecter uniquement les cas où ce chiffre est trompeur : filiales sans salariés de grands groupes, holdings, entités juridiques d'enseignes connues, etc.

Pour chaque entreprise, réponds :
- "grande" : UNIQUEMENT si tu es quasi certain qu'il s'agit d'une filiale/entité d'un grand groupe connu (250+ employés au total du groupe). Exemples : "McDonald's France", "Carrefour Proximité", "Orange SA", "Louis Vuitton Malletier".
- "pme" : UNIQUEMENT si tu connais personnellement cette entreprise comme étant une PME établie de 10-249 employés (nom connu dans son secteur).
- "non" : dans TOUS LES AUTRES CAS — y compris si tu n'es pas sûr, si le nom est générique ("Transport Dupont", "Boulangerie Martin"), ou si c'est une PME inconnue.

Règle d'or : par défaut, réponds "non". La majorité des entreprises de cette liste sont de vraies micro-entreprises ou de petites PME inconnues. Ne classe "pme" ou "grande" QUE pour des noms reconnaissables d'entreprises notoires.

Entreprises à classer :
${numbered}

Réponds en JSON strict : {"classifications": ["pme"|"grande"|"non", ...]} — une valeur par entreprise, dans le même ordre.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Tu classifies des entreprises françaises par taille. Tu réponds uniquement en JSON valide. Si tu as le moindre doute, réponds "non".' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 1500,
      }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 20;
      return res.status(429).json({
        error: 'Rate limit OpenAI atteint.',
        retry_after: retryAfter,
      });
    }
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur OpenAI' });
    }
    const content = data.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    const raw = parsed.classifications;
    if (!Array.isArray(raw)) {
      return res.status(500).json({ error: 'Réponse GPT invalide' });
    }

    // Normaliser chaque entrée, padder si trop court
    const classifications = [];
    for (let i = 0; i < list.length; i++) {
      const v = String(raw[i] ?? '').toLowerCase().trim();
      classifications.push(v === 'pme' || v === 'grande' ? v : 'non');
    }

    res.json({ classifications });
  } catch (err) {
    console.error('Erreur /classify-entreprises:', err.message);
    res.status(500).json({ error: err.message || 'Erreur interne du serveur' });
  }
});

// Récupère la page d'accueil d'un site et en extrait le texte brut (tronqué)
async function fetchHomepageText(url) {
  if (!url) return '';
  let fullUrl = url.trim();
  if (!/^https?:\/\//i.test(fullUrl)) fullUrl = 'https://' + fullUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(fullUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectionBot/1.0)' },
    });
    if (!response.ok) return '';
    const html = await response.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<\/(p|div|br|li|h[1-6]|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
    return text.slice(0, 4000);
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

// POST /api/claude/compose-email
// body: { nom_entreprise, site_web, nom_dirigeant }
// returns: { email }
router.post('/compose-email', async (req, res) => {
  try {
    const apiKey = process.env.GPT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GPT_API_KEY non configurée' });

    const { nom_entreprise, site_web, nom_dirigeant } = req.body || {};
    if (!nom_entreprise) return res.status(400).json({ error: 'nom_entreprise requis' });

    let template;
    try {
      template = fs.readFileSync(EMAIL_PROMPT_PATH, 'utf-8');
    } catch {
      return res.status(500).json({ error: 'Prompt introuvable : backend/prompts/email-prompt.txt' });
    }

    const contexte = await fetchHomepageText(site_web);
    const prompt = template
      .replace(/\{\{nom_entreprise\}\}/g, nom_entreprise || '')
      .replace(/\{\{nom_dirigeant\}\}/g, nom_dirigeant || '(non précisé)')
      .replace(/\{\{site_web\}\}/g, site_web || '')
      .replace(/\{\{contexte\}\}/g, contexte || '(contenu du site non disponible)');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
      }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 20;
      return res.status(429).json({ error: 'Rate limit OpenAI atteint.', retry_after: retryAfter });
    }
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erreur OpenAI' });
    }
    const email = data.choices?.[0]?.message?.content?.trim() || '';
    res.json({ email, contexte_length: contexte.length });
  } catch (err) {
    console.error('Erreur /compose-email:', err.message);
    res.status(500).json({ error: err.message || 'Erreur interne du serveur' });
  }
});

module.exports = router;
