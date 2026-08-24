import * as XLSX from 'xlsx';

function asText(value) {
  return `${value ?? ''}`.trim();
}

function normalizedLabel(value) {
  return asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/[^a-z0-9]/g, '');
}

function normalizedSiren(value) {
  const digits = asText(value).replace(/\D/g, '');
  if (!digits || digits.length > 9) return '';
  return digits.padStart(9, '0');
}

function cell(row, ...labels) {
  const entries = Object.entries(row || {});
  for (const label of labels) {
    const match = entries.find(([header]) => normalizedLabel(header) === normalizedLabel(label));
    if (match) return asText(match[1]);
  }
  return '';
}

function numberCell(row, ...labels) {
  const value = cell(row, ...labels).replace(',', '.');
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function compact(values) {
  return Object.fromEntries(Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .filter(([, value]) => !Array.isArray(value) || value.length > 0)
    .filter(([, value]) => Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length > 0));
}

function prospectionStatus(value) {
  const status = normalizedLabel(value);
  if (['interested', 'interessee'].includes(status)) return 'interested';
  if (['notinterested', 'pasinteressee'].includes(status)) return 'not_interested';
  if (['processed', 'traite', 'exported'].includes(status)) return 'processed';
  if (['unspecified', 'atraiter'].includes(status)) return 'unspecified';
  return undefined;
}

function googleFound(value) {
  const normalized = normalizedLabel(value);
  if (['oui', 'yes', 'true'].includes(normalized)) return true;
  if (['non', 'no', 'false'].includes(normalized)) return false;
  return undefined;
}

function googleCandidates(rows = []) {
  const bySiren = new Map();
  rows.forEach((row) => {
    const siren = normalizedSiren(cell(row, 'SIREN'));
    if (!siren) return;
    const candidate = compact({
      score: numberCell(row, 'Fiabilite'),
      fiabilite: compact({
        nom: numberCell(row, 'Score_nom'),
        adresse: numberCell(row, 'Score_adresse'),
        code_postal: numberCell(row, 'Score_CP'),
        ville: numberCell(row, 'Score_ville'),
        proximite: numberCell(row, 'Score_distance'),
      }),
      nom: cell(row, 'Nom_Google'),
      adresse: cell(row, 'Adresse_Google'),
      statut: cell(row, 'Statut_Google'),
      place_id: cell(row, 'Place_ID'),
      distance_km: numberCell(row, 'Distance_km'),
    });
    if (Object.keys(candidate).length) {
      bySiren.set(siren, [...(bySiren.get(siren) || []), candidate]);
    }
  });
  return bySiren;
}

function companyRecordFromRow(row, candidatesBySiren, updatedAt) {
  const siren = normalizedSiren(cell(row, 'SIREN'));
  if (!siren) return null;

  const cpSiege = cell(row, 'CP_siege');
  const villeSiege = cell(row, 'Ville_siege');
  const adresseSiege = cell(row, 'Siege_legal');
  const cpEtablissement = cell(row, 'CP_etablissement');
  const villeEtablissement = cell(row, 'Ville_etablissement');
  const adresseEtablissement = cell(row, 'Etablissement_Data_gouv');
  const rhName = cell(row, 'Contact_RH');
  const rhPosition = cell(row, 'Poste_RH');
  const rhLinkedin = cell(row, 'LinkedIn_RH');
  const status = prospectionStatus(cell(row, 'Statut_prospection'));
  const placeScore = numberCell(row, 'Score_Google_Places');
  const initialPlaceScore = numberCell(row, 'Score_Google_initial');
  const placeStatus = cell(row, 'Statut_Google');
  const found = googleFound(cell(row, 'Google_trouve'));
  const candidates = candidatesBySiren.get(siren) || [];
  const hasGoogleData = found !== undefined || placeScore !== undefined || initialPlaceScore !== undefined || Boolean(placeStatus) || candidates.length > 0;
  const email = cell(row, 'Email_principal', 'Email');
  const leaderEmail = cell(row, 'Email_dirigeant_Dropcontact');
  const rhEmail = cell(row, 'Email_RH_Dropcontact');

  const base = compact({
    siren,
    nom_entreprise: cell(row, 'Entreprise'),
    code_naf: cell(row, 'Code_NAF'),
    tranche_effectif: cell(row, 'Tranche_effectif'),
    nb_etablissements: numberCell(row, 'Nombre_etablissements'),
    adresse_legale: adresseSiege,
    code_postal_legal: cpSiege,
    ville_legale: villeSiege,
    adresse: adresseSiege,
    code_postal: cpSiege,
    ville: villeSiege,
    adresse_etablissement: adresseEtablissement,
    code_postal_etablissement: cpEtablissement,
    ville_etablissement: villeEtablissement,
    siret_etablissement: cell(row, 'SIRET_etablissement'),
    libelle_code_naf: cell(row, 'Secteur_NAF'),
    site_web: cell(row, 'Site_web'),
  });

  const data = compact({
    prospection_status: status,
    prospection_reason: cell(row, 'Raison_prospection'),
    processed_at: cell(row, 'Traitee_le'),
    prospection_updated_at: cell(row, 'Traitee_le'),
    enriched_at: cell(row, 'Enrichie_le'),
    exported_at: cell(row, 'Exportee_le'),
    prenom_dirigeant: cell(row, 'Prenom_dirigeant'),
    nom_dirigeant: cell(row, 'Nom_dirigeant'),
    qualite_dirigeant: cell(row, 'Qualite_dirigeant'),
    site_web_google: cell(row, 'Site_web_Google'),
    site_web_brave: cell(row, 'Site_web_Brave'),
    site_source: cell(row, 'Source_site'),
    sites_comparaison: cell(row, 'Comparaison_sites'),
    statut_google: placeStatus,
    place_score: placeScore,
    place_score_initial: initialPlaceScore,
    place_match_confirme: normalizedLabel(cell(row, 'Correspondance_Google')) === 'confirmee' ? true : undefined,
    place_fiabilite: compact({
      nom: numberCell(row, 'Score_nom_Google'),
      adresse: numberCell(row, 'Score_adresse_Google'),
      code_postal: numberCell(row, 'Score_CP_Google'),
      ville: numberCell(row, 'Score_ville_Google'),
      proximite: numberCell(row, 'Score_distance_Google'),
    }),
    adresse_google: cell(row, 'Adresse_Google'),
    telephone_google: cell(row, 'Telephone_Google'),
    place_date_controle: cell(row, 'Date_controle_Google'),
    contact_rh: (rhName || rhPosition || rhLinkedin) ? compact({ nom: rhName, poste: rhPosition, url_linkedin: rhLinkedin }) : undefined,
    leader_email: leaderEmail,
    leader_emailStatus: leaderEmail ? 'found' : undefined,
    leader_telephone: cell(row, 'Telephone_dirigeant_Dropcontact'),
    leader_telephone_mobile: cell(row, 'Mobile_dirigeant_Dropcontact'),
    contact_rh_email: rhEmail,
    contact_rh_emailStatus: rhEmail ? 'found' : undefined,
    contact_rh_telephone: cell(row, 'Telephone_RH_Dropcontact'),
    contact_rh_telephone_mobile: cell(row, 'Mobile_RH_Dropcontact'),
    contact_rh_score: numberCell(row, 'Score_Dropcontact'),
    email,
    emailStatus: email ? 'found' : undefined,
    contact_email_source: cell(row, 'Source_email'),
    score: numberCell(row, 'Score_Dropcontact'),
    telephone: cell(row, 'Telephone_Dropcontact', 'Telephone'),
    dirigeant_remontees: cell(row, 'Remontees_dirigeant'),
    places_result: hasGoogleData ? compact({
      found,
      score: placeScore ?? initialPlaceScore,
      statut: placeStatus,
      raison: placeStatus,
      candidats: candidates,
      candidat_retenu: candidates[0],
      fiabilite: compact({
        nom: numberCell(row, 'Score_nom_Google'),
        adresse: numberCell(row, 'Score_adresse_Google'),
        code_postal: numberCell(row, 'Score_CP_Google'),
        ville: numberCell(row, 'Score_ville_Google'),
        proximite: numberCell(row, 'Score_distance_Google'),
      }),
      date_controle: cell(row, 'Date_controle_Google'),
    }) : undefined,
  });

  return { siren, base, data, updated_at: updatedAt };
}

function sheetRows(workbook, name) {
  const sheet = workbook.Sheets[name];
  return sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, blankrows: false }) : [];
}

function mainSheetName(workbook) {
  const namedSheet = workbook.SheetNames.find((name) => ['cache', 'interessees'].includes(normalizedLabel(name)));
  if (namedSheet) return namedSheet;
  return workbook.SheetNames.find((name) => sheetRows(workbook, name).some((row) => cell(row, 'SIREN'))) || '';
}

export function cachePayloadFromXlsxRows(rows, candidateRows = [], updatedAt = new Date().toISOString()) {
  const candidatesBySiren = googleCandidates(candidateRows);
  const seen = new Set();
  const companies = rows.flatMap((row) => {
    const record = companyRecordFromRow(row, candidatesBySiren, updatedAt);
    if (!record || seen.has(record.siren)) return [];
    seen.add(record.siren);
    return [record];
  });
  if (!companies.length) throw new Error('Aucun SIREN valide n’a été trouvé dans le classeur.');
  return {
    version: 3,
    exported_at: updatedAt,
    companies,
    searches: [],
    pages: [],
  };
}

export async function readCacheImportFile(file) {
  const filename = asText(file?.name).toLocaleLowerCase('fr-FR');
  if (filename.endsWith('.json') || file?.type === 'application/json') {
    return { format: 'JSON', payload: JSON.parse(await file.text()) };
  }
  if (!/\.(xlsx|xls)$/.test(filename)) {
    throw new Error('Choisissez un fichier de cache JSON ou XLSX.');
  }

  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const mainName = mainSheetName(workbook);
  if (!mainName) throw new Error('Le classeur ne contient pas de feuille avec une colonne SIREN.');
  const candidateName = workbook.SheetNames.find((name) => normalizedLabel(name) === 'googleplaces');
  const rows = sheetRows(workbook, mainName);
  const payload = cachePayloadFromXlsxRows(rows, candidateName ? sheetRows(workbook, candidateName) : []);
  return { format: 'XLSX', payload };
}
