// Extract the useful task content from CSES HTML without relying on DOM APIs
// that are unavailable in an MV3 service worker.
(function (global) {
  function classList(openingTag) {
    const match = openingTag.match(/\bclass\s*=\s*(["'])(.*?)\1/i);
    return match ? match[2].split(/\s+/) : [];
  }

  function elementHtml(html, tagName, className) {
    const opening = new RegExp("<" + tagName + "\\b[^>]*>", "gi");
    let open;
    while ((open = opening.exec(html))) {
      if (!classList(open[0]).includes(className)) continue;

      const innerStart = opening.lastIndex;
      const tags = new RegExp("<\\/?" + tagName + "\\b[^>]*>", "gi");
      tags.lastIndex = innerStart;
      let depth = 1;
      let token;
      while ((token = tags.exec(html))) {
        if (/^<\//.test(token[0])) depth -= 1;
        else depth += 1;
        if (depth === 0) return html.slice(innerStart, token.index);
      }
      return "";
    }
    return "";
  }

  function textFromHtml(html) {
    return String(html || "")
      .replace(/<\/(?:p|h[1-6]|li|pre|div|ul|ol)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extract(html) {
    const taskHtml = elementHtml(html, "div", "md");
    const constraintsHtml = elementHtml(html, "ul", "task-constraints");
    const plain = textFromHtml(taskHtml || html);
    const sections = plain.split(/\n(?=(?:Input|Output|Constraints|Example|Sample)\b)/i);
    const take = (name) => sections
      .filter((part) => new RegExp("^" + name + "\\b", "i").test(part.trim()))
      .join("\n\n");
    // Sample blocks contain their own Input and Output headings, so they
    // cannot use the generic heading splitter above.
    const sampleMatch = plain.match(/(?:^|\n)(?:Example|Sample)\b[\s\S]*$/i);
    const supplementalStart = plain.search(/(?:^|\n)(?:Constraints|Example|Sample)\b/i);
    const statement = supplementalStart >= 0 ? plain.slice(0, supplementalStart).trim() : plain;
    const pageLimits = textFromHtml(constraintsHtml);
    const constraints = [pageLimits, take("Constraints")].filter(Boolean).join("\n\n");

    return {
      // Constraints and samples are supplied separately. Removing them here
      // prevents paying for the same context twice in every review.
      problem_statement: statement.slice(0, 8000),
      constraints: constraints.slice(0, 2400) || "Not explicitly listed",
      samples: (sampleMatch ? sampleMatch[0].trim() : "").slice(0, 2400) || "Not explicitly listed",
    };
  }

  global.CSESReviewProblemContext = { extract };
})(typeof self !== "undefined" ? self : globalThis);
