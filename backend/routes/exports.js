const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Créer la table si elle n'existe pas
pool.query(`
  CREATE TABLE IF NOT EXISTS "EntrepriseExportee" (
    "id" SERIAL PRIMARY KEY,
    "siren" TEXT NOT NULL UNIQUE,
    "nom" TEXT NOT NULL,
    "exported_at" TIMESTAMP DEFAULT NOW()
  )
`).catch((err) => console.error('Erreur création table:', err.message));

// POST /api/exports
router.post('/', async (req, res) => {
  try {
    const { entreprises } = req.body;
    if (!Array.isArray(entreprises) || entreprises.length === 0) {
      return res.status(400).json({ error: 'Paramètre entreprises manquant ou vide' });
    }
    for (const { siren, nom } of entreprises) {
      await pool.query(
        `INSERT INTO "EntrepriseExportee" (siren, nom) VALUES ($1, $2) ON CONFLICT (siren) DO NOTHING`,
        [siren, nom]
      );
    }
    res.json({ saved: entreprises.length });
  } catch (err) {
    console.error('Erreur POST /api/exports:', err.message);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// GET /api/exports/sirens
router.get('/sirens', async (req, res) => {
  try {
    const result = await pool.query(`SELECT siren FROM "EntrepriseExportee"`);
    res.json({ sirens: result.rows.map((r) => r.siren) });
  } catch (err) {
    console.error('Erreur GET /api/exports/sirens:', err.message);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// DELETE /api/exports
router.delete('/', async (req, res) => {
  try {
    await pool.query(`DELETE FROM "EntrepriseExportee"`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur DELETE /api/exports:', err.message);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;