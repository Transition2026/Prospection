const DB_NAME = 'prospection-b2b-cache';
const DB_VERSION = 2;
const LEGACY_CACHE_KEY = 'prospection-b2b.company-cache.v1';
const STORES = { companies: 'companies', searches: 'searches', pages: 'pages', meta: 'meta' };

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.companies)) db.createObjectStore(STORES.companies, { keyPath: 'siren' });
      if (!db.objectStoreNames.contains(STORES.searches)) db.createObjectStore(STORES.searches, { keyPath: 'signature' });
      if (!db.objectStoreNames.contains(STORES.pages)) {
        const pages = db.createObjectStore(STORES.pages, { keyPath: 'key' });
        pages.createIndex('signature', 'signature', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function persistentCompany(company = {}) {
  const {
    emailLoading,
    dirigeantResolving,
    enriching,
    data_gouv_brut,
    adresse_components,
    ...data
  } = company;
  if (Array.isArray(data.dirigeants)) {
    data.dirigeants = data.dirigeants.map((dirigeant) => ({
      prenoms: dirigeant.prenoms || '',
      nom: dirigeant.nom || '',
      qualite: dirigeant.qualite || '',
      siren: dirigeant.siren || '',
    }));
  }
  return data;
}

function hydratedRecord(record) {
  return {
    ...persistentCompany(record?.base),
    ...persistentCompany(record?.data),
  };
}

function compactBase(company = {}) {
  const source = persistentCompany(company);
  const fields = [
    'siren', 'nom_entreprise', 'prenom_dirigeant', 'nom_dirigeant',
    'qualite_dirigeant', 'siren_dirigeant', 'dirigeants',
    'adresse_legale', 'code_postal_legal', 'ville_legale', 'siret_siege',
    'adresse_etablissement', 'code_postal_etablissement', 'ville_etablissement',
    'siret_etablissement', 'enseigne_etablissement', 'latitude_etablissement',
    'longitude_etablissement', 'code_postal', 'ville', 'adresse', 'code_naf',
    'tranche_effectif', 'nb_etablissements', 'site_web',
  ];
  return Object.fromEntries(fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]]));
}

function cacheRecord(siren, base, previous, updatedAt = isoNow()) {
  return {
    siren,
    // La source Data.gouv est remplacée à chaque nouvelle recherche. Les
    // décisions et enrichissements restent dans `data` et ne sont jamais
    // écrasés par une réponse fraîche de l'API.
    base: compactBase(base),
    data: persistentCompany(previous?.data),
    updated_at: previous?.updated_at || updatedAt,
  };
}

function isoNow() {
  return new Date().toISOString();
}

async function migrateLegacyCache(db) {
  const transaction = db.transaction([STORES.meta, STORES.companies], 'readwrite');
  const completed = transactionResult(transaction);
  const meta = transaction.objectStore(STORES.meta);
  const alreadyMigrated = await requestResult(meta.get('legacy-local-storage-migrated'));
  if (alreadyMigrated) {
    await completed;
    return;
  }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_CACHE_KEY) || '{"entries":{}}');
    const companies = transaction.objectStore(STORES.companies);
    Object.entries(legacy.entries || {}).forEach(([siren, entry]) => {
      if (entry?.company) companies.put({ siren, data: persistentCompany(entry.company), updated_at: entry.cached_at || isoNow() });
    });
  } catch {
    // Un ancien cache illisible ne doit pas empêcher l'application de démarrer.
  }
  meta.put({ key: 'legacy-local-storage-migrated', value: true, updated_at: isoNow() });
  await completed;
}

export async function initializeCompanyCache() {
  const db = await openDatabase();
  await migrateLegacyCache(db);
  await compactSearchPages(db);
  await migrateProspectionStatuses(db);
  return db;
}

// Les anciennes versions répétaient une fiche complète dans chaque page de
// recherche. On migre vers une fiche canonique par SIREN et des pages qui ne
// contiennent plus que les SIREN, sans perdre les décisions/enrichissements.
async function compactSearchPages(db) {
  const transaction = db.transaction([STORES.companies, STORES.pages, STORES.meta], 'readwrite');
  const completed = transactionResult(transaction);
  const meta = transaction.objectStore(STORES.meta);
  const layout = await requestResult(meta.get('cache-layout-version'));
  if (layout?.value === 2) {
    await completed;
    return;
  }

  const pagesStore = transaction.objectStore(STORES.pages);
  const companiesStore = transaction.objectStore(STORES.companies);
  const pages = await requestResult(pagesStore.getAll());
  for (const page of pages) {
    const legacyCompanies = page.companies || [];
    if (legacyCompanies.length === 0) continue;
    const sirens = [];
    for (const company of legacyCompanies) {
      if (!company?.siren) continue;
      const previous = await requestResult(companiesStore.get(company.siren));
      companiesStore.put(cacheRecord(company.siren, company, previous, page.updated_at || isoNow()));
      sirens.push(company.siren);
    }
    pagesStore.put({
      key: page.key,
      signature: page.signature,
      page: page.page,
      sirens: [...new Set(sirens)],
      updated_at: page.updated_at || isoNow(),
    });
  }
  meta.put({ key: 'cache-layout-version', value: 2, updated_at: isoNow() });
  await completed;
}

// La boîte « Pas intéressées » doit rester consultable. Les anciennes versions
// avaient aplati ce statut sous `processed` : la migration le restaure à partir
// de la raison mémorisée, sans toucher aux vrais exports XLSX.
async function migrateProspectionStatuses(db) {
  const transaction = db.transaction([STORES.companies, STORES.meta], 'readwrite');
  const completed = transactionResult(transaction);
  const meta = transaction.objectStore(STORES.meta);
  const migration = await requestResult(meta.get('prospection-status-version'));
  if (migration?.value === 2) {
    await completed;
    return;
  }

  const companies = transaction.objectStore(STORES.companies);
  const records = await requestResult(companies.getAll());
  for (const record of records) {
    const data = persistentCompany(record.data);
    const historicalNegative = data.prospection_status === 'processed'
      && /pas intéressée|aucun dirigeant personne physique/i.test(data.prospection_reason || '');
    if (!['exported'].includes(data.prospection_status) && !historicalNegative) continue;
    const wasExported = data.prospection_status === 'exported';
    companies.put({
      ...record,
      data: {
        ...data,
        prospection_status: historicalNegative ? 'not_interested' : 'processed',
        prospection_reason: data.prospection_reason || (wasExported ? 'Export XLSX' : 'Décision : pas intéressée'),
        processed_at: data.processed_at || data.exported_at || data.prospection_updated_at || isoNow(),
      },
      updated_at: record.updated_at || isoNow(),
    });
  }
  meta.put({ key: 'prospection-status-version', value: 2, updated_at: isoNow() });
  await completed;
}

export function createSearchSignature(params) {
  return JSON.stringify({
    departements: [...(params.departements || [])].sort(),
    sections: [...(params.sections || [])].sort(),
    code_postaux: [...(params.code_postaux || (params.code_postal ? [params.code_postal] : []))].sort(),
    nom_contient: params.nom_contient || '',
    naf_prefixes: [...(params.naf_prefixes || (params.naf_prefix ? [params.naf_prefix] : []))].sort(),
    tranche_effectif_salarie: [...(params.tranche_effectif_salarie || [])].sort(),
  });
}

export async function getCachedSearch(signature) {
  const db = await initializeCompanyCache();
  const transaction = db.transaction([STORES.companies, STORES.searches, STORES.pages], 'readonly');
  const completed = transactionResult(transaction);
  const search = await requestResult(transaction.objectStore(STORES.searches).get(signature));
  const pages = await requestResult(transaction.objectStore(STORES.pages).index('signature').getAll(signature));
  const records = await requestResult(transaction.objectStore(STORES.companies).getAll());
  await completed;
  const ordered = pages.sort((a, b) => a.page - b.page);
  const companiesBySiren = new Map(records.map((record) => [record.siren, hydratedRecord(record)]));
  return {
    search: search || { signature, next_page: 1, exhausted: false, total_pages: null },
    companies: ordered.flatMap((page) => {
      if (Array.isArray(page.sirens)) return page.sirens.map((siren) => companiesBySiren.get(siren)).filter(Boolean);
      return page.companies || [];
    }),
  };
}

export async function cacheSearchPage(signature, page, companies, metadata = {}) {
  const db = await initializeCompanyCache();
  const now = isoNow();
  const transaction = db.transaction([STORES.companies, STORES.searches, STORES.pages], 'readwrite');
  const completed = transactionResult(transaction);
  const companyStore = transaction.objectStore(STORES.companies);
  const sirens = [];
  for (const company of companies) {
    if (!company?.siren) continue;
    const previous = await requestResult(companyStore.get(company.siren));
    companyStore.put(cacheRecord(company.siren, company, previous, now));
    sirens.push(company.siren);
  }
  transaction.objectStore(STORES.pages).put({ key: `${signature}:${page}`, signature, page, sirens: [...new Set(sirens)], updated_at: now });
  transaction.objectStore(STORES.searches).put({
    signature,
    next_page: metadata.hasMore ? page + 1 : page,
    exhausted: !metadata.hasMore,
    total_pages: metadata.totalPages ?? null,
    total_results: metadata.totalResults ?? null,
    updated_at: now,
  });
  await completed;
}

export async function getCompanyOverrides() {
  const db = await initializeCompanyCache();
  const transaction = db.transaction(STORES.companies, 'readonly');
  const completed = transactionResult(transaction);
  const records = await requestResult(transaction.objectStore(STORES.companies).getAll());
  await completed;
  return new Map(records.map((record) => [record.siren, hydratedRecord(record)]));
}

export async function getCachedCompanies() {
  const db = await initializeCompanyCache();
  const transaction = db.transaction(STORES.companies, 'readonly');
  const completed = transactionResult(transaction);
  const records = await requestResult(transaction.objectStore(STORES.companies).getAll());
  await completed;
  return records.map(hydratedRecord).filter((company) => company.siren);
}

export async function hydrateCompanies(companies) {
  const overrides = await getCompanyOverrides();
  return companies.map((company) => ({ ...company, ...(overrides.get(company.siren) || {}) }));
}

export async function updateCachedCompany(siren, patch) {
  if (!siren) return null;
  const db = await initializeCompanyCache();
  const transaction = db.transaction(STORES.companies, 'readwrite');
  const completed = transactionResult(transaction);
  const store = transaction.objectStore(STORES.companies);
  const previous = await requestResult(store.get(siren));
  const record = {
    siren,
    base: persistentCompany(previous?.base),
    data: { ...persistentCompany(previous?.data), ...persistentCompany(patch) },
    updated_at: isoNow(),
  };
  store.put(record);
  await completed;
  return record;
}

export async function getCacheStats() {
  const db = await initializeCompanyCache();
  const transaction = db.transaction([STORES.companies, STORES.pages], 'readonly');
  const completed = transactionResult(transaction);
  const overrides = await requestResult(transaction.objectStore(STORES.companies).getAll());
  const pageRecords = await requestResult(transaction.objectStore(STORES.pages).getAll());
  await completed;
  // Les fiches Data.gouv sans action utilisateur sont stockées dans les pages,
  // pas dans les surcharges. Le compteur doit donc refléter les deux sources.
  const sirens = new Set(overrides.map((record) => record.siren));
  pageRecords.forEach((page) => (page.companies || []).forEach((company) => {
    if (company.siren) sirens.add(company.siren);
  }));
  return { companies: sirens.size, pages: pageRecords.length };
}

export async function clearCompanyCache() {
  const db = await initializeCompanyCache();
  const transaction = db.transaction([STORES.companies, STORES.searches, STORES.pages], 'readwrite');
  const completed = transactionResult(transaction);
  transaction.objectStore(STORES.companies).clear();
  transaction.objectStore(STORES.searches).clear();
  transaction.objectStore(STORES.pages).clear();
  await completed;
}

export async function exportCompanyCache() {
  const db = await initializeCompanyCache();
  const transaction = db.transaction([STORES.companies, STORES.searches, STORES.pages], 'readonly');
  const completed = transactionResult(transaction);
  const companies = await requestResult(transaction.objectStore(STORES.companies).getAll());
  const searches = await requestResult(transaction.objectStore(STORES.searches).getAll());
  const pages = await requestResult(transaction.objectStore(STORES.pages).getAll());
  await completed;
  return { version: 3, exported_at: isoNow(), companies, searches, pages };
}

export async function importCompanyCache(payload) {
  if (!payload || ![2, 3].includes(payload.version) || !Array.isArray(payload.companies)) throw new Error('Fichier de cache incompatible.');
  const db = await initializeCompanyCache();
  const transaction = db.transaction([STORES.companies, STORES.searches, STORES.pages, STORES.meta], 'readwrite');
  const completed = transactionResult(transaction);
  const stores = { companies: transaction.objectStore(STORES.companies), searches: transaction.objectStore(STORES.searches), pages: transaction.objectStore(STORES.pages), meta: transaction.objectStore(STORES.meta) };
  const datasets = [['companies', payload.companies || [], 'siren'], ['searches', payload.searches || [], 'signature'], ['pages', payload.pages || [], 'key']];
  let merged = 0;
  for (const [storeName, records, key] of datasets) {
    for (const record of records) {
      if (!record?.[key]) continue;
      const previous = await requestResult(stores[storeName].get(record[key]));
      if (storeName === 'companies' && previous) {
        const importedIsNewer = (record.updated_at || '') > (previous.updated_at || '');
        stores[storeName].put({
          siren: record.siren,
          base: importedIsNewer
            ? { ...persistentCompany(previous.base), ...persistentCompany(record.base) }
            : { ...persistentCompany(record.base), ...persistentCompany(previous.base) },
          data: importedIsNewer
            ? { ...persistentCompany(previous.data), ...persistentCompany(record.data) }
            : { ...persistentCompany(record.data), ...persistentCompany(previous.data) },
          updated_at: importedIsNewer ? record.updated_at : previous.updated_at,
        });
        merged += 1;
      } else if (storeName === 'pages' && previous) {
        const importedIsNewer = (record.updated_at || '') > (previous.updated_at || '');
        const newest = importedIsNewer ? record : previous;
        const oldest = importedIsNewer ? previous : record;
        const previousBySiren = new Map((previous.companies || []).map((company) => [company.siren, company]));
        const importedBySiren = new Map((record.companies || []).map((company) => [company.siren, company]));
        const companySirens = new Set([...previousBySiren.keys(), ...importedBySiren.keys()]);
        const companies = [...companySirens].filter(Boolean).map((siren) => ({
          ...(oldest.companies || []).find((company) => company.siren === siren),
          ...(newest.companies || []).find((company) => company.siren === siren),
        }));
        stores[storeName].put({ ...oldest, ...newest, companies, updated_at: newest.updated_at });
        merged += 1;
      } else if (!previous || (record.updated_at || '') > (previous.updated_at || '')) {
        stores[storeName].put(record);
        merged += 1;
      }
    }
  }
  if ((payload.pages || []).some((page) => Array.isArray(page.companies))) {
    stores.meta.put({ key: 'cache-layout-version', value: 1, updated_at: isoNow() });
  }
  await completed;
  return merged;
}
