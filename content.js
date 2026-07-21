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
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onToggle(id, { ...meta, csesSolved: meta.getSolved() }, btn).then((active) => {
        if (opts.onChange) opts.onChange(active);
      });
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
      if (state.status === "running") {
        state = await CSESTimer.pause(id);
        clearInterval(ticker);
      } else if (state.status === "paused") {
        state = await CSESTimer.resume(id);
        startTicker();
      }
      render();
    });
  }

  // The result page reuses the same `.task-score` verdict marker the rest of
  // the site uses for "solved" — scoped to the sidebar's current-task link
  // first (same reliable spot decorateTaskPage already reads), falling back
  // to a document-wide search if that scope isn't present on this layout.
  function detectAcceptedOnResultPage() {
    const sidebarCurrent = document.querySelector(".nav.sidebar a.current");
    if (sidebarCurrent && sidebarCurrent.querySelector(".task-score")) {
      return detectSolved(sidebarCurrent);
    }
    return detectSolved(document);
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
    const link = document.querySelector('a[href*="/problemset/task/"]');
    const id = link ? idFromHref(link.getAttribute("href")) : null;
    if (!id) return;

    if (!detectAcceptedOnResultPage()) return;

    const state = await CSESTimer.stop(id);
    showAcceptedToast(formatMs(state.finalMs));

    await S.migrateIfNeeded();
    const existing = await S.get(id);
    if (existing) await S.patch(id, { timeSpentMs: state.finalMs });
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
