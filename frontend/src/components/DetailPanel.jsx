import { useEffect, useState } from 'react';
import { findWebsiteWithClaude, findRHContact } from '../services/api';

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

export default function DetailPanel({ entreprise, onClose, onUpdateEntreprise }) {
  const [findingWebsite, setFindingWebsite] = useState(false);
  const [websiteError, setWebsiteError] = useState(null);
  const [findingRH, setFindingRH] = useState(false);
  const [rhError, setRhError] = useState(null);

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

  function copyEmail() {
    if (e.email) navigator.clipboard.writeText(e.email).catch(() => {});
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  async function handleFindWebsite() {
    setFindingWebsite(true);
    setWebsiteError(null);
    try {
      const result = await findWebsiteWithClaude({
        nom: e.nom_entreprise,
        ville: e.ville,
        siren: e.siren,
      });
      if (result.found && onUpdateEntreprise) {
        onUpdateEntreprise(e.siren, { site_web: result.site_web });
      } else if (!result.found) {
        setWebsiteError('Site web introuvable');
      }
    } catch (err) {
      setWebsiteError(err.message);
    } finally {
      setFindingWebsite(false);
    }
  }


  async function handleFindRH() {
    setFindingRH(true);
    setRhError(null);
    try {
      const result = await findRHContact({ nom: e.nom_entreprise, ville: e.ville });
      if (result.found && onUpdateEntreprise) {
        onUpdateEntreprise(e.siren, { contact_rh: result.contact_rh });
      } else if (!result.found) {
        setRhError('Aucun contact RH trouvé');
      }
    } catch (err) {
      setRhError(err.message);
    } finally {
      setFindingRH(false);
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
                  {e.emailStatus === 'not_found' ? 'Email non trouvé via Hunter' : 'Site web non disponible'}
                </p>
              )}
            </div>
          )}

          {/* Informations générales */}
          <Section title="Informations générales">
            <Field label="Siège social" value={e.adresse || [e.code_postal, e.ville].filter(Boolean).join(' ')} />
            <Field label="Code postal" value={e.code_postal} />
            <Field label="Ville" value={e.ville} />
            <Field label="Date de création" value={e.date_creation ? new Date(e.date_creation).toLocaleDateString('fr-FR') : ''} />
            <Field label="Forme juridique" value={e.nature_juridique} />
            <Field label="Secteur (NAF)" value={e.libelle_code_naf ? `${e.libelle_code_naf} (${e.code_naf})` : e.code_naf} />
            <Field label="Effectif" value={TAILLE_LABELS[e.tranche_effectif] || (e.tranche_effectif ? `Code ${e.tranche_effectif}` : '')} />
            <Field label="Établissements ouverts" value={e.nb_etablissements ? String(e.nb_etablissements) : ''} />
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

          {/* Site web */}
          <Section title="Site web">
            {e.site_web ? (
              <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                <a
                  href={e.site_web.startsWith('http') ? e.site_web : `https://${e.site_web}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline break-all"
                >
                  {e.site_web}
                </a>
                <button
                  onClick={() => copyText(e.site_web)}
                  className="ml-3 shrink-0 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
                  title="Copier l'URL"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={handleFindWebsite}
                  disabled={findingWebsite}
                  className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-medium rounded-lg transition-colors w-full justify-center"
                >
                  {findingWebsite ? (
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
                      Trouver avec Brave Search
                    </>
                  )}
                </button>
                {websiteError && (
                  <p className="text-xs text-red-500 text-center">{websiteError}</p>
                )}
              </div>
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
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={handleFindRH}
                  disabled={findingRH}
                  className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white text-sm font-medium rounded-lg transition-colors w-full justify-center"
                >
                  {findingRH ? (
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
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Chercher un contact RH
                    </>
                  )}
                </button>
                {rhError && (
                  <p className="text-xs text-red-500 text-center">{rhError}</p>
                )}
              </div>
            )}
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
