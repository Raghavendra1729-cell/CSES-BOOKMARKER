// Scrape CSES result / task pages for post-submission review input.
(function () {
  function text(el) {
    return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim();
  }

  function idFromHref(href) {
    const m = (href || "").match(/\/problemset\/task\/(\d+)/);
    return m ? m[1] : null;
  }

  function resultIdFromPath() {
    const m = (location.pathname || "").match(/\/problemset\/result\/(\d+)/);
    return m ? m[1] : null;
  }

  function findCode() {
    // Common CSES layouts: <pre>, syntax-highlighted blocks, or raw source tables.
    const candidates = [
      document.querySelector("pre code"),
      document.querySelector("pre"),
      document.querySelector(".prettyprint"),
      document.querySelector("#source"),
      document.querySelector("textarea#source"),
      document.querySelector("textarea"),
    ].filter(Boolean);

    for (const el of candidates) {
      const t = (el.value != null ? el.value : el.textContent) || "";
      if (t.trim().length > 0) return t.replace(/\r\n/g, "\n");
    }

    // Fallback: largest <pre> on the page
    let best = "";
    document.querySelectorAll("pre").forEach((pre) => {
      const t = pre.textContent || "";
      if (t.length > best.length) best = t;
    });
    return best.replace(/\r\n/g, "\n");
  }

  function parseAccepted(verdict) {
    const v = (verdict || "").toLowerCase();
    return v.includes("accept") || v === "ac" || /\baccepted\b/.test(v);
  }

  function normalizeVerdict(raw) {
    const s = (raw || "").trim();
    if (!s) return "Unknown";
    const lower = s.toLowerCase();
    if (lower.includes("accept")) return "Accepted";
    if (lower.includes("wrong") || lower === "wa") return "Wrong Answer";
    if (lower.includes("time limit") || lower.includes("tle")) return "Time Limit Exceeded";
    if (lower.includes("memory limit") || lower.includes("mle")) return "Memory Limit Exceeded";
    if (lower.includes("runtime error") || /\bruntime\b/.test(lower))
      return "Runtime Error";
    if (lower.includes("compil")) return "Compilation Error";
    if (lower.includes("output limit")) return "Output Limit Exceeded";
    return s;
  }

  function scrapeFromTables() {
    const out = {};
    document.querySelectorAll("table tr").forEach((tr) => {
      const cells = tr.querySelectorAll("td, th");
      if (cells.length < 2) return;
      const key = text(cells[0]).toLowerCase().replace(/:$/, "");
      const val = text(cells[1]);
      if (!key || !val) return;

      if (key.includes("verdict") || key === "result" || key === "status") {
        out.verdictRaw = val;
      } else if (key.includes("language") || key === "lang") {
        out.language = val;
      } else if (key === "time" || key.includes("time")) {
        const m = val.match(/([\d.]+)\s*ms/i);
        if (m) out.time_ms = Math.round(parseFloat(m[1]));
        else {
          const s = val.match(/([\d.]+)\s*s/i);
          if (s) out.time_ms = Math.round(parseFloat(s[1]) * 1000);
        }
      } else if (key.includes("memory")) {
        const kb = val.match(/([\d.]+)\s*k/i);
        const mb = val.match(/([\d.]+)\s*m/i);
        if (kb) out.memory_kb = Math.round(parseFloat(kb[1]));
        else if (mb) out.memory_kb = Math.round(parseFloat(mb[1]) * 1024);
      } else if (key.includes("test") && (key.includes("fail") || key.includes("case"))) {
        out.failed_test = val;
      }
    });
    return out;
  }

  function scrapeVerdictFallback() {
    // Do not infer this submission's result from the sidebar score icon: it
    // represents whether the problem was solved at some point and can remain
    // full after a later rejected re-submission. That would expose the
    // accepted-review response shape for an incorrect attempt.
    const bodyText = text(document.body);
    const patterns = [
      /Wrong Answer/i,
      /Time Limit Exceeded/i,
      /Memory Limit Exceeded/i,
      /Runtime Error/i,
      /Compilation Error/i,
      /Output Limit Exceeded/i,
      /Accepted/i,
    ];
    for (const re of patterns) {
      const m = bodyText.match(re);
      if (m) return m[0];
    }
    return null;
  }

  function scrapeFailedTest() {
    const body = text(document.body);
    const m =
      body.match(/test\s*(?:case)?\s*#?\s*(\d+)/i) ||
      body.match(/on\s+test\s+(\d+)/i) ||
      body.match(/failed\s+on\s+test\s+(\d+)/i);
    return m ? m[1] : null;
  }

  function scrapeProblemMeta() {
    let problem_id = null;
    let problem_name = "";
    let category = "";

    const taskLink = document.querySelector('a[href*="/problemset/task/"]');
    if (taskLink) {
      problem_id = idFromHref(taskLink.getAttribute("href"));
      problem_name = text(taskLink);
    }

    const h1 = document.querySelector("h1");
    if (h1 && !problem_name) problem_name = text(h1);

    const current = document.querySelector(".nav.sidebar a.current");
    if (current) {
      if (!problem_id) problem_id = idFromHref(current.getAttribute("href"));
      if (!problem_name) problem_name = text(current).replace(/\d+\s*$/, "").trim();
      let node = current.previousElementSibling;
      while (node && node.tagName !== "H4") node = node.previousElementSibling;
      if (node) category = text(node);
    }

    return { problem_id, problem_name, category };
  }

  function scrapeLimitsFromTaskPageDoc(doc) {
    // Optional: if we ever fetch the task page HTML
    const out = {};
    const t = text(doc.body);
    const tl = t.match(/Time\s*limit:\s*([^\n]+)/i);
    const ml = t.match(/Memory\s*limit:\s*([^\n]+)/i);
    if (tl) out.time_limit = tl[1].trim();
    if (ml) out.memory_limit = ml[1].trim();
    return out;
  }

  function scrapeSubmission() {
    const table = scrapeFromTables();
    const meta = scrapeProblemMeta();
    let verdictRaw = table.verdictRaw || scrapeVerdictFallback() || "";
    const verdict = normalizeVerdict(verdictRaw);
    const accepted = parseAccepted(verdict);
    const code = findCode();
    const failed =
      table.failed_test != null ? table.failed_test : accepted ? null : scrapeFailedTest();

    return {
      result_id: resultIdFromPath(),
      problem_id: meta.problem_id,
      problem_name: meta.problem_name,
      category: meta.category,
      language: table.language || null,
      verdict,
      accepted,
      failed_test: failed,
      time_ms: table.time_ms != null ? table.time_ms : null,
      memory_kb: table.memory_kb != null ? table.memory_kb : null,
      time_limit: null,
      memory_limit: null,
      problem_statement: null,
      code,
    };
  }

  globalThis.CSESReviewScrape = {
    scrapeSubmission,
    scrapeLimitsFromTaskPageDoc,
    resultIdFromPath,
    idFromHref,
  };
})();
