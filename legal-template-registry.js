export const LEGAL_POLICY = {
  priority: [
    "law",
    "approved_template",
    "cautious_skeleton",
    "ai_generation"
  ],
  jurisdiction: "BD"
};

const TEMPLATE_REGISTRY = [
  {
    id: "talaq_notice_bd",
    label: "Talaq Notice (BD)",
    jurisdiction: "BD",
    category: "family_law",
    sensitivity: "high",
    finalDraftAllowed: false,
    approvedTemplateExists: false,
    fallbackMode: "cautious_skeleton",
    matchers: [
      /talaq/i,
      /divorce notice/i
    ],
    requiredFields: [
      "husband_name",
      "wife_name",
      "date",
      "address_husband",
      "address_wife",
      "date_of_marriage",
      "place_of_marriage"
    ]
  },
  {
    id: "general_legal_notice_bd",
    label: "General Legal Notice (BD)",
    jurisdiction: "BD",
    category: "general_notice",
    sensitivity: "medium",
    finalDraftAllowed: false,
    approvedTemplateExists: false,
    fallbackMode: "cautious_skeleton",
    matchers: [
      /legal notice/i,
      /notice/i
    ],
    requiredFields: [
      "sender_name",
      "recipient_name",
      "date",
      "subject",
      "facts",
      "relief_sought"
    ]
  }
];

export function resolveLegalDraftPolicy({ prompt = "", mode = "answer", jurisdiction = "BD" }) {
  const cleanPrompt = String(prompt || "").trim();
  const lower = cleanPrompt.toLowerCase();

  const extracted = extractKnownFields(cleanPrompt);
  const matchedTemplate = TEMPLATE_REGISTRY.find((tpl) => {
    if (tpl.jurisdiction !== jurisdiction) return false;
    return tpl.matchers.some((re) => re.test(lower));
  });

  const isDraftMode = mode === "draft";
  const isLegalDraftRequest =
    isDraftMode &&
    /(notice|legal|affidavit|application|petition|deed|agreement|complaint|talaq|divorce)/i.test(cleanPrompt);

  if (!isLegalDraftRequest) {
    return {
      route: "ai_generation",
      isLegalDraftRequest: false,
      matchedTemplate: null,
      extracted,
      warning: null
    };
  }

  if (!matchedTemplate) {
    return {
      route: "cautious_skeleton",
      isLegalDraftRequest: true,
      matchedTemplate: null,
      extracted,
      warning:
        "No approved Bangladesh legal template is configured for this draft type. Generate only a structured skeleton and require expert review."
    };
  }

  if (matchedTemplate.approvedTemplateExists && matchedTemplate.finalDraftAllowed) {
    return {
      route: "approved_template",
      isLegalDraftRequest: true,
      matchedTemplate,
      extracted,
      warning: null
    };
  }

  return {
    route: "cautious_skeleton",
    isLegalDraftRequest: true,
    matchedTemplate,
    extracted,
    warning:
      "This is legally sensitive or lacks an approved Bangladesh template. Generate only a cautious structured skeleton and state that expert review is required."
  };
}

export function buildRegistryOutput(policy) {
  if (!policy) return "";

  if (policy.route === "approved_template") {
    return buildApprovedTemplate(policy);
  }

  if (policy.route === "cautious_skeleton") {
    return buildCautiousSkeleton(policy);
  }

  return "";
}

function buildApprovedTemplate(policy) {
  const tpl = policy.matchedTemplate;
  if (!tpl) return "";

  // For now, no approved final BD template is enabled.
  return buildCautiousSkeleton(policy);
}

function buildCautiousSkeleton(policy) {
  const tpl = policy.matchedTemplate;
  const f = policy.extracted || {};

  if (tpl?.id === "talaq_notice_bd") {
    return [
      "BANGLADESH LAW / PROFESSIONAL REVIEW CAUTION",
      "This is only a general structured draft skeleton for discussion and review.",
      "It is not a confirmed final Bangladesh-law compliant notice.",
      "It must be reviewed and finalized by a qualified lawyer or other competent expert before use.",
      "",
      "PROPOSED DRAFT SKELETON — TALAQ-RELATED NOTICE",
      "",
      "From:",
      `${f.husband_name || "[Husband Name]"}`,
      `${f.address_husband || "[Husband Address]"}`,
      "",
      "To:",
      `${f.wife_name || "[Wife Name]"}`,
      `${f.address_wife || "[Wife Address]"}`,
      "",
      `Date: ${f.date || "[Date]"}`,
      "",
      "Subject: Notice relating to talaq",
      "",
      `Dear ${f.wife_name || "[Wife Name]"},`,
      "",
      "This notice is issued in relation to talaq and associated matters, subject to the applicable law, procedure, and competent legal/religious review where required.",
      "",
      "Relevant particulars:",
      `1. Husband's name: ${f.husband_name || "[Husband Name]"}`,
      `2. Wife's name: ${f.wife_name || "[Wife Name]"}`,
      `3. Date of marriage: ${f.date_of_marriage || "[Date of Marriage]"}`,
      `4. Place of marriage: ${f.place_of_marriage || "[Place of Marriage]"}`,
      "",
      "Statement section:",
      "[Insert the exact legally reviewed wording here.]",
      "",
      "Additional matters, if applicable:",
      "- Dower / mahr: [Details]",
      "- Maintenance: [Details]",
      "- Child-related matters: [Details]",
      "- Supporting documents: [Details]",
      "",
      "This structured draft should not be treated as a final legal instrument unless it has been reviewed and approved under the applicable Bangladesh legal framework.",
      "",
      "Sincerely,",
      "",
      `${f.husband_name || "[Husband Name]"}`,
      "Signature: ________________________",
      "",
      "MISSING INFORMATION CHECKLIST",
      `- Husband name: ${check(f.husband_name)}`,
      `- Wife name: ${check(f.wife_name)}`,
      `- Date: ${check(f.date)}`,
      `- Husband address: ${check(f.address_husband)}`,
      `- Wife address: ${check(f.address_wife)}`,
      `- Date of marriage: ${check(f.date_of_marriage)}`,
      `- Place of marriage: ${check(f.place_of_marriage)}`,
      "",
      "FINAL NOTE",
      "This output is intentionally cautious because law overrides model freedom."
    ].join("\n");
  }

  return [
    "BANGLADESH LAW / PROFESSIONAL REVIEW CAUTION",
    "No approved final Bangladesh template is configured for this document type.",
    "Below is a structured skeleton only. It must be reviewed before use.",
    "",
    "DOCUMENT TITLE: [Insert Title]",
    "",
    "From:",
    "[Sender Name]",
    "[Sender Address]",
    "",
    "To:",
    "[Recipient Name]",
    "[Recipient Address]",
    "",
    "Date: [Date]",
    "",
    "Subject: [Subject]",
    "",
    "Body:",
    "[Insert legally reviewed content here.]",
    "",
    "Signature:",
    "[Name / Signature]",
    "",
    "MISSING INFORMATION CHECKLIST",
    "- Sender details",
    "- Recipient details",
    "- Facts",
    "- Legal basis",
    "- Relief / demand",
    "",
    "FINAL NOTE",
    "This is a skeleton, not an approved final legal draft."
  ].join("\n");
}

function extractKnownFields(text) {
  return {
    husband_name: capture(text, [
      "husband name is",
      "husband is"
    ]),
    wife_name: capture(text, [
      "wife name is",
      "wife is",
      "name is"
    ]),
    address_husband: capture(text, [
      "husband address is"
    ]),
    address_wife: capture(text, [
      "wife address is"
    ]),
    date: capture(text, [
      "date is"
    ]),
    date_of_marriage: capture(text, [
      "date of marriage is",
      "marriage date is"
    ]),
    place_of_marriage: capture(text, [
      "place of marriage is",
      "marriage place is"
    ])
  };
}

function capture(text, patterns) {
  for (const p of patterns) {
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+([A-Za-z0-9,./' -]+)", "i");
    const match = text.match(re);
    if (match && match[1]) return match[1].trim();
  }
  return "";
}

function check(value) {
  return value ? "provided" : "missing";
}
