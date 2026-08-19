const express = require('express');
const router = express.Router();

const DROPCONTACT_BASE = 'https://api.dropcontact.io';

// Convertit les qualifications documentées par Dropcontact en un indicateur
// lisible. Les qualifications modernes sont par exemple "nominative@pro".
function qualificationToScore(qualification) {
  const value = (qualification || '').toLowerCase();
  if (value.includes('nominative') && value.includes('pro')) return 95;
  if (value.includes('verified')) return 95;
  if (value.includes('catch_all')) return 70;
  if (value.includes('high confidence')) return 75;
  if (value.includes('generic') && value.includes('pro')) return 55;
  if (value.includes('confidence')) return 50;
  return 30;
}

function bestEmail(emails) {
  return [...(emails || [])]
    .filter((entry) => entry?.email)
    .sort((a, b) => qualificationToScore(b.qualification) - qualificationToScore(a.qualification))[0] || null;
}

function setIfPresent(target, key, value) {
  if (typeof value === 'string' ? value.trim() : value) target[key] = value;
}

// POST /api/dropcontact/enrich
// Body: identité, société, SIREN/SIRET, site, LinkedIn, poste et téléphone public.
router.post('/enrich', async (req, res) => {
  try {
    const apiKey = process.env.DROPCONTACT_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Clé DROPCONTACT_API_KEY non configurée dans le .env' });
    }

    const {
      prenom, nom, entreprise, site_web, siren, siret, pays, poste, linkedin, telephone,
    } = req.body || {};
    if (!nom && !entreprise && !siren && !siret && !linkedin) {
      return res.status(400).json({ error: 'Paramètres nom et entreprise manquants' });
    }

    const contact = {};
    setIfPresent(contact, 'first_name', prenom);
    setIfPresent(contact, 'last_name', nom);
    setIfPresent(contact, 'full_name', [prenom, nom].filter(Boolean).join(' '));
    setIfPresent(contact, 'company', entreprise);
    setIfPresent(contact, 'website', site_web);
    setIfPresent(contact, 'num_siren', siren);
    setIfPresent(contact, 'siret', siret);
    setIfPresent(contact, 'country', pays || 'FR');
    setIfPresent(contact, 'job', poste);
    setIfPresent(contact, 'linkedin', linkedin);
    setIfPresent(contact, 'phone', telephone);

    // Étape 1 : soumettre la demande d'enrichissement
    const submitRes = await fetch(`${DROPCONTACT_BASE}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Token': apiKey,
      },
      body: JSON.stringify({
        data: [contact],
        // Demande aussi les données légales françaises dans la réponse.
        siren: Boolean(siren || siret),
        language: 'fr',
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

      if (!pollData.success || !pollData.data) continue;
      const contact = pollData.data?.[0];
      const emails = Array.isArray(contact?.email) ? contact.email : contact?.email ? [contact.email] : [];
      const email = bestEmail(emails);

      const enrichment = {
        company: contact?.company || '',
        website: contact?.website || '',
        linkedin: contact?.linkedin || '',
        company_linkedin: contact?.company_linkedin || '',
        siren: contact?.siren || '',
        siret: contact?.siret || '',
        job: contact?.job || '',
        job_level: contact?.job_level || '',
        job_function: contact?.job_function || '',
        emails: emails.map((entry) => ({ email: entry?.email || '', qualification: entry?.qualification || '' })),
      };

      if (!email) {
        return res.json({ found: false, email: null, score: null, telephone: null, enrichment });
      }

      // Le champ téléphone peut être sous plusieurs formes selon l'API Dropcontact
      let telephone = null;
      const phonesRaw = contact?.phone ?? contact?.phones ?? contact?.telephone ?? null;
      if (typeof phonesRaw === 'string' && phonesRaw.length > 0) {
        telephone = phonesRaw;
      } else if (Array.isArray(phonesRaw) && phonesRaw.length > 0) {
        const first = phonesRaw[0];
        telephone = first?.number ?? first?.phone ?? first?.value ?? (typeof first === 'string' ? first : null);
      }

      const telephoneMobile = contact?.mobile_phone || contact?.mobile || null;

      return res.json({
        found: true,
        email: email.email,
        score: qualificationToScore(email.qualification),
        qualification: email.qualification || '',
        telephone,
        telephone_mobile: telephoneMobile,
        linkedin: contact?.linkedin || '',
        company: contact?.company || '',
        website: contact?.website || '',
        enrichment,
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
