const express = require('express');
const router = express.Router();

const DROPCONTACT_BASE = 'https://api.dropcontact.io';

// Convertit la qualification Dropcontact en score numérique (pour compatibilité affichage)
function qualificationToScore(qualification) {
  switch (qualification) {
    case 'verified': return 95;
    case 'high confidence': return 75;
    case 'confidence': return 50;
    default: return 30;
  }
}

// POST /api/dropcontact/enrich
// Body: { prenom, nom, entreprise, site_web }
router.post('/enrich', async (req, res) => {
  try {
    const apiKey = process.env.DROPCONTACT_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Clé DROPCONTACT_API_KEY non configurée dans le .env' });
    }

    const { prenom, nom, entreprise, site_web } = req.body;
    if (!nom && !entreprise) {
      return res.status(400).json({ error: 'Paramètres nom et entreprise manquants' });
    }

    // Étape 1 : soumettre la demande d'enrichissement
    const submitRes = await fetch(`${DROPCONTACT_BASE}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Token': apiKey,
      },
      body: JSON.stringify({
        data: [{
          first_name: prenom || '',
          last_name: nom || '',
          company: entreprise || '',
          website: site_web || '',
        }],
        siren: false,
      }),
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok || submitData.error) {
      return res.status(submitRes.status).json({
        error: submitData.reason || submitData.message || 'Erreur Dropcontact',
      });
    }

    const requestId = submitData.request_id;
    if (!requestId) {
      return res.status(500).json({ error: 'Pas de request_id retourné par Dropcontact' });
    }

    // Étape 2 : polling jusqu'à ce que le résultat soit prêt (max 40 secondes)
    const MAX_ATTEMPTS = 10;
    const POLL_INTERVAL_MS = 4000;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollRes = await fetch(`${DROPCONTACT_BASE}/batch/${requestId}`, {
        headers: { 'X-Access-Token': apiKey },
      });
      const pollData = await pollRes.json();

      console.log('Dropcontact réponse:', JSON.stringify(pollData.data?.[0], null, 2));
      if (!pollData.success || !pollData.data) continue;
      const contact = pollData.data?.[0];
      const emails = contact?.email || [];

      // Log complet pour debug
      console.log('Dropcontact contact complet:', JSON.stringify(contact, null, 2));

      if (emails.length === 0) {
        return res.json({ found: false, email: null, score: null, telephone: null });
      }

      // Prendre le premier email (Dropcontact les trie par confiance)
      const best = emails[0];

      // Le champ téléphone peut être sous plusieurs formes selon l'API Dropcontact
      let telephone = null;
      const phonesRaw = contact?.phone ?? contact?.phones ?? contact?.telephone ?? null;
      if (typeof phonesRaw === 'string' && phonesRaw.length > 0) {
        telephone = phonesRaw;
      } else if (Array.isArray(phonesRaw) && phonesRaw.length > 0) {
        const first = phonesRaw[0];
        telephone = first?.number ?? first?.phone ?? first?.value ?? (typeof first === 'string' ? first : null);
      }

      return res.json({
        found: true,
        email: best.email,
        score: qualificationToScore(best.qualification),
        qualification: best.qualification || '',
        telephone,
      });
    }

    // Timeout
    return res.json({ found: false, email: null, score: null });
  } catch (err) {
    console.error('Erreur /api/dropcontact/enrich:', err.message);
    res.status(500).json({ error: err.message || 'Erreur interne du serveur' });
  }
});

module.exports = router;