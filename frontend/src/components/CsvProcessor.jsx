import { useState, useRef } from 'react';
import { composeEmail } from '../services/api';

const REQUIRED_COLUMNS = ['nom_entreprise', 'site_web', 'nom_dirigeant'];

// Parser CSV minimal : gère les champs entre guillemets, séparateurs "," ou ";"
function parseCsv(text) {
  const sample = text.split('\n').slice(0, 5).join('\n');
  const commaCount = (sample.match(/,/g) || []).length;
  const semiCount = (sample.match(/;/g) || []).length;
  const separator = semiCount > commaCount ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === separator) { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return { headers: [], data: [], separator };

  const headers = rows[0].map((h) => h.trim());
  const data = rows
    .slice(1)
    .filter((r) => r.some((c) => c && c.trim() !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
      return obj;
    });
  return { headers, data, separator };
}

function stringifyCsv(headers, rows, separator) {
  const escape = (s) => {
    const str = String(s ?? '');
    if (str.includes(separator) || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.map(escape).join(separator)];
  rows.forEach((row) => {
    lines.push(headers.map((h) => escape(row[h])).join(separator));
  });
  return lines.join('\n');
}

export default function CsvProcessor({ withRateLimitRetry }) {
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [separator, setSeparator] = useState(',');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [resultReady, setResultReady] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  function resetState() {
    setRows([]);
    setHeaders([]);
    setProcessing(false);
    setProgress({ current: 0, total: 0 });
    setResultReady(false);
    setError(null);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResultReady(false);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { headers: h, data, separator: sep } = parseCsv(ev.target.result);
        const missing = REQUIRED_COLUMNS.filter((r) => !h.includes(r));
        if (missing.length > 0) {
          setError(`Colonnes manquantes : ${missing.join(', ')}. Colonnes détectées : ${h.join(', ') || '(aucune)'}`);
          setHeaders([]);
          setRows([]);
          return;
        }
        if (data.length === 0) {
          setError('Le CSV ne contient aucune ligne de données.');
          return;
        }
        setHeaders(h);
        setRows(data);
        setSeparator(sep);
      } catch (err) {
        setError('Impossible de parser le CSV : ' + err.message);
      }
    };
    reader.onerror = () => setError('Erreur de lecture du fichier');
    reader.readAsText(file, 'UTF-8');
  }

  async function handleProcess() {
    if (processing || rows.length === 0) return;
    setProcessing(true);
    setError(null);
    setResultReady(false);
    setProgress({ current: 0, total: rows.length });

    const newRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const email = await withRateLimitRetry(
          () => composeEmail({
            nom_entreprise: row.nom_entreprise,
            site_web: row.site_web,
            nom_dirigeant: row.nom_dirigeant,
          }),
          'OpenAI'
        );
        newRows.push({ ...row, mail: email });
      } catch (err) {
        newRows.push({ ...row, mail: `[Erreur: ${err.message}]` });
      }
      setProgress({ current: i + 1, total: rows.length });
    }

    setRows(newRows);
    setResultReady(true);
    setProcessing(false);
  }

  function handleDownload() {
    const outHeaders = headers.includes('mail') ? headers : [...headers, 'mail'];
    const csv = stringifyCsv(outHeaders, rows, separator);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = fileName.replace(/\.csv$/i, '') || 'resultats';
    a.download = `${base}-emails.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <details className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <summary className="cursor-pointer text-base font-semibold text-gray-700 select-none">
        Traiter un CSV — générer des emails personnalisés
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-xs text-gray-500">
          Le CSV doit contenir les colonnes <code className="bg-gray-100 px-1 rounded">nom_entreprise</code>, <code className="bg-gray-100 px-1 rounded">site_web</code>, <code className="bg-gray-100 px-1 rounded">nom_dirigeant</code>. Une colonne <code className="bg-gray-100 px-1 rounded">mail</code> sera ajoutée. Le prompt est modifiable dans <code className="bg-gray-100 px-1 rounded">backend/prompts/email-prompt.txt</code>.
        </p>

        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            disabled={processing}
            className="text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:text-sm file:cursor-pointer hover:file:bg-blue-100"
          />
          {fileName && !processing && (
            <button
              onClick={resetState}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              réinitialiser
            </button>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        {rows.length > 0 && !processing && !resultReady && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              <strong>{rows.length}</strong> ligne{rows.length > 1 ? 's' : ''} prête{rows.length > 1 ? 's' : ''} à traiter
            </span>
            <button
              onClick={handleProcess}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              Générer les emails
            </button>
          </div>
        )}

        {processing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Traitement en cours…</span>
              <span><strong>{progress.current}</strong> / {progress.total} ({pct}%)</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-600 h-2 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {resultReady && (
          <div className="flex items-center gap-3 pt-2">
            <span className="text-sm text-green-700">
              ✓ {rows.length} email{rows.length > 1 ? 's' : ''} généré{rows.length > 1 ? 's' : ''}
            </span>
            <button
              onClick={handleDownload}
              className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
            >
              Télécharger le CSV
            </button>
            <button
              onClick={resetState}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              traiter un autre fichier
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
