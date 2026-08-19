import CompanyCard from './CompanyCard';

export default function CompanyCards({ companies, onDecision, onOpen, selectable, selected, onToggleSelect }) {
  if (!companies.length) return <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center text-gray-400">Aucune entreprise dans cette boîte.</div>;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {companies.map((company) => (
        <CompanyCard key={company.siren} company={company} onDecision={onDecision} onOpen={onOpen} selectable={selectable} selected={selected?.has(company.siren)} onToggleSelect={onToggleSelect} />
      ))}
    </div>
  );
}
