const DB_NAME = 'prospection-b2b-cache';
const DB_VERSION = 1;
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

function persistentCompany(company) {
  const { emailLoading, dirigeantResolving, enriching, ...data } = company;
  return data;
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
  return db;
}

export function createSearchSignature(params) {
  return JSON.stringify({
    departements: [...(params.departements || [])].sort(),
    sections: [...(params.sections || [])].sort(),
    code_postal: params.code_postal || '',
    nom_contient: params.nom_contient || '',
    naf_prefix: params.naf_prefix || '',
  });
}

export async function getCachedSearch(signature) {
  const db = await initializeCompanyCache();
  const transaction = db.transaction([STORES.searches, STORES.pages], 'readonly');
  const completed = transactionResult(transaction);
  const search = await requestResult(transaction.objectStore(STORES.searches).get(signature));
  const pages = await requestResult(transaction.objectStore(STORES.pages).index('signature').getAll(signature));
  await completed;
  const ordered = pages.sort((a, b) => a.page - b.page);
  return {
    search: search || { signature, next_page: 1, exhausted: false, total_pages: null },
    companies: ordered.flatMap((page) => page.companies || []),
  };
}

export async function cacheSearchPage(signature, page, companies, metadata = {}) {
  const db = await initializeCompanyCache();
  const now = isoNow();
  const transaction = db.transaction([STORES.searches, STORES.pages], 'readwrite');
  const completed = transactionResult(transaction);
  transaction.objectStore(STORES.pages).put({ key: `${signature}:${page}`, signature, page, companies: companies.map(persistentCompany), updated_at: now });
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
  return new Map(records.map((record) => [record.siren, record]));
}

export async function hydrateCompanies(companies) {
  const overrides = await getCompanyOverrides();
  return companies.map((company) => ({ ...company, ...(overrides.get(company.siren)?.data || {}) }));
}

export async function updateCachedCompany(siren, patch) {
  if (!siren) return null;
  const db = await initializeCompanyCache();
  const transaction = db.transaction(STORES.companies, 'readwrite');
  const completed = transactionResult(transaction);
  const store = transaction.objectStore(STORES.companies);
  const previous = await requestResult(store.get(siren));
  const record = { siren, data: { ...(previous?.data || {}), ...persistentCompany(patch) }, updated_at: isoNow() };
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
  return { version: 2, exported_at: isoNow(), companies, searches, pages };
}

export async function importCompanyCache(payload) {
  if (!payload || payload.version !== 2 || !Array.isArray(payload.companies)) throw new Error('Fichier de cache incompatible.');
  const db = await initializeCompanyCache();
  const transaction = db.transaction([STORES.companies, STORES.searches, STORES.pages], 'readwrite');
  const completed = transactionResult(transaction);
  const stores = { companies: transaction.objectStore(STORES.companies), searches: transaction.objectStore(STORES.searches), pages: transaction.objectStore(STORES.pages) };
  const datasets = [['companies', payload.companies || [], 'siren'], ['searches', payload.searches || [], 'signature'], ['pages', payload.pages || [], 'key']];
  let merged = 0;
  for (const [storeName, records, key] of datasets) {
    for (const record of records) {
      if (!record?.[key]) continue;
      const previous = await requestResult(stores[storeName].get(record[key]));
      if (storeName === 'companies' && previous) {
        const importedIsNewer = (record.updated_at || '') > (previous.updated_at || '');
        stores[storeName].put({
          ...(importedIsNewer ? previous : record),
          ...(importedIsNewer ? record : previous),
          data: importedIsNewer
            ? { ...(previous.data || {}), ...(record.data || {}) }
            : { ...(record.data || {}), ...(previous.data || {}) },
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
  await completed;
  return merged;
}
