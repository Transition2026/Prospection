const express = require('express');

const router = express.Router();
const DROPCONTACT_URL = 'https://api.dropcontact.com/v1/enrich/all';
const CACHE_TTL_MS = 60 * 1000;
let cachedDropcontact = null;

async function dropcontactCredits() {
  if (cachedDropcontact && Date.now() - cachedDropcontact.at < CACHE_TTL_MS) return cachedDropcontact.value;
  const key = process.env.DROPCONTACT_API_KEY;
  if (!key) return { configured: false, message: 'Clé Dropcontact non configurée.' };
  const response = await fetch(DROPCONTACT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Access-Token': key },
    // Forme documentée par Dropcontact pour lire credits_left sans enrichir de
    // contact ni débiter le compte.
    body: JSON.stringify({ data: [{}] }),
  });
  const data = await response.json();
  if (!response.ok || typeof data.credits_left !== 'number') {
    throw new Error(data.reason || data.message || 'Solde Dropcontact indisponible.');
  }
  const value = { configured: true, credits_left: data.credits_left, checked_at: new Date().toISOString() };
  cachedDropcontact = { at: Date.now(), value };
  return value;
}

// GET /api/usage
// Google Places est calculé côté navigateur depuis le cache local : aucun
// accès Google Cloud supplémentaire n'est requis.
router.get('/', async (req, res) => {
  try {
    res.json({
      dropcontact: await dropcontactCredits(),
      google_places: { source: 'local_cache' },
    });
  } catch (err) {
    res.json({
      dropcontact: { configured: false, message: err.message || 'Solde Dropcontact indisponible.' },
      google_places: { source: 'local_cache' },
    });
  }
});

module.exports = router;
