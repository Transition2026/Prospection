const express = require('express');

const router = express.Router();
const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';
const CONFIDENCE_CONFIRMATION_THRESHOLD = 70;
const RESOLVER_VERSION = 4;

function normaliser(value) {
  return (value || '')
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value) {
  const stopWords = new Set(['sas', 'sarl', 'sasu', 'sa', 'eurl', 'sci', 'snc', 'et', 'de', 'du', 'des', 'la', 'le', 'les']);
  return new Set(normaliser(value).split(' ').filter((token) => token.length >= 3 && !stopWords.has(token)));
}

function tokensAdresse(value) {
  // Les numéros de voie et les mots courts sont importants pour établir qu'un
  // établissement Data.gouv et une fiche Google désignent le même lieu.
  return new Set(normaliser(value).split(' ').filter((token) => token && token !== 'france'));
}

function couvertureAttendue(attendus, observes) {
  // On mesure ce qui est confirmé dans les données attendues. Un libellé
  // Google très descriptif ne doit pas pénaliser une adresse pourtant exacte.
  if (attendus.size === 0 || observes.size === 0) return 0;
  let communs = 0;
  for (const token of attendus) if (observes.has(token)) communs += 1;
  return communs / attendus.size;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nombreFini(value) {
  if (value === null || value === undefined || value === '') return null;
  const nombre = Number(value);
  return Number.isFinite(nombre) ? nombre : null;
}

function scoreCandidat(place, contexte) {
  const placeName = place.displayName?.text || '';
  const placeAddress = place.formattedAddress || '';
  const aliases = [...new Set([contexte.nom, contexte.enseigne].filter(Boolean).map(normaliser))];
  const nom = Math.round(Math.max(0, ...aliases.map((alias) => (
    couvertureAttendue(tokens(alias), tokens(placeName))
  ))) * 20);
  const adresse = Math.round(couvertureAttendue(tokensAdresse(contexte.adresse), tokensAdresse(placeAddress)) * 35);
  const postalCode = contexte.code_postal && placeAddress.includes(contexte.code_postal) ? 20 : 0;
  const ville = contexte.ville && normaliser(placeAddress).includes(normaliser(contexte.ville)) ? 10 : 0;

  const distance = distanceKm(
    nombreFini(contexte.latitude),
    nombreFini(contexte.longitude),
    nombreFini(place.location?.latitude),
    nombreFini(place.location?.longitude),
  );
  const proximite = distance === null ? 0 : distance <= 0.05 ? 15 : distance <= 0.25 ? 12 : distance <= 1 ? 8 : distance <= 5 ? 4 : 0;
  const score = Math.min(100, nom + adresse + postalCode + ville + proximite);

  return {
    score,
    nom_score: nom,
    fiabilite: {
      nom,
      adresse,
      code_postal: postalCode,
      ville,
      proximite,
      total: score,
    },
    distance_km: distance === null ? null : Number(distance.toFixed(2)),
  };
}

function nomsRecherche(contexte) {
  const names = [contexte.nom, contexte.enseigne].filter(Boolean);
  return [...new Map(names.map((name) => [normaliser(name), name])).values()];
}

function construireRequete(contexte) {
  return [
    ...nomsRecherche(contexte),
    contexte.adresse,
    contexte.code_postal,
    contexte.ville,
    'France',
  ].filter(Boolean).join(', ');
}

function construireRequeteNomVille(contexte) {
  return [...nomsRecherche(contexte), contexte.ville, 'France'].filter(Boolean).join(', ');
}

function candidatsPublics(places, contexte, sourceRecherche = 'nom_adresse') {
  return places
    .map((place) => ({ place, ...scoreCandidat(place, contexte) }))
    .sort((a, b) => b.score - a.score)
    .map(({ place, score, nom_score, fiabilite, distance_km }) => ({
      place_id: place.id,
      nom: place.displayName?.text || '',
      adresse: place.formattedAddress || '',
      statut: place.businessStatus || '',
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      score,
      nom_score,
      fiabilite,
      distance_km,
      source_recherche: sourceRecherche,
    }));
}

function fusionnerCandidats(...listes) {
  const candidats = new Map();
  listes.flat().forEach((candidat) => {
    if (!candidat.place_id) return;
    const precedent = candidats.get(candidat.place_id);
    if (!precedent || candidat.score > precedent.score) candidats.set(candidat.place_id, candidat);
  });
  return [...candidats.values()].sort((a, b) => b.score - a.score);
}

async function googleFetch(url, apiKey, fieldMask, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function requeteTextSearch(textQuery, contexte) {
  const latitude = nombreFini(contexte.latitude);
  const longitude = nombreFini(contexte.longitude);
  const body = {
    textQuery,
    languageCode: 'fr',
    regionCode: 'FR',
    pageSize: 5,
  };
  // Un biais, et non une restriction, favorise l'établissement Data.gouv sans
  // empêcher Google de retourner une enseigne dont la géolocalisation est un peu
  // décalée.
  if (latitude !== null && longitude !== null) {
    body.locationBias = {
      circle: {
        center: { latitude, longitude },
        radius: 1500,
      },
    };
  }
  return body;
}

// POST /api/places/resolve
// Le client ne reçoit jamais la clé : Google Places est appelé uniquement ici.
router.post('/resolve', async (req, res) => {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'GOOGLE_PLACES_API_KEY non configurée dans le .env' });
  }

  const {
    nom,
    enseigne = '',
    adresse = '',
    code_postal = '',
    ville = '',
    latitude = null,
    longitude = null,
  } = req.body || {};
  if (!nom) return res.status(400).json({ error: 'Le nom de l’entreprise est obligatoire.' });

  const contexte = { nom, enseigne, adresse, code_postal, ville, latitude, longitude };
  try {
    const fieldMask = 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus';
    const { response: searchResponse, data: searchData } = await googleFetch(
      PLACES_TEXT_SEARCH_URL,
      apiKey,
      fieldMask,
      {
        method: 'POST',
        // Le nom légal reste toujours présent ; l'enseigne est ajoutée comme
        // alias et ne le remplace jamais.
        body: JSON.stringify(requeteTextSearch(construireRequeteNomVille(contexte), contexte)),
      },
    );
    if (!searchResponse.ok) {
      console.error('Erreur Places Text Search:', searchResponse.status, searchData.error?.status || '');
      return res.status(searchResponse.status).json({ error: searchData.error?.message || 'Erreur Google Places.' });
    }

    const candidatsNomVille = candidatsPublics(searchData.places || [], contexte, 'nom_ville');
    let candidats = candidatsNomVille;
    let meilleur = candidats[0];

    // En secours, l'adresse rend la recherche plus discriminante lorsqu'il
    // existe des homonymes. Les deux listes sont conservées et, quel que soit
    // leur score, la meilleure proposition est ensuite passée à Place Details.
    if (!meilleur || meilleur.score < CONFIDENCE_CONFIRMATION_THRESHOLD) {
      const { response: fallbackResponse, data: fallbackData } = await googleFetch(
        PLACES_TEXT_SEARCH_URL,
        apiKey,
        fieldMask,
        {
          method: 'POST',
          body: JSON.stringify(requeteTextSearch(construireRequete(contexte), contexte)),
        },
      );
      if (fallbackResponse.ok) {
        candidats = fusionnerCandidats(candidatsNomVille, candidatsPublics(fallbackData.places || [], contexte, 'nom_adresse'));
        meilleur = candidats[0];
      } else {
        console.error('Erreur Places Text Search nom + adresse:', fallbackResponse.status, fallbackData.error?.status || '');
      }
    }

    if (!meilleur) {
      return res.json({
        resolver_version: RESOLVER_VERSION,
        found: false,
        raison: 'aucun_resultat',
        candidat_retenu: null,
        statut: '',
        score: null,
        date_controle: new Date().toISOString(),
        candidats,
      });
    }

    const { response: detailsResponse, data: details } = await googleFetch(
      `${PLACES_DETAILS_BASE_URL}/${encodeURIComponent(meilleur.place_id)}`,
      apiKey,
      'id,displayName,formattedAddress,addressComponents,location,nationalPhoneNumber,internationalPhoneNumber,websiteUri,businessStatus',
    );
    if (!detailsResponse.ok) {
      console.error('Erreur Places Details:', detailsResponse.status, details.error?.status || '');
      // La recherche texte a bien répondu : conserver sa meilleure proposition
      // permet de l'auditer et de la relancer plus tard.
      return res.json({
        resolver_version: RESOLVER_VERSION,
        found: false,
        raison: 'details_indisponibles',
        erreur_google: details.error?.message || 'Erreur Google Places Details.',
        candidat_retenu: { ...meilleur, details_obtenus: false },
        statut: meilleur.statut || '',
        score: meilleur.score,
        date_controle: new Date().toISOString(),
        candidats,
      });
    }

    const matchConfirme = meilleur.score >= CONFIDENCE_CONFIRMATION_THRESHOLD;
    const candidatsAvecDetails = candidats.map((candidat) => (
      candidat.place_id === meilleur.place_id ? { ...candidat, details_obtenus: true } : candidat
    ));

    return res.json({
      resolver_version: RESOLVER_VERSION,
      // `found` signifie qu'une fiche Google a été obtenue. La fiabilité de sa
      // correspondance Data.gouv est exposée séparément dans `match_confirme`.
      found: true,
      match_confirme: matchConfirme,
      raison: matchConfirme ? 'correspondance_confirmee' : 'proposition_a_verifier',
      place_id: details.id,
      score: meilleur.score,
      fiabilite: meilleur.fiabilite,
      candidat_retenu: { ...meilleur, details_obtenus: true },
      date_controle: new Date().toISOString(),
      adresse_google: details.formattedAddress || '',
      nom_google: details.displayName?.text || '',
      telephone_public: details.nationalPhoneNumber || details.internationalPhoneNumber || '',
      site_web: details.websiteUri || '',
      statut: details.businessStatus || meilleur.statut || '',
      adresse_components: details.addressComponents || [],
      latitude: details.location?.latitude ?? null,
      longitude: details.location?.longitude ?? null,
      candidats: candidatsAvecDetails,
    });
  } catch (error) {
    console.error('Erreur /api/places/resolve:', error.message);
    return res.status(502).json({ error: 'Impossible de joindre Google Places.' });
  }
});

module.exports = router;
