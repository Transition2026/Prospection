export default function StatusBanner({ status }) {
  if (!status || status.ok) return null;

  return (
    <div className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start gap-3">
      <svg className="w-5 h-5 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
      <div>
        <p className="font-semibold">Configuration incomplète</p>
        <p className="text-sm mt-0.5">{status.message}</p>
        <p className="text-sm mt-1">
          Renseignez les clés manquantes dans le fichier{' '}
          <code className="bg-red-100 px-1 rounded">backend/.env</code> puis redémarrez le serveur.
        </p>
      </div>
    </div>
  );
}
