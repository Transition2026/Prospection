import test from 'node:test';
import assert from 'node:assert/strict';
import { isFixableCacheCompany, processedCompanyPatch } from '../src/services/prospectionProcessing.mjs';

const NOW = '2026-09-17T10:00:00.000Z';

test('une enrichie sans e-mail devient traitée sans être déclarée exportée', () => {
  const company = { siren: '123456789', prospection_status: 'interested', enriched_at: NOW };
  const patch = processedCompanyPatch(company, {
    now: NOW,
    reason: (_company, exported) => exported ? 'Export XLSX' : 'Export Odoo — aucun e-mail exportable',
  });

  assert.deepEqual(patch, {
    prospection_status: 'processed',
    prospection_reason: 'Export Odoo — aucun e-mail exportable',
    prospection_updated_at: NOW,
    processed_at: NOW,
  });
});

test('une fiche avec contact exporté conserve la trace de son export', () => {
  const company = { siren: '123456789', prospection_status: 'interested', enriched_at: NOW, email: 'contact@example.test' };
  const patch = processedCompanyPatch(company, {
    now: NOW,
    reason: 'Export XLSX',
    marksAsExported: (candidate) => Boolean(candidate.email),
  });

  assert.equal(patch.exported_at, NOW);
  assert.equal(patch.exported_from_status, 'interested');
  assert.equal(patch.prospection_status, 'processed');
});

test('Fix cache cible seulement les enrichies non traitées et les pas intéressées', () => {
  assert.equal(isFixableCacheCompany({ prospection_status: 'interested', enriched_at: NOW }), true);
  assert.equal(isFixableCacheCompany({ prospection_status: 'not_interested' }), true);
  assert.equal(isFixableCacheCompany({ prospection_status: 'processed', enriched_at: NOW }), false);
  assert.equal(isFixableCacheCompany({ prospection_status: 'unspecified' }), false);
});
