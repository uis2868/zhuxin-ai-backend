import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import {
  detectDraftIntent,
  getLawSuggestion,
  buildLawFramedInstruction,
  buildGeneralDraftInstruction
} from "./draft-policy.js";

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
    message: "Workflow-memory backend is running"
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
      provider = "auto",
      draftTypeChoice = "",
      draftPreference = "",
      workflowState = null
    } = req.body || {};

    if (!String(prompt).trim()) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const mergedWorkflow = buildNextWorkflowState({
      prompt,
      mode,
      draftTypeChoice,
      draftPreference,
      workflowState
    });

    if (mode === "draft" && mergedWorkflow.stage === "choose_draft_type") {
      return res.json({
        ok: true,
        provider: "system",
        actionRequired: true,
        actionType: "choose_draft_type",
        originalPrompt: mergedWorkflow.originalPrompt || prompt,
        message: mergedWorkflow.pendingQuestion,
        options: mergedWorkflow.options || [],
        workflowState: mergedWorkflow
      });
    }

    if (mode === "draft" && mergedWorkflow.stage === "confirm_draft_preference") {
      return res.json({
        ok: true,
        provider: "system",
        actionRequired: true,
        actionType: "confirm_draft_preference",
        originalPrompt: mergedWorkflow.originalPrompt || prompt,
        draftTypeChoice: mergedWorkflow.draftType,
        message: mergedWorkflow.pendingQuestion,
        options: [
          { id: "law_framed", label: "Use suggested law frame" },
          { id: "general_draft", label: "General draft" }
        ],
        workflowState: mergedWorkflow
      });
    }

    const normalizedProvider = normalizeProvider(provider);
    const providerOrder = buildProviderOrder(normalizedProvider);

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
        const instructions = buildInstructions({
          prompt,
          mode,
          style,
          density,
          workflow: mergedWorkflow
        });

        const output = await runProvider({
          providerName,
          prompt: buildProviderPrompt(prompt, mergedWorkflow),
          instructions
        });

        markProviderSuccess(providerName);

        const finalWorkflow = {
          ...mergedWorkflow,
          active: mode === "draft",
          stage: mode === "draft" ? "drafting" : "completed",
          pendingQuestion: "",
          lastDraft: output
        };

        return res.json({
          ok: true,
          provider: providerName,
          output,
          statusMessage: `Completed with ${labelProvider(providerName)}.`,
          triedProviders,
          workflowState: finalWorkflow
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
      workflowState: mergedWorkflow
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
});

function buildNextWorkflowState({
  prompt,
  mode,
  draftTypeChoice,
  draftPreference,
  workflowState
}) {
  const previous = normalizeWorkflow(workflowState);
  const extractedFacts = extractFacts(prompt);

  if (mode !== "draft") {
    return {
      active: false,
      stage: "none",
      draftType: "",
      draftPreference: "",
      facts: {},
      pendingQuestion: "",
      originalPrompt: "",
      options: [],
      suggestedLaw: null,
      lastDraft: ""
    };
  }

  const effectivePrompt = previous.originalPrompt || prompt;
  const effectiveDraftTypeChoice = draftTypeChoice || previous.draftType || "";
  const intent = detectDraftIntent(effectivePrompt, mode, effectiveDraftTypeChoice);
  const suggestion = getLawSuggestion(intent.kind);

  const mergedFacts = {
    ...(previous.facts || {}),
    ...cleanObject(extractedFacts)
  };

  let stage = previous.stage || "start";
  let pendingQuestion = "";
  let options = [];
  let chosenPreference = draftPreference || previous.draftPreference || "";

  if (intent.ambiguous) {
    stage = "choose_draft_type";
    pendingQuestion = intent.question || "What kind of draft do you need?";
    options = intent.options || [];
  } else if (!chosenPreference && suggestion.available) {
    stage = "confirm_draft_preference";
    pendingQuestion = [
      `${suggestion.title}: ${suggestion.summary}`,
      "",
      `Suggested law / frame: ${suggestion.law}`,
      "",
      "Do you want to continue with the suggested law-framed draft, or generate a general draft?"
    ].join("\n");
  } else {
    stage = "drafting";
  }

  return {
    active: true,
    stage,
    draftType: intent.kind || previous.draftType || "",
    draftLabel: intent.label || previous.draftLabel || "",
    draftPreference: chosenPreference,
    facts: mergedFacts,
    pendingQuestion,
    options,
    originalPrompt: effectivePrompt,
    suggestedLaw: suggestion.available ? suggestion : null,
    lastDraft: previous.lastDraft || ""
  };
}

function normalizeWorkflow(state) {
  if (!state || typeof state !== "object") {
    return {
      active: false,
      stage: "",
      draftType: "",
      draftLabel: "",
      draftPreference: "",
      facts: {},
      pendingQuestion: "",
      options: [],
      originalPrompt: "",
      suggestedLaw: null,
      lastDraft: ""
    };
  }

  return {
    active: !!state.active,
    stage: state.stage || "",
    draftType: state.draftType || "",
    draftLabel: state.draftLabel || "",
    draftPreference: state.draftPreference || "",
    facts: state.facts || {},
    pendingQuestion: state.pendingQuestion || "",
    options: Array.isArray(state.options) ? state.options : [],
    originalPrompt: state.originalPrompt || "",
    suggestedLaw: state.suggestedLaw || null,
    lastDraft: state.lastDraft || ""
  };
}

function extractFacts(text) {
  const source = String(text || "");

  return {
    husband_name: capture(source, ["husband name is", "husband is"]),
    wife_name: capture(source, ["wife name is", "wife is", "wife's name is"]),
    sender_name: capture(source, ["sender name is", "my name is", "name is"]),
    recipient_name: capture(source, ["recipient is", "to is"]),
    court_name: capture(source, ["court is", "court name is"]),
    provision: capture(source, ["under provision", "u/o", "under order", "under section"]),
    case_reference: capture(source, ["case no is", "suit no is", "case reference is"]),
    date: capture(source, ["date is"]),
    marriage_date: capture(source, ["marriage date is", "date of marriage is"]),
    marriage_place: capture(source, ["place of marriage is", "marriage place is"]),
    address_husband: capture(source, ["husband address is"]),
    address_wife: capture(source, ["wife address is"]),
    subject: capture(source, ["subject is"]),
    facts_summary: capture(source, ["facts are", "facts is", "background is"]),
    relief: capture(source, ["relief is", "prayer is", "demand is"])
  };
}

function capture(text, patterns) {
  for (const pattern of patterns) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped + "\\s+([A-Za-z0-9,./()' -]+)", "i");
    const match = text.match(re);
    if (match && match[1]) return match[1].trim();
  }
  return "";
}

function cleanObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => String(value || "").trim())
  );
}

function buildProviderPrompt(latestPrompt, workflow) {
  if (!workflow || !workflow.active) return latestPrompt;

  const factLines = Object.entries(workflow.facts || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  return [
    `Current draft type: ${workflow.draftLabel || workflow.draftType || "N/A"}`,
    workflow.draftPreference ? `Draft preference: ${workflow.draftPreference}` : "",
    workflow.originalPrompt ? `Original drafting request: ${workflow.originalPrompt}` : "",
    factLines ? `Collected facts so far:\n${factLines}` : "",
    workflow.lastDraft ? `Last draft version:\n${workflow.lastDraft}` : "",
    `Latest user message:\n${latestPrompt}`
  ].filter(Boolean).join("\n\n");
}

function buildInstructions({ prompt, mode, style, density, workflow }) {
  const densityRule =
    density === "dense"
      ? "Be detailed, structured, and comprehensive."
      : "Be concise but complete.";

  const styleRule =
    style === "formal"
      ? "Use formal professional tone."
      : "Use clear natural tone.";

  if (mode === "draft" && workflow?.draftPreference === "law_framed") {
    return [
      styleRule,
      densityRule,
      `Current date: ${new Date().toDateString()}`,
      buildLawFramedInstruction(workflow.originalPrompt || prompt, {
        kind: workflow.draftType,
        label: workflow.draftLabel
      }, workflow.suggestedLaw),
      "This is a continuing drafting session.",
      "Do not restart from zero.",
      "Use the collected facts and latest user message together.",
      "If the user added new facts, update the draft accordingly.",
      "If information is still missing, use careful placeholders rather than forgetting prior context."
    ].join("\n");
  }

  if (mode === "draft" && workflow?.draftPreference === "general_draft") {
    return [
      styleRule,
      densityRule,
      `Current date: ${new Date().toDateString()}`,
      buildGeneralDraftInstruction(workflow.originalPrompt || prompt, {
        kind: workflow.draftType,
        label: workflow.draftLabel
      }, workflow.suggestedLaw),
      "This is a continuing drafting session.",
      "Do not restart from zero.",
      "Use the collected facts and latest user message together.",
      "If the user added new facts, update the draft accordingly."
    ].join("\n");
  }

  return [
    "You are Zhuxin Assistant.",
    styleRule,
    densityRule,
    `Current date: ${new Date().toDateString()}`,
    "Answer directly and naturally.",
    "Do not be robotic.",
    `User request: ${prompt}`
  ].join("\n");
}

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

async function runProvider({ providerName, prompt, instructions }) {
  if (providerName === "openai") return callOpenAI(instructions, prompt);
  if (providerName === "gemini") return callGemini(instructions, prompt);
  if (providerName === "groq") return callGroq(instructions, prompt);
  if (providerName === "anthropic") return callAnthropic(instructions, prompt);
  if (providerName === "openrouter") return callOpenRouter(instructions, prompt);

  throw createProviderError("Unknown provider", "provider_error", "Provider selection failed.");
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
  return data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
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
      messages: [{ role: "user", content: prompt }]
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
    throw createProviderError(message, "auth_error", "Authentication failed for this provider.");
  }

  if (response.status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    throw createProviderError(message, "rate_limit", "This provider is rate-limited right now.");
  }

  if (lower.includes("insufficient_quota") || lower.includes("quota") || response.status === 402) {
    throw createProviderError(message, "insufficient_quota", "This provider has reached its quota or billing limit.");
  }

  throw createProviderError(message, "provider_error", "This provider had a temporary error.");
}

function createProviderError(message, reason, publicMessage) {
  const err = new Error(message || "Provider request failed");
  err.reason = reason || "provider_error";
  err.publicMessage = publicMessage || "Provider request failed.";
  return err;
}

function labelProvider(name) {
  return {
    openai: "OpenAI",
    gemini: "Gemini",
    groq: "Groq",
    anthropic: "Anthropic",
    openrouter: "OpenRouter"
  }[name] || name;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

app.listen(PORT, () => {
  console.log(`Zhuxin workflow-memory backend listening on port ${PORT}`);
});
