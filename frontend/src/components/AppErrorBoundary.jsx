import React from 'react';

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Les détails restent dans la console de diagnostic, sans être exposés à
    // l'utilisateur ni interrompre l'accès au bouton de rechargement.
    console.error('Erreur de rendu Prospection B2B', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="min-h-screen bg-gray-50 px-6 py-12">
        <section className="mx-auto max-w-xl rounded-2xl border border-red-300 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-gray-900">L’application a rencontré une erreur</h1>
          <p className="mt-2 text-sm text-gray-600">Vos données enregistrées ne sont pas supprimées. Rechargez l’application pour reprendre.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Recharger l’application</button>
        </section>
      </main>
    );
  }
}
