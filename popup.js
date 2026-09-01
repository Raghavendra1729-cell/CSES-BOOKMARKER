(function () {
  const listEl = document.getElementById("list");
  const emptyEl = document.getElementById("empty");
  const sublineEl = document.getElementById("subline");
  const searchEl = document.getElementById("search");
  const tabsEl = document.getElementById("tabs");
  const clearBtn = document.getElementById("clear-all");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFile = document.getElementById("import-file");
  const flashEl = document.getElementById("flash");

  let map = {};
  let filter = "all";
  let clearTimer = null;
  let flashTimer = null;

  function flash(msg, isError) {
    flashEl.textContent = msg;
    flashEl.classList.toggle("error", Boolean(isError));
    flashEl.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (flashEl.hidden = true), 2800);
  }

  function counts() {
    const all = Object.values(map);
    return {
      all: all.length,
      done: all.filter((b) => b.status === "done").length,
      todo: all.filter((b) => b.status !== "done").length,
    };
  }

  function updateChrome() {
    const c = counts();
    tabsEl.querySelector('[data-count="all"]').textContent = c.all;
    tabsEl.querySelector('[data-count="todo"]').textContent = c.todo;
    tabsEl.querySelector('[data-count="done"]').textContent = c.done;
    clearBtn.hidden = c.all === 0;
    exportBtn.disabled = false;
    if (c.all === 0) {
      sublineEl.textContent = "";
    } else {
      sublineEl.textContent =
        `${c.all} saved · ${c.todo} to review` +
        (c.done ? ` · ${c.done} reviewed` : "");
    }
  }

  function visibleEntries() {
    const q = searchEl.value.trim().toLowerCase();
    return Object.values(map).filter((b) => {
      if (filter === "todo" && b.status === "done") return false;
      if (filter === "done" && b.status !== "done") return false;
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        (b.category || "").toLowerCase().includes(q)
      );
    });
  }

  function render() {
    updateChrome();
    const total = Object.keys(map).length;

    if (total === 0) {
      listEl.innerHTML = "";
      listEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    listEl.hidden = false;

    const entries = visibleEntries();
    listEl.innerHTML = "";

    if (entries.length === 0) {
      const div = document.createElement("div");
      div.className = "no-match";
      div.textContent =
        searchEl.value.trim() !== ""
          ? "No bookmarks match your search."
          : "Nothing here yet in this tab.";
      listEl.appendChild(div);
      return;
    }

    const byCat = {};
    entries.forEach((b) => {
      const cat = b.category || "Uncategorized";
      (byCat[cat] = byCat[cat] || []).push(b);
    });

    Object.keys(byCat)
      .sort((a, b) => a.localeCompare(b))
      .forEach((cat) => {
        const group = document.createElement("div");
        group.className = "category-group";

        const title = document.createElement("div");
        title.className = "category-title";
        title.textContent = cat;
        group.appendChild(title);

        byCat[cat]
          .sort((a, b) => b.addedAt - a.addedAt)
          .forEach((b) => group.appendChild(renderItem(b)));

        listEl.appendChild(group);
      });
  }

  function renderItem(b) {
    const done = b.status === "done";
    const item = document.createElement("div");
    item.className = "item" + (done ? " is-done" : "");

    const top = document.createElement("div");
    top.className = "item-top";

    const link = document.createElement("a");
    link.className = "item-link";
    link.href = b.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = b.name;
    link.title = b.name;

    const pill = document.createElement("button");
    pill.className = "status-pill" + (done ? " done" : "");
    pill.textContent = done ? "✓ Reviewed" : "To review";
    pill.title = done ? "Mark as still to review" : "Mark as reviewed";
    pill.addEventListener("click", () => toggleStatus(b));

    const remove = document.createElement("button");
    remove.className = "remove-btn";
    remove.setAttribute("aria-label", `Remove ${b.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removeItem(b));

    top.append(link, pill, remove);

    const meta = document.createElement("div");
    meta.className = "item-meta";

    if (b.csesSolved) {
      const tag = document.createElement("span");
      tag.className = "solved-tag";
      tag.textContent = "✓ Solved on CSES";
      meta.appendChild(tag);
    }

    if (b.timeSpentMs) {
      const timeTag = document.createElement("span");
      timeTag.className = "time-tag";
      timeTag.textContent = `⏱ ${CSESBM.formatDuration(b.timeSpentMs)}`;
      timeTag.title = "Time from starting the timer to Accepted";
      meta.appendChild(timeTag);
    }

    const note = document.createElement("input");
    note.type = "text";
    note.className = "item-note";
    note.placeholder = "Note — why you flagged this…";
    note.value = b.note || "";
    note.addEventListener("blur", () => saveNote(b, note.value));
    note.addEventListener("keydown", (e) => {
      if (e.key === "Enter") note.blur();
    });
    meta.appendChild(note);

    item.append(top, meta);
    return item;
  }

  async function toggleStatus(b) {
    const next = b.status === "done" ? "todo" : "done";
    try {
      const saved = await CSESBM.patch(b.id, { status: next });
      if (!saved) throw new Error("Bookmark no longer exists.");
      map[b.id] = saved;
      render();
    } catch (_) {
      flash("Could not update this bookmark.", true);
    }
  }

  async function saveNote(b, value) {
    if (!map[b.id]) return;
    if ((map[b.id].note || "") === value) return;
    try {
      const saved = await CSESBM.patch(b.id, { note: value });
      if (!saved) throw new Error("Bookmark no longer exists.");
      map[b.id] = saved;
    } catch (_) {
      flash("Could not save this note.", true);
      render();
    }
  }

  async function removeItem(b) {
    try {
      await CSESBM.remove(b.id);
      delete map[b.id];
      render();
    } catch (_) {
      flash("Could not remove this bookmark.", true);
    }
  }

  // ---------- Export / Import ----------
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function localGetAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (all) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(all || {});
      });
    });
  }

  function localSet(values) {
    return new Promise((resolve, reject) => chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(error);
      else resolve();
    }));
  }

  function isPortableLocalKey(key) {
    return (
      /^csesbm:rev:r:[A-Za-z0-9_-]{1,80}$/.test(key) ||
      /^csesbm:rev:p:\d{1,12}$/.test(key) ||
      /^csesbm-timer:\d{1,12}$/.test(key)
    );
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function isPortableLocalValue(key, value) {
    if (!isPlainObject(value)) return false;
    // Keep one imported item below Chrome's local-storage per-flow budget and
    // prevent a crafted backup from filling the extension's entire quota.
    if (JSON.stringify(value).length > 100000) return false;
    if (key.startsWith("csesbm-timer:")) {
      return (
        ["running", "paused", "stopped"].includes(value.status) &&
        typeof value.accumulatedMs === "number" && Number.isFinite(value.accumulatedMs) && value.accumulatedMs >= 0 &&
        (value.status !== "running" || (typeof value.lastResumeAt === "number" && Number.isFinite(value.lastResumeAt) && value.lastResumeAt > 0))
      );
    }
    if (key.startsWith("csesbm:rev:p:")) {
      return typeof value.result_id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value.result_id);
    }
    return (
      typeof value.result_id === "string" &&
      /^[A-Za-z0-9_-]{1,80}$/.test(value.result_id) &&
      isPlainObject(value.data) &&
      isPlainObject(value.submission) &&
      typeof value.savedAt === "number" && Number.isFinite(value.savedAt)
    );
  }

  function isImportableBookmark(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const id = String(raw.id == null ? "" : raw.id);
    return /^\d+$/.test(id) && id.length <= 12;
  }

  async function exportBookmarks() {
    const all = Object.values(map);
    const storedLocal = await localGetAll();
    const localData = {};
    Object.keys(storedLocal).filter(isPortableLocalKey).forEach((key) => {
      localData[key] = storedLocal[key];
    });
    const now = new Date();
    const payload = {
      app: "cses-bookmarker",
      version: 2,
      exportedAt: now.toISOString(),
      bookmarks: all,
      localData,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `cses-bookmarker-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash(`Backup saved · ${all.length} bookmark${all.length === 1 ? "" : "s"}.`);
  }

  async function importBookmarks(file) {
    try {
      if (!file || file.size > 6000000) throw new Error("too-large");
      const text = await file.text();
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : data && data.bookmarks;
      if (!Array.isArray(arr)) throw new Error("format");
      if (!Array.isArray(data) && data.app && data.app !== "cses-bookmarker") {
        throw new Error("wrong-app");
      }
      if (arr.length > 600) throw new Error("too-many-bookmarks");

      let n = 0;
      for (const raw of arr) {
        if (!isImportableBookmark(raw)) continue;
        const saved = await CSESBM.put(raw);
        map[saved.id] = saved;
        n += 1;
      }
      let localCount = 0;
      if (data && data.localData && typeof data.localData === "object") {
        const portable = {};
        const localKeys = Object.keys(data.localData).filter(isPortableLocalKey);
        if (localKeys.length > 160) throw new Error("too-many-local-items");
        localKeys.forEach((key) => {
          const value = data.localData[key];
          if (isPortableLocalValue(key, value)) {
            portable[key] = value;
            localCount += 1;
          }
        });
        if (Object.keys(portable).length) await localSet(portable);
      }
      render();
      flash(
        `Restored ${n} bookmark${n === 1 ? "" : "s"}` +
          (localCount ? ` and ${localCount} local item${localCount === 1 ? "" : "s"}.` : ".")
      );
    } catch (e) {
      const message = e && e.message;
      flash(
        ["format", "wrong-app", "too-many-bookmarks", "too-many-local-items", "too-large"].includes(message)
          ? "Import failed — this is not a supported CSES Bookmarker backup."
          : "Import failed — Chrome could not restore this backup.",
        true
      );
    }
  }

  // ---------- Wiring ----------
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    filter = btn.dataset.filter;
    tabsEl.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
    btn.classList.add("is-active");
    render();
  });

  searchEl.addEventListener("input", render);

  exportBtn.addEventListener("click", () => {
    exportBookmarks().catch(() => flash("Backup failed — Chrome storage could not be read.", true));
  });
  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", async () => {
    const file = importFile.files && importFile.files[0];
    if (file) {
      importBtn.disabled = true;
      await importBookmarks(file);
      importBtn.disabled = false;
    }
    importFile.value = "";
  });

  clearBtn.addEventListener("click", async () => {
    if (!clearBtn.classList.contains("confirming")) {
      clearBtn.classList.add("confirming");
      clearBtn.textContent = "Confirm?";
      clearTimer = setTimeout(() => {
        clearBtn.classList.remove("confirming");
        clearBtn.textContent = "Clear all";
      }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    clearBtn.classList.remove("confirming");
    clearBtn.textContent = "Clear all";
    try {
      await CSESBM.clearAll();
      map = {};
      render();
    } catch (_) {
      flash("Could not clear bookmarks.", true);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (!Object.keys(changes).some((k) => k.startsWith(CSESBM.PREFIX))) return;
    CSESBM.getMap().then((m) => {
      map = m;
      render();
    });
  });

  // ---------- AI review settings (calls HF directly — no local server) ----------
  const reviewToken = document.getElementById("review-token");
  const reviewTokenHint = document.getElementById("review-token-hint");
  const reviewSave = document.getElementById("review-save");
  const reviewHealth = document.getElementById("review-health");
  const reviewClearToken = document.getElementById("review-clear-token");
  const reviewStatus = document.getElementById("review-status");

  function setReviewStatus(msg, isError) {
    if (!reviewStatus) return;
    reviewStatus.textContent = msg;
    reviewStatus.hidden = !msg;
    reviewStatus.classList.toggle("error", Boolean(isError));
  }

  function applySettingsToUi(s) {
    if (!s) return;
    if (reviewTokenHint) {
      if (s.hasToken) {
        reviewTokenHint.hidden = false;
        const src =
          s.tokenSource === "popup" ? "from popup storage" : "loaded";
        reviewTokenHint.textContent =
          "Token ready (" + (s.tokenHint || "••••") + ", " + src + ")";
        if (reviewToken) reviewToken.placeholder = "Leave blank to keep current token";
      } else {
        reviewTokenHint.hidden = false;
        reviewTokenHint.textContent =
          "No token yet. Paste hf_… below and click Save.";
        if (reviewToken) reviewToken.placeholder = "hf_… paste here, then click Save";
      }
    }
  }

  function loadReviewSettings() {
    chrome.runtime.sendMessage({ type: "GET_REVIEW_SETTINGS" }, (s) => {
      if (chrome.runtime.lastError || !s) return;
      applySettingsToUi(s);
    });
  }

  if (reviewSave) {
    reviewSave.addEventListener("click", () => {
      const settings = {};
      // Only send token when the user typed something new.
      if (reviewToken && reviewToken.value.trim()) {
        settings.hfToken = reviewToken.value.trim();
      }
      chrome.runtime.sendMessage({ type: "SET_REVIEW_SETTINGS", settings }, (resp) => {
        if (chrome.runtime.lastError) {
          setReviewStatus(chrome.runtime.lastError.message, true);
          return;
        }
        if (resp && resp.ok) {
          if (reviewToken) reviewToken.value = "";
          applySettingsToUi(resp.settings);
          setReviewStatus(
            resp.settings && resp.settings.hasToken
              ? "Saved. Token ready for direct Hugging Face reviews."
              : "Saved, but no token yet. Paste hf_… in the token field and Save.",
            !(resp.settings && resp.settings.hasToken)
          );
        } else {
          setReviewStatus("Could not save.", true);
        }
      });
    });
  }

  if (reviewClearToken) {
    reviewClearToken.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "CLEAR_HF_TOKEN" }, (resp) => {
        if (chrome.runtime.lastError) {
          setReviewStatus(chrome.runtime.lastError.message, true);
          return;
        }
        if (reviewToken) reviewToken.value = "";
        applySettingsToUi(resp && resp.settings);
        setReviewStatus("Token cleared.", false);
      });
    });
  }

  if (reviewHealth) {
    reviewHealth.addEventListener("click", () => {
      setReviewStatus("Checking Hugging Face…");
      chrome.runtime.sendMessage({ type: "HEALTH_CHECK" }, (resp) => {
        if (chrome.runtime.lastError) {
          setReviewStatus(chrome.runtime.lastError.message, true);
          return;
        }
        if (!resp || !resp.ok) {
          setReviewStatus((resp && resp.error) || "API check failed", true);
          return;
        }
        const d = resp.data || {};
        setReviewStatus(
          "OK · " +
            (d.model || "model set") +
            " · " + (d.provider || "provider ready") +
            " · via " + (d.token_source || "token") +
            " · direct HF"
        );
      });
    });
  }

  (async function init() {
    await CSESBM.migrateIfNeeded();
    map = await CSESBM.getMap();
    render();
    loadReviewSettings();
  })();
})();
