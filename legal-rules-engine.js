export const LEGAL_DRAFT_RULES = [
  {
    id: "talaq_notice_bd",
    label: "Talaq Notice (Bangladesh)",
    jurisdiction: "BD",
    category: "family",
    triggers: [/talaq/i, /divorce notice/i],
    lawReferences: [
      "Muslim Family Laws Ordinance, 1961 / applicable Bangladesh legal procedure"
    ],
    authorityRule: "Draft must be addressed to the legally relevant authority/recipient required by the governing law, not guessed randomly.",
    requiredComponents: [
      "document_title",
      "correct_addressee_or_authority",
      "sender_identity",
      "relevant_marriage_identifiers",
      "core_legal_statement",
      "date",
      "signature_block"
    ],
    prohibitedFailures: [
      "wrong addressee",
      "missing core legal statement",
      "missing date",
      "missing signature block"
    ],
    ambiguityQuestions: [
      "Who is legally giving the notice: husband or wife?",
      "What is the intended legal addressee under your use case?",
      "Do you want a general Bangladesh-law-oriented draft skeleton or a lawyer-reviewed final wording base?"
    ],
    generationPolicy: {
      allowFreeDrafting: true,
      requireLegalFrame: true,
      requireStructure: true,
      cautionLevel: "high"
    }
  },
  {
    id: "plaint_bd",
    label: "Plaint (Bangladesh Civil)",
    jurisdiction: "BD",
    category: "civil",
    triggers: [/plaint/i, /file a suit/i, /civil suit/i],
    lawReferences: [
      "Code of Civil Procedure / applicable Bangladesh pleading practice"
    ],
    authorityRule: "Draft must be framed for the proper court and must not omit core pleading sections.",
    requiredComponents: [
      "court_name",
      "title_and_case_caption",
      "party_description",
      "jurisdiction_statement",
      "facts",
      "cause_of_action",
      "reliefs_prayed",
      "verification_or_signature_block"
    ],
    prohibitedFailures: [
      "missing parties",
      "missing court name",
      "missing jurisdiction",
      "missing prayer"
    ],
    ambiguityQuestions: [
      "Which court is this for?",
      "Who are the plaintiffs and defendants?",
      "What relief are you asking for?"
    ],
    generationPolicy: {
      allowFreeDrafting: true,
      requireLegalFrame: true,
      requireStructure: true,
      cautionLevel: "high"
    }
  },
  {
    id: "add_party_application_bd",
    label: "Application for Adding Party (Bangladesh Civil)",
    jurisdiction: "BD",
    category: "civil_application",
    triggers: [/add(ing)? party/i, /implead/i, /impleadment/i, /order 1 rule 10/i],
    lawReferences: [
      "Specific procedural provision must be identified and stated where required"
    ],
    authorityRule: "Draft must identify the proper court, suit reference, and relevant procedural provision where applicable.",
    requiredComponents: [
      "court_name",
      "case_reference",
      "party_title",
      "procedural_basis",
      "grounds",
      "prayer",
      "signature_block"
    ],
    prohibitedFailures: [
      "missing procedural basis",
      "missing case reference",
      "missing prayer"
    ],
    ambiguityQuestions: [
      "Which case/suit is this application for?",
      "Under which provision do you want it framed, if known?",
      "Who is the proposed added party and why are they necessary?"
    ],
    generationPolicy: {
      allowFreeDrafting: true,
      requireLegalFrame: true,
      requireStructure: true,
      cautionLevel: "high"
    }
  },
  {
    id: "general_legal_notice_bd",
    label: "General Legal Notice (Bangladesh)",
    jurisdiction: "BD",
    category: "notice",
    triggers: [/legal notice/i, /notice to/i, /business notice/i],
    lawReferences: [
      "Applicable underlying cause and governing law depend on the dispute"
    ],
    authorityRule: "Draft must be addressed to the correct recipient for the purpose, not to an unrelated authority.",
    requiredComponents: [
      "recipient",
      "sender",
      "date",
      "subject",
      "factual_background",
      "demand_or_position",
      "time_for_response_if_applicable",
      "signature_block"
    ],
    prohibitedFailures: [
      "wrong recipient",
      "missing demand",
      "missing facts"
    ],
    ambiguityQuestions: [
      "Who is the intended recipient?",
      "What is the legal/business purpose of the notice?",
      "What action or response are you demanding?"
    ],
    generationPolicy: {
      allowFreeDrafting: true,
      requireLegalFrame: true,
      requireStructure: true,
      cautionLevel: "medium"
    }
  }
];

export function analyzeLegalRequest({ prompt = "", mode = "answer", jurisdiction = "BD" }) {
  const text = String(prompt || "").trim();
  const lower = text.toLowerCase();

  const matchedRule = LEGAL_DRAFT_RULES.find(
    (rule) =>
      rule.jurisdiction === jurisdiction &&
      rule.triggers.some((re) => re.test(lower))
  );

  const isLegalDraftRequest =
    mode === "draft" &&
    /(notice|plaint|petition|application|affidavit|complaint|deed|agreement|talaq|divorce|party)/i.test(lower);

  if (!isLegalDraftRequest) {
    return {
      isLegalDraftRequest: false,
      route: "normal_ai",
      matchedRule: null,
      extractedFacts: {}
    };
  }

  const extractedFacts = extractFacts(text);

  if (!matchedRule) {
    return {
      isLegalDraftRequest: true,
      route: "legal_caution",
      matchedRule: null,
      extractedFacts,
      legalFramePrompt: buildUnknownLegalFrame(text),
      statusMessage: "No exact legal rule matched. Draft with caution and preserve essential legal structure."
    };
  }

  return {
    isLegalDraftRequest: true,
    route: "legal_framed_ai",
    matchedRule,
    extractedFacts,
    legalFramePrompt: buildLegalFramePrompt(matchedRule, extractedFacts),
    statusMessage: `Legal rule matched: ${matchedRule.label}`
  };
}

function extractFacts(text) {
  return {
    husband_name: capture(text, ["husband name is", "husband is"]),
    wife_name: capture(text, ["wife name is", "wife is", "wife's name is"]),
    sender_name: capture(text, ["sender name is", "my name is", "name is"]),
    recipient_name: capture(text, ["recipient is", "to is", "to"]),
    court_name: capture(text, ["court is", "court name is"]),
    provision: capture(text, ["under provision", "under", "u/o", "under order"]),
    case_reference: capture(text, ["case no is", "suit no is", "case reference is"]),
    date: capture(text, ["date is"]),
    marriage_date: capture(text, ["marriage date is", "date of marriage is"]),
    marriage_place: capture(text, ["place of marriage is", "marriage place is"])
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

function buildUnknownLegalFrame(prompt) {
  return [
    "This is a legal drafting request, but no exact registered legal rule was matched.",
    "Law is above drafting freedom.",
    "Do not invent a legally random authority, provision, or recipient.",
    "Preserve the mandatory legal structure for the apparent document type.",
    "If legal direction is unclear, state assumptions carefully and use placeholders rather than inventing decisive legal facts.",
    "Draft as a legally cautious structured draft, not as a generic letter.",
    `User request: ${prompt}`
  ].join("\n");
}

function buildLegalFramePrompt(rule, facts) {
  const knownFacts = Object.entries(facts)
    .filter(([, value]) => value)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n") || "- none extracted";

  return [
    `Jurisdiction: ${rule.jurisdiction}`,
    `Document Type: ${rule.label}`,
    `Category: ${rule.category}`,
    "LAW IS ABOVE ALL.",
    "Follow the governing legal direction before drafting.",
    `Authority rule: ${rule.authorityRule}`,
    `Law references: ${rule.lawReferences.join("; ")}`,
    "Required structural components:",
    ...rule.requiredComponents.map((x) => `- ${x}`),
    "Do not fail in these ways:",
    ...rule.prohibitedFailures.map((x) => `- ${x}`),
    "Known facts extracted from user input:",
    knownFacts,
    "Draft freely in wording and quality, but do not violate the legal frame or omit required structure.",
    "If a fact is missing, keep a clear placeholder rather than inventing it."
  ].join("\n");
      }
