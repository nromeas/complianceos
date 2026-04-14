// Netlify Function — Lookup SIREN via Pappers API (INPI officiel)
// Gratuit jusqu'à 1000 req/mois
// Retourne : raison_sociale, forme, capital, effectif, dirigeants, BE, TVA, code NAF

exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const siren = (event.queryStringParameters || {}).siren || "";
  const clean = siren.replace(/\s/g, "").replace(/-/g, "");

  if (!clean || clean.length < 9) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ error: "SIREN invalide (9 chiffres requis)" })
    };
  }

  const PAPPERS_KEY = process.env.PAPPERS_API_KEY;

  // Sans clé Pappers → appel INSEE (gratuit, pas de clé)
  if (!PAPPERS_KEY) {
    try {
      const res = await fetch(
        `https://api.insee.fr/entreprises/sirene/V3.11/siren/${clean}`,
        { headers: { "Accept": "application/json" } }
      );
      if (res.ok) {
        const data = await res.json();
        const u = data.uniteLegale || {};
        const p = u.periodesUniteLegale?.[0] || {};
        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            source: "INSEE",
            siren: clean,
            raison_sociale: p.denominationUniteLegale || p.nomUniteLegale || "",
            forme: p.categorieJuridiqueUniteLegale || "",
            activite: p.activitePrincipaleUniteLegale || "",
            effectif: p.trancheEffectifsUniteLegale || "",
            date_creation: u.dateCreationUniteLegale || "",
          })
        };
      }
    } catch(e) {}

    // Fallback : retourner structure vide avec message
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        source: "manual",
        siren: clean,
        message: "Ajoutez PAPPERS_API_KEY dans Netlify pour l'enrichissement complet",
        raison_sociale: "", forme: "", activite: "", effectif: ""
      })
    };
  }

  // Avec clé Pappers → données enrichies (dirigeants, BE, capital, TVA)
  try {
    const url = `https://api.pappers.fr/v2/entreprise?siren=${clean}&api_token=${PAPPERS_KEY}`;
    const res  = await fetch(url);

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, headers, body: JSON.stringify({ error: err }) };
    }

    const d = await res.json();

    // Extraire les dirigeants
    const dirigeants = (d.dirigeants || []).slice(0, 3).map(dir => ({
      nom:      (dir.prenom || "") + " " + (dir.nom || dir.denomination || ""),
      role:     dir.qualite || "",
      since:    dir.date_prise_de_poste || ""
    }));

    // Bénéficiaires effectifs
    const bes = (d.beneficiaires_effectifs || []).slice(0, 3).map(be => ({
      nom:     (be.prenom || "") + " " + (be.nom || ""),
      pct:     be.pourcentage_parts || "",
      pays:    be.nationalite || "France"
    }));

    // Procédures collectives
    const procedures = d.procedures_collectives_en_cours || [];

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        source:           "Pappers/INPI",
        siren:            clean,
        raison_sociale:   d.nom_entreprise || d.denomination || "",
        forme:            d.forme_juridique || "",
        capital:          d.capital ? d.capital + " " + (d.devise_capital || "EUR") : "",
        effectif:         d.effectif ? d.tranche_effectif + " sal." : (d.effectif_reel ? d.effectif_reel + " sal." : ""),
        tva:              d.numero_tva_intracommunautaire || "",
        activite:         d.code_naf || "",
        activite_libelle: d.libelle_code_naf || "",
        date_creation:    d.date_creation || "",
        adresse:          d.siege ? [d.siege.adresse_ligne_1, d.siege.ville, d.siege.pays].filter(Boolean).join(", ") : "",
        dirigeants,
        beneficiaires:    bes,
        procedures_actives: procedures.length > 0,
        procedures_detail:  procedures,
        ca:               d.chiffre_affaires ? d.chiffre_affaires + " €" : "",
        resultat:         d.resultat_net ? d.resultat_net + " €" : "",
        ebe:              d.excedent_brut_exploitation ? d.excedent_brut_exploitation + " €" : "",
      })
    };

  } catch(err) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
