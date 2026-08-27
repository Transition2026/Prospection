import * as XLSX from 'xlsx';

function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename, { compression: true });
}

function timestampForFilename() {
  const date = new Date();
  const pad = (value) => `${value}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

// Respecte la convention demandée dans les exports : une seule majuscule au
// début et le nom de naissance entre parenthèses est écarté. Les noms des
// entreprises ne passent jamais par cette fonction.
export function formatNomPersonne(value) {
  const cleaned = cleanNomPersonne(value);
  if (!cleaned) return '';
  const lower = cleaned.toLocaleLowerCase('fr-FR');
  return lower.charAt(0).toLocaleUpperCase('fr-FR') + lower.slice(1);
}

function cleanNomPersonne(value) {
  return `${value ?? ''}`
    .replace(/\s*\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitContactName(value) {
  const parts = cleanNomPersonne(value).split(' ').filter(Boolean);
  return {
    prenom: formatNomPersonne(parts.shift()),
    nom: formatNomPersonne(parts.join(' ')),
  };
}

function contactEmail(value) {
  return `${value ?? ''}`.trim().toLocaleLowerCase('fr-FR');
}

// Chaque e-mail nominatif devient une ligne indépendante. Ainsi, le dirigeant
// et le RH d'une même entreprise ne sont plus écrasés dans une seule fiche.
export function buildOdooContactRows(companies) {
  const seen = new Set();
  return companies.flatMap((company) => {
    const leaderEmail = company.leader_email
      || (company.contact_email_source === 'Dirigeant + Dropcontact' ? company.email : '');
    const rh = splitContactName(company.contact_rh?.nom);
    const candidates = [
      {
        prenom: formatNomPersonne(company.prenom_dirigeant),
        nom: formatNomPersonne(company.nom_dirigeant),
        fonction: company.qualite_dirigeant || '',
        email: leaderEmail,
      },
      {
        prenom: rh.prenom,
        nom: rh.nom,
        fonction: company.contact_rh?.poste || '',
        email: company.contact_rh_email,
      },
    ];

    // Sans contact nominatif, un e-mail d'organisation reste exportable, mais
    // il ne reçoit pas artificiellement le nom de l'entreprise comme patronyme.
    if (!leaderEmail && !company.contact_rh_email && company.email) {
      candidates.push({ prenom: '', nom: '', fonction: '', email: company.email });
    }

    return candidates.flatMap((contact) => {
      const email = contactEmail(contact.email);
      if (!email) return [];
      const dedupeKey = `${company.siren || company.nom_entreprise || ''}|${email}`;
      if (seen.has(dedupeKey)) return [];
      seen.add(dedupeKey);
      return [{
        Entreprise: company.nom_entreprise || '',
        Prénom: contact.prenom,
        Nom: contact.nom,
        Fonction: contact.fonction,
        Email: email,
      }];
    });
  });
}

export function exportContactsOdooXlsx(companies) {
  const rows = buildOdooContactRows(companies);
  if (!rows.length) return 0;
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = Object.keys(rows[0]).map((header) => ({ wch: Math.min(Math.max(header.length + 2, 14), 34) }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Contacts');
  downloadWorkbook(workbook, `mailing_contact_import_${timestampForFilename()}.xlsx`);
  return rows.length;
}

export function exportInterestedXlsx(companies) {
  return exportContactsOdooXlsx(companies);
}

export function exportCacheXlsx(companies, mode = 'all') {
  const rows = companies.map((company) => ({
    SIREN: company.siren || '',
    Entreprise: company.nom_entreprise || '',
    Statut_prospection: company.prospection_status || 'unspecified',
    Raison_prospection: company.prospection_reason || '',
    Traitee_le: company.processed_at || company.prospection_updated_at || '',
    Enrichie_le: company.enriched_at || '',
    Exportee_le: company.exported_at || '',
    Code_NAF: company.code_naf || '',
    Tranche_effectif: company.tranche_effectif || '',
    Nombre_etablissements: company.nb_etablissements ?? '',
    Siege_legal: company.adresse_legale || company.adresse || '',
    CP_siege: company.code_postal_legal || company.code_postal || '',
    Ville_siege: company.ville_legale || company.ville || '',
    Etablissement_Data_gouv: company.adresse_etablissement || '',
    CP_etablissement: company.code_postal_etablissement || '',
    Ville_etablissement: company.ville_etablissement || '',
    Site_web: company.site_web || '',
    Site_web_Google: company.site_web_google || '',
    Site_web_Brave: company.site_web_brave || '',
    Statut_Google: company.statut_google || '',
    Score_Google_Places: company.place_score ?? company.places_result?.score ?? '',
    Prenom_dirigeant: formatNomPersonne(company.prenom_dirigeant),
    Nom_dirigeant: formatNomPersonne(company.nom_dirigeant),
    Qualite_dirigeant: company.qualite_dirigeant || '',
    Contact_RH: formatNomPersonne(company.contact_rh?.nom),
    Poste_RH: company.contact_rh?.poste || '',
    Email_dirigeant_Dropcontact: company.leader_email || '',
    Email_RH_Dropcontact: company.contact_rh_email || '',
    Email_principal: company.email || '',
    Source_email: company.contact_email_source || '',
    Telephone: company.telephone || company.leader_telephone || company.contact_rh_telephone || '',
  }));
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = Object.keys(rows[0] || {}).map((header) => ({ wch: Math.min(Math.max(header.length + 2, 14), 34) }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'Cache');
  downloadWorkbook(workbook, `cache_prospection_${mode}_${timestampForFilename()}.xlsx`);
}
