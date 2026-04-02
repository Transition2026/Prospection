export default function ExportButton({ data, selected, onExported }) {
  function handleExport() {
    if (!data || data.length === 0) return;

    const toExport =
      selected && selected.size > 0
        ? data.filter((e) => selected.has(e.siren))
        : data;

    if (toExport.length === 0) return;

    const headers = [
      'nom_entreprise',
      'prenom_dirigeant',
      'nom_dirigeant',
      'qualite_dirigeant',
      'secteur',
      'code_postal',
      'ville',
      'site_web',
      'email',
      'score',
      'actu_titre',
      'actu_url',
      'actu_description',
      'actu_source',
      'actu_date',
    ];

    const rows = toExport.map((e) => [
      e.nom_entreprise || '',
      e.prenom_dirigeant || '',
      e.nom_dirigeant || '',
      e.qualite_dirigeant || '',
      e.libelle_code_naf || '',
      e.code_postal || '',
      e.ville || '',
      e.site_web || '',
      e.email || '',
      e.score !== null && e.score !== undefined ? e.score : '',
      e.actu?.titre || '',
      e.actu?.url || '',
      e.actu?.description || '',
      e.actu?.source || '',
      e.actu?.date || '',
    ]);

    // Séparateur ";" pour compatibilité Excel français
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `prospection_b2b_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    if (onExported) onExported(toExport);
  }

  const count = selected && selected.size > 0 ? selected.size : data?.length || 0;

  return (
    <button
      onClick={handleExport}
      disabled={!data || data.length === 0}
      className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
        />
      </svg>
      Exporter CSV{selected && selected.size > 0 ? ` (${count})` : ''}
    </button>
  );
}
