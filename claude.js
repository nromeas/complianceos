// Netlify Function — Proxy sécurisé Anthropic API
// La clé API est dans les variables d'environnement Netlify
// Jamais exposée au browser

exports.handler = async function(event, context) {
  // CORS
  const headers = {
    "Access-Control-Allow-Origin":  "https://complianceos1.netlify.app",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { system, userMsg, maxTokens, messages } = body;

    // Construire les messages
    const msgs = messages || [{ role: "user", content: userMsg || "" }];

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            ANTHROPIC_KEY,
        "anthropic-version":    "2023-06-01"
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: maxTokens || 1500,
        system:     system || "Tu es un assistant compliance expert.",
        messages:   msgs
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return { statusCode: response.status, headers, body: JSON.stringify({ error: err }) };
    }

    const data = await response.json();
    const text = (data.content || []).map(c => c.text || "").join("");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text, usage: data.usage })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
