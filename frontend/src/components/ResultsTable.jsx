const TRANCHES_MICRO = ['NN', '00', '01', '02', '03'];
const TRANCHES_PME = ['11', '12', '21', '22', '31'];

function tranchToCategorie(tranche) {
  if (!tranche) return 'micro';
  if (TRANCHES_MICRO.includes(tranche)) return 'micro';
  if (TRANCHES_PME.includes(tranche)) return 'pme';
  return 'grande';
}

const CATEGORIE_STYLE = {
  micro: { label: 'Micro', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  pme: { label: 'PME', cls: 'bg-green-50 text-green-600 border-green-200' },
  grande: { label: 'Grande', cls: 'bg-orange-50 text-orange-600 border-orange-200' },
};

function TailleBadge({ categorie, tranche, source }) {
  const cat = categorie || tranchToCategorie(tranche);
  const style = CATEGORIE_STYLE[cat];
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${style.cls}`}
      title={source === 'gpt' ? 'Catégorie corrigée par IA' : undefined}
    >
      {style.label}
      {source === 'gpt' && <span className="ml-1 opacity-60">✨</span>}
    </span>
  );
}


export default function ResultsTable({
  entreprises,
  selected,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  hunterProgress,
  onSelectEntreprise,
  exportedSirens = new Set(),
}) {
  if (!entreprises || entreprises.length === 0) return null;

  const allSelected = entreprises.length > 0 && selected.size === entreprises.length;
  const someSelected = selected.size > 0;

  function copyEmail(email) {
    navigator.clipboard.writeText(email).catch(() => {});
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Barre d'outils */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-3">
          <button
            onClick={onSelectAll}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Tout sélectionner
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={onDeselectAll}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Tout désélectionner
          </button>
          {someSelected && (
            <span className="text-sm text-gray-500 ml-2">
              {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Progress bar Hunter */}
        {hunterProgress && hunterProgress.total > 0 && (
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <span>
              Emails {hunterProgress.current} / {hunterProgress.total}
            </span>
            <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{
                  width: `${(hunterProgress.current / hunterProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tableau */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={allSelected ? onDeselectAll : onSelectAll}
                  className="accent-blue-600 w-4 h-4"
                />
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Entreprise</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Dirigeant</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Qualité</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Taille</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Secteur</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">CP</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Ville</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Site web</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entreprises.map((e) => (
              <tr
                key={e.siren}
                onClick={() => onSelectEntreprise(e)}
                className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                  selected.has(e.siren) ? 'bg-blue-50' : ''
                }`}
              >
                <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                  {exportedSirens.has(e.siren) ? (
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400 border border-gray-200 whitespace-nowrap">
                      Déjà exportée
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={selected.has(e.siren)}
                      onChange={() => onToggleSelect(e.siren)}
                      className="accent-blue-600 w-4 h-4"
                    />
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-gray-800 max-w-[160px] truncate">
                  {e.enriching ? (
                    <span className="flex items-center gap-2 text-gray-400">
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      {e.nom_entreprise}
                    </span>
                  ) : (
                    e.nom_entreprise
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {e.dirigeantResolving ? (
                    <span className="flex items-center gap-2 text-gray-400 text-xs italic">
                      <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Remontée en cours…
                    </span>
                  ) : e.prenom_dirigeant || e.nom_dirigeant ? (
                    <div className="flex flex-col">
                      <span>{`${e.prenom_dirigeant || ''} ${e.nom_dirigeant || ''}`.trim()}</span>
                      {e.dirigeant_remontees > 0 && (
                        <span
                          className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 self-start"
                          title={`Le président de l'entreprise était une personne morale — remonté ${e.dirigeant_remontees} niveau${e.dirigeant_remontees > 1 ? 'x' : ''}`}
                        >
                          ↑ Remonté {e.dirigeant_remontees} entreprise{e.dirigeant_remontees > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {e.qualite_dirigeant || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  <TailleBadge categorie={e.categorie} tranche={e.tranche_effectif} source={e.categorie_source} />
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs max-w-[120px] truncate">
                  {e.libelle_code_naf || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{e.code_postal || '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{e.ville || '—'}</td>
                <td className="px-4 py-3 text-xs max-w-[140px]" onClick={(ev) => ev.stopPropagation()}>
                  {e.site_web ? (
                    <a
                      href={e.site_web.startsWith('http') ? e.site_web : `https://${e.site_web}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline truncate block"
                      title={e.site_web}
                    >
                      {e.site_web.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {e.emailLoading ? (
                    <svg className="animate-spin w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  ) : e.email ? (
                    <span className="text-gray-700 font-mono">{e.email}</span>
                  ) : e.emailStatus === 'not_found' ? (
                    <span className="text-gray-400 italic">Email non trouvé</span>
                  ) : e.emailStatus === 'no_website' ? (
                    <span className="text-gray-400 italic">Site web non trouvé</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                  <button
                    onClick={() => copyEmail(e.email)}
                    disabled={!e.email}
                    title="Copier l'email"
                    className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-gray-600 rounded transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copier
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
