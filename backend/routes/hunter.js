const express = require('express');
const router = express.Router();

const HUNTER_BASE = 'https://api.hunter.io/v2';

// GET /api/hunter/domain-search?domain=exemple.fr
router.get('/domain-search', async (req, res) => {
  try {
    const apiKey = process.env.HUNTER_API_KEY;
    if (!apiKey || apiKey === 'ta_cle_hunter') {
      return res.status(500).json({ error: 'Clé HUNTER_API_KEY non configurée dans le .env' });
    }

    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Paramètre domain manquant' });

    const url = new URL(`${HUNTER_BASE}/domain-search`);
    url.searchParams.set('domain', domain);
    url.searchParams.set('api_key', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.errors?.[0]?.details || 'Erreur Hunter lors de la recherche',
      });
    }

    const emails = data.data?.emails || [];
    if (emails.length === 0) {
      return res.json({ found: false, email: null, score: null });
    }

    // Retourner le premier email avec le meilleur score
    const best = emails.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    res.json({
      found: true,
      email: best.value,
      score: best.confidence || 0,
    });
  } catch (err) {
    console.error('Erreur /api/hunter/domain-search:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;
