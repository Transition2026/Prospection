const BASE_URL = 'http://localhost:3001';

export async function checkStatus() {
  const res = await fetch(`${BASE_URL}/api/status`);
  return res.json();
}

/**
 * Recherche via l'API Recherche Entreprises (data.gouv.fr)
 * Gère les multi-départements et multi-sections en parallèle avec dédoublonnage par SIREN.
 * @param {Object} params
 * @returns {Array} liste d'entreprises dédoublonnées
 */
/**
 * @param {Object} params
 * @param {number} page - numéro de page (commence à 1)
 * @param {Set} existingSirens - SIRENs déjà chargés, pour dédoublonner entre pages
 * @returns {{ entreprises: Array, hasMore: boolean }}
 */
export async function searchEntreprises(params, page = 1, existingSirens = new Set()) {
  const { departements, sections, per_page, ...rest } = params;

  const depts = departements && departements.length > 0 ? departements : [null];
  const sects = sections && sections.length > 0 ? sections : [null];

  const combinations = [];
  for (const dept of depts) {
    for (const sect of sects) {
      combinations.push({ dept, sect });
    }
  }

  const results = await Promise.all(
    combinations.map(({ dept, sect }) => {
      const query = new URLSearchParams({ ...rest, per_page: per_page || 25, page });
      if (dept) query.set('departement', dept);
      if (sect) query.set('section', sect);
      return fetch(`${BASE_URL}/api/entreprises/search?${query.toString()}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.error) throw new Error(d.error);
          return d.entreprises || [];
        });
    })
  );

  const flat = results.flat();

  // Dédoublonner en tenant compte des pages déjà chargées
  const seen = new Set(existingSirens);
  const nouvelles = flat.filter((e) => {
    if (seen.has(e.siren)) return false;
    seen.add(e.siren);
    return true;
  });

  // S'il n'y a plus rien de nouveau depuis l'API, on est à la fin
  const hasMore = flat.length > 0;

  return { entreprises: nouvelles, hasMore };
}

/**
 * Trouve le site web d'une entreprise via Claude (web search)
 */
export async function findWebsiteWithClaude({ nom, ville, siren }) {
  const params = new URLSearchParams({ nom });
  if (ville) params.set('ville', ville);
  if (siren) params.set('siren', siren);
  const res = await fetch(`${BASE_URL}/api/claude/find-website?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur Claude');
  return data;
}

/**
 * Cherche l'actualité récente d'une entreprise via Brave Search
 */
export async function findNewsWithBrave({ nom, ville, siren, site_web }) {
  const params = new URLSearchParams({ nom });
  if (ville) params.set('ville', ville);
  if (siren) params.set('siren', siren);
  if (site_web) params.set('site_web', site_web);
  const res = await fetch(`${BASE_URL}/api/claude/find-news?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur Brave Search');
  return data;
}

/**
 * Enrichissement email via Dropcontact
 */
export async function enrichDropcontact({ prenom, nom, entreprise, site_web }) {
  const res = await fetch(`${BASE_URL}/api/dropcontact/enrich`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prenom, nom, entreprise, site_web }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur Dropcontact');
  return data;
}

export async function getExportedSirens() {
  const res = await fetch(`${BASE_URL}/api/exports/sirens`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return new Set(data.sirens);
}

export async function saveExportedEntreprises(entreprises) {
  const res = await fetch(`${BASE_URL}/api/exports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entreprises: entreprises.map((e) => ({ siren: e.siren, nom: e.nom_entreprise })) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

export async function resetExportedSirens() {
  const res = await fetch(`${BASE_URL}/api/exports`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
