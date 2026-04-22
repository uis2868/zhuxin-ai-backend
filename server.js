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
          hasKey: Boolean(KEYS[name])
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
      return res.status(400).json({ error: "Prompt is required" });
    }

    const normalizedProvider = normalizeProvider(provider);
    const providerOrder = buildProviderOrder(normalizedProvider);

    let lastFailure = null;

    for (const providerName of providerOrder) {
      if (!isProviderUsable(providerName)) continue;

      try {
        const output = await runProvider({
          providerName,
          prompt,
          mode,
          style,
          density
        });

        markProviderSuccess(providerName);

        return res.json({
          ok: true,
          provider: providerName,
          output
        });
      } catch (err) {
        lastFailure = err;
        markProviderFailure(providerName, err);
      }
    }

    return res.status(503).json({
      error: lastFailure?.message || "No AI provider is currently available",
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
  return ["openai", "gemini", "groq", "anthropic", "openrouter"];
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
        retryAt: state.retryAt
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
  providerState[name].lastError = err.message || "Provider failed";
}

function getCooldownMs(err) {
  if (err.reason === "rate_limit") return 60 * 1000;         // 1 min
  if (err.reason === "insufficient_quota") return 15 * 60 * 1000; // 15 min
  if (err.reason === "auth_error") return 30 * 60 * 1000;    // 30 min
  return 2 * 60 * 1000;                                      // 2 min
}

async function runProvider({ providerName, prompt, mode, style, density }) {
  const systemInstruction = buildInstruction(mode, style, density);

  if (providerName === "openai") {
    return callOpenAI(systemInstruction, prompt);
  }
  if (providerName === "gemini") {
    return callGemini(systemInstruction, prompt);
  }
  if (providerName === "groq") {
    return callGroq(systemInstruction, prompt);
  }
  if (providerName === "anthropic") {
    return callAnthropic(systemInstruction, prompt);
  }
  if (providerName === "openrouter") {
    return callOpenRouter(systemInstruction, prompt);
  }

  throw createProviderError("Unknown provider", "provider_error");
}

function buildInstruction(mode, style, density) {
  return [
    "You are Zhuxin Assistant.",
    "Be helpful, accurate, and structured.",
    `Mode: ${mode || "answer"}`,
    `Style: ${style || "clear"}`,
    `Density: ${density || "balanced"}`,
    "Return plain text only."
  ].join("\n");
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
    throw createProviderError(message, "auth_error");
  }
  if (response.status === 429 || lower.includes("rate limit")) {
    throw createProviderError(message, "rate_limit");
  }
  if (lower.includes("insufficient_quota") || lower.includes("quota") || response.status === 402) {
    throw createProviderError(message, "insufficient_quota");
  }

  throw createProviderError(message, "provider_error");
}

function createProviderError(message, reason) {
  const err = new Error(message || "Provider request failed");
  err.reason = reason || "provider_error";
  return err;
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
