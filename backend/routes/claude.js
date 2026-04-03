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

// GET /api/claude/find-rh?nom=COMPANY&ville=CITY
router.get('/find-rh', async (req, res) => {
  try {
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'BRAVE_API_KEY non configurée dans le .env' });
    }

    const { nom, ville } = req.query;
    if (!nom) return res.status(400).json({ error: 'Paramètre nom manquant' });

    // Recherche LinkedIn de profils RH liés à l'entreprise
    const query = `"${nom}" ${ville ? ville + ' ' : ''}Responsable RH OR DRH OR "Chargé RH" OR "Chargée RH" site:linkedin.com/in`;

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Erreur Brave Search' });
    }

    const results = data.web?.results || [];
    if (results.length === 0) {
      return res.json({ found: false, contact_rh: null });
    }

    // Extraire le nom depuis le titre du profil LinkedIn
    // Format typique : "Prénom Nom - Responsable RH - Entreprise | LinkedIn"
    const best = results[0];
    const titre = best.title || '';
    const description = best.description || '';
    const url = best.url || '';

    // Extraire le nom : partie avant le premier " - " ou " – " ou " | "
    const separators = [' - ', ' – ', ' | ', ' · '];
    let nom_rh = titre;
    for (const sep of separators) {
      const idx = nom_rh.indexOf(sep);
      if (idx > 0) {
        nom_rh = nom_rh.substring(0, idx).trim();
        break;
      }
    }

    // Extraire le poste : partie entre le 1er et 2ème séparateur
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

module.exports = router;