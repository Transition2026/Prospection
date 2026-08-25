import { useState } from 'react';

function probeText(probe) {
  if (!probe) return 'Non vérifié';
  if (probe.reachable) return `Joignable (HTTP ${probe.status || '—'})`;
  return probe.error?.code || probe.error?.message || 'Injoignable';
}

function downloadReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `diagnostic-prospection-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function DesktopDiagnostics() {
  const desktop = window.prospectionDesktop;
  const [report, setReport] = useState(null);
  const [checking, setChecking] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [message, setMessage] = useState(null);

  if (!desktop) return null;

  async function collect() {
    setChecking(true);
    setMessage(null);
    try {
      setReport(await desktop.getDiagnostics());
    } catch (error) {
      setMessage(error.message || 'Diagnostic impossible.');
    } finally {
      setChecking(false);
    }
  }

  async function restart() {
    setRestarting(true);
    setMessage(null);
    try {
      setReport(await desktop.restartBackend());
      setMessage('Le serveur local a été relancé et vérifié.');
    } catch (error) {
      setMessage(error.message || 'Le serveur local n’a pas pu être relancé.');
    } finally {
      setRestarting(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setMessage('Diagnostic copié. Tu peux le coller dans un message.');
    } catch {
      setMessage('Copie impossible : télécharge le fichier de diagnostic.');
    }
  }

  const backendUnavailable = report && !report.backend.reachable;
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-semibold text-amber-950">Diagnostic de connexion</h2>
          <p className="text-xs text-amber-900">Teste le serveur local, Google Places et Dropcontact sans envoyer de clé API.</p>
        </div>
        <button type="button" onClick={collect} disabled={checking || restarting} className="ml-auto rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60">
          {checking ? 'Vérification…' : 'Vérifier la connexion'}
        </button>
      </div>

      {report && (
        <div className="mt-4 space-y-3 border-t border-amber-200 pt-3 text-sm text-amber-950">
          <div className="grid gap-2 sm:grid-cols-3">
            <p><span className="font-medium">Serveur local :</span> {report.backend.reachable ? 'Opérationnel' : 'Indisponible'}</p>
            <p><span className="font-medium">Google Places :</span> {probeText(report.network.google_places)}</p>
            <p><span className="font-medium">Dropcontact :</span> {probeText(report.network.dropcontact)}</p>
          </div>
          {!report.backend.reachable && <p className="text-red-700">Le serveur local ne répond pas. L’application tente déjà de le relancer automatiquement ; tu peux aussi le relancer maintenant.</p>}
          {!report.network.google_places.reachable && !report.network.dropcontact.reachable && <p className="text-red-700">Les deux domaines externes sont injoignables : un VPN, proxy, pare-feu ou antivirus peut bloquer l’application.</p>}
          {!report.configuration.ready && <p className="text-red-700">La configuration locale est incomplète : renseigne les clés manquantes dans la section ci-dessus.</p>}
          <div className="flex flex-wrap gap-2">
            {backendUnavailable && <button type="button" onClick={restart} disabled={restarting || checking} className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60">{restarting ? 'Relance…' : 'Relancer le serveur local'}</button>}
            <button type="button" onClick={copy} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100">Copier le diagnostic</button>
            <button type="button" onClick={() => downloadReport(report)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100">Télécharger le diagnostic</button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-sm text-amber-950">{message}</p>}
    </section>
  );
}
