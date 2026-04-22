export function detectDraftIntent(prompt = "", mode = "answer", draftTypeChoice = "") {
  const text = String(prompt || "").toLowerCase().trim();
  const chosen = String(draftTypeChoice || "").toLowerCase().trim();

  if (mode !== "draft") {
    return { kind: "non_draft", ambiguous: false };
  }

  if (chosen) {
    return mapChosenType(chosen);
  }

  if (/\btalaq\b|\bdivorce\b/.test(text)) {
    return {
      kind: "talaq_notice_bd",
      ambiguous: false,
      label: "Talaq / divorce-related notice"
    };
  }

  if (/plaint\b|civil suit|money suit|title suit/.test(text)) {
    return {
      kind: "plaint_bd",
      ambiguous: false,
      label: "Plaint"
    };
  }

  if (/add(ing)? party|implead|impleadment|order 1 rule 10|order i rule 10/.test(text)) {
    return {
      kind: "add_party_application_bd",
      ambiguous: false,
      label: "Application for adding party"
    };
  }

  if (/\bnotice\b/.test(text)) {
    return {
      kind: "notice_ambiguous",
      ambiguous: true,
      label: "Notice",
      options: [
        { id: "business_notice", label: "Business notice" },
        { id: "general_legal_notice_bd", label: "General legal notice" },
        { id: "talaq_notice_bd", label: "Talaq / divorce notice" },
        { id: "court_application_notice", label: "Court-related application / petition" }
      ],
      question:
        "What kind of notice do you need? Business notice, general legal notice, talaq/divorce notice, or court-related application?"
    };
  }

  return {
    kind: "general_draft",
    ambiguous: false,
    label: "General draft"
  };
}

function mapChosenType(chosen) {
  const table = {
    business_notice: {
      kind: "business_notice",
      ambiguous: false,
      label: "Business notice"
    },
    general_legal_notice_bd: {
      kind: "general_legal_notice_bd",
      ambiguous: false,
      label: "General legal notice"
    },
    talaq_notice_bd: {
      kind: "talaq_notice_bd",
      ambiguous: false,
      label: "Talaq / divorce-related notice"
    },
    court_application_notice: {
      kind: "court_application_notice",
      ambiguous: false,
      label: "Court-related application / petition"
    }
  };

  return table[chosen] || {
    kind: "general_draft",
    ambiguous: false,
    label: "General draft"
  };
}

export function getLawSuggestion(intentKind) {
  if (intentKind === "talaq_notice_bd") {
    return {
      available: true,
      title: "Suggested legal frame",
      summary:
        "This appears to be a Bangladesh talaq/divorce-related notice. The legal route matters, so the addressee and structure should not be guessed randomly.",
      law:
        "Bangladesh Muslim family law procedure / MFLO-related route",
      structuralMusts: [
        "correct legal addressee or authority",
        "identity of issuing party",
        "identity of other party",
        "core legal declaration / statement",
        "date",
        "signature block"
      ]
    };
  }

  if (intentKind === "plaint_bd") {
    return {
      available: true,
      title: "Suggested legal frame",
      summary:
        "This appears to be a plaint. It should follow Bangladesh civil pleading structure.",
      law: "Bangladesh civil pleading / court structure",
      structuralMusts: [
        "court name",
        "party title and description",
        "jurisdiction statement",
        "facts",
        "cause of action",
        "reliefs / prayer",
        "verification or signature block"
      ]
    };
  }

  if (intentKind === "add_party_application_bd") {
    return {
      available: true,
      title: "Suggested legal frame",
      summary:
        "This appears to be an application for adding party. The correct procedural basis and case reference matter.",
      law: "Bangladesh civil procedural application structure",
      structuralMusts: [
        "court name",
        "case reference",
        "party title",
        "procedural basis / provision",
        "grounds",
        "prayer",
        "signature block"
      ]
    };
  }

  if (intentKind === "general_legal_notice_bd") {
    return {
      available: true,
      title: "Suggested legal frame",
      summary:
        "This appears to be a general legal notice. The correct recipient and legal purpose matter.",
      law: "General Bangladesh legal notice structure",
      structuralMusts: [
        "sender",
        "recipient",
        "date",
        "subject",
        "factual background",
        "legal position or demand",
        "response period if needed",
        "signature block"
      ]
    };
  }

  if (intentKind === "business_notice") {
    return {
      available: true,
      title: "Suggested drafting frame",
      summary:
        "This appears to be a business notice. It does not need a forced legal route unless you want one, but it still needs proper business structure.",
      law: "Business / commercial notice structure",
      structuralMusts: [
        "sender",
        "recipient",
        "date",
        "subject",
        "business facts",
        "demand / request / notice purpose",
        "signature block"
      ]
    };
  }

  if (intentKind === "court_application_notice") {
    return {
      available: true,
      title: "Suggested legal frame",
      summary:
        "This appears to be a court-related draft. It should be framed under the right court structure and provision where applicable.",
      law: "Court application / petition structure",
      structuralMusts: [
        "court name",
        "case title or matter title",
        "procedural basis if applicable",
        "grounds",
        "prayer",
        "signature block"
      ]
    };
  }

  return {
    available: false
  };
}

export function buildLawFramedInstruction(prompt, intent, suggestion) {
  const musts =
    suggestion?.structuralMusts?.map((x) => `- ${x}`).join("\n") || "- preserve legally necessary structure";

  return [
    "You are Zhuxin Assistant.",
    "Law comes first, but do not become robotic.",
    "Draft naturally and intelligently.",
    "Do not use a repetitive dead template.",
    `Detected draft type: ${intent.label || intent.kind}`,
    `Suggested legal / procedural frame: ${suggestion?.law || "N/A"}`,
    "Preserve these structural essentials:",
    musts,
    "Write a strong professional draft in natural language.",
    "Do not randomly choose the wrong authority, wrong recipient, or wrong procedural route.",
    "If some facts are missing, use careful placeholders rather than inventing them.",
    `User request: ${prompt}`
  ].join("\n");
}

export function buildGeneralDraftInstruction(prompt, intent, suggestion) {
  const musts =
    suggestion?.structuralMusts?.map((x) => `- ${x}`).join("\n") || "- preserve sensible structure";

  return [
    "You are Zhuxin Assistant.",
    "Generate a general professional draft.",
    "Do not lock yourself into a rigid template.",
    "Write naturally and intelligently.",
    `Detected draft type: ${intent.label || intent.kind}`,
    "Preserve these structural essentials where relevant:",
    musts,
    "This is a general draft, not a law-framed draft unless the user expressly asked for that.",
    `User request: ${prompt}`
  ].join("\n");
}
