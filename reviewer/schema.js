// Shared single-response review contract. Dependency-free for extension tests.
(function (global) {
  const VERSION = 3;

  const schemas = {
    accepted: {
      type: "object",
      additionalProperties: false,
      required: ["verdict_summary", "current_analysis", "code_quality", "improvements", "approaches"],
      properties: {
        verdict_summary: { type: "string" },
        current_analysis: {
          type: "object",
          additionalProperties: false,
          required: ["correctness", "time_complexity", "space_complexity", "is_optimal"],
          properties: {
            correctness: { type: "string" },
            time_complexity: { type: "string" },
            space_complexity: { type: "string" },
            is_optimal: { type: "boolean" },
          },
        },
        code_quality: { type: "array", items: { type: "string" }, maxItems: 4 },
        improvements: { type: "array", items: { type: "string" }, maxItems: 5 },
        approaches: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "idea", "time_complexity", "space_complexity", "tradeoffs", "code"],
            properties: {
              name: { type: "string" },
              idea: { type: "string" },
              time_complexity: { type: "string" },
              space_complexity: { type: "string" },
              tradeoffs: { type: "string" },
              code: { type: "string" },
            },
          },
        },
      },
    },
    rejected: {
      type: "object",
      additionalProperties: false,
      required: ["verdict_summary", "tiny_hint"],
      properties: {
        verdict_summary: { type: "string" },
        tiny_hint: { type: "string" },
      },
    },
  };

  function nonEmpty(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function hasOnlyKeys(value, keys) {
    return Object.keys(value).every((key) => keys.includes(key));
  }

  function stringList(value, maxItems) {
    return Array.isArray(value) && value.length <= maxItems && value.every(nonEmpty);
  }

  function validate(value, accepted) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return "Response must be an object.";
    }
    if (!nonEmpty(value.verdict_summary)) return "Verdict summary is missing.";

    if (!accepted) {
      if (!hasOnlyKeys(value, ["verdict_summary", "tiny_hint"])) {
        return "Rejected review has unexpected fields.";
      }
      if (!nonEmpty(value.tiny_hint)) return "Tiny hint is missing.";
      const leak = JSON.stringify(value).toLowerCase();
      if (/```|#include|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|\bpublic\s+static\s+void\b|\bfor\s*\(|\bwhile\s*\(/.test(leak)) {
        return "Rejected review contains solution-like code.";
      }
      return null;
    }

    const current = value.current_analysis;
    if (!hasOnlyKeys(value, ["verdict_summary", "current_analysis", "code_quality", "improvements", "approaches"])) {
      return "Accepted review has unexpected fields.";
    }
    if (!current || !nonEmpty(current.correctness) || !nonEmpty(current.time_complexity) ||
        !nonEmpty(current.space_complexity) || typeof current.is_optimal !== "boolean" ||
        !hasOnlyKeys(current, ["correctness", "time_complexity", "space_complexity", "is_optimal"])) {
      return "Current solution analysis is incomplete.";
    }
    if (!stringList(value.code_quality, 4) || !stringList(value.improvements, 5)) {
      return "Accepted review lists are missing.";
    }
    if (!Array.isArray(value.approaches) || value.approaches.length < 1 || value.approaches.length > 4) {
      return "Accepted review needs 1-4 alternative approaches.";
    }
    for (const approach of value.approaches) {
      if (!approach || !["name", "idea", "time_complexity", "space_complexity", "tradeoffs", "code"].every((key) => nonEmpty(approach[key]))) {
        return "An alternative approach is incomplete.";
      }
      if (!hasOnlyKeys(approach, ["name", "idea", "time_complexity", "space_complexity", "tradeoffs", "code"])) {
        return "An alternative approach has unexpected fields.";
      }
      if (approach.code.trim().length < 20) return "An alternative has no complete code.";
    }
    return null;
  }

  function jsonSchema(accepted) {
    return {
      name: accepted ? "cses_accepted_review" : "cses_rejected_review",
      strict: true,
      schema: schemas[accepted ? "accepted" : "rejected"],
    };
  }

  global.CSESReviewSchema = { VERSION, schemas, validate, jsonSchema };
})(typeof self !== "undefined" ? self : globalThis);
