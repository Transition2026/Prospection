// En dev Vite tourne sur :5173, en prod le backend sert tout sur :3001
const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

export class RateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message || 'Rate limit atteint');
    this.isRateLimit = true;
    this.retryAfter = Number(retryAfter) || 10;
  }
}

async function lireJson(res, erreurParDefaut) {
  const data = await res.json();
  if (res.status === 429) throw new RateLimitError(data.error, data.retry_after);
  if (!res.ok) throw new Error(data.error || erreurParDefaut);
  return data;
}

export async function checkStatus() {
  return lireJson(await fetch(`${BASE_URL}/api/status`), 'Erreur de statut API');
}

export async function searchEntreprises(params, page = 1, existingSirens = new Set()) {
  const { departements, sections, per_page, limit, ...rest } = params;
  const depts = departements?.length ? departements : [null];
  const sects = sections?.length ? sections : [null];
  const results = [];
  let hasMore = false;
  let totalPages = 0;
  let totalResults = 0;
  let firstRequest = true;

  // La recherche exhaustive peut regrouper plusieurs départements ou secteurs.
  // On les sérialise pour rester sous la limite publique de Data.gouv.
  for (const dept of depts) {
    for (const sect of sects) {
      if (!firstRequest) await sleep(170);
      firstRequest = false;
      const query = new URLSearchParams({ ...rest, per_page: per_page || 25, page });
      if (dept) query.set('departement', dept);
      if (sect) query.set('section', sect);
      const data = await lireJson(await fetch(`${BASE_URL}/api/entreprises/search?${query}`), 'Erreur Data.gouv');
      results.push(...(data.entreprises || []));
      hasMore = hasMore || Boolean(data.has_more);
      totalPages = Math.max(totalPages, Number(data.total_pages) || 0);
      totalResults += Number(data.total_results) || 0;
    }
  }
  const seen = new Set(existingSirens);
  return {
    entreprises: results.filter((entreprise) => {
      if (seen.has(entreprise.siren)) return false;
      seen.add(entreprise.siren);
      return true;
    }),
    hasMore,
    totalPages,
    totalResults,
  };
}

export async function getDirigeantReel(siren) {
  return lireJson(await fetch(`${BASE_URL}/api/entreprises/dirigeant-reel?siren=${encodeURIComponent(siren)}`), 'Erreur remontée dirigeant');
}

export async function resolveGooglePlace({ nom, enseigne, adresse, code_postal, ville, latitude, longitude }) {
  return lireJson(await fetch(`${BASE_URL}/api/places/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom, enseigne, adresse, code_postal, ville, latitude, longitude }),
  }), 'Erreur Google Places');
}

export async function findWebsiteWithClaude({ nom, ville, code_postal, siren }) {
  const params = new URLSearchParams({ nom });
  if (ville) params.set('ville', ville);
  if (code_postal) params.set('code_postal', code_postal);
  if (siren) params.set('siren', siren);
  return lireJson(await fetch(`${BASE_URL}/api/claude/find-website?${params}`), 'Erreur Brave Search');
}

export async function findRHContact({ nom, enseigne, ville, code_postal, site_web }) {
  const params = new URLSearchParams({ nom });
  if (enseigne) params.set('enseigne', enseigne);
  if (ville) params.set('ville', ville);
  if (code_postal) params.set('code_postal', code_postal);
  if (site_web) params.set('site_web', site_web);
  return lireJson(await fetch(`${BASE_URL}/api/claude/find-rh?${params}`), 'Erreur Brave Search');
}

export async function enrichDropcontact({ prenom, nom, entreprise, site_web, siren, siret, pays, poste, linkedin, telephone }) {
  return lireJson(await fetch(`${BASE_URL}/api/dropcontact/enrich`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prenom, nom, entreprise, site_web, siren, siret, pays, poste, linkedin, telephone }),
  }), 'Erreur Dropcontact');
}

export async function classifyEntreprises(entreprises) {
  const data = await lireJson(await fetch(`${BASE_URL}/api/claude/classify-entreprises`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entreprises }),
  }), 'Erreur classification');
  return data.classifications;
}

export async function composeEmail({ nom_entreprise, site_web, nom_dirigeant }) {
  const data = await lireJson(await fetch(`${BASE_URL}/api/claude/compose-email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom_entreprise, site_web, nom_dirigeant }),
  }), 'Erreur génération email');
  return data.email;
}

export async function getExportedSirens() {
  const data = await lireJson(await fetch(`${BASE_URL}/api/exports/sirens`), 'Erreur export');
  return new Set(data.sirens);
}

export async function saveExportedEntreprises(entreprises) {
  return lireJson(await fetch(`${BASE_URL}/api/exports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entreprises: entreprises.map(({ siren, nom_entreprise }) => ({ siren, nom: nom_entreprise })) }),
  }), 'Erreur export');
}

export async function resetExportedSirens() {
  return lireJson(await fetch(`${BASE_URL}/api/exports`, { method: 'DELETE' }), 'Erreur export');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
