(function () {
  const ID = "csesbm-review-root";
  const WIDTH_KEY = "csesbm:reviewPanelWidth";

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function root() {
    let node = document.getElementById(ID);
    if (!node) {
      node = make("aside", "csesbm-review");
      node.id = ID;
      node.setAttribute("aria-label", "CSES submission review");
      document.body.append(node);
    }
    return node;
  }

  function setWidth(node) {
    const value = Math.max(400, Math.min(920, Number(localStorage.getItem(WIDTH_KEY)) || 620));
    node.style.setProperty("--panel-width", value + "px");
  }

  function close(options) {
    if (options && options.onClose) options.onClose();
    const node = document.getElementById(ID);
    if (node) node.remove();
  }

  function button(label, className, handler) {
    const node = make("button", className, label);
    node.type = "button";
    node.onclick = handler;
    return node;
  }

  function header(title, status, options) {
    const node = make("header", "csesbm-rv-header");
    const titleWrap = make("div", "csesbm-rv-heading");
    titleWrap.append(make("span", "csesbm-rv-status", status), make("h2", "csesbm-rv-title", title));
    const actions = make("div", "csesbm-rv-actions");
    if (options && options.onReviewAgain) {
      actions.append(button("Review again", "csesbm-rv-secondary", options.onReviewAgain));
    }
    const closeButton = button("×", "csesbm-rv-close", () => close(options));
    closeButton.setAttribute("aria-label", "Close review");
    actions.append(closeButton);
    node.append(titleWrap, actions);
    return node;
  }

  function section(title, children, extraClass) {
    const node = make("section", "csesbm-rv-section" + (extraClass ? " " + extraClass : ""));
    if (title) node.append(make("h3", "csesbm-rv-h", title));
    (Array.isArray(children) ? children : [children]).filter(Boolean).forEach((child) => node.append(child));
    return node;
  }

  function list(items) {
    const node = make("ul", "csesbm-rv-list");
    (items || []).forEach((item) => node.append(make("li", null, item)));
    return node;
  }

  function badges(current) {
    const node = make("div", "csesbm-rv-complexity");
    node.append(
      make("span", "csesbm-rv-badge", "Time  " + (current.time_complexity || "—")),
      make("span", "csesbm-rv-badge", "Space  " + (current.space_complexity || "—")),
      make("span", "csesbm-rv-badge " + (current.is_optimal ? "is-good" : "is-warn"), current.is_optimal ? "Optimal" : "Can improve")
    );
    return node;
  }

  function resize(node) {
    const grip = make("div", "csesbm-rv-resize");
    grip.onpointerdown = (event) => {
      const startX = event.clientX;
      const startWidth = node.getBoundingClientRect().width;
      grip.setPointerCapture(event.pointerId);
      const move = (next) => {
        const width = Math.max(400, Math.min(920, startWidth + startX - next.clientX));
        node.style.setProperty("--panel-width", width + "px");
      };
      const done = () => {
        localStorage.setItem(WIDTH_KEY, String(Math.round(node.getBoundingClientRect().width)));
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", done);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", done);
    };
    node.append(grip);
  }

  function loading(_stage, options) {
    const node = root();
    node.innerHTML = "";
    node.className = "csesbm-review is-working";
    setWidth(node);
    const body = make("div", "csesbm-rv-loading-wrap");
    body.append(
      make("div", "csesbm-rv-spinner"),
      make("h3", null, "MiniMax is reviewing your submission"),
      make("p", null, "One request only. Accepted solutions take longer because alternatives include complete code.")
    );
    node.append(header("Submission review", "Working", options), body);
    resize(node);
  }

  function codeBlock(code) {
    const wrap = make("div", "csesbm-rv-code-wrap");
    const bar = make("div", "csesbm-rv-code-bar");
    const copy = button("Copy code", "csesbm-rv-copy-btn", async () => {
      try {
        await navigator.clipboard.writeText(code);
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy code"; }, 1200);
      } catch (_) {
        copy.textContent = "Copy failed";
      }
    });
    bar.append(make("span", null, "Complete code"), copy);
    const pre = make("pre", "csesbm-rv-code");
    pre.textContent = code;
    wrap.append(bar, pre);
    return wrap;
  }

  function approachCard(approach, index) {
    const node = make("article", "csesbm-rv-approach");
    const top = make("div", "csesbm-rv-approach-head");
    const label = make("div");
    label.append(make("span", "csesbm-rv-index", String(index + 1)), make("h3", null, approach.name));
    const metrics = make("div", "csesbm-rv-complexity compact");
    metrics.append(
      make("span", "csesbm-rv-badge", approach.time_complexity),
      make("span", "csesbm-rv-badge", approach.space_complexity)
    );
    top.append(label, metrics);
    node.append(
      top,
      make("p", "csesbm-rv-copy", approach.idea),
      section("Trade-off", make("p", "csesbm-rv-copy muted", approach.tradeoffs)),
      codeBlock(approach.code)
    );
    return node;
  }

  function render(review, submission, options) {
    const node = root();
    node.innerHTML = "";
    setWidth(node);
    const accepted = Boolean(submission && submission.accepted);
    node.className = "csesbm-review " + (accepted ? "is-accepted" : "is-rejected");
    const status = accepted ? "Accepted" : (submission.verdict || "Needs work");
    node.append(header(review.verdict_summary || status, status, options));
    const body = make("div", "csesbm-rv-body");

    if (!accepted) {
      const hint = make("div", "csesbm-rv-hint-card");
      hint.append(make("span", "csesbm-rv-hint-icon", "✦"), make("p", null, review.tiny_hint));
      body.append(
        section("What MiniMax noticed", make("p", "csesbm-rv-copy", review.verdict_summary)),
        section("Small hint", hint)
      );
    } else {
      const current = review.current_analysis || {};
      body.append(
        section("Your solution", [make("p", "csesbm-rv-copy", current.correctness), badges(current)], "csesbm-rv-summary-card")
      );
      const split = make("div", "csesbm-rv-split");
      if (review.code_quality && review.code_quality.length) split.append(section("Code quality", list(review.code_quality)));
      if (review.improvements && review.improvements.length) split.append(section("Quick improvements", list(review.improvements)));
      if (split.children.length) body.append(split);
      const alternatives = section("Better or useful alternatives", (review.approaches || []).map(approachCard), "csesbm-rv-alternatives");
      body.append(alternatives);
    }

    if (options && options.fromCache) {
      body.prepend(make("div", "csesbm-rv-cache-note", "Saved review · no new model request"));
    }
    node.append(body);
    resize(node);
  }

  function error(message, options) {
    const node = root();
    node.innerHTML = "";
    node.className = "csesbm-review is-error";
    setWidth(node);
    const body = make("div", "csesbm-rv-error-wrap");
    body.append(make("h3", null, "Review did not finish"), make("p", null, message));
    if (options && options.onRetry) body.append(button("Try once more", "csesbm-rv-primary", options.onRetry));
    node.append(header("Submission review", "Error", options), body);
    resize(node);
  }

  globalThis.CSESReviewPanel = {
    renderLoading: loading,
    renderReview: render,
    renderError: error,
  };
})();
