import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const KEYS = {
  openai: process.env.OPENAI_API_KEY || "",
  gemini: process.env.GEMINI_API_KEY || "",
  groq: process.env.GROQ_API_KEY || "",
  anthropic: process.env.ANTHROPIC_API_KEY || "",
  openrouter: process.env.OPENROUTER_API_KEY || ""
};

const MODELS = {
  openai: process.env.OPENAI_MODEL || "gpt-5",
  gemini: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  groq: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  anthropic: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
  openrouter: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"
};

const providerState = {
  openai: { available: !!KEYS.openai, reason: !!KEYS.openai ? null : "missing_key", retryAt: null, lastError: null },
  gemini: { available: !!KEYS.gemini, reason: !!KEYS.gemini ? null : "missing_key", retryAt: null, lastError: null },
  groq: { available: !!KEYS.groq, reason: !!KEYS.groq ? null : "missing_key", retryAt: null, lastError: null },
  anthropic: { available: !!KEYS.anthropic, reason: !!KEYS.anthropic ? null : "missing_key", retryAt: null, lastError: null },
  openrouter: { available: !!KEYS.openrouter, reason: !!KEYS.openrouter ? null : "missing_key", retryAt: null, lastError: null }
};

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    app: "zhuxin-ai-backend",
    message: "Multi-provider backend is running"
  });
});

app.get("/health", (_req, res) => {
  refreshAvailabilityByTime();

  res.json({
    ok: true,
    providers: Object.fromEntries(
      Object.entries(providerState).map(([name, state]) => [
        name,
        {
          available: state.available,
          reason: state.reason,
          retryAt: state.retryAt,
          hasKey: Boolean(KEYS[name]),
          lastError: state.lastError
        }
      ])
    )
  });
});

app.post("/api/ai", async (req, res) => {
  try {
    refreshAvailabilityByTime();

    const {
      prompt = "",
      mode = "answer",
      style = "clear",
      density = "balanced",
      provider = "auto"
    } = req.body || {};

    if (!prompt.trim()) {
      return res.status(400).json({
        error: "Prompt is required"
      });
    }

    const normalizedProvider = normalizeProvider(provider);
    const providerOrder = buildProviderOrder(normalizedProvider);

    const prepared = preparePrompt(prompt, mode);

    let lastFailure = null;
    const triedProviders = [];

    for (const providerName of providerOrder) {
      if (!isProviderUsable(providerName)) {
        triedProviders.push({
          provider: providerName,
          skipped: true,
          reason: providerState[providerName]?.reason || "unavailable"
        });
        continue;
      }

      try {
        let output;

        // hard-coded safe template path for sensitive notice drafting
        if (prepared.forceLocalTemplate) {
          output = buildLocalTemplate(prepared);
        } else {
          output = await runProvider({
            providerName,
            prompt: prepared.prompt,
            mode,
            style,
            density,
            meta: prepared
          });
        }

        markProviderSuccess(providerName);

        return res.json({
          ok: true,
          provider: providerName,
          output,
          statusMessage: `Completed with ${labelProvider(providerName)}.`,
          triedProviders
        });
      } catch (err) {
        lastFailure = err;
        markProviderFailure(providerName, err);

        triedProviders.push({
          provider: providerName,
          skipped: false,
          reason: err.reason || "provider_error",
          message: err.publicMessage || err.message || "Provider failed"
        });
      }
    }

    return res.status(503).json({
      error: lastFailure?.publicMessage || "No AI provider is currently available.",
      triedProviders,
      providers: summarizeProviders()
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
});

function normalizeProvider(value) {
  const v = String(value || "auto").toLowerCase().trim();
  const allowed = ["auto", "openai", "gemini", "groq", "anthropic", "openrouter"];
  return allowed.includes(v) ? v : "auto";
}

function buildProviderOrder(selected) {
  if (selected !== "auto") return [selected];
  return ["gemini", "groq", "openrouter", "openai", "anthropic"];
}

function isProviderUsable(name) {
  const state = providerState[name];
  if (!state) return false;
  if (!KEYS[name]) return false;

  if (state.retryAt && Date.now() >= state.retryAt) {
    state.available = true;
    state.reason = null;
    state.retryAt = null;
    state.lastError = null;
  }

  return state.available;
}

function refreshAvailabilityByTime() {
  for (const name of Object.keys(providerState)) {
    isProviderUsable(name);
  }
}

function summarizeProviders() {
  return Object.fromEntries(
    Object.entries(providerState).map(([name, state]) => [
      name,
      {
        available: isProviderUsable(name),
        reason: state.reason,
        retryAt: state.retryAt,
        lastError: state.lastError
      }
    ])
  );
}

function markProviderSuccess(name) {
  providerState[name].available = true;
  providerState[name].reason = null;
  providerState[name].retryAt = null;
  providerState[name].lastError = null;
}

function markProviderFailure(name, err) {
  const cooldownMs = getCooldownMs(err);
  providerState[name].available = false;
  providerState[name].reason = err.reason || "provider_error";
  providerState[name].retryAt = Date.now() + cooldownMs;
  providerState[name].lastError = err.publicMessage || err.message || "Provider failed";
}

function getCooldownMs(err) {
  if (err.reason === "rate_limit") return 60 * 1000;
  if (err.reason === "insufficient_quota") return 15 * 60 * 1000;
  if (err.reason === "auth_error") return 30 * 60 * 1000;
  return 2 * 60 * 1000;
}

function preparePrompt(rawPrompt, mode) {
  const prompt = String(rawPrompt || "").trim();
  const lower = prompt.toLowerCase();

  const isTalaqNotice =
    /talaq/.test(lower) ||
    (/notice/.test(lower) && /divorce/.test(lower));

  const extracted = {
    wifeName: extractAfter(prompt, ["wife name is", "name is", "wife is"]),
    husbandName: extractAfter(prompt, ["husband name is", "husband is"]),
    keepBlank: /rest leave as blank|leave rest as blank|keep rest blank/i.test(prompt)
  };

  return {
    prompt,
    isTalaqNotice,
    forceLocalTemplate: mode === "draft" && isTalaqNotice,
    extracted
  };
}

function extractAfter(text, patterns) {
  for (const pattern of patterns) {
    const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+([A-Za-z .'-]+)", "i");
    const match = text.match(re);
    if (match && match[1]) return match[1].trim();
  }
  return "";
}

function buildLocalTemplate(prepared) {
  const wifeName = prepared.extracted.wifeName || "[Wife Name]";
  const husbandName = prepared.extracted.husbandName || "[Husband Name]";

  return [
    "GENERAL INFORMATIONAL TEMPLATE ONLY",
    "This is a neutral general draft for informational use. Local law, court procedure, registration requirements, and religious rules may differ.",
    "",
    "NOTICE OF INTENTION / DECLARATION RELATING TO TALAQ",
    "",
    "From:",
    `${husbandName}`,
    "[Address]",
    "[Phone Number]",
    "",
    "To:",
    `${wifeName}`,
    "[Address]",
    "",
    "Date:",
    "[Date]",
    "",
    "Subject: Notice relating to talaq",
    "",
    "Dear " + wifeName + ",",
    "",
    "This notice is being issued as a general written communication regarding talaq. The details, legal effect, procedural requirements, date of effectiveness, and any registration or notice obligations shall be governed by the applicable law and competent authority.",
    "",
    "For record purposes, the relevant details are stated below:",
    "1. Husband's name: " + husbandName,
    "2. Wife's name: " + wifeName,
    "3. Date of marriage: [Date of Marriage]",
    "4. Place of marriage: [Place of Marriage]",
    "5. Address of husband: [Husband Address]",
    "6. Address of wife: [Wife Address]",
    "",
    "Statement:",
    "[Insert the intended statement here in the exact form advised by your qualified lawyer / lawful authority.]",
    "",
    "Additional matters:",
    "- Mahr / dower: [Details]",
    "- Maintenance: [Details]",
    "- Child-related matters, if any: [Details]",
    "- Documents attached, if any: [Details]",
    "",
    "This document is kept in general template form and should be finalized only after review by a qualified lawyer or other competent advisor under the applicable law.",
    "",
    "Sincerely,",
    "",
    `${husbandName}`,
    "[Signature]"
  ].join("\n");
}

async function runProvider({ providerName, prompt, mode, style, density, meta }) {
  const instruction = buildInstruction(mode, style, density, meta);

  if (providerName === "openai") {
    return callOpenAI(instruction, prompt);
  }
  if (providerName === "gemini") {
    return callGemini(instruction, prompt);
  }
  if (providerName === "groq") {
    return callGroq(instruction, prompt);
  }
  if (providerName === "anthropic") {
    return callAnthropic(instruction, prompt);
  }
  if (providerName === "openrouter") {
    return callOpenRouter(instruction, prompt);
  }

  throw createProviderError("Unknown provider", "provider_error", "Provider selection failed.");
}

function buildInstruction(mode, style, density, meta) {
  const densityRule =
    density === "dense"
      ? "Be detailed, structured, and comprehensive."
      : "Be concise but complete.";

  const styleRule =
    style === "formal"
      ? "Use formal professional tone."
      : "Use clear natural tone.";

  const base = [
    "You are Zhuxin Assistant.",
    "Be helpful, accurate, practical, and structured.",
    styleRule,
    densityRule,
    `Current date: ${new Date().toDateString()}`,
    "Do not mention training cutoff.",
    "Do not claim lack of current date access.",
    "Return plain text only."
  ];

  if (mode === "answer") {
    base.push(
      "Mode is answer.",
      "Answer directly.",
      "If the user asks a simple question, give a direct answer only.",
      "Do not add unnecessary disclaimers.",
      "Be confident and clear."
    );
  } else if (mode === "draft") {
    base.push(
      "Mode is draft.",
      "You MUST produce a COMPLETE ready-to-use document.",
      "Do NOT explain how to draft.",
      "Do NOT list required information unless the user explicitly asks for a checklist.",
      "Do NOT output advice instead of a document.",
      "Start directly with the document.",
      "Use realistic placeholders where data is missing.",
      "Use formal headings and document structure."
    );
  } else if (mode === "revise") {
    base.push(
      "Mode is revise.",
      "Rewrite the user's text directly.",
      "Do not explain what you changed unless asked.",
      "Preserve meaning while improving clarity, tone, and structure."
    );
  }

  if (meta?.isTalaqNotice) {
    base.push(
      "This is a sensitive legal and religious topic.",
      "You may provide a neutral general informational template.",
      "Do not refuse if the user asks for a general template.",
      "Avoid jurisdiction-specific legal conclusions.",
      "If drafting, produce a formal general template with placeholders instead of commentary."
    );
  }

  return base.join("\n");
}

async function callOpenAI(instructions, prompt) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KEYS.openai}`
    },
    body: JSON.stringify({
      model: MODELS.openai,
      instructions,
      input: prompt
    })
  });

  const data = await safeJson(response);
  ensureOk(response, data);
  return data.output_text || "";
}

async function callGemini(instructions, prompt) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODELS.gemini)}:generateContent?key=${KEYS.gemini}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: instructions }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    })
  });

  const data = await safeJson(response);
  ensureOk(response, data);

  return (
    data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || ""
  );
}

async function callGroq(instructions, prompt) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KEYS.groq}`
    },
    body: JSON.stringify({
      model: MODELS.groq,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: prompt }
      ]
    })
  });

  const data = await safeJson(response);
  ensureOk(response, data);
  return data?.choices?.[0]?.message?.content || "";
}

async function callAnthropic(instructions, prompt) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": KEYS.anthropic,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODELS.anthropic,
      max_tokens: 1024,
      system: instructions,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  const data = await safeJson(response);
  ensureOk(response, data);
  return data?.content?.map((item) => item.text || "").join("") || "";
}

async function callOpenRouter(instructions, prompt) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${KEYS.openrouter}`
    },
    body: JSON.stringify({
      model: MODELS.openrouter,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: prompt }
      ]
    })
  });

  const data = await safeJson(response);
  ensureOk(response, data);
  return data?.choices?.[0]?.message?.content || "";
}

function ensureOk(response, data) {
  if (response.ok) return;

  const message =
    data?.error?.message ||
    data?.message ||
    JSON.stringify(data);

  const lower = String(message).toLowerCase();

  if (response.status === 401 || response.status === 403) {
    throw createProviderError(
      message,
      "auth_error",
      "Authentication failed for this provider."
    );
  }

  if (
    response.status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    throw createProviderError(
      message,
      "rate_limit",
      "This provider is rate-limited right now."
    );
  }

  if (
    lower.includes("insufficient_quota") ||
    lower.includes("quota") ||
    response.status === 402
  ) {
    throw createProviderError(
      message,
      "insufficient_quota",
      "This provider has reached its quota or billing limit."
    );
  }

  throw createProviderError(
    message,
    "provider_error",
    "This provider had a temporary error."
  );
}

function createProviderError(message, reason, publicMessage) {
  const err = new Error(message || "Provider request failed");
  err.reason = reason || "provider_error";
  err.publicMessage = publicMessage || "Provider request failed.";
  return err;
}

function labelProvider(name) {
  const map = {
    openai: "OpenAI",
    gemini: "Gemini",
    groq: "Groq",
    anthropic: "Anthropic",
    openrouter: "OpenRouter"
  };
  return map[name] || name;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

app.listen(PORT, () => {
  console.log(`Zhuxin multi-provider backend listening on port ${PORT}`);
});
