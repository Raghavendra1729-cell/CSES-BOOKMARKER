// Renders the post-submission review panel on CSES result pages.
(function () {
  const ROOT_ID = "csesbm-review-root";

  function stars(n) {
    const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return "★".repeat(v) + "☆".repeat(5 - v);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function listBlock(title, items) {
    const wrap = el("section", "csesbm-review-section");
    wrap.appendChild(el("h3", "csesbm-review-h", title));
    const ul = el("ul", "csesbm-review-list");
    (items || []).forEach((item) => {
      const li = el("li", null, String(item));
      ul.appendChild(li);
    });
    if (!items || !items.length) {
      ul.appendChild(el("li", "csesbm-muted", "—"));
    }
    wrap.appendChild(ul);
    return wrap;
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = el("aside", "csesbm-review");
    root.id = ROOT_ID;
    root.setAttribute("aria-label", "Submission review");
    document.body.appendChild(root);
    return root;
  }

  function setState(kind, message) {
    const root = ensureRoot();
    root.innerHTML = "";
    root.className = "csesbm-review is-" + kind;
    const banner = el("div", "csesbm-review-banner", message);
    root.appendChild(banner);
    if (kind === "loading") {
      const spin = el("div", "csesbm-review-loading", "Analyzing submission…");
      root.appendChild(spin);
    }
    requestAnimationFrame(() => root.classList.add("is-visible"));
  }

  function renderError(message) {
    setState("error", message || "Review failed");
  }

  function renderLoading() {
    setState("loading", "AI Review");
  }

  function renderReview(data, submission) {
    const accepted = Boolean(
      data && data._meta && data._meta.accepted != null
        ? data._meta.accepted
        : submission && submission.accepted
    );
    const root = ensureRoot();
    root.innerHTML = "";
    root.className =
      "csesbm-review is-visible " + (accepted ? "is-accepted" : "is-rejected");

    // 1. Verdict banner
    const banner = el(
      "div",
      "csesbm-review-banner",
      (data && data.verdict_summary) ||
        (submission && submission.verdict) ||
        "Review"
    );
    root.appendChild(banner);

    // 2. Code score / approach quality
    const score = el("div", "csesbm-review-score");
    if (!accepted && data.approach_quality != null) {
      score.appendChild(
        el("div", "csesbm-score-main", `Approach ${Number(data.approach_quality).toFixed(1)} / 10`)
      );
      if (data.approach_reason) {
        score.appendChild(el("div", "csesbm-score-reason", data.approach_reason));
      }
    } else if (accepted && data.ratings) {
      const r = data.ratings;
      score.appendChild(
        el(
          "div",
          "csesbm-score-main",
          `Overall ${Number(r.overall != null ? r.overall : 0).toFixed(1)} / 10`
        )
      );
      score.appendChild(
        el(
          "div",
          "csesbm-score-sub",
          `Algorithm ${Number(r.algorithm || 0).toFixed(1)} · Code ${Number(
            r.code_quality || 0
          ).toFixed(1)}`
        )
      );
    }
    if (score.childNodes.length) root.appendChild(score);

    // 3. Tiny hint (rejected only)
    if (!accepted && data.tiny_hint) {
      const hint = el("section", "csesbm-review-section csesbm-hint");
      hint.appendChild(el("h3", "csesbm-review-h", "Tiny hint"));
      hint.appendChild(el("p", "csesbm-hint-text", data.tiny_hint));
      root.appendChild(hint);
    }

    // 4. Review findings
    if (!accepted) {
      root.appendChild(listBlock("Findings", data.code_review));
      if (data.categories) {
        const cat = el("section", "csesbm-review-section");
        cat.appendChild(el("h3", "csesbm-review-h", "Categories"));
        const grid = el("div", "csesbm-cat-grid");
        ["correctness", "efficiency", "readability", "implementation"].forEach(
          (k) => {
            const row = el("div", "csesbm-cat-row");
            row.appendChild(el("span", "csesbm-cat-label", k));
            row.appendChild(
              el("span", "csesbm-cat-stars", stars(data.categories[k]))
            );
            grid.appendChild(row);
          }
        );
        cat.appendChild(grid);
        root.appendChild(cat);
      }
    } else {
      root.appendChild(listBlock("Code quality", data.code_quality));

      // 5. Better approaches
      if (data.is_optimal === false && (data.alternative_approaches || []).length) {
        const alt = el("section", "csesbm-review-section csesbm-warn");
        alt.appendChild(el("h3", "csesbm-review-h", "⚠ Better approaches exist"));
        const ul = el("ul", "csesbm-review-list");
        data.alternative_approaches.forEach((a) =>
          ul.appendChild(el("li", null, String(a)))
        );
        alt.appendChild(ul);
        root.appendChild(alt);
      } else if (data.is_optimal) {
        const opt = el("section", "csesbm-review-section csesbm-ok");
        opt.appendChild(
          el("p", null, "✅ This is already optimal.")
        );
        root.appendChild(opt);
      }

      // 6. Complexity
      const cx = el("section", "csesbm-review-section");
      cx.appendChild(el("h3", "csesbm-review-h", "Complexity"));
      cx.appendChild(
        el(
          "p",
          "csesbm-mono",
          `Time  ${data.time_complexity || "—"}`
        )
      );
      cx.appendChild(
        el(
          "p",
          "csesbm-mono",
          `Space ${data.space_complexity || "—"}`
        )
      );
      root.appendChild(cx);

      // 7. Improvements
      root.appendChild(listBlock("Improvements", data.improvements));
    }

    const foot = el("footer", "csesbm-review-foot");
    const close = el("button", "csesbm-review-close", "Dismiss");
    close.type = "button";
    close.addEventListener("click", () => root.remove());
    foot.appendChild(close);
    root.appendChild(foot);
  }

  globalThis.CSESReviewPanel = {
    renderLoading,
    renderReview,
    renderError,
  };
})();
