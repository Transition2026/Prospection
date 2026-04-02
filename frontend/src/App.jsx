import { useEffect, useState, useCallback } from 'react';
import StatusBanner from './components/StatusBanner';
import SearchForm from './components/SearchForm';
import ResultsTable from './components/ResultsTable';
import ExportButton from './components/ExportButton';
import DetailPanel from './components/DetailPanel';
import { checkStatus, searchEntreprises, enrichDropcontact, sleep, getExportedSirens, saveExportedEntreprises, resetExportedSirens } from './services/api';

const HUNTER_DELAY_MS = 300;

const TAILLE_TRANCHES = {
  non_renseignee: ['', null, undefined],
  petite: ['NN', '00', '01', '02', '03'],
  moyenne: ['11', '12'],
  grande: ['21', '22'],
  tres_grande: ['31', '32', '41', '42', '51', '52', '53'],
};

function getTranche(tranche_effectif) {
  if (!tranche_effectif) return 'non_renseignee';
  if (TAILLE_TRANCHES.petite.includes(tranche_effectif)) return 'petite';
  if (TAILLE_TRANCHES.moyenne.includes(tranche_effectif)) return 'moyenne';
  if (TAILLE_TRANCHES.grande.includes(tranche_effectif)) return 'grande';
  return 'tres_grande';
}

const DEFAULT_TAILLE_FILTER = {
  non_renseignee: true,
  petite: true,
  moyenne: true,
  grande: true,
  tres_grande: false,
};

export default function App() {
  const [apiStatus, setApiStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [entreprises, setEntreprises] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [hunterProgress, setHunterProgress] = useState(null);
  const [hunterRunning, setHunterRunning] = useState(false);
  const [error, setError] = useState(null);
  const [tailleFilter, setTailleFilter] = useState(DEFAULT_TAILLE_FILTER);
  const [exclureGroupes, setExclureGroupes] = useState(true);
  const [exportedSirens, setExportedSirens] = useState(new Set());
  const [exclureDejaExportes, setExclureDejaExportes] = useState(true);
  const [entrepriseSelectionnee, setEntrepriseSelectionnee] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastSearchParams, setLastSearchParams] = useState(null);

  const filteredEntreprises = entreprises.filter((e) => {
    if (!tailleFilter[getTranche(e.tranche_effectif)]) return false;
    if (exclureGroupes && e.nb_etablissements > 35) return false;
    if (exclureDejaExportes && exportedSirens.has(e.siren)) return false;
    return true;
  });
  const masquees = entreprises.length - filteredEntreprises.length;

  useEffect(() => {
    checkStatus()
      .then(setApiStatus)
      .catch(() =>
        setApiStatus({
          ok: false,
          message:
            "Impossible de contacter le serveur backend (http://localhost:3001). Assurez-vous qu'il est démarré.",
        })
      );
    getExportedSirens().then(setExportedSirens).catch(() => {});
  }, []);

  function updateEntreprise(siren, updates) {
    setEntreprises((prev) =>
      prev.map((e) => (e.siren === siren ? { ...e, ...updates } : e))
    );
  }

  const handleSearch = useCallback(async (params) => {
    setError(null);
    setLoading(true);
    setEntreprises([]);
    setSelected(new Set());
    setHunterProgress(null);
    setCurrentPage(1);
    setHasMore(false);
    setLastSearchParams(params);

    try {
      const { entreprises: results, hasMore: more } = await searchEntreprises(params, 1, new Set());
      setEntreprises(results);
      setHasMore(more);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (!lastSearchParams || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);

    const nextPage = currentPage + 1;
    const existingSirens = new Set(entreprises.map((e) => e.siren));

    try {
      const { entreprises: nouvelles, hasMore: more } = await searchEntreprises(
        lastSearchParams,
        nextPage,
        existingSirens
      );
      setEntreprises((prev) => [...prev, ...nouvelles]);
      setCurrentPage(nextPage);
      setHasMore(more && nouvelles.length > 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [lastSearchParams, loadingMore, hasMore, currentPage, entreprises]);

  const handleHunterEnrich = useCallback(async () => {
    if (selected.size === 0 || hunterRunning) return;
    setHunterRunning(true);
    setError(null);

    const toEnrich = entreprises.filter((e) => selected.has(e.siren));
    setHunterProgress({ current: 0, total: toEnrich.length });

    for (let i = 0; i < toEnrich.length; i++) {
      const e = toEnrich[i];
      updateEntreprise(e.siren, { emailLoading: true });

      try {
        const result = await enrichDropcontact({
          prenom: e.prenom_dirigeant,
          nom: e.nom_dirigeant,
          entreprise: e.nom_entreprise,
          site_web: e.site_web,
        });
        if (result.found) {
          updateEntreprise(e.siren, {
            emailLoading: false,
            email: result.email,
            score: result.score,
            emailStatus: 'found',
          });
        } else {
          updateEntreprise(e.siren, { emailLoading: false, emailStatus: 'not_found' });
        }
      } catch {
        updateEntreprise(e.siren, { emailLoading: false, emailStatus: 'not_found' });
      }

      setHunterProgress({ current: i + 1, total: toEnrich.length });
      if (i < toEnrich.length - 1) await sleep(HUNTER_DELAY_MS);
    }

    setHunterProgress(null);
    setHunterRunning(false);
  }, [selected, entreprises, hunterRunning]);

  function toggleSelect(siren) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(siren)) next.delete(siren);
      else next.add(siren);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filteredEntreprises.map((e) => e.siren)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  const emailCount = filteredEntreprises.filter((e) => e.email).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <DetailPanel
        entreprise={entrepriseSelectionnee}
        onClose={() => setEntrepriseSelectionnee(null)}
        onUpdateEntreprise={(siren, updates) => {
          updateEntreprise(siren, updates);
          setEntrepriseSelectionnee((prev) => prev ? { ...prev, ...updates } : prev);
        }}
      />
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Prospection B2B</h1>
            <p className="text-xs text-gray-500">Nord de la France — data.gouv.fr + Dropcontact</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        <StatusBanner status={apiStatus} />

        {error && (
          <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">
            <strong>Erreur :</strong> {error}
          </div>
        )}

        <SearchForm
          onSearch={handleSearch}
          loading={loading}
          tailleFilter={tailleFilter}
          onTailleChange={setTailleFilter}
          exclureGroupes={exclureGroupes}
          onExclureGroupesChange={setExclureGroupes}
          exclureDejaExportes={exclureDejaExportes}
          onExclureDejaExportesChange={setExclureDejaExportes}
          exportedCount={exportedSirens.size}
          onResetExports={() => {
            resetExportedSirens().catch(() => {});
            setExportedSirens(new Set());
          }}
        />

        {filteredEntreprises.length > 0 && (
          <>
            <ResultsTable
              entreprises={filteredEntreprises}
              selected={selected}
              onToggleSelect={toggleSelect}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              hunterProgress={hunterProgress}
              onSelectEntreprise={setEntrepriseSelectionnee}
              exportedSirens={exportedSirens}
            />

            {/* Bouton Charger plus */}
            {lastSearchParams && (
              <div className="flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="px-6 py-2.5 bg-white border border-gray-300 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50 text-gray-600 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 shadow-sm"
                >
                  {loadingMore ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Chargement...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      Charger plus d'entreprises
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Barre d'actions */}
            <div className="flex items-center justify-between bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-4">
              <p className="text-sm text-gray-500">
                <span className="font-semibold text-gray-700">{filteredEntreprises.length}</span>{' '}
                entreprise{filteredEntreprises.length > 1 ? 's' : ''} affichée{filteredEntreprises.length > 1 ? 's' : ''}
                {masquees > 0 && (
                  <span className="text-gray-400">
                    {' '}({masquees} masquée{masquees > 1 ? 's' : ''} par le filtre taille)
                  </span>
                )}
                {emailCount > 0 && (
                  <>
                    {' '}—{' '}
                    <span className="font-semibold text-green-600">{emailCount}</span> email
                    {emailCount > 1 ? 's' : ''} récupéré{emailCount > 1 ? 's' : ''}
                  </>
                )}
              </p>

              <div className="flex items-center gap-3">
                <ExportButton
                  data={filteredEntreprises}
                  selected={selected}
                  onExported={(exported) => {
                    saveExportedEntreprises(exported).catch(() => {});
                    setExportedSirens((prev) => new Set([...prev, ...exported.map((e) => e.siren)]));
                  }}
                />

                {selected.size > 0 && (
                  <button
                    onClick={handleHunterEnrich}
                    disabled={hunterRunning}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                  >
                    {hunterRunning ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Recherche Dropcontact en cours...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Trouver les emails ({selected.size} sélectionné{selected.size > 1 ? 's' : ''})
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* Cas : des résultats existent mais tous masqués par le filtre */}
        {!loading && entreprises.length > 0 && filteredEntreprises.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="font-medium">Tous les résultats sont masqués par le filtre taille.</p>
            <p className="text-sm mt-1">Ajustez les cases à cocher dans le formulaire.</p>
          </div>
        )}

        {!loading && entreprises.length === 0 && !error && (
          <div className="text-center py-16 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M16.65 16.65A7.5 7.5 0 1116.65 2a7.5 7.5 0 010 14.65z" />
            </svg>
            <p>Lancez une recherche pour afficher les résultats</p>
          </div>
        )}
      </main>
    </div>
  );
}
