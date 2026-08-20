import { useEffect, useState } from 'react';

const FIELDS = [
  ['DROPCONTACT_API_KEY', 'Clé Dropcontact', true],
  ['BRAVE_API_KEY', 'Clé Brave Search', true],
  ['GOOGLE_PLACES_API_KEY', 'Clé Google Places', true],
  ['GPT_API_KEY', 'Clé OpenAI (optionnelle)', false],
  ['DATABASE_URL', 'URL base de données (optionnelle)', false],
  ['DIRECT_URL', 'URL directe base de données (optionnelle)', false],
];

export default function DesktopSettings({ onSaved }) {
  const desktop = window.prospectionDesktop;
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!desktop) return;
    desktop.getConfigStatus().then((next) => {
      setStatus(next);
      setOpen(!next.ready);
    }).catch((err) => setError(err.message));
  }, [desktop]);

  if (!desktop) return null;

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await desktop.saveConfig(values);
      setStatus(next);
      setValues({});
      setMessage('Configuration chiffrée enregistrée et backend redémarré.');
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  }

  const configuredCount = FIELDS.filter(([key]) => status?.configured?.[key]).length;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">Configuration sécurisée</h2>
          <p className="text-xs text-gray-500">{status ? `${configuredCount}/${FIELDS.length} valeurs enregistrées dans le coffre-fort Windows.` : 'Vérification du coffre-fort Windows…'}</p>
        </div>
        <button type="button" onClick={() => setOpen((previous) => !previous)} className="ml-auto px-4 py-2 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 text-sm font-medium">
          {open ? 'Fermer' : 'Configurer les clés'}
        </button>
      </div>
      {open && (
        <form onSubmit={save} className="mt-4 border-t border-gray-100 pt-4 space-y-3">
          <p className="text-sm text-gray-600">Les valeurs déjà enregistrées ne sont jamais réaffichées. Laisse un champ vide pour conserver sa valeur actuelle.</p>
          {!status?.available && <p className="text-sm text-red-600">Le chiffrement système Windows est indisponible : aucune clé ne sera enregistrée.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {FIELDS.map(([key, label, required]) => (
              <label key={key} className="text-sm text-gray-600">
                {label}{required ? ' *' : ''}
                <input type="password" autoComplete="off" value={values[key] || ''} onChange={(event) => setValues((previous) => ({ ...previous, [key]: event.target.value }))} placeholder={status?.configured?.[key] ? 'Déjà enregistrée' : 'À renseigner'} className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
            ))}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-700">{message}</p>}
          <button type="submit" disabled={saving || !status?.available} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-200 text-white font-semibold text-sm">
            {saving ? 'Enregistrement…' : 'Enregistrer et appliquer'}
          </button>
        </form>
      )}
    </section>
  );
}
