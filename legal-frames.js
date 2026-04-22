export function detectLegalIntent(prompt) {
  const text = prompt.toLowerCase();

  if (text.includes("talaq") || text.includes("divorce")) {
    return "talaq_notice";
  }

  if (text.includes("plaint")) {
    return "plaint";
  }

  if (text.includes("notice")) {
    return "general_notice";
  }

  return "general";
}

export function getLegalFrame(intent) {
  if (intent === "talaq_notice") {
    return {
      law: "Muslim Family Laws Ordinance (MFLO), 1961 (Bangladesh)",
      rules: [
        "Talaq notice must follow the legally proper Bangladesh process.",
        "Do not randomly address the wrong person or authority.",
        "Date of pronouncement must be clear where applicable.",
        "Required legal route matters more than generic wording."
      ],
      mustHave: [
        "Correct legal addressee or authority",
        "Identity of issuing party",
        "Identity of opposite party",
        "Core legal statement",
        "Date",
        "Signature block"
      ],
      criticalQuestion:
        "Who is issuing the talaq, and who is the intended legal addressee for your use case?"
    };
  }

  if (intent === "plaint") {
    return {
      law: "Civil Procedure / Bangladesh pleading structure",
      mustHave: [
        "Court name",
        "Parties",
        "Cause of action",
        "Jurisdiction",
        "Reliefs"
      ]
    };
  }

  if (intent === "general_notice") {
    return {
      law: "General legal / business notice structure",
      mustHave: [
        "Recipient",
        "Sender",
        "Date",
        "Subject",
        "Facts",
        "Demand or position",
        "Signature"
      ]
    };
  }

  return null;
      }
