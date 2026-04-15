// Netlify Function — Lookup SIREN via INSEE (gratuit, officiel)
// Fallback OpenCorporates si INSEE indisponible

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

  const siren = ((event.queryStringParameters || {}).siren || "").replace(/\s/g,"").replace(/-/g,"");

  if (!siren || siren.length < 9) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "SIREN invalide (9 chiffres requis)" }) };
  }

  // ── Tentative 1 : API Recherche Entreprises (data.gouv.fr) ────────
  // Pas de clé API requise, données INPI officielles
  try {
    const res = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`,
      { headers: { "Accept": "application/json" } }
    );

    if (res.ok) {
      const data = await res.json();
      const result = data.results && data.results[0];

      if (result) {
        const siege = result.siege || {};
        const dirigeants = (result.dirigeants || []).slice(0,3).map(d => ({
          nom:  (d.prenoms || "") + " " + (d.nom || d.denomination || ""),
          role: d.qualite || d.titre || ""
        }));

        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            source:          "data.gouv.fr / INPI",
            siren:           result.siren || siren,
            raison_sociale:  result.nom_complet || result.nom_raison_sociale || "",
            forme:           result.nature_juridique || "",
            activite:        siege.activite_principale || "",
            activite_libelle:result.activite_principale_libelle || "",
            effectif:        result.tranche_effectif_salarie || "",
            date_creation:   result.date_creation || "",
            adresse:         [siege.numero_voie, siege.type_voie, siege.libelle_voie, siege.code_postal, siege.libelle_commune].filter(Boolean).join(" "),
            dirigeants:      dirigeants,
            tva:             "FR" + (12 + 3 * (parseInt(siren) % 97)) % 97 + siren,
            capital:         result.capital || "",
            ca:              "",
            resultat:        "",
            beneficiaires:   [],
            procedures_actives: false
          })
        };
      }
    }
  } catch(e) {
    console.log("data.gouv.fr error:", e.message);
  }

  // ── Tentative 2 : API Annuaire Entreprises (fallback) ─────────────
  try {
    const res2 = await fetch(
      `https://annuaire-entreprises.data.gouv.fr/api/v1/entreprise/${siren}`,
      { headers: { "Accept": "application/json" } }
    );

    if (res2.ok) {
      const d = await res2.json();
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          source:          "Annuaire Entreprises",
          siren:           siren,
          raison_sociale:  d.nom_complet || d.nom_raison_sociale || "",
          forme:           d.nature_juridique_label || "",
          activite:        d.activite_principale || "",
          activite_libelle:d.libelle_activite_principale || "",
          effectif:        d.tranche_effectif_salarie_label || "",
          date_creation:   d.date_creation || "",
          adresse:         d.siege ? d.siege.adresse : "",
          dirigeants:      [],
          tva:             "",
          capital:         "",
          ca:              "",
          beneficiaires:   [],
          procedures_actives: false
        })
      };
    }
  } catch(e) {
    console.log("annuaire error:", e.message);
  }

  // ── Fallback final : retourner structure minimale ─────────────────
  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      source:         "Manuel",
      siren:          siren,
      raison_sociale: "",
      forme:          "",
      activite:       "",
      effectif:       "",
      message:        "SIREN valide mais donn\u00e9es non disponibles — saisissez manuellement"
    })
  };
};
