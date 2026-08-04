// Shared review contract. Keep this dependency-free so it also works in tests.
(function (global) {
  const VERSION = 2;
  const kinds = {
    summary: {
      type: "object", additionalProperties: false,
      required: ["diagnosis", "evidence", "complexity", "first_hint"],
      properties: {
        diagnosis: { type: "string" },
        evidence: { type: "array", items: { type: "string" }, maxItems: 4 },
        complexity: { type: "object", required: ["time", "space"], properties: { time: { type: "string" }, space: { type: "string" } } },
        first_hint: { type: "string" },
        optimality: { type: "string" },
        code_quality: { type: "array", items: { type: "string" }, maxItems: 4 }
      }
    },
    rejectedDetails: {
      type: "object", additionalProperties: false,
      required: ["critique", "hints"],
      properties: {
        critique: { type: "array", items: { type: "string" }, maxItems: 5 },
        hints: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 }
      }
    },
    acceptedDetails: {
      type: "object", additionalProperties: false,
      required: ["improvements", "approaches"],
      properties: {
        improvements: { type: "array", items: { type: "string" }, maxItems: 5 },
        approaches: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", required: ["name", "idea", "steps", "correctness", "time_complexity", "space_complexity", "tradeoffs", "code"], properties: { name: { type: "string" }, idea: { type: "string" }, steps: { type: "array", items: { type: "string" }, minItems: 2 }, correctness: { type: "string" }, time_complexity: { type: "string" }, space_complexity: { type: "string" }, tradeoffs: { type: "string" }, code: { type: "string" } } } }
      }
    }
  };

  function isString(x) { return typeof x === "string" && x.trim().length > 0; }
  function validate(stage, value, accepted) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Response must be an object.";
    const shape = kinds[stage];
    if (!shape) return "Unknown review stage.";
    for (const key of shape.required) if (!(key in value)) return "Missing " + key + ".";
    if (stage === "summary") {
      if (!isString(value.diagnosis) || !isString(value.first_hint)) return "Summary text is missing.";
      if (!value.complexity || !isString(value.complexity.time) || !isString(value.complexity.space)) return "Summary complexity is missing.";
    }
    if (stage === "rejectedDetails") {
      if (!Array.isArray(value.critique) || !Array.isArray(value.hints)) return "Rejected details must contain lists.";
      const leak = JSON.stringify(value).toLowerCase();
      if (/```|#include|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\(|\bpublic\s+static\s+void\b|\bfor\s*\(|\bwhile\s*\(/.test(leak)) return "Rejected details contain solution-like code.";
    }
    if (stage === "acceptedDetails") {
      if (!Array.isArray(value.approaches) || value.approaches.length < 2 || value.approaches.length > 4) return "Accepted details need 2–4 approaches.";
      for (const a of value.approaches) {
        if (!a || !["name", "idea", "correctness", "time_complexity", "space_complexity", "tradeoffs", "code"].every((k) => isString(a[k])) || !Array.isArray(a.steps) || a.steps.length < 2) return "An approach is incomplete.";
        if (a.code.trim().length < 20) return "An approach has no complete code.";
      }
    }
    return null;
  }

  function strictify(schema) {
    const copy = JSON.parse(JSON.stringify(schema));
    (function walk(node) { if (!node || typeof node !== "object") return; if (node.type === "object") node.additionalProperties = false; if (node.properties) Object.values(node.properties).forEach(walk); if (node.items) walk(node.items); })(copy);
    return copy;
  }
  function jsonSchema(stage) { return { name: "cses_" + stage, strict: true, schema: strictify(kinds[stage]) }; }
  global.CSESReviewSchema = { VERSION, kinds, validate, jsonSchema };
})(typeof self !== "undefined" ? self : globalThis);
