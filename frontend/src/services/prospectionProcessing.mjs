export function isFixableCacheCompany(company = {}) {
  return company.prospection_status === 'not_interested'
    || (Boolean(company.enriched_at) && company.prospection_status !== 'processed');
}

export function processedCompanyPatch(company = {}, {
  now,
  reason,
  marksAsExported = () => false,
} = {}) {
  const exported = Boolean(marksAsExported(company));
  return {
    prospection_status: 'processed',
    prospection_reason: typeof reason === 'function' ? reason(company, exported) : reason,
    prospection_updated_at: now,
    processed_at: now,
    ...(exported ? {
      exported_at: now,
      exported_from_status: company.prospection_status,
    } : {}),
  };
}
