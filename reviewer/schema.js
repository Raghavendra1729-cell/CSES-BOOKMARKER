// Shared single-response review contract. Dependency-free for extension tests.
(function (global) {
  const VERSION = 4;

  const limits = {
    verdictSummary: 240,
    tinyHint: 280,
    correctness: 600,
    complexity: 120,
    listItem: 240,
    approachName: 120,
    approachIdea: 600,
    tradeoffs: 360,
    code: 8000,
  };

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
        code_quality: { type: "array", items: { type: "string" } },
        improvements: { type: "array", items: { type: "string" } },
        approaches: {
          type: "array",
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

  function within(value, maximum) {
    return nonEmpty(value) && value.length <= maximum;
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
    if (!within(value.verdict_summary, limits.verdictSummary)) return "Verdict summary is missing or too long.";

    if (!accepted) {
      if (!hasOnlyKeys(value, ["verdict_summary", "tiny_hint"])) {
        return "Rejected review has unexpected fields.";
      }
      if (!within(value.tiny_hint, limits.tinyHint)) return "Tiny hint is missing or too long.";
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
    if (!current || !within(current.correctness, limits.correctness) || !within(current.time_complexity, limits.complexity) ||
        !within(current.space_complexity, limits.complexity) || typeof current.is_optimal !== "boolean" ||
        !hasOnlyKeys(current, ["correctness", "time_complexity", "space_complexity", "is_optimal"])) {
      return "Current solution analysis is incomplete.";
    }
    if (!stringList(value.code_quality, 3) || !stringList(value.improvements, 3) ||
        !value.code_quality.every((item) => item.length <= limits.listItem) ||
        !value.improvements.every((item) => item.length <= limits.listItem)) {
      return "Accepted review lists are missing.";
    }
    if (!Array.isArray(value.approaches) || value.approaches.length !== 1) {
      return "Accepted review needs exactly one alternative approach.";
    }
    for (const approach of value.approaches) {
      if (!approach || !within(approach.name, limits.approachName) ||
          !within(approach.idea, limits.approachIdea) ||
          !within(approach.time_complexity, limits.complexity) ||
          !within(approach.space_complexity, limits.complexity) ||
          !within(approach.tradeoffs, limits.tradeoffs) || !within(approach.code, limits.code)) {
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

  global.CSESReviewSchema = { VERSION, limits, schemas, validate, jsonSchema };
})(typeof self !== "undefined" ? self : globalThis);
