import { useState } from 'react';

const DEPARTEMENTS = [
  { value: '59', label: 'Nord (59)' },
  { value: '62', label: 'Pas-de-Calais (62)' },
  { value: '80', label: 'Somme (80)' },
  { value: '02', label: 'Aisne (02)' },
  { value: '60', label: 'Oise (60)' },
];

// Sections NAF (lettre) pour l'API data.gouv
const SECTEURS = [
  { value: 'J', label: 'Informatique / Tech' },
  { value: 'G', label: 'Commerce de gros' },
  { value: 'C', label: 'Industrie' },
  { value: 'F', label: 'Construction / BTP' },
  { value: 'M', label: 'Services aux entreprises' },
  { value: 'H', label: 'Transport / Logistique' },
  { value: 'Q', label: 'Santé' },
  { value: 'P', label: 'Formation' },
  { value: '', label: 'Tous secteurs' },
];

const TAILLE_OPTIONS = [
  { key: 'non_renseignee', label: 'Non renseignée (inclure quand même)' },
  { key: 'petite', label: 'Moins de 10 salariés' },
  { key: 'moyenne', label: '10 à 49 salariés' },
  { key: 'grande', label: '50 à 199 salariés' },
  { key: 'tres_grande', label: '200 salariés et plus' },
];

export default function SearchForm({ onSearch, loading, tailleFilter, onTailleChange, exclureGroupes, onExclureGroupesChange, exclureDejaExportes, onExclureDejaExportesChange, exportedCount, onResetExports }) {
  const [geoMode, setGeoMode] = useState('departement');
  const [selectedDepts, setSelectedDepts] = useState(['59']);
  const [codePostal, setCodePostal] = useState('');
  const [selectedSecteurs, setSelectedSecteurs] = useState([]);
  const [nombreResultats, setNombreResultats] = useState(25);

  function toggleDept(val) {
    setSelectedDepts((prev) =>
      prev.includes(val) ? prev.filter((d) => d !== val) : [...prev, val]
    );
  }

  function toggleSecteur(val) {
    if (val === '') {
      setSelectedSecteurs([]);
      return;
    }
    setSelectedSecteurs((prev) =>
      prev.includes(val) ? prev.filter((s) => s !== val) : [...prev, val]
    );
  }

  function handleSubmit(e) {
    e.preventDefault();

    const params = {
      per_page: Math.min(nombreResultats, 25),
      sections: selectedSecteurs,
    };

    if (geoMode === 'departement') {
      params.departements = selectedDepts.length > 0 ? selectedDepts : ['59'];
    } else if (geoMode === 'code_postal') {
      params.code_postal = codePostal.trim();
    }

    onSearch(params);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
      {/* Zone géographique */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</span>
          Zone géographique
        </h2>

        <div className="flex gap-4 mb-4">
          {[
            { value: 'departement', label: 'Par département' },

            { value: 'code_postal', label: 'Par code postal' },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="geoMode"
                value={opt.value}
                checked={geoMode === opt.value}
                onChange={() => setGeoMode(opt.value)}
                className="accent-blue-600"
              />
              <span className="text-sm text-gray-600">{opt.label}</span>
            </label>
          ))}
        </div>

        {geoMode === 'departement' && (
          <div className="flex flex-wrap gap-2">
            {DEPARTEMENTS.map((d) => (
              <button
                type="button"
                key={d.value}
                onClick={() => toggleDept(d.value)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedDepts.includes(d.value)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        {geoMode === 'code_postal' && (
          <input
            type="text"
            value={codePostal}
            onChange={(e) => setCodePostal(e.target.value)}
            placeholder="Ex : 59000, 59100..."
            className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        )}
      </div>

      {/* Secteur d'activité */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</span>
          Secteur d'activité
        </h2>
        <div className="flex flex-wrap gap-2">
          {SECTEURS.map((s) => (
            <button
              type="button"
              key={s.value || 'all'}
              onClick={() => toggleSecteur(s.value)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                s.value === '' && selectedSecteurs.length === 0
                  ? 'bg-blue-600 text-white border-blue-600'
                  : s.value !== '' && selectedSecteurs.includes(s.value)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Taille d'entreprise */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</span>
          Taille d'entreprise
        </h2>
        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-2">
          {TAILLE_OPTIONS.map((opt) => (
            <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={tailleFilter[opt.key]}
                onChange={(e) =>
                  onTailleChange((prev) => ({ ...prev, [opt.key]: e.target.checked }))
                }
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-sm text-gray-600">{opt.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          ℹ️ La taille n'est pas renseignée pour environ 50% des entreprises, notamment les plus récentes.
        </p>
      </div>

      {/* Filtre groupes nationaux */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={exclureGroupes}
            onChange={(e) => onExclureGroupesChange(e.target.checked)}
            className="accent-blue-600 w-4 h-4"
          />
          <span className="text-sm text-gray-600">Exclure les grands groupes nationaux</span>
        </label>
        <p className="text-xs text-gray-400 mt-1 ml-6">
          Masque les entités ayant plus de 35 établissements ouverts
        </p>
      </div>

      {/* Filtre déjà exportées */}
      <div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={exclureDejaExportes}
              onChange={(e) => onExclureDejaExportesChange(e.target.checked)}
              className="accent-blue-600 w-4 h-4"
            />
            <span className="text-sm text-gray-600">
              Exclure les entreprises déjà exportées
              {exportedCount > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full border border-gray-200">
                  {exportedCount} mémorisée{exportedCount > 1 ? 's' : ''}
                </span>
              )}
            </span>
          </label>
          {exportedCount > 0 && (
            <button
              type="button"
              onClick={onResetExports}
              className="text-xs text-red-400 hover:text-red-600 underline"
            >
              Remettre à zéro
            </button>
          )}
        </div>
      </div>

      {/* Autres filtres */}
      <div className="flex flex-wrap items-end gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            Nombre de résultats
          </label>
          <input
            type="number"
            min={1}
            max={25}
            value={nombreResultats}
            onChange={(e) => setNombreResultats(Number(e.target.value))}
            className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400 ml-2">(max 25)</span>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="ml-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Recherche en cours...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.65 16.65A7.5 7.5 0 1116.65 2a7.5 7.5 0 010 14.65z" />
              </svg>
              Rechercher
            </>
          )}
        </button>
      </div>
    </form>
  );
}
