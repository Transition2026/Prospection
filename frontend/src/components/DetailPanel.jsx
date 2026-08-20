import { useEffect, useState } from 'react';
import { resolveGooglePlace } from '../services/api';

const TAILLE_LABELS = {
  NN: '0 salarié',
  '00': '0 salarié',
  '01': '1 à 2 salariés',
  '02': '3 à 5 salariés',
  '03': '6 à 9 salariés',
  '11': '10 à 19 salariés',
  '12': '20 à 49 salariés',
  '21': '50 à 99 salariés',
  '22': '100 à 199 salariés',
  '31': '200 à 249 salariés',
  '32': '250 à 499 salariés',
  '41': '500 à 999 salariés',
  '42': '1 000 à 1 999 salariés',
  '51': '2 000 à 4 999 salariés',
  '52': '5 000 à 9 999 salariés',
  '53': '10 000 salariés et plus',
};

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-sm text-gray-400 w-36 shrink-0">{label}</span>
      <span className="text-sm text-gray-800">{value}</span>
    </div>
  );
}

function sitesEntreprise(entreprise) {
  const byUrl = new Map();
  const add = (url, source) => {
    if (!url) return;
    const key = url.replace(/\/$/, '').toLowerCase();
    const previous = byUrl.get(key);
    byUrl.set(key, previous ? { ...previous, sources: [...previous.sources, source] } : { url, sources: [source] });
  };
  add(entreprise.site_web_google, 'Google Places');
  add(entreprise.site_web_brave, 'Brave Search');
  add(entreprise.site_web_dropcontact, 'Dropcontact');
  add(entreprise.site_web, entreprise.site_source || 'Site retenu');
  return [...byUrl.values()];
}

export default function DetailPanel({ entreprise, onClose, onUpdateEntreprise }) {
  const [resolvingPlace, setResolvingPlace] = useState(false);
  const [placeError, setPlaceError] = useState(null);

  // Fermer avec Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!entreprise) return null;

  const e = entreprise;
  const sites = sitesEntreprise(e);

  function copyEmail() {
    if (e.email) navigator.clipboard.writeText(e.email).catch(() => {});
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  async function handleResolveGooglePlace() {
    setResolvingPlace(true);
    setPlaceError(null);
    try {
      const result = await resolveGooglePlace({
        nom: e.nom_entreprise,
        enseigne: e.enseigne_etablissement,
        adresse: e.adresse_etablissement || e.adresse_legale || e.adresse,
        code_postal: e.code_postal_etablissement || e.code_postal_legal || e.code_postal,
        ville: e.ville_etablissement || e.ville_legale || e.ville,
        latitude: e.latitude_etablissement,
        longitude: e.longitude_etablissement,
      });
      onUpdateEntreprise?.(e.siren, {
        places_result: result,
        place_id: result.place_id,
        place_score: result.score ?? result.candidats?.[0]?.score ?? null,
        place_date_controle: result.date_controle || new Date().toISOString(),
        nom_google: result.nom_google || '',
        adresse_google: result.adresse_google || '',
        telephone_google: result.telephone_public || '',
        site_web_google: result.site_web || '',
        site_web: result.site_web || e.site_web,
        site_source: result.site_web ? 'Google Places' : e.site_source,
        statut_google: result.statut || '',
        place_score_initial: result.score ?? result.candidats?.[0]?.score ?? null,
        place_fiabilite: result.fiabilite || result.candidat_retenu?.fiabilite || null,
        place_match_confirme: Boolean(result.match_confirme),
        latitude_google: result.latitude ?? null,
        longitude_google: result.longitude ?? null,
      });
      if (!result.found) setPlaceError('Google n’a renvoyé aucun établissement exploitable. Les candidats sont conservés dans le cache.');
      else if (!result.match_confirme) setPlaceError('Proposition Google conservée : la correspondance avec Data.gouv est à vérifier.');
    } catch (err) {
      setPlaceError(err.message);
    } finally {
      setResolvingPlace(false);
    }
  }
  const scoreColor =
    e.score >= 70
      ? 'bg-green-100 text-green-700 border-green-200'
      : e.score >= 40
      ? 'bg-orange-100 text-orange-700 border-orange-200'
      : 'bg-red-100 text-red-700 border-red-200';

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panneau */}
      <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-200 bg-gray-50">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-lg font-bold text-gray-900 truncate">{e.nom_entreprise}</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">SIREN : {e.siren}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-7">

          {/* Email (si disponible, mis en avant) */}
          {(e.email || e.emailStatus) && (
            <div className={`rounded-xl p-4 border ${e.email ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Email de contact</p>
              {e.email ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-mono text-gray-800 break-all">{e.email}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {e.score !== null && e.score !== undefined && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${scoreColor}`}>
                          {e.score}%
                        </span>
                      )}
                      <button
                        onClick={copyEmail}
                        className="px-3 py-1.5 bg-white border border-green-300 text-green-700 hover:bg-green-50 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copier
                      </button>
                    </div>
                  </div>
                  {e.telephone && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-mono text-gray-700">{e.telephone}</span>
                      <button
                        onClick={() => copyText(e.telephone)}
                        className="px-3 py-1.5 bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copier
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">
                  {e.emailStatus === 'not_found' ? 'Email non trouvé via Dropcontact' : 'Site web non disponible'}
                </p>
              )}
            </div>
          )}

          {/* Informations générales */}
          <Section title="Informations générales">
            <Field label="Siège légal" value={e.adresse_legale || e.adresse || [e.code_postal_legal || e.code_postal, e.ville_legale || e.ville].filter(Boolean).join(' ')} />
            <Field label="Établissement Data.gouv" value={e.adresse_etablissement || ''} />
            <Field label="SIRET établissement" value={e.siret_etablissement || ''} />
            <Field label="Date de création" value={e.date_creation ? new Date(e.date_creation).toLocaleDateString('fr-FR') : ''} />
            <Field label="Forme juridique" value={e.nature_juridique} />
            <Field label="Secteur (NAF)" value={e.libelle_code_naf ? `${e.libelle_code_naf} (${e.code_naf})` : e.code_naf} />
            <Field label="Effectif" value={TAILLE_LABELS[e.tranche_effectif] || (e.tranche_effectif ? `Code ${e.tranche_effectif}` : '')} />
            <Field label="Établissements ouverts" value={e.nb_etablissements ? String(e.nb_etablissements) : ''} />
          </Section>

          <Section title="Établissement Google Places">
            {e.place_id ? (
              <>
                <Field label="Établissement" value={e.nom_google} />
                <Field label="Adresse confirmée" value={e.adresse_google} />
                <Field label="Téléphone public" value={e.telephone_google} />
                <Field label="Statut" value={e.statut_google} />
                <Field label="Fiabilité" value={e.place_score !== undefined ? `${e.place_score}/100` : ''} />
                <Field label="Correspondance" value={e.place_match_confirme ? 'Confirmée' : 'Proposition à vérifier'} />
                <Field label="Validation Brave" value={e.sites_comparaison === 'concordants' ? 'Site cohérent' : e.sites_comparaison === 'differents' ? 'Site différent' : ''} />
                <Field label="Contrôlé le" value={e.place_date_controle ? new Date(e.place_date_controle).toLocaleDateString('fr-FR') : ''} />
              </>
            ) : e.places_result ? (
              <div className="space-y-2 rounded-lg bg-gray-50 px-4 py-3">
                <Field label="Statut" value={e.statut_google || e.places_result.statut || e.places_result.raison || 'Non confirmé'} />
                <Field label="Fiabilité" value={e.place_score ?? e.places_result.score ?? e.places_result.candidat_retenu?.score ?? ''} />
                <Field label="Candidats conservés" value={String(e.places_result.candidats?.length || 0)} />
                <Field label="Contrôlé le" value={e.place_date_controle ? new Date(e.place_date_controle).toLocaleDateString('fr-FR') : ''} />
                <button
                  onClick={handleResolveGooglePlace}
                  disabled={resolvingPlace}
                  className="mt-1 text-sm text-blue-600 hover:underline disabled:text-gray-400"
                >
                  {resolvingPlace ? 'Vérification Google Places...' : 'Relancer la vérification'}
                </button>
                {placeError && <p className="text-xs text-red-500">{placeError}</p>}
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={handleResolveGooglePlace}
                  disabled={resolvingPlace}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-medium rounded-lg transition-colors w-full justify-center"
                >
                  {resolvingPlace ? 'Vérification Google Places...' : 'Vérifier l’établissement avec Google Places'}
                </button>
                {placeError && <p className="text-xs text-red-500 text-center">{placeError}</p>}
              </div>
            )}
          </Section>

          {/* Dirigeants */}
          {e.dirigeants && e.dirigeants.length > 0 && (
            <Section title={`Dirigeant${e.dirigeants.length > 1 ? 's' : ''} (${e.dirigeants.length})`}>
              <div className="space-y-3">
                {e.dirigeants.map((d, i) => (
                  <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-lg px-4 py-3">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                      {(d.prenoms?.[0] || d.nom?.[0] || '?').toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {[d.prenoms, d.nom].filter(Boolean).join(' ') || '—'}
                      </p>
                      {d.qualite && (
                        <p className="text-xs text-gray-500 mt-0.5">{d.qualite}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Sites web */}
          <Section title="Sites web">
            {sites.length > 0 ? sites.map((site) => (
              <div key={site.url} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-gray-400 mb-0.5">{site.sources.join(' + ')}</p>
                  <a
                    href={site.url.startsWith('http') ? site.url : `https://${site.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline break-all"
                  >
                    {site.url}
                  </a>
                </div>
                <button
                  onClick={() => copyText(site.url)}
                  className="ml-3 shrink-0 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
                  title="Copier l'URL"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 0116 0v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            )) : (
              <p className="text-sm text-gray-500">Google Places et Brave Search sont lancés automatiquement lors de l’enrichissement.</p>
            )}
          </Section>

          {/* Contact RH */}
          <Section title="Contact RH">
            {e.contact_rh ? (
              <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{e.contact_rh.nom}</p>
                    {e.contact_rh.poste && (
                      <p className="text-xs text-gray-500 mt-0.5">{e.contact_rh.poste}</p>
                    )}
                  </div>
                  {e.contact_rh.url_linkedin && (
                    <a
                      href={e.contact_rh.url_linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      LinkedIn
                    </a>
                  )}
                </div>
                {e.contact_rh.description && (
                  <p className="text-xs text-gray-400 line-clamp-2 mt-1">{e.contact_rh.description}</p>
                )}
                <Field label="Email Dropcontact" value={e.contact_rh_email} />
                <Field label="Téléphone Dropcontact" value={e.contact_rh_telephone} />
                <Field label="Mobile Dropcontact" value={e.contact_rh_telephone_mobile} />
              </div>
            ) : <p className="text-sm text-gray-500">La recherche de contact RH est lancée automatiquement pendant l’enrichissement.</p>}
          </Section>

          {/* Liens externes */}
          <Section title="Liens utiles">
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${e.siren}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Annuaire data.gouv.fr
              </a>
              <a
                href={`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(e.nom_entreprise)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600 rounded-lg transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                LinkedIn
              </a>
            </div>
          </Section>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </>
  );
}
