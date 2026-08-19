const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const dropcontactKey = process.env.DROPCONTACT_API_KEY;
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;

  const missing = [];
  if (!dropcontactKey) missing.push('DROPCONTACT_API_KEY');
  if (!placesKey) missing.push('GOOGLE_PLACES_API_KEY');

  if (missing.length > 0) {
    return res.status(200).json({
      ok: false,
      missing,
      message: `Clé(s) manquante(s) dans le .env : ${missing.join(', ')}`,
    });
  }

  res.json({ ok: true, message: 'Clés API configurées.' });
});

module.exports = router;
