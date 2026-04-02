const express = require('express');
const router = express.Router();

// GET /api/claude/find-website?nom=COMPANY&ville=CITY&siren=123
router.get('/find-website', async (req, res) => {
  try {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'BRAVE_API_KEY non configurée dans le .env' });
    }

    const { nom, ville } = req.query;
    if (!nom) return res.status(400).json({ error: 'Paramètre nom manquant' });

    const query = [nom, ville, 'site officiel'].filter(Boolean).join(' ');

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Erreur Brave Search' });
    }

    const results = data.web?.results || [];
    if (results.length === 0) {
      return res.json({ found: false, site_web: null });
    }

    // Exclure les annuaires et réseaux sociaux
    const EXCLUSIONS = ['wikipedia', 'societe.com', 'pappers', 'infogreffe', 'verif.com', 'manageo', 'linkedin', 'facebook', 'twitter', 'instagram', 'pages-jaunes', 'pagesjaunes', 'kompass', 'annuaire', 'annuaires', 'cylex', 'hoodspot', 'foursquare', 'yelp', 'europages', 'mappy', 'justacoté', 'justacote', '118000', '118712', 'laposte.fr/annuaire'];
    const best = results.find((item) => !EXCLUSIONS.some((ex) => item.url.includes(ex)));

    if (!best) {
      return res.json({ found: false, site_web: null });
    }

    // Retourner uniquement le domaine racine
    const parsed = new URL(best.url);
    const site = `${parsed.protocol}//${parsed.hostname}`;

    return res.json({ found: true, site_web: site });
  } catch (err) {
    console.error('Erreur /api/find-website:', err.message);
    res.status(500).json({ error: err.message || 'Erreur interne du serveur' });
  }
});

// GET /api/claude/find-news?nom=COMPANY&ville=CITY&siren=123&site_web=URL
router.get('/find-news', async (req, res) => {
  try {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'BRAVE_API_KEY non configurée dans le .env' });
    }

    const { nom, ville, siren, site_web } = req.query;
    if (!nom) return res.status(400).json({ error: 'Paramètre nom manquant' });

    const domaine = site_web
      ? new URL(site_web.startsWith('http') ? site_web : `https://${site_web}`).hostname
      : null;

    // Stratégie : deux requêtes en parallèle
    // 1. Recherche dans le site de l'entreprise (si dispo) : site:domaine.fr actualité
    // 2. Recherche générale avec nom + siren pour précision
    const braveHeaders = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    };

    // Requête 1 : API News Brave — actu presse/médias sur l'entreprise
    const newsQuery = [nom, siren, ville].filter(Boolean).join(' ');
    const newsResponse = await fetch(
      `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(newsQuery)}&count=5&freshness=py`,
      { headers: braveHeaders }
    );
    const newsData = await newsResponse.json();
    const newsResults = newsData.results || [];

    // Requête 2 : si on a le site, chercher une page actu/blog dans le site
    let siteResults = [];
    if (domaine) {
      const siteResponse = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(`site:${domaine} actualité OR news OR communiqué`)}&count=3`,
        { headers: braveHeaders }
      );
      const siteData = await siteResponse.json();
      siteResults = siteData.web?.results || [];
    }

    // Priorité : page du site de l'entreprise > article de presse
    const best = siteResults[0] || newsResults[0];

    if (!best) {
      return res.json({ found: false, actu: null });
    }

    return res.json({
      found: true,
      actu: {
        titre: best.title || '',
        url: best.url || '',
        description: best.description || '',
        date: best.age || best.page_age || '',
        source: best.meta_url?.hostname || best.source?.name || '',
      },
    });
  } catch (err) {
    console.error('Erreur /api/claude/find-news:', err.message);
    res.status(500).json({ error: err.message || 'Erreur interne du serveur' });
  }
});

module.exports = router;