import { useCallback, useEffect, useRef, useState } from 'react';
import StatusBanner from './components/StatusBanner';
import SearchForm from './components/SearchForm';
import DetailPanel from './components/DetailPanel';
import CompanyCards from './components/CompanyCards';
import DesktopSettings from './components/DesktopSettings';
import DesktopDiagnostics from './components/DesktopDiagnostics';
import {
  checkStatus, enrichDropcontact, findRHContact, findWebsiteWithClaude, getApiUsage, RateLimitError,
  TransientApiError,
  getDirigeantReel, resolveGooglePlace, searchEntreprises, sleep,
} from './services/api';
import {
  cacheSearchPage, clearCompanyCache, createSearchSignature, exportCompanyCache,
  getCacheStats, getCachedCompanies, getCachedSearch, hydrateCompanies, importCompanyCache,
  initializeCompanyCache, updateCachedCompanies, updateCachedCompany,
} from './services/companyCache';
import { buildOdooContactRows, exportCacheXlsx, exportContactsOdooXlsx, exportInterestedXlsx } from './services/xlsxExport';
import { readCacheImportFile } from './services/xlsxCacheImport';

const ZERO_EMPLOYEE_CODES = new Set(['NN', '00']);
const MICRO_CODES = new Set(['01', '02', '03']);
const PME_CODES = new Set(['11', '12', '21', '22', '31']);
const DEFAULT_CATEGORY_FILTER = { micro: false, pme: true, grande: false };
const ENRICHMENT_CONCURRENCY = 4;
const LEADER_RESOLUTION_CONCURRENCY = 4;
const LEADER_RESOLVER_VERSION = 2;
const PLACES_RESOLVER_VERSION = 4;
const DATA_GOUV_SOFT_CAP = 10000;
const DATA_GOUV_MAX_RETRIES = 3;
const CONTACT_EXPORT_CACHE_BATCH_SIZE = 100;

function abortError() {
  const error = new Error('Recherche annulée.');
  error.name = 'AbortError';
  return error;
}

function waitWithAbort(delayMs, signal) {
  if (!signal) return sleep(delayMs);
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(abortError());
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function retryDelayMs(error, attempt) {
  if (error instanceof RateLimitError) return Math.max(1, error.retryAfter) * 1000;
  return Math.min(2 ** attempt, 10) * 1000;
}

function isRetryableSearchError(error) {
  return error instanceof RateLimitError || error instanceof TransientApiError || error?.isRetryable;
}

function categoryFromSize(value) {
  if (MICRO_CODES.has(value)) return 'micro';
  if (PME_CODES.has(value)) return 'pme';
  return 'grande';
}

function normalizeCompany(company) {
  const googleStatus = company.statut_google || company.places_result?.statut || '';
  return {
    ...company,
    statut_google: googleStatus,
    categorie: company.categorie || categoryFromSize(company.tranche_effectif),
    prospection_status: company.prospection_status || (googleStatus === 'CLOSED_PERMANENTLY' || googleStatus === 'CLOSED_TEMPORARILY' ? 'processed' : 'unspecified'),
  };
}

function dedupe(companies) {
  const seen = new Set();
  return companies.filter((company) => {
    if (seen.has(company.siren)) return false;
    seen.add(company.siren);
    return true;
  });
}

function personFromRh(contact) {
  const parts = (contact?.nom || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    prenom: parts[0],
    nom: parts.slice(1).join(' '),
    poste: contact.poste || '',
    linkedin: contact.url_linkedin || '',
  };
}

function normalizedHost(url) {
  if (!url) return '';
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizedText(value) {
  return (value || '').toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizedNaf(value) {
  return (value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function hasIdentifiedLeader(company) {
  return Boolean((company.prenom_dirigeant || '').trim() && (company.nom_dirigeant || '').trim());
}

function siteComparison(googleSite, braveSite) {
  const googleHost = normalizedHost(googleSite);
  const braveHost = normalizedHost(braveSite);
  if (!googleHost || !braveHost) return { statut: 'source_unique', ajustement: 0, coherent: null };
  if (googleHost === braveHost || googleHost.endsWith(`.${braveHost}`) || braveHost.endsWith(`.${googleHost}`)) {
    return { statut: 'concordants', ajustement: 10, coherent: true };
  }
  return { statut: 'differents', ajustement: -12, coherent: false };
}

function placePatchFromResult(places) {
  return {
    places_result: places,
    place_id: places.place_id || '',
    place_score_initial: places.score ?? places.candidats?.[0]?.score ?? null,
    place_score: places.score ?? places.candidats?.[0]?.score ?? null,
    place_fiabilite: places.fiabilite || places.candidat_retenu?.fiabilite || null,
    place_match_confirme: Boolean(places.match_confirme),
    place_date_controle: places.date_controle || new Date().toISOString(),
    nom_google: places.nom_google || '',
    adresse_google: places.adresse_google || '',
    telephone_google: places.telephone_public || '',
    site_web_google: places.site_web || '',
    statut_google: places.statut || '',
    latitude_google: places.latitude ?? null,
    longitude_google: places.longitude ?? null,
  };
}

function sitePatchFromSources(company, places, braveSite) {
  const googleSite = places?.site_web || company.site_web_google || '';
  const braveSiteFinal = braveSite || company.site_web_brave || '';
  const comparison = siteComparison(googleSite, braveSiteFinal);
  const initialScore = places?.score ?? company.place_score_initial ?? company.place_score ?? null;
  const finalScore = initialScore === null ? null : Math.max(0, Math.min(100, initialScore + comparison.ajustement));
  const googleReliable = finalScore !== null && finalScore >= 70;
  const primarySite = googleSite || braveSiteFinal || company.site_web || '';
  const source = googleSite && braveSiteFinal
    ? (comparison.coherent ? 'Google Places + Brave cohérents' : 'Google Places + Brave à vérifier')
    : googleSite ? 'Google Places' : braveSiteFinal ? 'Brave Search' : company.site_source || '';

  return {
    site_web: primarySite,
    site_source: source,
    site_web_google: googleSite,
    site_web_brave: braveSiteFinal,
    sites_comparaison: comparison.statut,
    sites_coherents: comparison.coherent,
    place_score_initial: initialScore,
    place_score: finalScore,
    place_match_confirme: googleReliable,
    places_result: places ? {
      ...places,
      score_initial: initialScore,
      score_final: finalScore,
      validation_brave: comparison,
      match_confirme: googleReliable,
    } : company.places_result,
  };
}

function isTemporarilyClosed(company) {
  return company.statut_google === 'CLOSED_TEMPORARILY'
    || company.places_result?.statut === 'CLOSED_TEMPORARILY';
}

function matchesEstablishmentArea(company, params) {
  if (!params) return true;
  const establishmentPostalCode = company.code_postal_etablissement || '';
  const postalCodes = [...new Set([...(params.code_postaux || []), params.code_postal].filter(Boolean))];
  if (postalCodes.length) return postalCodes.includes(establishmentPostalCode);
  const departements = params.departements || [];
  if (!departements.length) return true;
  return departements.includes(establishmentPostalCode.slice(0, 2));
}

function matchesLegalHeadquartersArea(company, params) {
  if (!params) return true;
  const headquartersPostalCode = company.code_postal_legal || company.code_postal || '';
  const postalCodes = [...new Set([...(params.code_postaux || []), params.code_postal].filter(Boolean))];
  if (postalCodes.length) return postalCodes.includes(headquartersPostalCode);
  const departements = params.departements || [];
  if (!departements.length) return true;
  return departements.includes(headquartersPostalCode.slice(0, 2));
}

function isInSearchedArea(company, params, filterLegalHeadquarters) {
  return matchesEstablishmentArea(company, params)
    && (!filterLegalHeadquarters || matchesLegalHeadquartersArea(company, params));
}

function searchFilterReport(companies, params, { categoryFilter, excludeGroups, filterLegalHeadquarters }) {
  let remaining = companies;
  const steps = [];
  const apply = (label, predicate) => {
    const before = remaining.length;
    remaining = remaining.filter(predicate);
    steps.push({ label, removed: before - remaining.length, remaining: remaining.length });
  };

  apply('Décisions déjà prises', (company) => company.prospection_status === 'unspecified');
  apply('Fermetures temporaires Google', (company) => !isTemporarilyClosed(company));
  apply('Effectif nul ou inconnu', (company) => !ZERO_EMPLOYEE_CODES.has(company.tranche_effectif));
  apply('Taille non sélectionnée', (company) => categoryFilter[company.categorie || categoryFromSize(company.tranche_effectif)]);
  if (excludeGroups) apply('Groupes de plus de 35 établissements', (company) => company.nb_etablissements <= 35);
  if (params?.nom_contient) apply('Nom ne correspondant pas', (company) => normalizedText(company.nom_entreprise).includes(normalizedText(params.nom_contient)));
  const nafPrefixes = [...new Set([...(params?.naf_prefixes || []), params?.naf_prefix].filter(Boolean))]
    .map(normalizedNaf)
    .filter(Boolean);
  if (nafPrefixes.length) apply('Code NAF hors sélection', (company) => nafPrefixes.some((prefix) => normalizedNaf(company.code_naf).startsWith(prefix)));
  apply('Établissement hors zone recherchée', (company) => matchesEstablishmentArea(company, params));
  if (filterLegalHeadquarters) apply('Siège légal hors zone recherchée', (company) => matchesLegalHeadquartersArea(company, params));

  return { steps, matching: remaining.length };
}

function needsLeaderResolution(company) {
  if (company.dirigeant_resolution_at && company.dirigeant_resolver_version === LEADER_RESOLVER_VERSION) return false;
  // Une personne physique déjà retournée par la recherche suffit à la règle
  // locale. Data.gouv n'est utile que pour une information réellement ambiguë.
  return !hasIdentifiedLeader(company);
}

function leaderPatchFromResult(result) {
  const patch = {
    dirigeant_resolver_version: LEADER_RESOLVER_VERSION,
    dirigeant_remontees: result.remontees ?? null,
    dirigeant_raison: result.raison || '',
  };
  if (!['fetch', 'api_error'].includes(result.raison)) patch.dirigeant_resolution_at = new Date().toISOString();
  if (!result.found) return patch;
  return {
    ...patch,
    prenom_dirigeant: result.prenom || '',
    nom_dirigeant: result.nom || '',
    qualite_dirigeant: result.qualite || '',
    siren_dirigeant: '',
  };
}

async function runWithConcurrency(items, concurrency, worker, shouldContinue = () => true) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length && shouldContinue()) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

const GOOGLE_TEXT_SEARCH_PRO = { freeMonthly: 5000, usdPer1000: 32 };
const GOOGLE_PLACE_DETAILS_ENTERPRISE = { freeMonthly: 1000, usdPer1000: 20 };

function currentMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function estimateGooglePlacesFromCache(companies) {
  const monthStart = currentMonthStart();
  const checked = companies.filter((company) => {
    const checkedAt = company.place_date_controle || company.places_result?.date_controle;
    return company.places_result && checkedAt && new Date(checkedAt) >= monthStart;
  });
  let textSearches = 0;
  let placeDetails = 0;
  checked.forEach((company) => {
    const result = company.places_result || {};
    const score = result.candidat_retenu?.score ?? result.score;
    // Le résolveur fait une seconde recherche quand le premier résultat est
    // absent ou insuffisamment fiable ; le cache permet de l'estimer.
    textSearches += !Number.isFinite(score) || score < 70 ? 2 : 1;
    if (result.candidat_retenu?.place_id || result.place_id) placeDetails += 1;
  });
  const textBillable = Math.max(0, textSearches - GOOGLE_TEXT_SEARCH_PRO.freeMonthly);
  const detailsBillable = Math.max(0, placeDetails - GOOGLE_PLACE_DETAILS_ENTERPRISE.freeMonthly);
  const amount = (textBillable * GOOGLE_TEXT_SEARCH_PRO.usdPer1000 + detailsBillable * GOOGLE_PLACE_DETAILS_ENTERPRISE.usdPer1000) / 1000;
  return {
    source: 'local_cache',
    month_start: monthStart.toISOString(),
    checks: checked.length,
    text_searches: textSearches,
    place_details: placeDetails,
    amount,
    currency: 'USD',
    note: 'Estimation locale : elle ne couvre que les contrôles conservés dans ce cache, hors appels externes ou cache supprimé.',
  };
}

export default function App() {
  const [apiStatus, setApiStatus] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState(DEFAULT_CATEGORY_FILTER);
  const [excludeGroups, setExcludeGroups] = useState(true);
  const [filterLegalHeadquarters, setFilterLegalHeadquarters] = useState(true);
  const [activeSearchParams, setActiveSearchParams] = useState(null);
  const [view, setView] = useState('discover');
  const [selected, setSelected] = useState(new Set());
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState(null);
  const [error, setError] = useState(null);
  const [enriching, setEnriching] = useState(false);
  const [exportingContacts, setExportingContacts] = useState(false);
  const [contactExportProgress, setContactExportProgress] = useState(null);
  const [enrichment, setEnrichment] = useState(null);
  const [autoDeciding, setAutoDeciding] = useState(false);
  const [autoDecisionProgress, setAutoDecisionProgress] = useState(null);
  const [cacheStats, setCacheStats] = useState({ companies: 0, pages: 0 });
  const [apiUsage, setApiUsage] = useState(null);
  const [cacheMenuOpen, setCacheMenuOpen] = useState(false);
  const cancelSearchRef = useRef(false);
  const searchAbortRef = useRef(null);
  const cancelEnrichmentRef = useRef(false);
  const enrichmentAbortRef = useRef(null);
  const cancelDecisionRef = useRef(false);
  const decisionAbortRef = useRef(null);
  const importInputRef = useRef(null);

  const refreshCacheStats = useCallback(async () => setCacheStats(await getCacheStats()), []);
  const refreshApiUsage = useCallback(async () => {
    try {
      const [usage, cached] = await Promise.all([getApiUsage(), getCachedCompanies()]);
      setApiUsage({ ...usage, google_places: estimateGooglePlacesFromCache(cached) });
    } catch (err) {
      setApiUsage({ error: err.message });
    }
  }, []);

  useEffect(() => {
    initializeCompanyCache().then(refreshCacheStats).catch((err) => setError(`Cache : ${err.message}`));
    checkStatus().then(setApiStatus).catch(() => setApiStatus({ ok: false, message: 'Backend indisponible sur http://localhost:3001.' }));
    refreshApiUsage();
  }, [refreshApiUsage, refreshCacheStats]);

  const patchCompany = useCallback(async (siren, patch) => {
    const withDecision = patch.statut_google === 'CLOSED_PERMANENTLY'
      ? { ...patch, prospection_status: 'processed', prospection_reason: 'Google Places : fermé définitivement', prospection_updated_at: new Date().toISOString() }
      : patch.statut_google === 'CLOSED_TEMPORARILY'
        ? { ...patch, prospection_status: 'processed', prospection_reason: 'Google Places : fermé temporairement', prospection_updated_at: new Date().toISOString() }
        : patch;
    setCompanies((previous) => previous.map((company) => company.siren === siren ? { ...company, ...withDecision } : company));
    setSelectedCompany((previous) => previous?.siren === siren ? { ...previous, ...withDecision } : previous);
    await updateCachedCompany(siren, withDecision);
    refreshCacheStats();
  }, [refreshCacheStats]);

  const passesFilters = useCallback((company, includeStatus = 'unspecified', searchParams = activeSearchParams) => {
    if (includeStatus && company.prospection_status !== includeStatus) return false;
    if (isTemporarilyClosed(company)) return false;
    if (ZERO_EMPLOYEE_CODES.has(company.tranche_effectif)) return false;
    if (!categoryFilter[company.categorie || categoryFromSize(company.tranche_effectif)]) return false;
    if (excludeGroups && company.nb_etablissements > 35) return false;
    if (searchParams?.nom_contient && !normalizedText(company.nom_entreprise).includes(normalizedText(searchParams.nom_contient))) return false;
    const nafPrefixes = [...new Set([...(searchParams?.naf_prefixes || []), searchParams?.naf_prefix].filter(Boolean))]
      .map(normalizedNaf)
      .filter(Boolean);
    if (nafPrefixes.length && !nafPrefixes.some((prefix) => normalizedNaf(company.code_naf).startsWith(prefix))) return false;
    if (!isInSearchedArea(company, searchParams, filterLegalHeadquarters)) return false;
    return true;
  }, [activeSearchParams, categoryFilter, excludeGroups, filterLegalHeadquarters]);

  const visible = companies.filter((company) => passesFilters(company, 'unspecified'));
  const interested = companies.filter((company) => passesFilters(company, 'interested'));
  const notInterested = companies.filter((company) => passesFilters(company, 'not_interested'));
  const activeCompanies = view === 'discover' ? visible : view === 'interested' ? interested : notInterested;

  const decide = useCallback((siren, status) => {
    const finalStatus = status;
    patchCompany(siren, {
      prospection_status: finalStatus,
      prospection_reason: finalStatus === 'unspecified' ? '' : finalStatus === 'not_interested' ? 'Décision manuelle : pas intéressée' : 'Décision manuelle',
      prospection_updated_at: new Date().toISOString(),
    }).catch((err) => setError(`Sauvegarde : ${err.message}`));
    setSelected((previous) => {
      const next = new Set(previous);
      if (status !== 'interested') next.delete(siren);
      return next;
    });
  }, [patchCompany]);

  const toggleSelected = useCallback((siren) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(siren)) next.delete(siren); else next.add(siren);
      return next;
    });
  }, []);

  const handleAutomaticDecision = useCallback(async () => {
    const targets = visible;
    if (!targets.length || autoDeciding) return;
    cancelDecisionRef.current = false;
    const controller = new AbortController();
    decisionAbortRef.current = controller;
    setAutoDeciding(true);
    setError(null);
    const progress = { total: targets.length, completed: 0, skipped: 0 };
    setAutoDecisionProgress({ ...progress });
    try {
      await runWithConcurrency(targets, LEADER_RESOLUTION_CONCURRENCY, async (initial) => {
        let company = initial;
        try {
          if (needsLeaderResolution(company)) {
            const result = await getDirigeantReel(company.siren, controller.signal);
            // Une erreur technique Data.gouv ne vaut pas une décision négative.
            if (['fetch', 'api_error'].includes(result.raison)) {
              progress.skipped += 1;
              return;
            }
            const leaderPatch = leaderPatchFromResult(result);
            company = { ...company, ...leaderPatch };
            await patchCompany(company.siren, leaderPatch);
          }
          // La règle est locale : les données déjà reçues suffisent dans la
          // majorité des cas. Data.gouv n'est consulté qu'en cas de dirigeant
          // personne morale ou d'information incomplète.
          const status = hasIdentifiedLeader(company) ? 'interested' : 'not_interested';
          await patchCompany(company.siren, {
            prospection_status: status,
            prospection_reason: hasIdentifiedLeader(company) ? 'Décision automatique locale : dirigeant identifié' : 'Décision automatique : aucun dirigeant personne physique identifié',
            prospection_updated_at: new Date().toISOString(),
          });
        } catch (err) {
          if (!isAbortError(err)) progress.skipped += 1;
        } finally {
          progress.completed += 1;
          setAutoDecisionProgress({ ...progress });
        }
      }, () => !cancelDecisionRef.current && !controller.signal.aborted);
    } finally {
      setAutoDeciding(false);
    }
  }, [autoDeciding, patchCompany, visible]);

  const stopAutomaticDecision = useCallback(() => {
    cancelDecisionRef.current = true;
    decisionAbortRef.current?.abort();
  }, []);

  const handleSearch = useCallback(async (params) => {
    cancelSearchRef.current = false;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearching(true);
    setError(null);
    setSelected(new Set());
    setActiveSearchParams(params);
    const signature = createSearchSignature(params);
    const requestedLimit = params.limit === 'all' ? DATA_GOUV_SOFT_CAP : Math.min(Number(params.limit || 25), DATA_GOUV_SOFT_CAP);
    try {
      const cached = await getCachedSearch(signature);
      let all = dedupe((await hydrateCompanies(cached.companies)).map(normalizeCompany));
      setCompanies(all);
      let page = cached.search.next_page || 1;
      let hasMore = !cached.search.exhausted;
      const cachedExcludedHeadOffices = cached.search.excluded_closed_head_offices;
      let excludedClosedHeadOfficesKnown = Number.isFinite(cachedExcludedHeadOffices) || cached.companies.length === 0;
      let excludedClosedHeadOffices = Number.isFinite(cachedExcludedHeadOffices) ? cachedExcludedHeadOffices : 0;
      let filterReport = searchFilterReport(all, params, { categoryFilter, excludeGroups, filterLegalHeadquarters });
      let matching = filterReport.matching;
      setSearchProgress({ cached: all.length, loaded: all.length, matching, target: requestedLimit, total: cached.search.total_results, page, running: hasMore, exhausted: !hasMore, retry: null, excludedClosedHeadOffices, excludedClosedHeadOfficesKnown, filterReport });

      while (hasMore && !cancelSearchRef.current && matching < requestedLimit) {
        await sleep(170); // <= 6 pages/s, sous la limite Data.gouv de 7 req/s.
        const knownSirens = new Set(all.map((company) => company.siren));
        let response;
        for (let attempt = 0; attempt <= DATA_GOUV_MAX_RETRIES; attempt += 1) {
          try {
            response = await searchEntreprises(params, page, knownSirens, controller.signal);
            break;
          } catch (err) {
            if (isAbortError(err) || !isRetryableSearchError(err) || attempt === DATA_GOUV_MAX_RETRIES) throw err;
            const delayMs = retryDelayMs(err, attempt + 1);
            setSearchProgress((previous) => previous ? {
              ...previous,
              retry: { page, attempt: attempt + 1, delayMs },
            } : previous);
            await waitWithAbort(delayMs, controller.signal);
          }
        }
        const fetched = response.entreprises.map(normalizeCompany);
        if (excludedClosedHeadOfficesKnown) excludedClosedHeadOffices += response.excludedClosedHeadOffices;
        await cacheSearchPage(signature, page, fetched, {
          hasMore: response.hasMore,
          totalPages: response.totalPages,
          totalResults: response.totalResults,
          excludedClosedHeadOffices: excludedClosedHeadOfficesKnown ? excludedClosedHeadOffices : null,
        });
        const hydrated = await hydrateCompanies(fetched);
        all = dedupe([...all, ...hydrated.map(normalizeCompany)]);
        setCompanies(all);
        hasMore = response.hasMore;
        filterReport = searchFilterReport(all, params, { categoryFilter, excludeGroups, filterLegalHeadquarters });
        matching = filterReport.matching;
        setSearchProgress({ cached: cached.companies.length, loaded: all.length, matching, target: requestedLimit, total: response.totalResults || null, page, running: hasMore, exhausted: !hasMore, retry: null, excludedClosedHeadOffices, excludedClosedHeadOfficesKnown, filterReport });
        page += 1;
      }
      await refreshCacheStats();
    } catch (err) {
      if (!isAbortError(err)) setError(err.message || 'Recherche impossible.');
    } finally {
      setSearching(false);
      setSearchProgress((previous) => previous ? { ...previous, running: false } : null);
    }
  }, [categoryFilter, excludeGroups, filterLegalHeadquarters, refreshCacheStats]);

  const stopSearch = useCallback(() => {
    cancelSearchRef.current = true;
    searchAbortRef.current?.abort();
  }, []);

  const enrichOne = useCallback(async (initial, stats, signal) => {
    let company = initial;
    let places;
    if (signal?.aborted) return;
    // Une indisponibilité réseau n'est pas une réponse Places : on la garde
    // comme trace, mais une nouvelle sélection doit pouvoir réessayer.
    if (company.places_result && company.places_result.raison !== 'erreur_places' && company.places_result.resolver_version === PLACES_RESOLVER_VERSION) {
      places = company.places_result;
      stats.google_tentes += 1;
      if (places.found || places.candidats?.length) stats.google_trouves += 1;
    } else try {
      places = await resolveGooglePlace({
        nom: company.nom_entreprise,
        enseigne: company.enseigne_etablissement,
        adresse: company.adresse_etablissement || company.adresse_legale || company.adresse,
        code_postal: company.code_postal_etablissement || company.code_postal_legal || company.code_postal,
        ville: company.ville_etablissement || company.ville_legale || company.ville,
        latitude: company.latitude_etablissement,
        longitude: company.longitude_etablissement,
      }, signal);
      stats.google_tentes += 1;
      if (places.found || places.candidats?.length) stats.google_trouves += 1;
    } catch (err) {
      if (isAbortError(err)) return;
      stats.echecs += 1;
      places = { found: false, raison: err.message || 'erreur_places', candidats: [] };
      await patchCompany(company.siren, { places_result: places, place_date_controle: new Date().toISOString() });
    }

    if (places?.site_web) stats.sites_google += 1;
    if (places?.statut === 'CLOSED_PERMANENTLY') stats.google_fermes += 1;
    if (places?.statut === 'CLOSED_TEMPORARILY') stats.google_temporairement_fermes += 1;
    if (places) {
      const placePatch = placePatchFromResult(places);
      company = { ...company, ...placePatch };
      await patchCompany(company.siren, placePatch);
    }

    // Brave et la recherche RH sont intentionnellement systématiques et
    // parallèles : Brave sert aussi de second avis sur le site retourné par
    // Google, même lorsqu'un site Google existe déjà.
    const [braveResult, rhPatch, leaderPatch] = await Promise.all([
      (async () => {
        try {
          const website = await findWebsiteWithClaude({
            nom: company.nom_entreprise,
            ville: company.ville_etablissement || company.ville,
            code_postal: company.code_postal_etablissement || company.code_postal,
            siren: company.siren,
          }, signal);
          if (!website.found || !website.site_web) return null;
          stats.sites_brave += 1;
          return website.site_web;
        } catch (err) {
          if (isAbortError(err)) return null;
          stats.echecs += 1;
          return null;
        }
      })(),
      (async () => {
        try {
          const result = await findRHContact({
            nom: company.nom_entreprise,
            enseigne: company.enseigne_etablissement,
            ville: company.ville_etablissement || company.ville,
            code_postal: company.code_postal_etablissement || company.code_postal,
            site_web: company.site_web_google || company.site_web,
          }, signal);
          if (!result.found || !result.contact_rh) return null;
          stats.rh_trouves += 1;
          return { contact_rh: result.contact_rh };
        } catch (err) {
          if (isAbortError(err)) return null;
          stats.echecs += 1;
          return null;
        }
      })(),
      needsLeaderResolution(company) ? (async () => {
        try {
          const leader = await getDirigeantReel(company.siren, signal);
          return leaderPatchFromResult(leader);
        } catch (err) {
          if (isAbortError(err)) return null;
          stats.echecs += 1;
          return null;
        }
      })() : Promise.resolve(null),
    ]);

    const supplementalPatches = [rhPatch, leaderPatch].filter(Boolean);
    if (supplementalPatches.length) {
      company = Object.assign({}, company, ...supplementalPatches);
      await Promise.all(supplementalPatches.map((patch) => patchCompany(company.siren, patch)));
    }

    const sitesPatch = sitePatchFromSources(company, places, braveResult);
    company = { ...company, ...sitesPatch };
    await patchCompany(company.siren, sitesPatch);

    if (signal?.aborted) return;
    await patchCompany(company.siren, { enriched_at: new Date().toISOString() });

    // Une entreprise fermée conserve tous ses retours Google/Brave/RH, mais
    // n'entame pas de crédit Dropcontact pour un contact à exclure.
    if (company.statut_google === 'CLOSED_PERMANENTLY' || company.statut_google === 'CLOSED_TEMPORARILY') return;

    const leaderTarget = hasIdentifiedLeader(company)
      ? { prenom: company.prenom_dirigeant, nom: company.nom_dirigeant, poste: company.qualite_dirigeant || '' }
      : null;
    const rhTarget = personFromRh(company.contact_rh);
    const legacyLeaderEnriched = company.contact_email_source === 'Dirigeant + Dropcontact' && Boolean(company.emailStatus);
    const leaderNeedsEnrichment = leaderTarget && !company.leader_emailStatus && !legacyLeaderEnriched;
    const rhNeedsEnrichment = rhTarget && !company.contact_rh_emailStatus;
    const organizationNeedsEnrichment = !leaderTarget && !rhTarget && !company.emailStatus;
    if (!leaderNeedsEnrichment && !rhNeedsEnrichment && !organizationNeedsEnrichment) return;

    const enrichTarget = async (target) => enrichDropcontact({
      prenom: target?.prenom || '',
      nom: target?.nom || '',
      entreprise: company.nom_entreprise,
      site_web: company.site_web,
      siren: company.siren,
      siret: company.siret_etablissement || company.siret_siege || '',
      pays: 'FR',
      poste: target?.poste || '',
      linkedin: target?.linkedin || '',
      telephone: company.telephone_google || '',
    }, signal);

    try {
      // Lorsqu'un RH est identifié, les deux demandes sont indépendantes et
      // partent ensemble : aucune identité ne prend la place de l'autre.
      const outcomes = await Promise.allSettled([
        leaderNeedsEnrichment ? enrichTarget(leaderTarget) : Promise.resolve(null),
        rhNeedsEnrichment ? enrichTarget(rhTarget) : Promise.resolve(null),
        organizationNeedsEnrichment ? enrichTarget(null) : Promise.resolve(null),
      ]);
      outcomes.filter((outcome) => outcome.status === 'rejected' && !isAbortError(outcome.reason)).forEach(() => { stats.echecs += 1; });
      const [leaderResult, rhResult, organizationResult] = outcomes.map((outcome) => outcome.status === 'fulfilled' ? outcome.value : null);
      const primaryResult = leaderResult || rhResult || organizationResult;
      const patch = primaryResult ? {
        site_web_dropcontact: primaryResult.website || primaryResult.enrichment?.website || '',
        company_dropcontact: primaryResult.company || primaryResult.enrichment?.company || '',
      } : {};

      if (leaderResult) {
        patch.dropcontact_result_leader = leaderResult.enrichment || null;
        patch.leader_emailStatus = leaderResult.found ? 'found' : 'not_found';
        if (leaderResult.found) {
          stats.emails_trouves += 1;
          Object.assign(patch, {
            leader_email: leaderResult.email,
            leader_score: leaderResult.score,
            leader_email_qualification: leaderResult.qualification || '',
            leader_telephone: leaderResult.telephone || '',
            leader_telephone_mobile: leaderResult.telephone_mobile || '',
            // Le contact principal reste le dirigeant quand les deux existent.
            email: leaderResult.email,
            score: leaderResult.score,
            email_qualification: leaderResult.qualification || '',
            telephone: leaderResult.telephone || '',
            telephone_mobile: leaderResult.telephone_mobile || '',
            emailStatus: 'found',
            contact_email_source: 'Dirigeant + Dropcontact',
          });
        }
      }
      if (rhResult) {
        patch.dropcontact_result_rh = rhResult.enrichment || null;
        patch.contact_rh_emailStatus = rhResult.found ? 'found' : 'not_found';
        if (rhResult.found) {
          stats.emails_trouves += 1;
          Object.assign(patch, {
            contact_rh_email: rhResult.email,
            contact_rh_score: rhResult.score,
            contact_rh_email_qualification: rhResult.qualification || '',
            contact_rh_telephone: rhResult.telephone || '',
            contact_rh_telephone_mobile: rhResult.telephone_mobile || '',
          });
          if (!leaderResult?.found) Object.assign(patch, {
            email: rhResult.email,
            score: rhResult.score,
            email_qualification: rhResult.qualification || '',
            telephone: rhResult.telephone || '',
            telephone_mobile: rhResult.telephone_mobile || '',
            emailStatus: 'found',
            contact_email_source: 'RH Brave Search + Dropcontact',
          });
        }
      }
      if (organizationResult) {
        patch.dropcontact_result = organizationResult.enrichment || null;
        patch.emailStatus = organizationResult.found ? 'found' : 'not_found';
        if (organizationResult.found) {
          stats.emails_trouves += 1;
          Object.assign(patch, {
            email: organizationResult.email,
            score: organizationResult.score,
            email_qualification: organizationResult.qualification || '',
            telephone: organizationResult.telephone || '',
            telephone_mobile: organizationResult.telephone_mobile || '',
            contact_email_source: 'Organisation + Dropcontact',
          });
        }
      }
      await patchCompany(company.siren, patch);
    } catch (err) { if (!isAbortError(err)) stats.echecs += 1; }
  }, [patchCompany]);

  const handleEnrich = useCallback(async () => {
    const targets = interested.filter((company) => selected.has(company.siren));
    if (!targets.length) return;
    cancelEnrichmentRef.current = false;
    const controller = new AbortController();
    enrichmentAbortRef.current = controller;
    setEnriching(true);
    const stats = { total: targets.length, terminees: 0, google_tentes: 0, google_trouves: 0, google_fermes: 0, google_temporairement_fermes: 0, sites_google: 0, sites_brave: 0, rh_trouves: 0, emails_trouves: 0, echecs: 0 };
    setEnrichment({ ...stats });
    try {
      await runWithConcurrency(targets, ENRICHMENT_CONCURRENCY, async (company) => {
        try {
          await enrichOne(company, stats, controller.signal);
        } catch (err) {
          if (isAbortError(err)) return;
          stats.echecs += 1;
        } finally {
          stats.terminees += 1;
          setEnrichment({ ...stats });
        }
      }, () => !cancelEnrichmentRef.current && !controller.signal.aborted);
    } finally {
      setEnriching(false);
      // On conserve la sélection après enrichissement : l'export des fiches
      // désormais enrichies reste immédiatement disponible.
      setSelected(new Set(targets.map((company) => company.siren)));
    }
  }, [enrichOne, interested, selected]);

  const stopEnrichment = useCallback(() => {
    cancelEnrichmentRef.current = true;
    enrichmentAbortRef.current?.abort();
  }, []);

  const handleClearCache = useCallback(async () => {
    if (!window.confirm('Supprimer le cache local, les pages mémorisées et les décisions de prospection ?')) return;
    await clearCompanyCache();
    setCompanies([]);
    setSelected(new Set());
    await refreshCacheStats();
  }, [refreshCacheStats]);

  const handleCacheExport = useCallback(async () => {
    const payload = await exportCompanyCache();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cache_prospection_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleCacheXlsxExport = useCallback(async (mode) => {
    try {
      const cached = await getCachedCompanies();
      const filtered = cached.filter((company) => {
        if (mode === 'enriched') return Boolean(company.enriched_at);
        if (mode === 'with_email') return Boolean(company.email || company.leader_email || company.contact_rh_email);
        if (mode === 'interested') return company.prospection_status === 'interested';
        if (mode === 'not_interested') return company.prospection_status === 'not_interested';
        if (mode === 'to_process') return company.prospection_status === 'unspecified';
        return true;
      });
      if (!filtered.length) {
        window.alert('Aucune fiche ne correspond à cette extraction du cache.');
        return;
      }
      const contactsExported = mode === 'with_email'
        ? exportContactsOdooXlsx(filtered)
        : exportCacheXlsx(filtered, mode);
      if (mode === 'with_email' && !contactsExported) {
        window.alert('Aucun e-mail de contact exploitable à exporter.');
        return;
      }
      if (mode === 'not_interested') {
        const now = new Date().toISOString();
        await Promise.all(filtered.map((company) => patchCompany(company.siren, {
          prospection_status: 'processed',
          prospection_reason: `Export XLSX — ${company.prospection_reason || 'Pas intéressée'}`,
          prospection_updated_at: now,
          processed_at: now,
          exported_at: now,
          exported_from_status: 'not_interested',
        })));
      }
    } catch (err) {
      setError(`Extraction du cache : ${err.message}`);
    }
  }, [patchCompany]);

  const handleCacheImport = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const { format, payload } = await readCacheImportFile(file);
      const merged = await importCompanyCache(payload);
      // Réhydrate immédiatement la liste déjà affichée : sans cela les décisions
      // importées ne sont appliquées qu'à la recherche suivante et des fiches
      // déjà traitées restent à tort dans « À traiter ».
      const hydratedCurrent = (await hydrateCompanies(companies)).map(normalizeCompany);
      setCompanies(hydratedCurrent);
      setSelectedCompany((current) => {
        if (!current) return current;
        return hydratedCurrent.find((company) => company.siren === current.siren) || current;
      });
      await refreshCacheStats();
      setError(null);
      window.alert(`${merged} élément(s) de cache fusionné(s) depuis le fichier ${format}.`);
    } catch (err) {
      setError(`Import du cache : ${err.message}`);
    } finally {
      event.target.value = '';
    }
  }, [companies, refreshCacheStats]);

  const selectedInterested = interested.filter((company) => selected.has(company.siren));
  const exportableInterested = selectedInterested.filter((company) => Boolean(company.enriched_at));
  const handleInterestedExport = useCallback(async () => {
    if (!exportableInterested.length || exportingContacts) return;
    let fileDownloaded = false;
    setExportingContacts(true);
    setContactExportProgress(null);
    setError(null);
    try {
      const companiesWithContacts = exportableInterested
        .filter((company) => buildOdooContactRows([company]).length > 0);
      const contactsExported = exportInterestedXlsx(exportableInterested);
      if (!contactsExported) {
        window.alert('Aucun e-mail de contact exploitable à exporter.');
        return;
      }
      fileDownloaded = true;
      const now = new Date().toISOString();
      const exportPatch = {
        prospection_status: 'processed',
        prospection_reason: 'Export XLSX',
        prospection_updated_at: now,
        processed_at: now,
        exported_at: now,
      };
      setContactExportProgress({ completed: 0, total: companiesWithContacts.length });
      for (let start = 0; start < companiesWithContacts.length; start += CONTACT_EXPORT_CACHE_BATCH_SIZE) {
        const batch = companiesWithContacts.slice(start, start + CONTACT_EXPORT_CACHE_BATCH_SIZE);
        await updateCachedCompanies(batch.map((company) => ({
          siren: company.siren,
          patch: exportPatch,
        })));
        const batchSirens = new Set(batch.map((company) => company.siren));
        setCompanies((previous) => previous.map((company) => (
          batchSirens.has(company.siren) ? { ...company, ...exportPatch } : company
        )));
        setSelectedCompany((previous) => (
          previous && batchSirens.has(previous.siren) ? { ...previous, ...exportPatch } : previous
        ));
        setSelected((previous) => {
          const remaining = new Set(previous);
          batchSirens.forEach((siren) => remaining.delete(siren));
          return remaining;
        });
        setContactExportProgress({
          completed: Math.min(start + batch.length, companiesWithContacts.length),
          total: companiesWithContacts.length,
        });
      }
      setSelected(new Set());
    } catch (err) {
      const detail = err?.message || 'erreur inconnue';
      setError(fileDownloaded
        ? `Le fichier a été téléchargé, mais son suivi dans le cache a échoué : ${detail}`
        : `Export des contacts impossible : ${detail}`);
    } finally {
      setExportingContacts(false);
      setContactExportProgress(null);
    }
  }, [exportableInterested, exportingContacts]);
  return (
    <div className="min-h-screen bg-gray-50">
      <DetailPanel entreprise={selectedCompany} onClose={() => setSelectedCompany(null)} onUpdateEntreprise={patchCompany} />
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center gap-4">
          <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">P</div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Prospection B2B</h1>
            <p className="text-xs text-gray-500">Data.gouv · Google Places · Brave Search · Dropcontact</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs">
            <span className="text-gray-400">Cache : {cacheStats.companies} fiches · {cacheStats.pages} pages</span>
            <button type="button" onClick={() => setCacheMenuOpen((open) => !open)} className="text-blue-600 hover:underline">Cache</button>
            <input ref={importInputRef} type="file" accept=".json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,application/vnd.ms-excel" className="hidden" onChange={handleCacheImport} />
          </div>
          {cacheMenuOpen && <div className="basis-full ml-auto max-w-md rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-950">
            <p className="font-semibold">Extraire le cache en XLSX</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => handleCacheXlsxExport('all')} className="rounded-lg bg-white px-2.5 py-1.5 text-blue-700 shadow-sm hover:bg-blue-100">Tout</button>
              <button type="button" onClick={() => handleCacheXlsxExport('to_process')} className="rounded-lg bg-white px-2.5 py-1.5 text-blue-700 shadow-sm hover:bg-blue-100">À traiter</button>
              <button type="button" onClick={() => handleCacheXlsxExport('interested')} className="rounded-lg bg-white px-2.5 py-1.5 text-blue-700 shadow-sm hover:bg-blue-100">Intéressées</button>
              <button type="button" onClick={() => handleCacheXlsxExport('not_interested')} className="rounded-lg bg-white px-2.5 py-1.5 text-blue-700 shadow-sm hover:bg-blue-100">Pas intéressées</button>
              <button type="button" onClick={() => handleCacheXlsxExport('enriched')} className="rounded-lg bg-white px-2.5 py-1.5 text-blue-700 shadow-sm hover:bg-blue-100">Enrichies</button>
              <button type="button" onClick={() => handleCacheXlsxExport('with_email')} className="rounded-lg bg-white px-2.5 py-1.5 text-blue-700 shadow-sm hover:bg-blue-100">Contacts avec e-mail (Odoo)</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 border-t border-blue-100 pt-3">
              <button type="button" onClick={handleCacheExport} className="text-blue-700 hover:underline">Sauvegarde JSON</button>
              <button type="button" onClick={() => importInputRef.current?.click()} className="text-blue-700 hover:underline">Importer JSON / XLSX</button>
              <button type="button" onClick={handleClearCache} className="text-red-700 hover:underline">Vider le cache local</button>
            </div>
          </div>}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <StatusBanner status={apiStatus} />
        <DesktopSettings onSaved={() => checkStatus().then(setApiStatus).catch(() => setApiStatus({ ok: false, message: 'Backend indisponible.' }))} />
        <DesktopDiagnostics />
        {error && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <SearchForm onSearch={handleSearch} onCancel={stopSearch} loading={searching} categoryFilter={categoryFilter} onCategoryChange={setCategoryFilter} exclureGroupes={excludeGroups} onExclureGroupesChange={setExcludeGroups} filterLegalHeadquarters={filterLegalHeadquarters} onFilterLegalHeadquartersChange={setFilterLegalHeadquarters} cacheOnly={false} />

        {searchProgress && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex flex-wrap items-center gap-3">
            <span>{searchProgress.matching} correspondante{searchProgress.matching > 1 ? 's' : ''} sur {searchProgress.target} demandée{searchProgress.target > 1 ? 's' : ''} · {searchProgress.loaded} reçue{searchProgress.loaded > 1 ? 's' : ''} de Data.gouv{searchProgress.total ? ` sur ${searchProgress.total}` : ''} · page {searchProgress.page}</span>
            {searchProgress.retry && <span className="text-amber-700">Data.gouv temporairement indisponible : nouvel essai de la page {searchProgress.retry.page} dans {Math.ceil(searchProgress.retry.delayMs / 1000)} s ({searchProgress.retry.attempt}/{DATA_GOUV_MAX_RETRIES}).</span>}
            {searching && <button type="button" onClick={stopSearch} className="ml-auto text-red-600 underline">Arrêter la recherche</button>}
          </div>
        )}

        {searchProgress?.filterReport && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold text-slate-900">Journal de filtrage de la recherche</h2>
              <span className="text-xs text-slate-500">{searchProgress.exhausted ? 'Résultats Data.gouv épuisés' : searchProgress.matching >= searchProgress.target ? 'Objectif atteint' : 'Recherche en cours'}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <span>Data.gouv annonce : <strong>{searchProgress.total?.toLocaleString('fr-FR') ?? '—'}</strong></span>
              <span>Fiches reçues : <strong>{searchProgress.loaded.toLocaleString('fr-FR')}</strong></span>
              {searchProgress.exhausted && Number.isFinite(searchProgress.total) && <span>Écart Data.gouv → fiches reçues : <strong>{Math.max(0, searchProgress.total - searchProgress.loaded).toLocaleString('fr-FR')}</strong></span>}
              {searchProgress.excludedClosedHeadOfficesKnown && <span>Sièges légaux fermés écartés : <strong>{searchProgress.excludedClosedHeadOffices.toLocaleString('fr-FR')}</strong></span>}
            </div>
            <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
              {searchProgress.filterReport.steps.map((step) => <li key={step.label}>{step.label} : <strong>-{step.removed.toLocaleString('fr-FR')}</strong> · reste {step.remaining.toLocaleString('fr-FR')}</li>)}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div><h2 className="font-semibold text-slate-800">Crédits et usage API</h2><p className="text-xs text-slate-500">Les clés et données de contact ne quittent jamais le backend.</p></div>
            <button type="button" onClick={refreshApiUsage} className="ml-auto text-blue-600 hover:underline">Actualiser</button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-950"><span className="font-medium">Dropcontact</span><br />{apiUsage?.dropcontact?.configured ? `${apiUsage.dropcontact.credits_left.toLocaleString('fr-FR')} crédits restants` : apiUsage?.dropcontact?.message || apiUsage?.error || 'Lecture…'}</div>
            <div className="rounded-xl bg-blue-50 px-3 py-2 text-blue-950"><span className="font-medium">Google Places</span><br />{apiUsage?.google_places?.source === 'local_cache' ? <>Estimation cache : {apiUsage.google_places.checks.toLocaleString('fr-FR')} contrôles · {apiUsage.google_places.text_searches.toLocaleString('fr-FR')} recherches · {apiUsage.google_places.place_details.toLocaleString('fr-FR')} fiches · {apiUsage.google_places.amount.toFixed(2)} {apiUsage.google_places.currency} HT</> : apiUsage?.error || 'Lecture du cache…'}</div>
          </div>
        </section>

        <nav className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
          {[['discover', `À traiter (${visible.length})`], ['interested', `Intéressées (${interested.length})`], ['not_interested', `Pas intéressées (${notInterested.length})`]].map(([key, label]) => (
            <button key={key} type="button" onClick={() => { setView(key); setSelected(key === 'interested' ? new Set(interested.map((company) => company.siren)) : new Set()); }} className={`px-4 py-2 rounded-full text-sm font-medium ${view === key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600'}`}>{label}</button>
          ))}
        </nav>

        {view === 'discover' && visible.length > 0 && (
          <section className="rounded-2xl bg-white border border-gray-200 p-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-gray-600">Décision locale selon le dirigeant déjà reçu ; Data.gouv n’est interrogé que si le dirigeant est une personne morale ou incomplet. OpenAI n’est jamais utilisé ici.</p>
            <button type="button" disabled={autoDeciding} onClick={handleAutomaticDecision} className="ml-auto px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-200 text-white font-semibold text-sm">
              {autoDeciding ? `Décision automatique… (${autoDecisionProgress?.completed || 0}/${autoDecisionProgress?.total || visible.length})` : `Intéressée / pas intéressée auto (${visible.length})`}
            </button>
            {autoDeciding && <button type="button" onClick={stopAutomaticDecision} className="rounded-xl border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">Arrêter</button>}
            {!autoDeciding && autoDecisionProgress?.skipped > 0 && <span className="text-xs text-amber-700">{autoDecisionProgress.skipped} fiche(s) non classée(s) : Data.gouv indisponible.</span>}
          </section>
        )}

        {view === 'interested' && (
          <section className="rounded-2xl bg-white border border-gray-200 p-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setSelected(new Set(interested.map((company) => company.siren)))} className="text-sm text-blue-600 hover:underline">Tout sélectionner</button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:underline">Tout désélectionner</button>
            <span className="text-sm text-gray-500">{selectedInterested.length} sélectionnée{selectedInterested.length > 1 ? 's' : ''}</span>
            <button type="button" disabled={!selectedInterested.length || enriching} onClick={handleEnrich} className="ml-auto px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-200 text-white font-semibold text-sm">{enriching ? 'Enrichissement en cours…' : 'Enrichir la sélection'}</button>
            {enriching && <button type="button" onClick={stopEnrichment} className="rounded-xl border border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50">Arrêter</button>}
            <button type="button" disabled={!exportableInterested.length || enriching || exportingContacts} onClick={handleInterestedExport} className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:bg-green-200 text-white font-semibold text-sm">{exportingContacts ? (contactExportProgress ? `Classement en traité… (${contactExportProgress.completed}/${contactExportProgress.total})` : 'Création du fichier…') : `Exporter contacts Odoo${exportableInterested.length ? ` (${exportableInterested.length})` : ''}`}</button>
          </section>
        )}

        {enrichment && (
          <section className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5">
            <h2 className="font-semibold text-indigo-950">Résumé d’enrichissement {enriching ? `· ${enrichment.terminees}/${enrichment.total}` : 'terminé'}</h2>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-indigo-900">
              <span>Places : {enrichment.google_trouves}/{enrichment.google_tentes}</span><span>Fermées : {enrichment.google_fermes}</span><span>Fermées temporairement : {enrichment.google_temporairement_fermes}</span><span>Sites Google : {enrichment.sites_google}</span><span>Sites Brave : {enrichment.sites_brave}</span><span>Contacts RH : {enrichment.rh_trouves}</span><span>Emails : {enrichment.emails_trouves}</span><span>Échecs : {enrichment.echecs}</span>
            </div>
          </section>
        )}

        <CompanyCards companies={activeCompanies} onDecision={decide} onOpen={setSelectedCompany} selectable={view === 'interested'} selected={selected} onToggleSelect={toggleSelected} />
      </main>
    </div>
  );
}
