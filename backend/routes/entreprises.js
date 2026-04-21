const express = require('express');
const router = express.Router();

const GOUV_BASE = 'https://recherche-entreprises.api.gouv.fr';
const MAX_REMONTEES = 5;

// Priorité des qualités dirigeants : les vrais dirigeants avant les CAC et autres
function prioriteDirigeant(qualite) {
  const q = (qualite || '').toLowerCase();
  if (q.includes('président') || q.includes('president')) return 1;
  if (q.includes('gérant') || q.includes('gerant')) return 2;
  if (q.includes('directeur général') || q.includes('directeur general') || q.includes('dg ') || q === 'dg') return 3;
  if (q.includes('directeur')) return 4;
  if (q.includes('pdg')) return 5;
  if (q.includes('administrateur')) return 6;
  if (q.includes('associé') || q.includes('associe')) return 7;
  if (q.includes('commissaire aux comptes') || q.includes('commissaire aux compte')) return 99;
  if (q.includes('commissaire')) return 98;
  return 50;
}

function trierDirigeants(dirigeants) {
  return [...(dirigeants || [])].sort((a, b) => {
    // Priorité 1 : vraie personne (a un prénom) avant une société/groupe
    const aPersonne = a.prenoms ? 0 : 1;
    const bPersonne = b.prenoms ? 0 : 1;
    if (aPersonne !== bPersonne) return aPersonne - bPersonne;
    // Priorité 2 : qualité du rôle
    return prioriteDirigeant(a.qualite) - prioriteDirigeant(b.qualite);
  });
}

async function remonterDirigeant(siren, visited = new Set(), depth = 0) {
  if (depth > MAX_REMONTEES) return { found: false, remontees: depth, raison: 'max_profondeur' };
  if (visited.has(siren)) return { found: false, remontees: depth, raison: 'cycle' };
  visited.add(siren);

  let response, data;
  try {
    response = await fetch(`${GOUV_BASE}/search?q=${encodeURIComponent(siren)}&per_page=1`);
    data = await response.json();
  } catch {
    return { found: false, remontees: depth, raison: 'fetch' };
  }
  if (!response.ok) return { found: false, remontees: depth, raison: 'api_error' };

  const entreprise = (data.results || []).find((r) => r.siren === siren) || (data.results || [])[0];
  if (!entreprise) return { found: false, remontees: depth, raison: 'non_trouvee' };

  const tries = trierDirigeants(entreprise.dirigeants);
  const top = tries[0];
  if (!top) return { found: false, remontees: depth, raison: 'aucun_dirigeant' };

  if (top.prenoms) {
    return {
      found: true,
      prenom: top.prenoms,
      nom: top.nom || '',
      qualite: top.qualite || '',
      remontees: depth,
    };
  }

  // Dirigeant est une personne morale — remonter d'un cran
  if (top.siren) {
    return remonterDirigeant(top.siren, visited, depth + 1);
  }

  return { found: false, remontees: depth, raison: 'dirigeant_sans_siren' };
}

// GET /api/entreprises/search
router.get('/search', async (req, res) => {
  try {
    const { departement, code_postal, section, q, per_page = 25, page = 1 } = req.query;

    const url = new URL(`${GOUV_BASE}/search`);

    if (q) url.searchParams.set('q', q);
    if (code_postal) url.searchParams.set('code_postal', code_postal);
    if (section) url.searchParams.set('section_activite_principale', section);
    if (departement) url.searchParams.set('departement', departement);
    url.searchParams.set('per_page', Math.min(Number(per_page), 25));

    url.searchParams.set('page', Number(page));

    const response = await fetch(url.toString());
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after')) || 5;
      return res.status(429).json({
        error: "Trop de requêtes vers l'API data.gouv.",
        retry_after: retryAfter,
      });
    }
    if (!response.ok) {
      const data = await response.json();
      return res.status(response.status).json({ error: data.erreur || data.message || 'Erreur API' });
    }
    const data = await response.json();

    let entreprises = (data.results || []).map((e) => {
      const dirigeantsTries = trierDirigeants(e.dirigeants);
      const dirigeant = dirigeantsTries[0] || {};
      const tousLesDirigeants = dirigeantsTries.map((d) => ({
        prenoms: d.prenoms || '',
        nom: d.nom || d.denomination || '',
        qualite: d.qualite || '',
        date_naissance: d.annee_de_naissance ? `${d.annee_de_naissance}` : '',
      }));
      return {
        siren: e.siren,
        nom_entreprise: e.nom_complet || '',
        prenom_dirigeant: dirigeant.prenoms || '',
        nom_dirigeant: dirigeant.nom || dirigeant.denomination || '',
        qualite_dirigeant: dirigeant.qualite || '',
        dirigeants: tousLesDirigeants,
        code_postal: e.siege?.code_postal || '',
        ville: e.siege?.libelle_commune || e.siege?.commune || '',
        adresse: e.siege?.adresse || '',
        date_creation: e.date_creation || '',
        nature_juridique: e.nature_juridique || '',
        code_naf: e.activite_principale || '',
        libelle_code_naf: e.libelle_activite_principale || '',
        tranche_effectif: e.tranche_effectif_salarie || '',
        nb_etablissements: e.nombre_etablissements_ouverts || 0,
        site_web: e.site_web || '',
        _etat: e.siege?.etat_administratif || 'A',
      };
    });

    // Exclure les entreprises fermées
    entreprises = entreprises.filter((e) => e._etat === 'A');
    entreprises.forEach((e) => delete e._etat);

    res.json({ total: entreprises.length, entreprises });
  } catch (err) {
    console.error('Erreur /api/entreprises/search:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

// GET /api/entreprises/dirigeant-reel?siren=XXX
// Remonte l'arbre quand le dirigeant est une personne morale, jusqu'à trouver une vraie personne
router.get('/dirigeant-reel', async (req, res) => {
  const { siren } = req.query;
  if (!siren) return res.status(400).json({ error: 'Paramètre siren manquant' });
  try {
    const result = await remonterDirigeant(siren);
    res.json(result);
  } catch (err) {
    console.error('Erreur /api/entreprises/dirigeant-reel:', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

module.exports = router;
