// En dev Vite tourne sur :5173, en prod le backend sert tout sur :3001
const BASE_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

export class RateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message || 'Rate limit atteint');
    this.name = 'RateLimitError';
    this.isRateLimit = true;
    this.retryAfter = Number(retryAfter) || 10;
  }
}

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
        .then(async (r) => {
          const d = await r.json();
          if (r.status === 429) throw new RateLimitError(d.error, d.retry_after);
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
 * Remonte l'arbre des dirigeants pour une entreprise dont le président est une personne morale,
 * jusqu'à trouver une vraie personne physique (max 5 niveaux).
 */
export async function getDirigeantReel(siren) {
  const res = await fetch(`${BASE_URL}/api/entreprises/dirigeant-reel?siren=${encodeURIComponent(siren)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur remontée dirigeant');
  return data;
}

/**
 * Trouve le site web d'une entreprise via Claude (web search)
 */
export async function findWebsiteWithClaude({ nom, ville, code_postal, siren }) {
  const params = new URLSearchParams({ nom });
  if (ville) params.set('ville', ville);
  if (code_postal) params.set('code_postal', code_postal);
  if (siren) params.set('siren', siren);
  const res = await fetch(`${BASE_URL}/api/claude/find-website?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur Claude');
  return data;
}


/**
 * Cherche un contact RH via Brave Search (LinkedIn)
 */
export async function findRHContact({ nom, ville, code_postal }) {
  const params = new URLSearchParams({ nom });
  if (ville) params.set('ville', ville);
  if (code_postal) params.set('code_postal', code_postal);
  const res = await fetch(`${BASE_URL}/api/claude/find-rh?${params.toString()}`);
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

/**
 * Classification batch d'entreprises via GPT (Micro/PME/Grande)
 * @param {Array<{nom: string, ville?: string}>} entreprises
 * @returns {Promise<Array<'pme'|'grande'|'non'>>}
 */
export async function classifyEntreprises(entreprises) {
  const res = await fetch(`${BASE_URL}/api/claude/classify-entreprises`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entreprises }),
  });
  const data = await res.json();
  if (res.status === 429) throw new RateLimitError(data.error, data.retry_after);
  if (!res.ok) throw new Error(data.error || 'Erreur classification');
  return data.classifications;
}

/**
 * Génère un email de prospection personnalisé via GPT en utilisant le contenu
 * de la page d'accueil du site comme contexte.
 */
export async function composeEmail({ nom_entreprise, site_web, nom_dirigeant }) {
  const res = await fetch(`${BASE_URL}/api/claude/compose-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nom_entreprise, site_web, nom_dirigeant }),
  });
  const data = await res.json();
  if (res.status === 429) throw new RateLimitError(data.error, data.retry_after);
  if (!res.ok) throw new Error(data.error || 'Erreur génération email');
  return data.email;
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
