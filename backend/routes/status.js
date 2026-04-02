const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  const dropcontactKey = process.env.DROPCONTACT_API_KEY;

  if (!dropcontactKey) {
    return res.status(200).json({
      ok: false,
      missing: ['DROPCONTACT_API_KEY'],
      message: 'Clé manquante dans le .env : DROPCONTACT_API_KEY',
    });
  }

  res.json({ ok: true, message: 'Clés API configurées.' });
});

module.exports = router;