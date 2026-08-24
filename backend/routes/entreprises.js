const express = require('express');
const router = express.Router();

const GOUV_BASE = 'https://recherche-entreprises.api.gouv.fr';
const MAX_REMONTEES = 5;

function adresseEtablissement(etablissement = {}) {
  return etablissement.adresse || etablissement.adresse_complete || '';
}

function villeEtablissement(etablissement = {}) {
  return etablissement.libelle_commune || etablissement.commune || '';
}

function enseigneEtablissement(etablissement = {}) {
  return etablissement.enseigne
    || etablissement.nom_commercial
    || (Array.isArray(etablissement.liste_enseignes) ? etablissement.liste_enseignes[0] : '')
    || '';
}

// `matching_etablissements` représente le lieu qui a motivé le résultat de
// recherche Data.gouv. Il est plus utile à la prospection qu'un siège de groupe.
function choisirEtablissementCible(entreprise = {}) {
  const etablissements = Array.isArray(entreprise.matching_etablissements)
    ? entreprise.matching_etablissements
    : [];
  return etablissements.find((e) => (e.etat_administratif || 'A') === 'A') || etablissements[0] || null;
}

// Les commissaires aux comptes ne sont pas des interlocuteurs de prospection.
// Tous les autres mandataires sont conservés : certaines petites structures ne
// déclarent ni président ni gérant malgré la présence d'une personne physique.
function prioriteDirigeant(qualite) {
  const q = (qualite || '').toLowerCase();
  if (q.includes('commissaire')) return null;
  if (q.includes('président') || q.includes('president') || q.includes('pdg')) return 1;
  if (q.includes('gérant') || q.includes('gerant')) return 2;
  if (q.includes('directeur général') || q.includes('directeur general') || q === 'dg') return 3;
  return 10;
}

function trierDirigeants(dirigeants) {
  return [...(dirigeants || [])]
    .filter((dirigeant) => prioriteDirigeant(dirigeant.qualite) !== null)
    .sort((a, b) => {
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
  if (tries.length === 0) return { found: false, remontees: depth, raison: 'aucun_mandataire_hors_commissaire' };

  // On recherche d'abord une personne physique au niveau courant, puis chaque
  // mandataire personne morale éligible. L'ancien code ne suivait que le premier.
  const personnePhysique = tries.find((dirigeant) => dirigeant.prenoms);
  if (personnePhysique) {
    return {
      found: true,
      prenom: personnePhysique.prenoms,
      nom: personnePhysique.nom || '',
      qualite: personnePhysique.qualite || '',
      remontees: depth,
    };
  }

  for (const dirigeant of tries) {
    if (!dirigeant.siren) continue;
    const resultat = await remonterDirigeant(dirigeant.siren, visited, depth + 1);
    if (resultat.found) return resultat;
  }

  return { found: false, remontees: depth, raison: 'dirigeant_personne_morale_non_resolu' };
}

// GET /api/entreprises/search
router.get('/search', async (req, res) => {
  try {
    const { departement, code_postal, section, q, nom_contient, tranche_effectif_salarie, per_page = 25, page = 1 } = req.query;

    const url = new URL(`${GOUV_BASE}/search`);

    // Le filtre « nom de l'entreprise contient » doit aussi être envoyé à
    // Data.gouv : le filtrer uniquement après le téléchargement des pages
    // donnait des résultats incohérents et remplissait inutilement le cache.
    if (q || nom_contient) url.searchParams.set('q', q || nom_contient);
    if (code_postal) url.searchParams.set('code_postal', code_postal);
    if (section) url.searchParams.set('section_activite_principale', section);
    if (departement) url.searchParams.set('departement', departement);
    if (tranche_effectif_salarie) url.searchParams.set('tranche_effectif_salarie', tranche_effectif_salarie);
    // Réduit le volume transféré sans retirer les champs nécessaires au tri,
    // à la décision locale ou à la vérification d'établissement.
    url.searchParams.set('etat_administratif', 'A');
    url.searchParams.set('minimal', 'true');
    url.searchParams.set('include', 'siege,dirigeants,matching_etablissements');
    url.searchParams.set('limite_matching_etablissements', '1');
    url.searchParams.set('sort_by_size', 'true');
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
      const etablissement = choisirEtablissementCible(e);
      const tousLesDirigeants = dirigeantsTries.map((d) => ({
        prenoms: d.prenoms || '',
        nom: d.nom || d.denomination || '',
        qualite: d.qualite || '',
        siren: d.siren || '',
        date_naissance: d.annee_de_naissance ? `${d.annee_de_naissance}` : '',
      }));
      return {
        siren: e.siren,
        nom_entreprise: e.nom_complet || '',
        // La fiche source complète est gardée dans IndexedDB avec le résultat
        // normalisé, y compris si elle est ensuite masquée par un filtre UI.
        data_gouv_brut: e,
        prenom_dirigeant: dirigeant.prenoms || '',
        nom_dirigeant: dirigeant.nom || dirigeant.denomination || '',
        qualite_dirigeant: dirigeant.qualite || '',
        siren_dirigeant: dirigeant.siren || '',
        dirigeants: tousLesDirigeants,
        // Donnée légale : ne jamais l'écraser avec un résultat Google Places.
        adresse_legale: e.siege?.adresse || '',
        code_postal_legal: e.siege?.code_postal || '',
        ville_legale: villeEtablissement(e.siege),
        siret_siege: e.siege?.siret || '',
        // Donnée issue du filtre/recherche Data.gouv : point de départ Places.
        adresse_etablissement: adresseEtablissement(etablissement),
        code_postal_etablissement: etablissement?.code_postal || '',
        ville_etablissement: villeEtablissement(etablissement),
        siret_etablissement: etablissement?.siret || '',
        enseigne_etablissement: enseigneEtablissement(etablissement),
        latitude_etablissement: etablissement?.latitude || etablissement?.coordonnees?.latitude || null,
        longitude_etablissement: etablissement?.longitude || etablissement?.coordonnees?.longitude || null,
        // Compatibilité avec le frontend actuel : il continue à afficher le siège.
        code_postal: e.siege?.code_postal || '',
        ville: villeEtablissement(e.siege),
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

    // La recherche peut cibler un établissement actif alors que le siège légal
    // est fermé. On conserve ce retrait et le comptabilise pour le journal UI.
    const excludedClosedHeadOffices = entreprises.filter((e) => e._etat !== 'A').length;
    entreprises = entreprises.filter((e) => e._etat === 'A');
    entreprises.forEach((e) => delete e._etat);

    res.json({
      total: entreprises.length,
      total_results: data.total_results ?? null,
      total_pages: data.total_pages ?? null,
      excluded_closed_head_offices: excludedClosedHeadOffices,
      page: Number(data.page || page),
      has_more: data.total_pages ? Number(data.page || page) < Number(data.total_pages) : entreprises.length > 0,
      entreprises,
    });
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
