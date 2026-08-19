const TAILLE_LABELS = {
  NN: '0 salarié', '00': '0 salarié', '01': '1 à 2', '02': '3 à 5', '03': '6 à 9',
  '11': '10 à 19', '12': '20 à 49', '21': '50 à 99', '22': '100 à 199', '31': '200 à 249',
  '32': '250 à 499', '41': '500 à 999', '42': '1 000 à 1 999', '51': '2 000 à 4 999',
  '52': '5 000 à 9 999', '53': '10 000+',
};

function PlaceStatus({ company }) {
  if (!company.places_result) return <span className="text-xs text-gray-400">Places non vérifié</span>;
  if (company.statut_google === 'CLOSED_PERMANENTLY') return <span className="text-xs font-medium text-red-600">Google : fermé définitivement</span>;
  if (company.statut_google === 'CLOSED_TEMPORARILY') return <span className="text-xs font-medium text-amber-600">Google : fermé temporairement</span>;
  if (company.places_result.found && company.place_match_confirme) return <span className="text-xs font-medium text-green-600">Google confirmé · {company.place_score}/100</span>;
  if (company.places_result.found) return <span className="text-xs font-medium text-amber-600">Proposition Google · {company.place_score}/100</span>;
  return <span className="text-xs text-amber-600">Google non confirmé</span>;
}

export default function CompanyCard({ company, onDecision, onOpen, selectable = false, selected = false, onToggleSelect }) {
  const prenom = (company.prenom_dirigeant || '').trim();
  const nom = (company.nom_dirigeant || '').trim();
  const dirigeant = [prenom ? `${prenom[0]}.` : '', nom].filter(Boolean).join(' ');
  const dirigeantLabel = dirigeant || (company.dirigeant_raison ? 'Aucun mandataire hors commissaire' : 'Recherche en cours…');
  return (
    <article className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 flex flex-col gap-4 hover:border-blue-300 transition-colors">
      <div className="flex items-start gap-3">
        {selectable && (
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(company.siren)} className="mt-1 accent-blue-600 w-4 h-4" />
        )}
        <button type="button" onClick={() => onOpen(company)} className="text-left min-w-0 flex-1">
          <h3 className="font-bold text-gray-900 leading-tight truncate">{company.nom_entreprise}</h3>
          <p className="mt-1 text-xs text-gray-400 font-mono">SIREN {company.siren}</p>
        </button>
        <PlaceStatus company={company} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <p className="text-xs text-gray-400">Dirigeant</p>
          <p className="text-gray-800 break-words">{dirigeantLabel}</p>
          {company.qualite_dirigeant && <p className="text-xs text-gray-500">{company.qualite_dirigeant}</p>}
        </div>
        <div>
          <p className="text-xs text-gray-400">Effectif</p>
          <p className="text-gray-800">{TAILLE_LABELS[company.tranche_effectif] || 'Non renseigné'}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-gray-400">Établissement Data.gouv</p>
          <p className="text-gray-800 break-words">{[company.code_postal_etablissement, company.ville_etablissement].filter(Boolean).join(' ') || 'Non renseigné'}</p>
        </div>
        <div className="col-span-2">
          <p className="text-xs text-gray-400">Siège légal</p>
          <p className="text-gray-600 truncate">{[company.code_postal_legal, company.ville_legale].filter(Boolean).join(' ') || company.ville || 'Non renseigné'}</p>
        </div>
      </div>

      {company.prospection_status === 'unspecified' && (
        <div className="grid grid-cols-2 gap-3 mt-auto">
          <button type="button" onClick={() => onDecision(company.siren, 'interested')} className="py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-sm">Intéressée</button>
          <button type="button" onClick={() => onDecision(company.siren, 'not_interested')} className="py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm">Pas intéressée</button>
        </div>
      )}
      {company.prospection_status !== 'unspecified' && (
        <button type="button" onClick={() => onDecision(company.siren, 'unspecified')} className="mt-auto py-2 text-sm text-blue-600 hover:text-blue-700 underline">Remettre à traiter</button>
      )}
    </article>
  );
}
