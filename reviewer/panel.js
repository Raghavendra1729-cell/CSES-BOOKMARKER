// Post-submission review panel — draggable, scannable, learn-mode on AC.
(function () {
  const ROOT_ID = "csesbm-review-root";
  const POS_KEY = "csesbm:reviewPanelPos";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function fmtScore(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toFixed(1);
  }

  function shortText(s, max) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + "…";
  }

  function loadPos() {
    try {
      const raw = sessionStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.left === "number" && typeof p.top === "number") return p;
    } catch (_e) {
      /* ignore */
    }
    return null;
  }

  function savePos(left, top) {
    try {
      sessionStorage.setItem(POS_KEY, JSON.stringify({ left, top }));
    } catch (_e) {
      /* ignore */
    }
  }

  function applyDefaultPlacement(root) {
    const saved = loadPos();
    root.style.bottom = "auto";
    root.style.right = "auto";
    if (saved) {
      placeAt(root, saved.left, saved.top);
    } else {
      // Default: top-right, clear of timer
      const w = root.offsetWidth || 400;
      const left = Math.max(12, window.innerWidth - w - 12);
      placeAt(root, left, 12);
    }
  }

  function placeAt(root, left, top) {
    const rect = root.getBoundingClientRect();
    const w = rect.width || 400;
    const h = rect.height || 320;
    const maxL = Math.max(8, window.innerWidth - w - 8);
    const maxT = Math.max(8, window.innerHeight - Math.min(h, window.innerHeight - 16) - 8);
    const l = clamp(left, 8, maxL);
    const t = clamp(top, 8, maxT);
    root.style.left = l + "px";
    root.style.top = t + "px";
    return { left: l, top: t };
  }

  function enableDrag(root, handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origL = 0;
    let origT = 0;

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      // Don't start drag from buttons inside header
      if (e.target && e.target.closest && e.target.closest("button")) return;
      dragging = true;
      root.classList.add("is-dragging");
      const rect = root.getBoundingClientRect();
      origL = rect.left;
      origT = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
    }

    function onMove(e) {
      if (!dragging) return;
      placeAt(root, origL + (e.clientX - startX), origT + (e.clientY - startY));
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("is-dragging");
      const rect = root.getBoundingClientRect();
      savePos(rect.left, rect.top);
    }

    handle.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = el("aside", "csesbm-review");
    root.id = ROOT_ID;
    root.setAttribute("aria-label", "Submission review");
    root.setAttribute("role", "complementary");
    document.body.appendChild(root);
    return root;
  }

  function finishMount(root) {
    // Disable enter animation transform conflict with left/top placement
    root.classList.add("is-placed");
    requestAnimationFrame(() => {
      applyDefaultPlacement(root);
      root.classList.add("is-visible");
    });
  }

  function header(opts) {
    const head = el("header", "csesbm-rv-header");
    head.title = "Drag to move";

    const grip = el("div", "csesbm-rv-grip");
    grip.setAttribute("aria-hidden", "true");
    grip.innerHTML = "<span></span><span></span><span></span>";
    head.appendChild(grip);

    const main = el("div", "csesbm-rv-header-main");
    const eyebrow = el("div", "csesbm-rv-eyebrow");
    const pill = el("span", "csesbm-rv-pill");
    pill.appendChild(el("span", "csesbm-rv-pill-dot"));
    pill.appendChild(document.createTextNode(opts.pill || "Review"));
    eyebrow.appendChild(pill);
    eyebrow.appendChild(el("span", "csesbm-rv-brand", "Drag me"));
    main.appendChild(eyebrow);
    main.appendChild(el("h2", "csesbm-rv-title", opts.title || "Review"));
    if (opts.meta) main.appendChild(el("div", "csesbm-rv-meta", opts.meta));
    head.appendChild(main);

    const close = el("button", "csesbm-rv-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss review");
    close.addEventListener("click", () => {
      const root = document.getElementById(ROOT_ID);
      if (root) root.remove();
    });
    head.appendChild(close);
    return head;
  }

  function formatSavedAt(ts) {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_e) {
      return "";
    }
  }

  function footer(note, actions) {
    const foot = el("footer", "csesbm-rv-foot");
    foot.appendChild(el("span", "csesbm-rv-foot-note", note || "Drag header to move"));
    const btns = el("div", "csesbm-rv-foot-actions");
    (actions || []).forEach((a) => {
      if (!a) return;
      const btn = el(
        "button",
        "csesbm-rv-btn" + (a.primary ? " is-primary" : ""),
        a.label
      );
      btn.type = "button";
      if (a.title) btn.title = a.title;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (a.onClick) a.onClick();
      });
      btns.appendChild(btn);
    });
    if (!actions || !actions.length) {
      const btn = el("button", "csesbm-rv-btn", "Dismiss");
      btn.type = "button";
      btn.addEventListener("click", () => {
        const root = document.getElementById(ROOT_ID);
        if (root) root.remove();
      });
      btns.appendChild(btn);
    }
    foot.appendChild(btns);
    return foot;
  }

  function listSection(title, items, variant) {
    const sec = el("section", "csesbm-rv-section");
    sec.appendChild(el("h3", "csesbm-rv-h", title));
    const arr = (items || [])
      .filter((x) => x != null && String(x).trim() !== "")
      .slice(0, 5)
      .map((x) => shortText(x, 90));
    if (!arr.length) {
      sec.appendChild(el("div", "csesbm-rv-empty", "Nothing flagged."));
      return sec;
    }
    const ul = el(
      "ul",
      "csesbm-rv-list" + (variant === "checks" ? " csesbm-rv-checks" : "")
    );
    arr.forEach((item, i) => {
      const li = el("li", null, item);
      if (variant !== "checks") li.setAttribute("data-n", String(i + 1));
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    return sec;
  }

  function scoreBand(score, label, reason, subs) {
    const band = el("div", "csesbm-rv-scoreband");
    const pct = clamp((Number(score) / 10) * 100, 0, 100);
    const ring = el("div", "csesbm-rv-score-ring");
    ring.style.setProperty("--rv-pct", String(pct));
    const num = el("div", "csesbm-rv-score-num");
    num.appendChild(document.createTextNode(fmtScore(score)));
    num.appendChild(el("small", null, "/10"));
    ring.appendChild(num);
    band.appendChild(ring);

    const copy = el("div", "csesbm-rv-score-copy");
    copy.appendChild(el("div", "csesbm-rv-score-label", label));
    if (reason) {
      copy.appendChild(el("div", "csesbm-rv-score-reason", shortText(reason, 100)));
    }
    if (subs && subs.length) {
      const row = el("div", "csesbm-rv-score-subs");
      subs.forEach((s) => {
        const chip = el("span", "csesbm-rv-chip");
        chip.appendChild(document.createTextNode(s.label + " "));
        chip.appendChild(el("strong", null, fmtScore(s.value)));
        row.appendChild(chip);
      });
      copy.appendChild(row);
    }
    band.appendChild(copy);
    return band;
  }

  function categoriesSection(cats) {
    const sec = el("section", "csesbm-rv-section");
    sec.appendChild(el("h3", "csesbm-rv-h", "Categories"));
    const grid = el("div", "csesbm-rv-cats");
    ["correctness", "efficiency", "readability", "implementation"].forEach((k) => {
      const raw = Number(cats[k]);
      const stars = clamp(Math.round(Number.isFinite(raw) ? raw : 0), 0, 5);
      const row = el("div", "csesbm-rv-cat");
      row.appendChild(el("span", "csesbm-rv-cat-label", k));
      row.appendChild(el("span", "csesbm-rv-cat-val", stars + " / 5"));
      const bar = el("div", "csesbm-rv-cat-bar");
      const fill = el("div", "csesbm-rv-cat-fill");
      fill.style.setProperty("--rv-fill", String((stars / 5) * 100));
      bar.appendChild(fill);
      row.appendChild(bar);
      grid.appendChild(row);
    });
    sec.appendChild(grid);
    return sec;
  }

  function complexitySection(data) {
    const sec = el("section", "csesbm-rv-section");
    sec.appendChild(el("h3", "csesbm-rv-h", "Complexity"));
    const grid = el("div", "csesbm-rv-cx");
    [
      ["Time", data.time_complexity],
      ["Space", data.space_complexity],
    ].forEach(([k, v]) => {
      const card = el("div", "csesbm-rv-cx-card");
      card.appendChild(el("div", "csesbm-rv-cx-k", k));
      card.appendChild(el("div", "csesbm-rv-cx-v", v || "—"));
      grid.appendChild(card);
    });
    sec.appendChild(grid);
    return sec;
  }

  function normalizeApproaches(data) {
    // New shape: better_approaches[{name,why,complexity,code}]
    // Legacy: alternative_approaches[string]
    const out = [];
    const modern = data && data.better_approaches;
    if (Array.isArray(modern) && modern.length) {
      modern.forEach((a) => {
        if (!a) return;
        if (typeof a === "string") {
          out.push({ name: a, why: "", complexity: "", code: "" });
        } else {
          out.push({
            name: a.name || a.title || "Approach",
            why: a.why || a.reason || "",
            complexity: a.complexity || "",
            code: a.code || a.snippet || "",
          });
        }
      });
      return out.slice(0, 2);
    }
    const legacy = data && data.alternative_approaches;
    if (Array.isArray(legacy)) {
      legacy.forEach((a) => {
        if (typeof a === "string") out.push({ name: a, why: "", complexity: "", code: "" });
        else if (a && typeof a === "object") {
          out.push({
            name: a.name || "Approach",
            why: a.why || "",
            complexity: a.complexity || "",
            code: a.code || "",
          });
        }
      });
    }
    return out.slice(0, 2);
  }

  function approachesSection(data) {
    const approaches = normalizeApproaches(data);
    const sec = el("section", "csesbm-rv-section csesbm-rv-learn");
    sec.appendChild(el("h3", "csesbm-rv-h", "Learn — better approaches"));

    if (data.is_optimal && !approaches.length) {
      const box = el("div", "csesbm-rv-banner-msg is-ok");
      box.textContent = "Solid approach for typical CSES limits.";
      sec.appendChild(box);
      return sec;
    }

    if (!approaches.length) {
      sec.appendChild(el("div", "csesbm-rv-empty", "No alternate listed."));
      return sec;
    }

    approaches.forEach((ap, idx) => {
      const card = el("article", "csesbm-rv-approach");
      const top = el("div", "csesbm-rv-approach-top");
      top.appendChild(el("span", "csesbm-rv-approach-idx", String(idx + 1)));
      const titles = el("div", "csesbm-rv-approach-titles");
      titles.appendChild(el("div", "csesbm-rv-approach-name", ap.name || "Approach"));
      if (ap.why) {
        titles.appendChild(el("div", "csesbm-rv-approach-why", shortText(ap.why, 120)));
      }
      if (ap.complexity) {
        titles.appendChild(
          el("div", "csesbm-rv-approach-cx", shortText(ap.complexity, 60))
        );
      }
      top.appendChild(titles);
      card.appendChild(top);

      if (ap.code && String(ap.code).trim()) {
        const preWrap = el("div", "csesbm-rv-code-wrap");
        const bar = el("div", "csesbm-rv-code-bar");
        bar.appendChild(el("span", null, "code"));
        const copyBtn = el("button", "csesbm-rv-copy", "Copy");
        copyBtn.type = "button";
        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(String(ap.code));
            copyBtn.textContent = "Copied";
            setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
          } catch (_e) {
            copyBtn.textContent = "Failed";
            setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
          }
        });
        bar.appendChild(copyBtn);
        preWrap.appendChild(bar);
        const pre = el("pre", "csesbm-rv-code");
        pre.appendChild(el("code", null, String(ap.code).trim()));
        preWrap.appendChild(pre);
        card.appendChild(preWrap);
      }

      sec.appendChild(card);
    });

    return sec;
  }

  function wireChrome(root) {
    const head = root.querySelector(".csesbm-rv-header");
    if (head) enableDrag(root, head);
  }

  function setState(kind, title, bodyNode) {
    const root = ensureRoot();
    root.innerHTML = "";
    root.className = "csesbm-review is-" + kind;
    root.appendChild(
      header({
        pill: kind === "loading" ? "Working" : kind === "error" ? "Error" : "Review",
        title: title,
      })
    );
    if (bodyNode) root.appendChild(bodyNode);
    root.appendChild(
      footer(kind === "error" ? "Fix setup, then resubmit" : "Drag header to move")
    );
    wireChrome(root);
    finishMount(root);
  }

  function renderLoading() {
    const body = el("div", "csesbm-rv-loading");
    const row = el("div", "csesbm-rv-loading-row");
    row.appendChild(el("div", "csesbm-rv-spinner"));
    row.appendChild(el("div", "csesbm-rv-loading-text", "Analyzing…"));
    body.appendChild(row);
    const sk = el("div", "csesbm-rv-skeleton");
    sk.appendChild(el("div", "csesbm-rv-skel"));
    sk.appendChild(el("div", "csesbm-rv-skel"));
    sk.appendChild(el("div", "csesbm-rv-skel"));
    body.appendChild(sk);
    setState("loading", "Running review", body);
  }

  function renderError(message) {
    const body = el(
      "div",
      "csesbm-rv-error-body",
      shortText(message || "Review failed", 280)
    );
    setState("error", "Could not review", body);
  }

  function metaLine(submission, data) {
    const bits = [];
    if (submission && submission.problem_name) {
      bits.push(shortText(submission.problem_name, 40));
    }
    if (submission && submission.language) bits.push(submission.language);
    return bits.join(" · ");
  }

  function renderReview(data, submission, opts) {
    opts = opts || {};
    const fromCache = Boolean(opts.fromCache);
    const accepted = Boolean(
      data && data._meta && data._meta.accepted != null
        ? data._meta.accepted
        : submission && submission.accepted
    );

    const root = ensureRoot();
    root.innerHTML = "";
    root.className =
      "csesbm-review " + (accepted ? "is-accepted" : "is-rejected");

    const verdict = shortText(
      (data && data.verdict_summary) ||
        (submission && submission.verdict) ||
        (accepted ? "Accepted" : "Rejected"),
      80
    );

    const metaBits = [metaLine(submission, data)];
    if (fromCache) metaBits.push("saved review");
    const when = formatSavedAt(opts.savedAt);
    if (when) metaBits.push(when);

    root.appendChild(
      header({
        pill: fromCache ? "Saved" : accepted ? "Accepted" : "Rejected",
        title: verdict,
        meta: metaBits.filter(Boolean).join(" · "),
      })
    );

    if (fromCache) {
      const banner = el("div", "csesbm-rv-cache-banner");
      banner.textContent =
        "Showing saved review for this submission. Use New review to regenerate.";
      root.appendChild(banner);
    }

    if (!accepted && data.approach_quality != null) {
      root.appendChild(
        scoreBand(
          data.approach_quality,
          "Approach",
          data.approach_reason || "",
          null
        )
      );
    } else if (accepted && data.ratings) {
      const r = data.ratings;
      root.appendChild(
        scoreBand(r.overall != null ? r.overall : 0, "Overall", null, [
          { label: "Algo", value: r.algorithm },
          { label: "Code", value: r.code_quality },
        ])
      );
    }

    const body = el("div", "csesbm-rv-body");

    if (!accepted) {
      if (data.tiny_hint) {
        const hint = el("div", "csesbm-rv-hint");
        hint.appendChild(el("h3", "csesbm-rv-h", "Hint"));
        hint.appendChild(
          el("p", "csesbm-rv-hint-text", shortText(data.tiny_hint, 160))
        );
        body.appendChild(hint);
      }
      body.appendChild(listSection("Findings", data.code_review));
      if (data.categories) body.appendChild(categoriesSection(data.categories));
    } else {
      // Learning first — main value after AC
      body.appendChild(approachesSection(data));
      body.appendChild(complexitySection(data));
      body.appendChild(listSection("Polish", data.code_quality));
      body.appendChild(listSection("Improvements", data.improvements, "checks"));
    }

    root.appendChild(body);

    const actions = [];
    if (typeof opts.onRerun === "function") {
      actions.push({
        label: "New review",
        primary: true,
        title: "Call the model again and overwrite the saved review",
        onClick: opts.onRerun,
      });
    }
    actions.push({
      label: "Dismiss",
      onClick: () => {
        const r = document.getElementById(ROOT_ID);
        if (r) r.remove();
      },
    });

    root.appendChild(
      footer(
        fromCache
          ? "Saved · reopen anytime · drag header"
          : accepted
            ? "Saved for this result · drag header"
            : "Saved · hints only · drag header",
        actions
      )
    );
    wireChrome(root);
    finishMount(root);
  }

  globalThis.CSESReviewPanel = {
    renderLoading,
    renderReview,
    renderError,
  };
})();
