import { useState } from 'react';

const DEPARTEMENTS = [
  { value: '59', label: 'Nord (59)' }, { value: '62', label: 'Pas-de-Calais (62)' },
  { value: '80', label: 'Somme (80)' }, { value: '02', label: 'Aisne (02)' }, { value: '60', label: 'Oise (60)' },
];
const SECTEURS = [
  { value: 'J', label: 'Informatique / Tech' }, { value: 'G', label: 'Commerce de gros' },
  { value: 'C', label: 'Industrie' }, { value: 'F', label: 'Construction / BTP' },
  { value: 'M', label: 'Services aux entreprises' }, { value: 'H', label: 'Transport / Logistique' },
  { value: 'Q', label: 'Santé' }, { value: 'P', label: 'Formation' },
];
const CATEGORIES = [
  ['micro', 'Micro', '1 à 9 salariés'], ['pme', 'PME', '10 à 249 salariés'], ['grande', 'Grande', '250+ salariés'],
];

function commaSeparatedValues(value, normalizer) {
  return [...new Set(value
    .split(',')
    .map((item) => normalizer(item.trim()))
    .filter(Boolean))];
}

export default function SearchForm({ onSearch, loading, categoryFilter, onCategoryChange, exclureGroupes, onExclureGroupesChange, filterLegalHeadquarters, onFilterLegalHeadquartersChange }) {
  const [geoMode, setGeoMode] = useState('departement');
  const [departements, setDepartements] = useState(['59']);
  const [codePostal, setCodePostal] = useState('');
  const [sections, setSections] = useState([]);
  const [nomContient, setNomContient] = useState('');
  const [nafPrefix, setNafPrefix] = useState('');
  const [limit, setLimit] = useState('25');
  const toggle = (value, setter) => setter((previous) => previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value]);

  function submit(event) {
    event.preventDefault();
    const codePostaux = commaSeparatedValues(codePostal, (value) => value.replace(/\D/g, '').slice(0, 5));
    const nafPrefixes = commaSeparatedValues(nafPrefix, (value) => value.replace(/[^0-9a-z.]/gi, '').slice(0, 5));
    if (geoMode === 'code_postal' && (!codePostaux.length || codePostaux.some((value) => value.length !== 5))) {
      window.alert('Saisis un ou plusieurs codes postaux à 5 chiffres, séparés par des virgules.');
      return;
    }
    const params = {
      sections,
      nom_contient: nomContient.trim(),
      naf_prefixes: nafPrefixes,
      limit: limit === 'all' ? 'all' : Math.min(Math.max(Number(limit) || 25, 1), 2000),
      per_page: 25,
    };
    if (geoMode === 'code_postal') params.code_postaux = codePostaux;
    else params.departements = departements.length ? departements : ['59'];
    onSearch(params);
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-gray-800">Zone géographique</h2>
        <div className="mt-3 flex gap-5 text-sm text-gray-600">
          <label className="flex gap-2 items-center"><input type="radio" checked={geoMode === 'departement'} onChange={() => setGeoMode('departement')} className="accent-blue-600" /> Département</label>
          <label className="flex gap-2 items-center"><input type="radio" checked={geoMode === 'code_postal'} onChange={() => setGeoMode('code_postal')} className="accent-blue-600" /> Ville / code postal</label>
        </div>
        {geoMode === 'departement' ? <div className="mt-3 flex flex-wrap gap-2">{DEPARTEMENTS.map((dept) => <button key={dept.value} type="button" onClick={() => toggle(dept.value, setDepartements)} className={`px-3 py-1.5 rounded-full text-sm border ${departements.includes(dept.value) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>{dept.label}</button>)}</div> : <input value={codePostal} onChange={(event) => setCodePostal(event.target.value)} required placeholder="Ex. 59000, 59100" inputMode="text" className="mt-3 w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm" />}
      </div>

      <div>
        <h2 className="font-semibold text-gray-800">Secteurs</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => setSections([])} className={`px-3 py-1.5 rounded-full text-sm border ${sections.length === 0 ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>Tous secteurs</button>
          {SECTEURS.map((sector) => <button key={sector.value} type="button" onClick={() => toggle(sector.value, setSections)} className={`px-3 py-1.5 rounded-full text-sm border ${sections.includes(sector.value) ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>{sector.label}</button>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-gray-600">Nom de l’entreprise contient
            <input value={nomContient} onChange={(event) => setNomContient(event.target.value)} placeholder="Ex. transition" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm text-gray-600">Code NAF commence par
            <input value={nafPrefix} onChange={(event) => setNafPrefix(event.target.value)} placeholder="Ex. 62, 62.01" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-5">
        <div><h2 className="font-semibold text-gray-800">Taille</h2><div className="mt-3 flex flex-wrap gap-2">{CATEGORIES.map(([key, label, subtitle]) => <button key={key} type="button" onClick={() => onCategoryChange((previous) => ({ ...previous, [key]: !previous[key] }))} className={`px-3 py-1.5 rounded-full text-sm border ${categoryFilter[key] ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>{label} <span className="opacity-75 text-xs">{subtitle}</span></button>)}</div></div>
        <label className="flex gap-2 items-center text-sm text-gray-600"><input type="checkbox" checked={exclureGroupes} onChange={(event) => onExclureGroupesChange(event.target.checked)} className="accent-blue-600" /> Exclure les groupes (&gt;35 établissements)</label>
        <button type="button" onClick={() => onFilterLegalHeadquartersChange(!filterLegalHeadquarters)} className={`px-3 py-1.5 rounded-full text-sm border ${filterLegalHeadquarters ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`} title="Applique aussi la zone de recherche au siège légal">Siège légal = établissement : {filterLegalHeadquarters ? 'activé' : 'désactivé'}</button>
        <label className="text-sm text-gray-600">Résultats <select value={limit} onChange={(event) => setLimit(event.target.value)} className="ml-2 rounded-lg border border-gray-300 px-2 py-1.5"><option value="25">25</option><option value="100">100</option><option value="500">500</option><option value="2000">2 000</option><option value="all">Tous les résultats</option></select></label>
        <button type="submit" disabled={loading} className="ml-auto px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-200 text-white font-semibold">{loading ? 'Recherche en cours…' : 'Rechercher'}</button>
      </div>
    </form>
  );
}
