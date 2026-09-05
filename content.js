(function () {
  const S = globalThis.CSESBM;
  const STAR_PATH =
    "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

  function idFromHref(href) {
    const m = (href || "").match(/\/problemset\/task\/(\d+)/);
    return m ? m[1] : null;
  }

  // CSES marks an accepted task with `<span class="task-score icon full">`.
  function detectSolved(scope) {
    const el = scope.querySelector(".task-score");
    return Boolean(el && el.classList.contains("full"));
  }

  function setStarState(btn, active) {
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.title = active
      ? "Remove from CSES Bookmarker"
      : "Save to CSES Bookmarker";
    btn.setAttribute("aria-label", btn.title);
  }

  function makeStarButton(id, active) {
    const btn = document.createElement("button");
    btn.className = "csesbm-star";
    btn.type = "button";
    btn.dataset.taskId = id;
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="' +
      STAR_PATH +
      '"></path></svg>';
    setStarState(btn, active);
    return btn;
  }

  async function onToggle(id, meta, btn) {
    const existing = await S.get(id);
    if (existing) {
      await S.remove(id);
      setStarState(btn, false);
      return false;
    }
    await S.put({
      id,
      name: meta.name,
      category: meta.category,
      url: `https://cses.fi/problemset/task/${id}`,
      note: "",
      addedAt: Date.now(),
      status: "todo",
      csesSolved: Boolean(meta.csesSolved),
    });
    setStarState(btn, true);
    return true;
  }

  function attachStar(anchorEl, id, meta, active, opts) {
    opts = opts || {};
    const btn = makeStarButton(id, active);
    if (opts.extraClass) btn.classList.add(opts.extraClass);
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        const active = await onToggle(id, { ...meta, csesSolved: meta.getSolved() }, btn);
        if (opts.onChange) opts.onChange(active);
      } catch (_) {
        btn.title = "Could not update bookmark — click to retry";
        btn.setAttribute("aria-label", btn.title);
      } finally {
        btn.disabled = false;
      }
    });
    if (opts.inside) anchorEl.appendChild(btn);
    else anchorEl.insertAdjacentElement("afterend", btn);
    return btn;
  }

  async function decorateListPage() {
    await S.migrateIfNeeded();
    const map = await S.getMap();

    document.querySelectorAll("h2").forEach((h2) => {
      const list = h2.nextElementSibling;
      if (!list || list.tagName !== "UL" || !list.classList.contains("task-list")) {
        return;
      }
      const category = h2.textContent.trim();

      list.querySelectorAll("li.task").forEach((li) => {
        const a = li.querySelector("a[href*='/problemset/task/']");
        if (!a) return;
        const id = idFromHref(a.getAttribute("href"));
        if (!id) return;

        const name = a.textContent.trim();
        const solved = detectSolved(li);
        const existing = map[id];

        if (existing) li.classList.add("csesbm-marked");

        attachStar(
          a,
          id,
          { name, category, getSolved: () => detectSolved(li) },
          Boolean(existing),
          { onChange: (active) => li.classList.toggle("csesbm-marked", active) }
        );

        // Keep the auto-detected CSES solved flag fresh for saved problems.
        if (existing && existing.csesSolved !== solved) {
          S.patch(id, { csesSolved: solved });
        }
      });
    });
  }

  async function decorateTaskPage() {
    await S.migrateIfNeeded();
    const id = idFromHref(location.pathname);
    if (!id) return;

    const h1 = document.querySelector("h1");
    if (!h1) return;
    const name = h1.textContent.trim();

    let category = "";
    const current = document.querySelector(".nav.sidebar a.current");
    const getSolved = () => (current ? detectSolved(current) : false);

    if (current) {
      let node = current.previousElementSibling;
      while (node && node.tagName !== "H4") node = node.previousElementSibling;
      if (node) category = node.textContent.trim();
    }

    const existing = await S.get(id);
    const solved = getSolved();
    if (existing && existing.csesSolved !== solved) {
      S.patch(id, { csesSolved: solved });
    }

    attachStar(h1, id, { name, category, getSolved }, Boolean(existing), {
      extraClass: "csesbm-star-title",
      inside: true,
    });

    initTimerWidget(id, getSolved);
    maybeShowSavedReviewButton({ problem_id: id, problem_name: name, category });
  }

  function maybeShowSavedReviewButton(meta) {
    const panel = globalThis.CSESReviewPanel;
    if (!panel || !meta || !meta.problem_id) return;

    chrome.runtime.sendMessage(
      { type: "GET_CACHED_REVIEW", submission: { problem_id: meta.problem_id } },
      (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.hit) return;

        // Avoid duplicate buttons
        if (document.getElementById("csesbm-open-saved-review")) return;

        const btn = document.createElement("button");
        btn.id = "csesbm-open-saved-review";
        btn.type = "button";
        btn.className = "csesbm-open-saved";
        btn.textContent = "Saved AI review";
        btn.title = "Open the last AI review for this problem";
        btn.addEventListener("click", () => {
          const sub = Object.assign({}, meta, resp.submission || {});
          panel.renderReview(resp.data, sub, {
            fromCache: true,
            onReviewAgain: () => {
              if (!sub.code || !String(sub.code).trim()) {
                panel.renderError(
                  "No saved code. Open a submission result page to run a new review."
                );
                return;
              }
              requestReview(sub, panel, true);
            },
          });
        });
        document.body.appendChild(btn);
      }
    );
  }

  // ---------- Solve timer ----------

  function formatMs(ms) {
    return (globalThis.CSESBM && CSESBM.formatDuration(ms)) || "0:00";
  }

  async function initTimerWidget(id, getSolved) {
    let state = await CSESTimer.get(id);

    // Reconciliation fallback: CSES already shows this solved (e.g. solved
    // before the timer existed, or the result-page detection never ran)
    // but our stored state never caught the accepted moment.
    const alreadySolved = getSolved();
    if (alreadySolved && (!state || state.status !== "stopped")) {
      state = await CSESTimer.stop(id);
    }
    if (!state) {
      if (alreadySolved) return; // nothing to time — solved before we existed
      state = await CSESTimer.ensureStarted(id);
    }

    const box = document.createElement("div");
    box.className = "csesbm-timer";
    const label = document.createElement("span");
    label.className = "csesbm-timer-label";
    label.hidden = true;
    label.textContent = "Solved in";
    const timeEl = document.createElement("span");
    timeEl.className = "csesbm-timer-time";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "csesbm-timer-btn";
    box.append(label, timeEl, btn);
    document.body.appendChild(box);

    let ticker = null;

    function render() {
      timeEl.textContent = formatMs(CSESTimer.elapsedMs(state));
      box.classList.toggle("is-paused", state.status === "paused");
      box.classList.toggle("is-stopped", state.status === "stopped");
      label.hidden = state.status !== "stopped";
      btn.hidden = state.status === "stopped";
      btn.textContent = state.status === "running" ? "Pause" : "Resume";
    }

    function startTicker() {
      clearInterval(ticker);
      ticker = setInterval(render, 1000);
    }

    render();
    if (state.status === "running") startTicker();

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        if (state.status === "running") {
          state = await CSESTimer.pause(id);
          clearInterval(ticker);
        } else if (state.status === "paused") {
          state = await CSESTimer.resume(id);
          startTicker();
        }
        render();
      } catch (_) {
        btn.title = "Timer could not be saved — click to retry";
      } finally {
        btn.disabled = false;
      }
    });
  }

  function showAcceptedToast(timeText) {
    const toast = document.createElement("div");
    toast.className = "csesbm-toast";
    toast.textContent = `Timer stopped — solved in ${timeText}`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => toast.remove(), 5000);
  }

  async function decorateResultPage() {
    // A solved icon in the sidebar means the task was accepted at some point;
    // it does not describe this particular result. Reuse the submission
    // scraper so a later WA never stops or overwrites the solve timer.
    let submission = null;
    try {
      submission = globalThis.CSESReviewScrape && CSESReviewScrape.scrapeSubmission();
    } catch (_) {
      // The review launcher will display a focused error if the page cannot
      // be scraped. Do not alter timing data without a reliable verdict.
    }
    const id = submission && submission.problem_id;

    // Timer stop only on this result being Accepted.
    if (id && submission && submission.accepted) {
      const state = await CSESTimer.stop(id);
      showAcceptedToast(formatMs(state.finalMs));

      await S.migrateIfNeeded();
      const existing = await S.get(id);
      if (existing) await S.patch(id, { timeSpentMs: state.finalMs });
    }

    // AI review is intentionally manual. Never spend a model call on page load.
    installReviewButton();
  }

  // ---------- AI post-submission review ----------

  function runPostSubmissionReview(opts) {
    opts = opts || {};
    const force = Boolean(opts.force);
    const scrape = globalThis.CSESReviewScrape;
    const panel = globalThis.CSESReviewPanel;
    if (!scrape || !panel) return;

    let submission;
    try {
      submission = scrape.scrapeSubmission();
    } catch (e) {
      panel.renderError("Could not read this result page.");
      return;
    }

    if (!submission.code || !submission.code.trim()) {
      // Result pages can populate source code after the rest of the page.
      // Poll briefly instead of failing after one arbitrary delay.
      let attempts = 0;
      const retry = () => setTimeout(() => {
        attempts += 1;
        try {
          submission = scrape.scrapeSubmission();
        } catch {
          if (attempts < 8) retry();
          else panel.renderError("Could not read this result page.");
          return;
        }
        if (!submission.code || !submission.code.trim()) {
          if (attempts < 8) retry();
          else panel.renderError("No source code found on this result page.");
          return;
        }
        requestReview(submission, panel, force);
      }, 500);
      retry();
      return;
    }

    requestReview(submission, panel, force);
  }

  function installReviewButton() {
    if (document.getElementById("csesbm-review-launch")) return;
    const scrape = globalThis.CSESReviewScrape;
    const panel = globalThis.CSESReviewPanel;
    if (!scrape || !panel) return;

    let submission;
    try { submission = scrape.scrapeSubmission(); } catch (_) { return; }

    const launch = document.createElement("button");
    launch.id = "csesbm-review-launch";
    launch.className = "csesbm-review-launch";
    launch.type = "button";
    launch.textContent = "Review submission";
    launch.title = "Ask GLM-5.3 for one focused CSES review";
    document.body.appendChild(launch);

    chrome.runtime.sendMessage({ type: "GET_CACHED_REVIEW", submission }, (response) => {
      if (chrome.runtime.lastError || !response || !response.hit) return;
      launch._csesbmSavedReview = response;
      launch.classList.add("has-saved");
      launch.textContent = "Open review";
    });

    launch.addEventListener("click", () => {
      try { submission = scrape.scrapeSubmission(); } catch (_) { /* use initial scrape */ }
      const savedReview = launch._csesbmSavedReview;
      if (savedReview) {
        const savedSubmission = Object.assign({}, submission, savedReview.submission || {});
        panel.renderReview(savedReview.data, savedSubmission, {
          fromCache: true,
          onReviewAgain: () => runPostSubmissionReview({ force: true }),
        });
        return;
      }
      runPostSubmissionReview({ force: false });
    });
  }

  let activeRequestId = null;
  function cancelReview() {
    if (activeRequestId) chrome.runtime.sendMessage({ type: "CANCEL_REVIEW", requestId: activeRequestId });
    activeRequestId = null;
  }
  function requestReview(submission, panel, force) {
    cancelReview();
    const requestId = crypto.randomUUID();
    activeRequestId = requestId;
    panel.renderLoading("Reviewing submission…", { onClose: cancelReview });
    chrome.runtime.sendMessage({ type: "REVIEW_SUBMISSION", submission, force: Boolean(force), requestId }, (resp) => {
      if (activeRequestId !== requestId) return;
      activeRequestId = null;
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        const message = (chrome.runtime.lastError && chrome.runtime.lastError.message) || (resp && resp.error) || "Review failed";
        panel.renderError(message, {
          onClose: cancelReview,
          onRetry: () => requestReview(submission, panel, true),
        });
        return;
      }
      const launch = document.getElementById("csesbm-review-launch");
      if (launch) {
        launch.classList.add("has-saved");
        launch.textContent = "Open review";
        launch._csesbmSavedReview = { data: resp.data, submission };
      }
      panel.renderReview(resp.data, submission, {
        fromCache: Boolean(resp.fromCache),
        timing: resp.timing,
        onClose: cancelReview,
        onReviewAgain: () => requestReview(submission, panel, true),
      });
    });
  }

  function init() {
    const path = location.pathname;
    if (/^\/problemset\/task\/\d+/.test(path)) {
      decorateTaskPage();
    } else if (/^\/problemset\/result\/\d+/.test(path)) {
      decorateResultPage();
    } else {
      // Everything else under /problemset (the root list, /problemset/list/, etc.)
      // Self-guards by only decorating <ul class="task-list"> found under an <h2>.
      decorateListPage();
    }
  }

  init();
})();
