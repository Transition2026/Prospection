import * as XLSX from 'xlsx';

function downloadWorkbook(workbook, filename) {
  XLSX.writeFile(workbook, filename, { compression: true });
}

function timestampForFilename() {
  const date = new Date();
  const pad = (value) => `${value}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function googleCandidates(company) {
  return company.places_result?.candidats || [];
}

export function exportInterestedXlsx(companies) {
  const rows = companies.map((company) => {
    const googleScore = company.place_score ?? company.places_result?.score ?? company.places_result?.candidat_retenu?.score ?? '';
    return {
      SIREN: company.siren || '',
      Entreprise: company.nom_entreprise || '',
      Statut_prospection: company.prospection_status || 'interessee',
      Prenom_dirigeant: company.prenom_dirigeant || '',
      Nom_dirigeant: company.nom_dirigeant || '',
      Qualite_dirigeant: company.qualite_dirigeant || '',
      Siege_legal: company.adresse_legale || company.adresse || '',
      CP_siege: company.code_postal_legal || company.code_postal || '',
      Ville_siege: company.ville_legale || company.ville || '',
      Etablissement_Data_gouv: company.adresse_etablissement || '',
      CP_etablissement: company.code_postal_etablissement || '',
      Ville_etablissement: company.ville_etablissement || '',
      SIRET_etablissement: company.siret_etablissement || '',
      Secteur_NAF: company.libelle_code_naf || '',
      Code_NAF: company.code_naf || '',
      Tranche_effectif: company.tranche_effectif || '',
      Nombre_etablissements: company.nb_etablissements ?? '',
      Google_trouve: company.places_result?.found ? 'Oui' : 'Non',
      Score_Google_Places: googleScore,
      Fiabilite_Google_Places: googleScore === '' ? '' : googleScore / 100,
      Score_Google_initial: company.place_score_initial ?? company.places_result?.score ?? '',
      Correspondance_Google: company.place_match_confirme ? 'Confirmée' : company.places_result?.found ? 'Proposition à vérifier' : 'Aucune',
      Score_nom_Google: company.place_fiabilite?.nom ?? '',
      Score_adresse_Google: company.place_fiabilite?.adresse ?? '',
      Score_CP_Google: company.place_fiabilite?.code_postal ?? '',
      Score_ville_Google: company.place_fiabilite?.ville ?? '',
      Score_distance_Google: company.place_fiabilite?.proximite ?? '',
      Statut_Google: company.statut_google || company.places_result?.raison || '',
      Adresse_Google: company.adresse_google || '',
      Telephone_Google: company.telephone_google || '',
      Date_controle_Google: company.place_date_controle || '',
      Site_web: company.site_web || '',
      Source_site: company.site_source || '',
      Site_web_Google: company.site_web_google || '',
      Site_web_Brave: company.site_web_brave || '',
      Comparaison_sites: company.sites_comparaison || '',
      Contact_RH: company.contact_rh?.nom || '',
      Poste_RH: company.contact_rh?.poste || '',
      LinkedIn_RH: company.contact_rh?.url_linkedin || '',
      Email_dirigeant_Dropcontact: company.leader_email || (company.contact_email_source === 'Dirigeant + Dropcontact' ? company.email || '' : ''),
      Telephone_dirigeant_Dropcontact: company.leader_telephone || (company.contact_email_source === 'Dirigeant + Dropcontact' ? company.telephone || '' : ''),
      Mobile_dirigeant_Dropcontact: company.leader_telephone_mobile || '',
      Email_RH_Dropcontact: company.contact_rh_email || '',
      Telephone_RH_Dropcontact: company.contact_rh_telephone || '',
      Mobile_RH_Dropcontact: company.contact_rh_telephone_mobile || '',
      Email: company.email || '',
      Source_email: company.contact_email_source || '',
      Score_Dropcontact: company.score ?? '',
      Telephone_Dropcontact: company.telephone || '',
      Remontees_dirigeant: company.dirigeant_remontees ?? '',
    };
  });

  const candidateRows = companies.flatMap((company) => {
    const candidates = googleCandidates(company);
    if (candidates.length === 0) {
      return [{
        SIREN: company.siren || '',
        Entreprise: company.nom_entreprise || '',
        Google_trouve: company.places_result?.found ? 'Oui' : 'Non',
        Raison: company.places_result?.raison || 'aucun_candidat',
        Rang: '',
        Fiabilite: '',
        Nom_Google: '',
        Adresse_Google: '',
        Statut_Google: '',
        Place_ID: '',
        Distance_km: '',
      }];
    }
    return candidates.map((candidate, index) => ({
      SIREN: company.siren || '',
      Entreprise: company.nom_entreprise || '',
      Google_trouve: company.places_result?.found ? 'Oui' : 'Non',
      Raison: company.places_result?.raison || '',
      Rang: index + 1,
      Fiabilite: candidate.score ?? '',
      Score_nom: candidate.fiabilite?.nom ?? '',
      Score_adresse: candidate.fiabilite?.adresse ?? '',
      Score_CP: candidate.fiabilite?.code_postal ?? '',
      Score_ville: candidate.fiabilite?.ville ?? '',
      Score_distance: candidate.fiabilite?.proximite ?? '',
      Nom_Google: candidate.nom || '',
      Adresse_Google: candidate.adresse || '',
      Statut_Google: candidate.statut || '',
      Place_ID: candidate.place_id || '',
      Distance_km: candidate.distance_km ?? '',
    }));
  });

  const workbook = XLSX.utils.book_new();
  const mainSheet = XLSX.utils.json_to_sheet(rows);
  const googleSheet = XLSX.utils.json_to_sheet(candidateRows);
  mainSheet['!cols'] = Object.keys(rows[0] || {}).map((header) => ({ wch: Math.min(Math.max(header.length + 2, 14), 34) }));
  googleSheet['!cols'] = Object.keys(candidateRows[0] || {}).map((header) => ({ wch: Math.min(Math.max(header.length + 2, 14), 34) }));
  XLSX.utils.book_append_sheet(workbook, mainSheet, 'Interessées');
  XLSX.utils.book_append_sheet(workbook, googleSheet, 'Google Places');
  downloadWorkbook(workbook, `prospection_interessees_${timestampForFilename()}.xlsx`);
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
    Prenom_dirigeant: company.prenom_dirigeant || '',
    Nom_dirigeant: company.nom_dirigeant || '',
    Qualite_dirigeant: company.qualite_dirigeant || '',
    Contact_RH: company.contact_rh?.nom || '',
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
