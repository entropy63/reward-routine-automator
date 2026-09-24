document.addEventListener("DOMContentLoaded", async () => {
  // Canonical step ids in default order — mirrors STARTUP_STEPS in background.js.
  const STEP_IDS = ["stats", "claim", "dailySet", "keepEarning", "search", "imageSearch"];

  // Query-source ids in default order — mirrors QUERY_SOURCES in background.js.
  const SOURCE_IDS = ["bingAutosuggest", "googleTrends", "wikipedia", "uselessFacts", "local"];

  // Popup card ids in default order — mirrors settings.sectionOrder in
  // background.js (keyed by each card's data-section attribute). The
  // Run-on-startup card lives in the Settings view now, and the Search
  // settings card became the Run now card's gear panel (2026-09-03), so
  // both left the reorderable main view; the Redeem card joined after
  // Stats. Saved orders from before either change are normalized on load
  // (unknown ids dropped, missing ones slotted at their default spot).
  const SECTION_IDS = ["runNow", "stats", "redeem", "activity"];

  // Card titles for the hidden-sections menu (the restore button below the
  // topbar pencil) — mirrors each card's h2 in popup.html.
  const SECTION_TITLES = {
    runNow: "Run now",
    stats: "Stats",
    redeem: "Redeem",
    activity: "Activity"
  };
  const ENABLED_KEY = {
    stats: "statsStartupEnabled",
    claim: "claimStartupEnabled",
    dailySet: "dailySetStartupEnabled",
    keepEarning: "keepEarningStartupEnabled",
    search: "searchStartupEnabled",
    imageSearch: "imageSearchStartupEnabled"
  };

  // Tab-cleanup switches. The per-step ones and the manual-run one are gated
  // by the close-mode radios; the mode itself is handled separately below.
  // Same keys as DEFAULT_SETTINGS.
  const TAB_KEYS = [
    "closeTabsAfterClaim",
    "closeTabsAfterDailySet",
    "closeTabsAfterKeepEarning",
    "closeTabsAfterSearch",
    "closeTabsAfterImageSearch",
    "closeTabsAfterManualRun",
    "keepPinnedTabs"
  ];

  // Popup height. Declared up here because the init block below measures before
  // reaching the section that uses them, and a const is not hoisted.
  const PEEK = 10; // sliver of the next thing left showing below the fold, as the scroll cue
  const MIN_H = 240;
  const MAX_H = 600; // Chromium's hard cap for action popups

  const root = document.documentElement;

  const startupCard = document.getElementById("startupCard");
  const startupToggle = document.getElementById("startupEnabled");
  const oncePerDayToggle = document.getElementById("startupOncePerDay");
  const confirmBeforeRoutineToggle = document.getElementById("confirmBeforeRoutine");
  const stepList = document.getElementById("startupSteps");
  const handles = Array.from(stepList.querySelectorAll(".step-handle"));
  const sourceList = document.getElementById("querySources");
  const stepToggles = STEP_IDS.map(id => ({
    key: ENABLED_KEY[id],
    input: document.getElementById(ENABLED_KEY[id])
  }));

  const searchesInput = document.getElementById("searchesPerBatch");
  // The batch mode is a two-way radio pair over one setting key: automatic
  // is rightSizeSearchBatch on (check → size → verify → more if short),
  // manual is off (exactly the configured count, no checks).
  const searchModeManual = document.getElementById("searchModeManual");
  const searchModeAutomatic = document.getElementById("searchModeAutomatic");
  const minDelayInput = document.getElementById("minDelaySec");
  const maxDelayInput = document.getElementById("maxDelaySec");
  const tabCloseDelayInput = document.getElementById("tabCloseDelaySec");
  const popupHeightInput = document.getElementById("popupHeight");
  const dailySetTilesInput = document.getElementById("dailySetMaxTiles");
  const keepEarningTilesInput = document.getElementById("keepEarningMaxTiles");
  const stepSearchCount = document.getElementById("stepSearchCount");
  const stepDailySetCount = document.getElementById("stepDailySetCount");
  const stepKeepEarningCount = document.getElementById("stepKeepEarningCount");

  const closeTabsGroup = document.getElementById("closeTabsGroup");
  const tabModeRadios = Array.from(
    document.querySelectorAll('input[name="tabCloseMode"]')
  );
  const tabToggles = TAB_KEYS.map(key => ({
    key,
    input: document.getElementById(key)
  }));
  const animToggle = document.getElementById("animationsEnabled");
  const refreshOnOpenToggle = document.getElementById("refreshStatsOnPopupOpen");
  const devToggle = document.getElementById("developerOptionsEnabled");
  const experimentalToggle = document.getElementById("experimentalFeatures");
  const themeBtns = Array.from(document.querySelectorAll(".theme-btn[data-theme-choice]"));
  const modeBtns = Array.from(document.querySelectorAll(".theme-btn[data-mode-choice]"));

  const runDailySetBtn = document.getElementById("runDailySetBtn");
  const runKeepEarningBtn = document.getElementById("runKeepEarningBtn");
  const claimBtn = document.getElementById("claimBtn");
  const startSearchBtn = document.getElementById("startSearchBtn");
  const stopBtn = document.getElementById("stopBtn");
  const runImageSearchBtn = document.getElementById("runImageSearchBtn");
  const clearTabsBtn = document.getElementById("clearTabsBtn");
  const clearTabsLabel = document.getElementById("clearTabsLabel");

  // Layout edit mode: the topbar pencil toggles it; while on, the section
  // handles are enabled, each card grows a × to hide it, and the cards can
  // be dragged into a new order.
  const mainEl = document.getElementById("mainView");
  const settingsViewEl = document.getElementById("settingsView");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsBackBtn = document.getElementById("settingsBackBtn");
  const editLayoutBtn = document.getElementById("editLayoutBtn");
  const sectionHandles = Array.from(document.querySelectorAll(".section-handle"));
  // The restore side of hiding sections: the eye button (edit mode only, and
  // only while something is hidden) and the menu it drops down.
  const showHiddenBtn = document.getElementById("showHiddenBtn");
  const hiddenMenu = document.getElementById("hiddenMenu");
  const sectionHideBtns = Array.from(mainEl.querySelectorAll(".section-hide"));

  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const lastApiEl = document.getElementById("lastApi");
  const lastRewardsEl = document.getElementById("lastRewards");
  const lastStatsLogEl = document.getElementById("lastStatsLog");
  const lastRedeemLogEl = document.getElementById("lastRedeemLog");
  const lastQueryTextEl = document.getElementById("lastQueryText");
  const lastImageSearchEl = document.getElementById("lastImageSearch");
  const lastTabActionEl = document.getElementById("lastTabAction");

  // The Stats card. Keys mirror the shape background.js stores in lastStats,
  // with the activities flattened into the same lookup. The Overwatch amounts
  // no longer render here (user request 2026-09-03) — the Redeem card's
  // picker (renderRedeem) is their only home now.
  const refreshStatsBtn = document.getElementById("refreshStatsBtn");
  const statsUpdatedEl = document.getElementById("statsUpdated");
  const redeemSelect = document.getElementById("redeemVariant");
  const redeemBtn = document.getElementById("redeemBtn");
  const redeemBtnLabelEl = document.getElementById("redeemBtnLabel");
  const redeemNoteEl = document.getElementById("redeemNote");
  // The experimental Coupons button (Settings → Experimental features) and
  // the gear that opens the Run now card's own search settings panel.
  const couponBtn = document.getElementById("couponBtn");
  const searchSettingsBtn = document.getElementById("searchSettingsBtn");
  const searchSettingsEl = document.getElementById("searchSettings");
  // The Bing-app warning banner renderStats toggles at the top of the main
  // view.
  const bingAppBanner = document.getElementById("bingAppBanner");
  const bingAppBannerText = document.getElementById("bingAppBannerText");
  const redeemRestockBanner = document.getElementById("redeemRestockBanner");
  const redeemRestockBannerText = document.getElementById("redeemRestockBannerText");
  const redeemSoldOutBanner = document.getElementById("redeemSoldOutBanner");
  const redeemSoldOutBannerText = document.getElementById("redeemSoldOutBannerText");
  const testNotificationsBtn = document.getElementById("testNotificationsBtn");
  const openRoutineDoneBtn = document.getElementById("openRoutineDoneBtn");
  const resetRoutineDayBtn = document.getElementById("resetRoutineDayBtn");
  const statValueEls = {
    availablePoints: document.getElementById("statAvailablePoints"),
    readyToClaim: document.getElementById("statReadyToClaim"),
    dailyStreak: document.getElementById("statDailyStreak"),
    stampBonus: document.getElementById("statStampBonus"),
    searchPoints: document.getElementById("statSearchPoints"),
    bingSearch: document.getElementById("statBingSearch"),
    dailySet: document.getElementById("statDailySet"),
    bingApp: document.getElementById("statBingApp"),
    visualSearch: document.getElementById("statVisualSearch")
  };
  // The earn bar's own two nodes (user request 2026-09-07): the value inside
  // it is statSearchPoints above, written by renderStats like every other
  // stat — these are the container it hides with and the fill it sizes.
  const searchPointsBar = document.getElementById("searchPointsBar");
  const todayEarnFill = document.getElementById("todayEarnFill");

  // One drag-reorder implementation, three lists (makeSortableList, below):
  // each instance owns its own drag/settle state, so the lists never interact.
  const startupOrderList = makeSortableList(stepList, {
    idKey: "step",
    save: order => patchSettings({ startupOrder: order })
  });
  const querySourceList = makeSortableList(sourceList, {
    idKey: "source",
    save: order => patchSettings({ querySourceOrder: order })
  });
  // The cards themselves. Their handles only unlock in layout edit mode (the
  // topbar pencil), and renumbering restaggers the entrance delay so it follows
  // the visual order.
  const sectionOrderList = makeSortableList(mainEl, {
    idKey: "section",
    itemSelector: ".card",
    handleSelector: ".section-handle",
    renumberItem: (card, index) => card.style.setProperty("--i", String(index)),
    save: order => {
      patchSettings({ sectionOrder: order });
      // Which card sits where changes where the fold lands, and the cached
      // heights popup-boot.js reuses have to be re-measured.
      syncHeight();
    }
  });

  // No flash animations while painting the values that were already there.
  let live = false;
  let lastRemaining = null;
  // Declared up here with the other init-time state: renderStats() runs during
  // init, and a `let` in the stats section below would still be in its
  // temporal dead zone when that call assigns it (QA BUG-1, 2026-09-03).
  let lastStatsSeen = null;
  // The detail-page URL the Redeem button navigates to, from the same
  // lastRedeem record the variant picker reads (renderRedeem). Same TDZ
  // reasoning as lastStatsSeen.
  let redeemUrl = "";
  // Sections hidden through the layout editor's × button, in the order they
  // were hidden. Init-time state for the same TDZ reason: the visibility
  // functions run during init, before the handlers section is reached.
  let hiddenSections = [];

  // settings live in sync; status/lastQuery churn too fast for the sync quota
  const { settings } = await chrome.storage.sync.get("settings");
  const {
    status,
    lastQuery,
    lastImageSearch,
    lastTabAction,
    lastRewards,
    lastStatsLog,
    lastRedeemLog,
    lastStats,
    lastRedeem,
    lastCoupons,
    redeemRestockNews,
    redeemSoldOutNews
  } = await chrome.storage.local.get([
    "status",
    "lastQuery",
    "lastImageSearch",
    "lastTabAction",
    "lastRewards",
    "lastStatsLog",
    "lastRedeemLog",
    "lastStats",
    "lastRedeem",
    "lastCoupons",
    "redeemRestockNews",
    "redeemSoldOutNews"
  ]);

  const effectiveSettings = settings || {};
  // Default off (user request 2026-09-03); a stored true always wins.
  startupToggle.checked = effectiveSettings.startupEnabled ?? false;
  oncePerDayToggle.checked = effectiveSettings.startupOncePerDay ?? true;
  confirmBeforeRoutineToggle.checked = effectiveSettings.confirmBeforeRoutine ?? true;
  stepToggles.forEach(({ key, input }) => {
    input.checked = effectiveSettings[key] ?? true;
  });
  tabToggles.forEach(({ key, input }) => {
    input.checked = effectiveSettings[key] ?? true;
  });
  animToggle.checked = effectiveSettings.animationsEnabled ?? true;
  refreshOnOpenToggle.checked = effectiveSettings.refreshStatsOnPopupOpen ?? true;
  devToggle.checked = effectiveSettings.developerOptionsEnabled ?? false;
  experimentalToggle.checked = effectiveSettings.experimentalFeatures ?? false;

  // Unknown ids are dropped and duplicates collapse by construction (the
  // filter walks SECTION_IDS, not the stored list); the hide order is kept.
  const storedHidden = Array.isArray(effectiveSettings.hiddenSections)
    ? effectiveSettings.hiddenSections
    : [];
  hiddenSections = SECTION_IDS.filter(id => storedHidden.includes(id));

  searchesInput.value = effectiveSettings.searchesPerBatch ?? 30;
  // Radios, not a checkbox: exactly one of the two modes is ever selected.
  const automaticMode = effectiveSettings.rightSizeSearchBatch ?? true;
  searchModeManual.checked = !automaticMode;
  searchModeAutomatic.checked = automaticMode;
  // Automatic right-sizes the batch itself, so its manual size field is hidden
  // (the CSS keys off this attribute); manual mode shows it.
  searchSettingsEl.dataset.batchMode = automaticMode ? "automatic" : "manual";
  minDelayInput.value = effectiveSettings.minDelaySec ?? 5;
  maxDelayInput.value = effectiveSettings.maxDelaySec ?? 15;
  tabCloseDelayInput.value = effectiveSettings.tabCloseDelaySec ?? 8;
  popupHeightInput.value = effectiveSettings.popupHeight ?? 0;
  dailySetTilesInput.value = effectiveSettings.dailySetMaxTiles ?? 3;
  keepEarningTilesInput.value = effectiveSettings.keepEarningMaxTiles ?? 0;

  const tabCloseMode =
    effectiveSettings.tabCloseMode === "routine" ? "routine" : "perStep";
  const activeModeRadio = tabModeRadios.find(radio => radio.value === tabCloseMode);
  if (activeModeRadio) activeModeRadio.checked = true;
  closeTabsGroup.dataset.closeMode = tabCloseMode;

  applyAnimations(animToggle.checked);
  // Both visibility gates have to be on the root before the first height
  // measurement — a hidden card means a shorter fold (measureHeight skips
  // display:none cards), and the two disagreeing for a frame is a visible
  // window resize.
  applyDeveloperMode(devToggle.checked);
  // Same reasoning as the developer gate above: the coupon button joins the
  // Run-now grid before the first height measurement or not at all.
  applyExperimental(experimentalToggle.checked);
  applySectionVisibility();
  const theme = ["geist", "primer", "catppuccin"].includes(
    effectiveSettings.theme
  )
    ? effectiveSettings.theme
    : "geist";
  applyTheme(theme);
  // The second theme axis (ADR-003): light/dark/auto, independent of the
  // palette choice.
  const mode = ["auto", "light", "dark"].includes(effectiveSettings.appearance)
    ? effectiveSettings.appearance
    : "auto";
  applyMode(mode);
  startupOrderList.applyOrder(normalizeOrder(effectiveSettings.startupOrder));
  querySourceList.applyOrder(
    normalizeOrder(effectiveSettings.querySourceOrder, SOURCE_IDS)
  );
  sectionOrderList.applyOrder(
    normalizeOrder(effectiveSettings.sectionOrder, SECTION_IDS)
  );
  applyLayoutEdit(false);
  applyStartupMaster();
  updateStepSummaries();
  updateStatus(status);
  updateLastQuery(lastQuery);
  updateRewards(lastRewards);
  updateStatsLog(lastStatsLog);
  updateRedeemLog(lastRedeemLog);
  updateImageSearch(lastImageSearch);
  updateTabAction(lastTabAction);
  renderStats(lastStats);
  renderRedeem(lastRedeem);
  renderRestockNews(redeemRestockNews);
  renderSoldOutNews(redeemSoldOutNews);
  updateCouponButton(lastCoupons);

  // The first height measurement; popup-boot.js already put the cached value
  // in place pre-paint, and this confirms it against the live DOM.
  syncHeight();
  live = true;

  // Text metrics can shift once the UI font is actually resolved.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncHeight).catch(() => {});
  }

  // ---------- settings ----------

  // Read-modify-write so a field we don't own here can't be clobbered.
  async function patchSettings(patch) {
    const { settings } = await chrome.storage.sync.get("settings");
    await chrome.storage.sync.set({ settings: { ...(settings || {}), ...patch } });
  }

  // The sub-steps stay visible when the master switch is off — the user should
  // still see what the sequence is — but they can't be edited or reordered.
  // The once-per-day gate and the cancel prompt belong to the same inert
  // state: they only do anything when the sequence itself runs.
  function applyStartupMaster() {
    const on = startupToggle.checked;
    startupCard.dataset.off = String(!on);
    oncePerDayToggle.disabled = !on;
    confirmBeforeRoutineToggle.disabled = !on;
    stepToggles.forEach(({ input }) => {
      input.disabled = !on;
    });
    handles.forEach(handle => {
      handle.disabled = !on;
    });
  }

  startupToggle.addEventListener("change", async () => {
    applyStartupMaster();
    await patchSettings({ startupEnabled: startupToggle.checked });
  });

  oncePerDayToggle.addEventListener("change", () => {
    patchSettings({ startupOncePerDay: oncePerDayToggle.checked });
  });

  confirmBeforeRoutineToggle.addEventListener("change", () => {
    patchSettings({ confirmBeforeRoutine: confirmBeforeRoutineToggle.checked });
  });

  stepToggles.forEach(({ key, input }) => {
    input.addEventListener("change", () => {
      const step = input.closest(".step");
      if (step) replay(step.querySelector(".step-index"), "is-pop");
      patchSettings({ [key]: input.checked });
    });
  });

  tabToggles.forEach(({ key, input }) => {
    input.addEventListener("change", () => patchSettings({ [key]: input.checked }));
  });

  // ---------- tab close mode ----------

  function applyCloseMode(mode) {
    closeTabsGroup.dataset.closeMode = mode;
    // Which group of opts is showing changes the panel's height, and the
    // cached heights popup-boot.js reuses have to be re-measured.
    syncHeight();
  }

  tabModeRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      applyCloseMode(radio.value);
      patchSettings({ tabCloseMode: radio.value });
    });
  });

  // ---------- layout edit mode ----------
  //
  // The pencil in the topbar unlocks the section handles and the × buttons.
  // Off by default so the cards' heads stay clean; while on, everything still
  // works — only the affordances change.

  function applyLayoutEdit(on) {
    document.body.dataset.layoutEdit = String(on);
    editLayoutBtn.setAttribute("aria-pressed", String(on));
    sectionHandles.forEach(handle => {
      handle.disabled = !on;
    });
    // Leaving edit mode closes the restore menu with it.
    if (!on) closeHiddenMenu();
    updateShowHiddenBtn();
  }

  editLayoutBtn.addEventListener("click", () => {
    applyLayoutEdit(editLayoutBtn.getAttribute("aria-pressed") !== "true");
  });

  // ---------- hidden sections + the developer option ----------
  //
  // Two gates share one mechanism: attribute selectors on the root that
  // display:none the card (see popup.css). Both are mirrored into
  // localStorage so popup-boot.js can apply them before the first paint —
  // a card that appears for one frame also drags the measured height with
  // it. chrome.storage stays canonical.

  function applySectionVisibility() {
    if (hiddenSections.length) root.dataset.hidden = hiddenSections.join(" ");
    else delete root.dataset.hidden;
    try {
      localStorage.setItem("meowHidden", hiddenSections.join(" "));
    } catch (e) {
      // No localStorage — the attribute still applies for this session.
    }
    updateShowHiddenBtn();
  }

  // The Activity card is the Developer Option: it stays out of the main view
  // (and out of the fold) unless the Settings toggle shows it. Hiding it this
  // way — rather than through hiddenSections — keeps the two lists from
  // fighting over one card: the × never fires for it while it's already
  // dev-hidden, and it never shows up in the restore menu.
  function applyDeveloperMode(on) {
    if (on) delete root.dataset.dev;
    else root.dataset.dev = "off";
    try {
      localStorage.setItem("meowDev", on ? "on" : "off");
    } catch (e) {
      // No localStorage — the attribute still applies for this session.
    }
  }

  // Experimental features (Settings → Experimental features): currently the
  // Coupons button in the Run-now grid. Same mirror pattern as the developer
  // gate — popup-boot.js re-applies it before the first paint.
  function applyExperimental(on) {
    if (on) root.dataset.experimental = "on";
    else delete root.dataset.experimental;
    try {
      localStorage.setItem("meowExperimental", on ? "on" : "off");
    } catch (e) {
      // No localStorage — the attribute still applies for this session.
    }
  }

  // The eye button only exists while there is something to restore, and only
  // in edit mode — the same window where the × that hid the section was.
  function updateShowHiddenBtn() {
    showHiddenBtn.hidden =
      document.body.dataset.layoutEdit !== "true" || hiddenSections.length === 0;
    if (showHiddenBtn.hidden) closeHiddenMenu();
  }

  function renderHiddenMenu() {
    hiddenMenu.replaceChildren(
      ...hiddenSections.map(id => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "hidden-menu-item";
        item.dataset.section = id;
        item.textContent = SECTION_TITLES[id] || id;
        return item;
      })
    );
  }

  function closeHiddenMenu() {
    if (hiddenMenu.hidden) return;
    hiddenMenu.hidden = true;
    showHiddenBtn.setAttribute("aria-expanded", "false");
  }

  function openHiddenMenu() {
    renderHiddenMenu();
    hiddenMenu.hidden = false;
    showHiddenBtn.setAttribute("aria-expanded", "true");
  }

  showHiddenBtn.addEventListener("click", () => {
    if (hiddenMenu.hidden) openHiddenMenu();
    else closeHiddenMenu();
  });

  // Restoring an item: pull the id out of the hidden list, persist, and
  // re-measure — the fold moved again the moment the card came back.
  hiddenMenu.addEventListener("click", event => {
    const item = event.target.closest(".hidden-menu-item");
    if (!item) return;
    const id = item.dataset.section;
    hiddenSections = hiddenSections.filter(sectionId => sectionId !== id);
    patchSettings({ hiddenSections: hiddenSections.slice() });
    applySectionVisibility();
    syncHeight();
    if (hiddenSections.length) renderHiddenMenu();
    else closeHiddenMenu();
  });

  // A click anywhere else dismisses the menu; so does Escape. The eye button
  // itself is excluded — its own click handler toggles.
  document.addEventListener("click", event => {
    if (hiddenMenu.hidden) return;
    if (hiddenMenu.contains(event.target) || showHiddenBtn.contains(event.target)) return;
    closeHiddenMenu();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeHiddenMenu();
  });

  sectionHideBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".card").dataset.section;
      // The dev-hidden Activity card is display:none, so its × can't be
      // reached — but the guard costs nothing if that ever changes.
      if (!id || hiddenSections.includes(id)) return;
      hiddenSections = [...hiddenSections, id];
      patchSettings({ hiddenSections: hiddenSections.slice() });
      applySectionVisibility();
      syncHeight();
    });
  });

  devToggle.addEventListener("change", () => {
    applyDeveloperMode(devToggle.checked);
    patchSettings({ developerOptionsEnabled: devToggle.checked });
    syncHeight();
  });

  experimentalToggle.addEventListener("change", () => {
    applyExperimental(experimentalToggle.checked);
    patchSettings({ experimentalFeatures: experimentalToggle.checked });
    // The Coupons button joins or leaves the Run-now grid.
    syncHeight();
  });

  // ---------- the search settings panel ----------

  // The gear in the Search button opens the Run now card's own settings: the
  // query sources, just below the action grid. Collapsed by default and
  // never part of the layout editor — it is a panel of this card, not a
  // card, so no × button, no eye-menu entry, no drag handle.
  function applySearchSettingsOpen(open) {
    searchSettingsEl.hidden = !open;
    searchSettingsBtn.setAttribute("aria-expanded", String(open));
    // The panel changes this card's height, and the fold follows the cards.
    syncHeight();
  }

  // A span, not a button (HTML forbids buttons inside buttons), so both the
  // click and the keyboard path stop the event before the Search button's
  // own handler can see it.
  searchSettingsBtn.addEventListener("click", e => {
    e.stopPropagation();
    applySearchSettingsOpen(searchSettingsEl.hidden);
  });

  searchSettingsBtn.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    applySearchSettingsOpen(searchSettingsEl.hidden);
  });

  // ---------- experimental: the Coupons button ----------

  // Grayed exactly when the last read saw every coupon applied. No record
  // yet means "unknown", which stays green — pressing it is harmless: the
  // run reports what it found and writes its verdict to lastCoupons.
  function updateCouponButton(lastCoupons) {
    const allApplied = !!lastCoupons && lastCoupons.available === 0;
    couponBtn.disabled = allApplied;
    couponBtn.title = allApplied
      ? "Every coupon is already applied."
      : "Open the Rewards dashboard and apply every coupon (experimental).";
  }

  couponBtn.addEventListener("click", () => {
    sendRun({ type: "CLAIM_COUPONS" }, () => {
      // Held off until the run writes its lastCoupons verdict; the
      // storage.onChanged listener takes it from there.
      couponBtn.disabled = true;
      couponBtn.title = "Applying coupons…";
    });
  });

  // ---------- motion ----------

  // Mirrored into localStorage because popup-boot.js has to know before the
  // first paint, and chrome.storage is async. chrome.storage stays canonical.
  function applyAnimations(on) {
    if (on) delete root.dataset.anim;
    else root.dataset.anim = "off";
    try {
      localStorage.setItem("animations", on ? "1" : "0");
    } catch (e) {
      // No localStorage — the attribute still applies for this session.
    }
  }

  animToggle.addEventListener("change", () => {
    applyAnimations(animToggle.checked);
    patchSettings({ animationsEnabled: animToggle.checked });
  });

  refreshOnOpenToggle.addEventListener("change", () => {
    patchSettings({ refreshStatsOnPopupOpen: refreshOnOpenToggle.checked });
  });

  // ---------- theme ----------

  // Same mirror-into-localStorage pattern as applyAnimations: popup-boot.js has
  // to know the palette before the first paint, and chrome.storage is async.
  function applyTheme(theme) {
    root.dataset.theme = theme;
    themeBtns.forEach(btn => {
      btn.setAttribute("aria-pressed", String(btn.dataset.themeChoice === theme));
    });
    try {
      localStorage.setItem("meowTheme", theme);
    } catch (e) {
      // No localStorage — the attribute still applies for this session.
    }
  }

  themeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.themeChoice);
      patchSettings({ theme: btn.dataset.themeChoice });
    });
  });

  // ---------- appearance (light / dark / auto) ----------

  // Same shape as applyTheme one block above: the attribute has to be on the
  // root before the first paint (popup-boot.js mirrors it into localStorage),
  // and "auto" is the absence of a choice — no attribute, the CSS default
  // (follow the OS) holds.
  function applyMode(mode) {
    if (mode === "light" || mode === "dark") root.dataset.mode = mode;
    else delete root.dataset.mode;
    modeBtns.forEach(btn => {
      btn.setAttribute("aria-pressed", String(btn.dataset.modeChoice === mode));
    });
    try {
      localStorage.setItem("meowMode", mode);
    } catch (e) {
      // No localStorage — the attribute still applies for this session.
    }
  }

  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      applyMode(btn.dataset.modeChoice);
      patchSettings({ appearance: btn.dataset.modeChoice });
    });
  });

  // Removing, reflowing and re-adding is what makes a repeat call actually
  // replay the animation instead of being ignored. The timeout is the cleanup:
  // animationend never fires when motion is off, and a stale class is inert.
  function replay(el, cls) {
    if (!el || root.dataset.anim === "off") return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), 1000);
  }

  // Pointer-tracked highlight on the buttons — CSS reads --px/--py.
  document.querySelectorAll(".btn").forEach(btn => {
    btn.addEventListener("pointermove", event => {
      const box = btn.getBoundingClientRect();
      btn.style.setProperty("--px", `${event.clientX - box.left}px`);
      btn.style.setProperty("--py", `${event.clientY - box.top}px`);
    });
  });

  // ---------- popup height ----------
  //
  // The window is sized from the document, so clamping the body height is what
  // puts the fold at a chosen boundary: everything above fits, what's below is
  // a scroll away. Both heights get cached for popup-boot.js to reuse.

  // Scroll-independent, unlike getBoundingClientRect — this runs again after the
  // user may have scrolled down to Activity.
  function documentTop(el) {
    let top = 0;
    for (let node = el; node; node = node.offsetParent) top += node.offsetTop;
    return top;
  }

  function clampHeight(h) {
    return Math.round(Math.min(MAX_H, Math.max(MIN_H, h)));
  }

  // Where the fold goes when the Activity-card clamp saturates Chromium's cap:
  // the bottom of the deepest complete Run-now row, plus a peek of the next
  // one. A 10px sliver of a button reads as "there's more below"; a row sliced
  // through at 5px of its 30 reads as a rendering glitch. Derived from the live
  // grid rows rather than hardcoded pixels.
  function actionsFold() {
    const actions = document.querySelector(".actions");
    if (!actions) return MAX_H;

    // Content coordinate of the grid's top: offset-based, so neither scroll
    // nor an in-flight entrance transform on the card moves it. Button rows
    // are rect deltas from the container, which keeps sub-pixel accuracy and
    // cancels any transform above it.
    const base = documentTop(actions);
    const actionsTop = actions.getBoundingClientRect().top;
    const rows = new Map();
    actions.querySelectorAll(".btn").forEach(btn => {
      const box = btn.getBoundingClientRect();
      const top = Math.round(box.top - actionsTop);
      rows.set(top, Math.max(rows.get(top) ?? 0, top + box.height));
    });

    let fold = MAX_H; // if not even one row fits, the cap is the best on offer
    const tops = [...rows.keys()].sort((a, b) => a - b);
    const bottoms = [...rows.values()].sort((a, b) => a - b);
    bottoms.forEach((bottom, i) => {
      // The peek must stop at the next row's top edge: PEEK (10px) is wider
      // than the 7px grid gap, so an uncapped peek leaves a ~1px sliver of
      // the next row — which reads as a rendering glitch, not a cue. Landing
      // flush on the row boundary reads as "the next thing starts here".
      const nextTop = tops[i + 1] ?? Infinity;
      const peek = Math.min(PEEK, nextTop - bottom);
      const candidate = base + bottom + peek;
      if (candidate <= MAX_H) fold = candidate;
    });
    return fold;
  }

  // One measurement instead of the old disclosure pair: the main view's fold
  // is the top edge of the deepest VISIBLE card (hidden sections and the
  // dev-gated Activity card measure as nothing — offsetParent is null while
  // display:none) plus a peek, or — when even that doesn't fit Chromium's
  // cap — the deepest complete Run-now row. The Settings view never
  // re-measures (syncHeight guards it); it scrolls inside whatever the
  // window held on the switch.
  function measureHeight() {
    const cards = Array.from(mainEl.querySelectorAll(".card")).filter(
      card => card.offsetParent !== null
    );
    const last = cards[cards.length - 1];
    // With every section hidden there is nothing to anchor on; the cap is
    // the best on offer (clampHeight still floors it at MIN_H).
    const bottom = last ? documentTop(last) : MAX_H;
    const fold = bottom + PEEK <= MAX_H ? bottom + PEEK : actionsFold();
    return clampHeight(fold);
  }

  // The user's height preference, when it holds a usable value: 0 means "fold
  // automatically" (the measured behavior), anything else is clamped to the
  // window Chromium allows a popup (MIN_H–MAX_H) when it is saved.
  function userPopupHeight() {
    const h = Number(popupHeightInput.value);
    return Number.isFinite(h) && h >= MIN_H && h <= MAX_H ? h : null;
  }

  function syncHeight() {
    const user = userPopupHeight();
    // While the Settings view is showing, the main view is display:none and
    // would measure as zero-height. A set height still applies (it never
    // needed measuring); a measured one keeps whatever the window held until
    // the switch back re-measures (applyView).
    if (document.body.dataset.view === "settings" && !user) return;
    const h = user ? clampHeight(user) : measureHeight();
    root.style.setProperty("--popup-h", `${h}px`);

    try {
      localStorage.setItem("popupHeight", String(h));
    } catch (e) {
      // Without the cache the popup just resizes once on each open.
    }
  }

  // ---------- the Settings view ----------
  //
  // The topbar's gear switches between the main view and the Settings view
  // (the startup plan and the former Advanced panel live there). Not
  // persisted: every popup opens on the main view — the settings are
  // consulted occasionally, the main view is acted on daily.

  function applyView(view) {
    const settings = view === "settings";
    document.body.dataset.view = settings ? "settings" : "main";
    mainEl.hidden = settings;
    settingsViewEl.hidden = !settings;
    settingsBtn.setAttribute("aria-pressed", String(settings));
    // The restore menu overlays the main view's cards; it has no business
    // hanging open over the Settings view.
    if (settings) closeHiddenMenu();
    if (!settings) syncHeight(); // the main view was display:none while away
    // Land at the top of whichever view was just entered.
    document.body.scrollTo({ top: 0 });
  }

  settingsBtn.addEventListener("click", () => {
    applyView(document.body.dataset.view === "settings" ? "main" : "settings");
  });

  settingsBackBtn.addEventListener("click", () => applyView("main"));

  // ---------- ordered lists ----------
  //
  // Both drag-reorder lists (startup steps, query sources) share this code.
  // The list element and the data-* key holding each row's id differ; the
  // save() callback persists whatever settings key backs the order.

  // Tolerates a stale or hand-edited value: unknown ids and duplicates go, and
  // anything missing is slotted into its default position. Mirrors background.js.
  function normalizeOrder(order, ids = STEP_IDS) {
    const known = Array.isArray(order) ? order.filter(id => ids.includes(id)) : [];
    const merged = [...new Set(known)];

    // A row added by an update is absent from every saved order. Putting it
    // where it belongs by default beats tacking it on the end.
    ids.forEach((id, defaultIndex) => {
      if (!merged.includes(id)) {
        merged.splice(Math.min(defaultIndex, merged.length), 0, id);
      }
    });

    return merged;
  }

  // ---------- drag to reorder ----------
  //
  // Pointer events rather than HTML5 drag-and-drop: dragging inside an
  // extension popup with the native API is unreliable, and this way the row
  // follows the pointer exactly while the others slide out of its way.
  //
  // One implementation, three lists: the startup steps, the query sources and
  // the popup's own cards. itemSelector/handleSelector say what counts as a
  // row; renumberItem repaints each row's position (the steps show a number,
  // the cards restagger their entrance delay through --i).

  function makeSortableList(list, { idKey, save, itemSelector = ".step", handleSelector = ".step-handle", renumberItem }) {
    function itemEl(id) {
      return list.querySelector(`${itemSelector}[data-${idKey}="${id}"]`);
    }

    function currentOrder() {
      return Array.from(list.querySelectorAll(itemSelector), li => li.dataset[idKey]);
    }

    // Re-appending in sequence is enough to sort a list this short.
    function applyOrder(order) {
      order.forEach(id => {
        const li = itemEl(id);
        if (li) list.appendChild(li);
      });
      renumber(order);
    }

    function renumber(order) {
      order.forEach((id, index) => {
        const li = itemEl(id);
        if (!li) return;
        if (renumberItem) renumberItem(li, index);
        else li.querySelector(".step-index").textContent = String(index + 1);
      });
    }

    let drag = null;

    // A drop doesn't commit its DOM order until a 150ms settle has played out.
    // That pending commit has to be flushable: a second drag begun inside the
    // window would otherwise be clobbered by the timeout firing mid-flight,
    // reverting the first reorder under the user's pointer.
    let settleTimer = null;
    let pendingSettle = null;

    function flushSettle() {
      if (!settleTimer) return;
      window.clearTimeout(settleTimer);
      settleTimer = null;

      const state = pendingSettle;
      pendingSettle = null;
      if (!state) return;

      state.item.classList.remove("is-settling");
      list.classList.remove("is-dragging");
      state.items.forEach(li => {
        li.style.transform = "";
      });
      applyOrder(state.order);
    }

    function orderWith(ids, from, to) {
      const next = ids.slice();
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    }

    function projectedOrder() {
      return orderWith(
        drag.items.map(li => li.dataset[idKey]),
        drag.index,
        drag.target
      );
    }

    // How far the row has to travel to sit in its target slot.
    function restingOffset({ heights, gap, index, target }) {
      let offset = 0;
      for (let i = index + 1; i <= target; i++) offset += heights[i] + gap;
      for (let i = target; i < index; i++) offset -= heights[i] + gap;
      return offset;
    }

    // The slot the row would land in, given how far it has been dragged. Each
    // neighbour is passed once the pointer clears half of it.
    function targetIndexFor(dy) {
      const { heights, gap, index } = drag;
      let target = index;
      let travelled = 0;

      if (dy > 0) {
        for (let i = index + 1; i < heights.length; i++) {
          const stride = heights[i] + gap;
          if (dy <= travelled + stride / 2) break;
          travelled += stride;
          target = i;
        }
      } else {
        for (let i = index - 1; i >= 0; i--) {
          const stride = heights[i] + gap;
          if (-dy <= travelled + stride / 2) break;
          travelled += stride;
          target = i;
        }
      }

      return target;
    }

    function shiftOthers() {
      const { items, heights, index, target, gap, item } = drag;
      const own = heights[index] + gap;

      items.forEach((li, i) => {
        if (li === item) return;
        let shift = 0;
        if (target > index && i > index && i <= target) shift = -own;
        else if (target < index && i >= target && i < index) shift = own;
        li.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    }

    function onHandlePointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const handle = event.currentTarget;
      if (handle.disabled) return;

      // Commit any settle still pending from the previous drop before this drag
      // takes its snapshot — otherwise it fires mid-drag and reverts the reorder.
      flushSettle();

      const item = handle.closest(itemSelector);
      const items = Array.from(list.querySelectorAll(itemSelector));

      drag = {
        handle,
        item,
        items,
        index: items.indexOf(item),
        target: items.indexOf(item),
        heights: items.map(li => li.getBoundingClientRect().height),
        gap: parseFloat(getComputedStyle(list).rowGap) || 0,
        startY: event.clientY,
        started: false
      };

      // Track on the window rather than capturing the pointer: it leaves the
      // 16px handle immediately, and capture is not guaranteed to be granted.
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    }

    function onPointerMove(event) {
      if (!drag) return;

      const dy = event.clientY - drag.startY;

      // A few pixels of slack so a click on the handle isn't a drag.
      if (!drag.started) {
        if (Math.abs(dy) < 3) return;
        drag.started = true;
        list.classList.add("is-dragging");
        drag.item.classList.add("is-dragging");
      }

      const target = targetIndexFor(dy);
      if (target !== drag.target) {
        drag.target = target;
        shiftOthers();
        renumber(projectedOrder());
      }

      drag.item.style.transform = `translateY(${dy}px)`;
    }

    function onPointerUp() {
      const state = drag;
      drag = null;
      if (!state) return;

      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (!state.started) return;

      const { item, items, index, target } = state;
      const order = orderWith(items.map(li => li.dataset[idKey]), index, target);
      const offset = restingOffset(state);

      // Persist before the settle animation: the popup can be closed mid-flight.
      save(order);

      item.classList.remove("is-dragging");
      item.classList.add("is-settling");
      item.style.transform = offset ? `translateY(${offset}px)` : "";

      pendingSettle = { item, items, order };
      settleTimer = window.setTimeout(flushSettle, offset ? 150 : 0);
    }

    // Keyboard equivalent, so reordering doesn't depend on a pointer.
    function onHandleKeyDown(event) {
      const direction =
        event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (!direction) return;

      const handle = event.currentTarget;
      // Same race as a pointer drag: a settle still pending from a drop would
      // fire after this reorder and revert it.
      flushSettle();

      const ids = currentOrder();
      const from = ids.indexOf(handle.closest(itemSelector).dataset[idKey]);
      const to = from + direction;

      event.preventDefault();
      if (to < 0 || to >= ids.length) return;

      const order = orderWith(ids, from, to);
      applyOrder(order);
      save(order);
      handle.focus(); // moving the row in the DOM drops focus
    }

    Array.from(list.querySelectorAll(handleSelector)).forEach(handle => {
      handle.addEventListener("pointerdown", onHandlePointerDown);
      handle.addEventListener("keydown", onHandleKeyDown);
      // The handle is a button; a stray click must not submit or scroll anything.
      handle.addEventListener("click", event => event.preventDefault());
    });

    return { applyOrder, currentOrder };
  }

  // ---------- search settings ----------

  function clampNumber(input, fallback) {
    const min = Number(input.min);
    const max = Number(input.max);
    let value = Number(input.value);

    if (!Number.isFinite(value)) value = fallback;
    if (Number.isFinite(min)) value = Math.max(min, value);
    if (Number.isFinite(max)) value = Math.min(max, value);

    return Math.round(value);
  }

  // Reflect any clamping back into the field, and shake it so the correction
  // isn't silent — a typed 900 quietly becoming 100 reads like a bug.
  function writeBack(input, value) {
    const corrected = String(value) !== input.value.trim();
    input.value = value;
    if (corrected) replay(input.closest(".input-wrap"), "is-clamped");
  }

  // The step rows carry the value each Advanced field holds, so the list reads
  // as a plan rather than four bare names.
  function updateStepSummaries() {
    stepSearchCount.textContent = searchesInput.value || "0";

    const tiles = Number(dailySetTilesInput.value);
    stepDailySetCount.textContent =
      Number.isFinite(tiles) && tiles > 0
        ? `${tiles} ${tiles === 1 ? "tile" : "tiles"}`
        : "tiles";

    // 0 means no limit of our own, which is the sane default: the section holds
    // a different number of activities every day.
    const keep = Number(keepEarningTilesInput.value);
    stepKeepEarningCount.textContent =
      Number.isFinite(keep) && keep > 0 ? `up to ${keep}` : "all";
  }

  async function saveSearchSettings() {
    const searchesPerBatch = clampNumber(searchesInput, 30);
    const minDelaySec = clampNumber(minDelayInput, 5);
    const maxDelaySec = Math.max(clampNumber(maxDelayInput, 15), minDelaySec);
    const tabCloseDelaySec = clampNumber(tabCloseDelayInput, 8);
    const dailySetMaxTiles = clampNumber(dailySetTilesInput, 3);
    // 0 is meaningful here: it means "open all of them".
    const keepEarningMaxTiles = clampNumber(keepEarningTilesInput, 0);

    writeBack(searchesInput, searchesPerBatch);
    writeBack(minDelayInput, minDelaySec);
    writeBack(maxDelayInput, maxDelaySec);
    writeBack(tabCloseDelayInput, tabCloseDelaySec);
    writeBack(dailySetTilesInput, dailySetMaxTiles);
    writeBack(keepEarningTilesInput, keepEarningMaxTiles);
    updateStepSummaries();

    await patchSettings({
      searchesPerBatch,
      minDelaySec,
      maxDelaySec,
      tabCloseDelaySec,
      dailySetMaxTiles,
      keepEarningMaxTiles
    });
  }

  // Persist on edit; closing the popup without pressing Start used to discard these.
  [
    searchesInput,
    minDelayInput,
    maxDelayInput,
    tabCloseDelayInput,
    dailySetTilesInput,
    keepEarningTilesInput
  ].forEach(input => {
    input.addEventListener("change", saveSearchSettings);
  });
  searchesInput.addEventListener("input", updateStepSummaries);

  // The batch mode writes its key the moment it flips. The radio group
  // fires "change" only on the newly checked input, and its checked state
  // IS the mode — automatic on, manual off.
  for (const radio of [searchModeManual, searchModeAutomatic]) {
    radio.addEventListener("change", () => {
      const automatic = searchModeAutomatic.checked;
      patchSettings({ rightSizeSearchBatch: automatic });
      // Manual reveals the "Searches per batch" field, automatic hides it. The
      // panel is open when this fires, so re-measure the popup height.
      searchSettingsEl.dataset.batchMode = automatic ? "automatic" : "manual";
      syncHeight();
    });
  }

  // The height preference previews live (syncHeight reads the field) and is
  // clamped on commit: 0 stays 0 ("auto"), anything else snaps into the
  // window Chromium allows a popup (240–600).
  popupHeightInput.addEventListener("input", syncHeight);
  popupHeightInput.addEventListener("change", async () => {
    const raw = Number(popupHeightInput.value);
    const height = !Number.isFinite(raw) || raw === 0 ? 0 : clampHeight(raw);
    writeBack(popupHeightInput, height);
    await patchSettings({ popupHeight: height });
    syncHeight();
  });

  // ---------- manual controls ----------

  // Double-click guard for the manual run buttons: two sendMessage calls make
  // the background start two concurrent runs, and the second clobbers the
  // first's tab bookkeeping. Ignore the click entirely while one is in flight;
  // the flag clears when the message settles — including the rejection a dead
  // worker produces. Once the run registers, the status update takes over.
  let runInFlight = false;

  function sendRun(message, log) {
    if (runInFlight) return;
    runInFlight = true;
    log();
    chrome.runtime
      .sendMessage(message)
      .catch(() => {})
      .finally(() => {
        runInFlight = false;
      });
  }

  runDailySetBtn.addEventListener("click", () => {
    sendRun({ type: "RUN_DAILY_SET" }, () =>
      setLog(lastRewardsEl, "Daily set — starting…", null)
    );
  });

  // Same shape as the daily set, but the number of activities varies by the day,
  // so the count it reports back is the only way to know what it found.
  runKeepEarningBtn.addEventListener("click", () => {
    sendRun({ type: "RUN_KEEP_EARNING" }, () =>
      setLog(lastRewardsEl, "Keep earning — starting…", null)
    );
  });

  // Same shape as the daily set: the background reports into lastRewards once
  // the claim finishes (or finds nothing pending).
  claimBtn.addEventListener("click", () => {
    sendRun({ type: "RUN_CLAIM" }, () =>
      setLog(lastRewardsEl, "Claim — starting…", null)
    );
  });

  startSearchBtn.addEventListener("click", async () => {
    await saveSearchSettings();
    chrome.runtime.sendMessage({ type: "START_SEARCH_BATCH" }, async () => {
      const { status } = await chrome.storage.local.get("status");
      updateStatus(status);
    });
  });

  stopBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "STOP_BATCH" }, () => {
      updateStatus({ running: false, remaining: 0 });
    });
  });

  // Run visual image search with a random image
  runImageSearchBtn.addEventListener("click", () => {
    sendRun({ type: "RUN_IMAGE_SEARCH" }, () =>
      setLog(lastImageSearchEl, "Starting…", null)
    );
  });

  // The Redeem button: a user-initiated spend, so it goes through sendRun's
  // double-click guard like the other manual runs, and the background opens
  // the page FOREGROUND (the user watches their own transaction). Deliberately
  // no Activity-log row: the page opening in front of the user IS the feedback.
  redeemBtn.addEventListener("click", () => {
    const chosen = redeemSelect.selectedOptions[0];
    if (!chosen || chosen.disabled || !redeemUrl) return;
    sendRun({ type: "REDEEM_OVERWATCH", url: redeemUrl, label: chosen.value }, () => {
      redeemNoteEl.textContent = "Opening the redeem page…";
    });
  });

  // ---------- clear tabs ----------
  //
  // Arm, then confirm. This closes every tab in the window, which is not
  // something a misplaced click should be able to do.

  let disarmTimer = null;

  function disarmClearTabs() {
    window.clearTimeout(disarmTimer);
    disarmTimer = null;
    clearTabsBtn.dataset.armed = "false";
    clearTabsLabel.textContent = "Clear tabs";
  }

  clearTabsBtn.addEventListener("click", async () => {
    if (clearTabsBtn.dataset.armed !== "true") {
      clearTabsBtn.dataset.armed = "true";
      clearTabsLabel.textContent = "Confirm?";
      disarmTimer = window.setTimeout(disarmClearTabs, 4000);
      return;
    }

    disarmClearTabs();
    setLog(lastTabActionEl, "Clearing…", null);

    // Resolve the window here so the background can't fall back to a different
    // one; it only guesses when the popup has nothing to tell it.
    let windowId;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) windowId = tab.windowId;
    } catch (e) {
      windowId = undefined;
    }

    chrome.runtime.sendMessage({ type: "CLEAR_ALL_TABS", windowId }, result => {
      // The background records the outcome in lastTabAction, which arrives via
      // storage.onChanged — so there is only something to say when it doesn't.
      if (!result) {
        setLog(lastTabActionEl, "No reply from the extension worker", "failed");
      }
    });
  });

  // Any other click means the confirmation was not the intent.
  document.addEventListener("click", event => {
    if (disarmTimer && !clearTabsBtn.contains(event.target)) disarmClearTabs();
  });

  // ---------- readouts ----------

  function setLog(el, text, state) {
    const empty = !text;
    const next = empty ? "Nothing yet" : text;
    const changed = el.textContent !== next;

    el.textContent = next;
    el.classList.toggle("is-empty", empty);
    if (state) el.dataset.state = state;
    else delete el.dataset.state;

    // A value landing while the popup is open shouldn't change silently.
    if (live && changed) replay(el, "is-fresh");
  }

  function updateStatus(status) {
    const running = Boolean(status && status.running);
    const remaining = running ? status.remaining : null;

    statusPill.dataset.state = running ? "running" : "idle";
    // Non-search activities carry a label ("Daily set", "Image search"…);
    // the search batch counts down instead.
    statusText.textContent = running
      ? (status.label || `${status.remaining ?? 0} left`)
      : "Idle";
    stopBtn.disabled = !running;
    document.body.dataset.running = String(running);

    if (live && remaining !== lastRemaining) replay(statusText, "status-tick");
    lastRemaining = remaining;
  }

  function updateLastQuery(lastQuery) {
    setLog(lastApiEl, (lastQuery && lastQuery.api) || "", null);
    setLog(lastQueryTextEl, (lastQuery && lastQuery.text) || "", null);
  }

  function stateOf(entry) {
    return entry.ok === true ? "ok" : entry.ok === false ? "failed" : null;
  }

  // The Rewards row now carries the same extra as the stats and redeem rows
  // (2026-09-05, "all errors should be available at the Activity section"):
  // the claim flow attaches the markup it was staring at when it failed or
  // timed out, and that dump is the row's hover text — copyable, because the
  // service worker console is not a place the user can go.
  function updateRewards(lastRewards) {
    if (!lastRewards || !lastRewards.detail) {
      setLog(lastRewardsEl, "", null);
      lastRewardsEl.removeAttribute("title");
      return;
    }
    setLog(lastRewardsEl, lastRewards.detail, stateOf(lastRewards));
    lastRewardsEl.title = lastRewards.dump || lastRewards.detail;
  }

  // The stats read's row, same extra as the redeem row's: the markup dump
  // the readers attached when a page surprised them — hover text, the only
  // place the evidence surfaces without devtools on the read tabs.
  function updateStatsLog(lastStatsLog) {
    if (!lastStatsLog || !lastStatsLog.detail) {
      setLog(lastStatsLogEl, "", null);
      lastStatsLogEl.removeAttribute("title");
      return;
    }
    setLog(lastStatsLogEl, lastStatsLog.detail, stateOf(lastStatsLog));
    lastStatsLogEl.title = lastStatsLog.dump || lastStatsLog.detail;
  }

  function updateImageSearch(lastImageSearch) {
    if (!lastImageSearch || !lastImageSearch.detail) {
      setLog(lastImageSearchEl, "", null);
      return;
    }
    setLog(lastImageSearchEl, lastImageSearch.detail, stateOf(lastImageSearch));
  }

  function updateTabAction(lastTabAction) {
    if (!lastTabAction || !lastTabAction.detail) {
      setLog(lastTabActionEl, "", null);
      return;
    }
    setLog(lastTabActionEl, lastTabAction.detail, stateOf(lastTabAction));
  }

  // The redeem watch's row carries one extra: the markup dump the reader
  // attached when a page surprised it. The read tab is a background tab
  // nobody can open devtools on, so this hover text is the only place the
  // evidence surfaces without devtools.
  function updateRedeemLog(lastRedeemLog) {
    if (!lastRedeemLog || !lastRedeemLog.detail) {
      setLog(lastRedeemLogEl, "", null);
      lastRedeemLogEl.removeAttribute("title");
      return;
    }
    setLog(lastRedeemLogEl, lastRedeemLog.detail, stateOf(lastRedeemLog));
    lastRedeemLogEl.title = lastRedeemLog.dump || lastRedeemLog.detail;
  }

  // The dump rows are click-to-copy (2026-09-05, user request): a title
  // tooltip cannot be selected, and the dump is the refinement lead — one
  // click puts it on the clipboard. Only rows carrying a tooltip answer the
  // click; the row flashes "Copied ✓" so the click visibly did something
  // (and never restores over a value that landed in the meantime).
  function makeCopyOnClick(el) {
    el.classList.add("copy-on-click");
    el.addEventListener("click", async () => {
      const text = el.title;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        // A refused clipboard permission (older Chromium): the legacy path.
        const scratch = document.createElement("textarea");
        scratch.value = text;
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        scratch.remove();
      }
      const restore = el.textContent;
      el.textContent = "Copied ✓";
      setTimeout(() => {
        if (el.textContent === "Copied ✓") el.textContent = restore;
      }, 1200);
    });
  }
  makeCopyOnClick(lastRewardsEl);
  makeCopyOnClick(lastStatsLogEl);
  makeCopyOnClick(lastRedeemLogEl);

  // The stock-news banners (2026-09-03): the watch writes one record per
  // direction when an Overwatch amount flips between two reads — green for a
  // restock ("coins available"), orange for a newly sold-out amount. NOT
  // dismissible (user's call): the banners show while the page's state says
  // so, and the watch clears a record only when the amount flips back.
  function renderNewsBanner(banner, textEl, news, prefix) {
    const labels = (news && Array.isArray(news.labels)) ? news.labels : [];
    const wasHidden = banner.hidden;
    banner.hidden = !labels.length;
    if (labels.length) textEl.textContent = `${prefix}${labels.join(", ")}.`;
    // A banner appearing or leaving shifts every card below it, so the fold
    // moves with it.
    if (wasHidden !== banner.hidden) syncHeight();
  }

  function renderRestockNews(news) {
    renderNewsBanner(
      redeemRestockBanner,
      redeemRestockBannerText,
      news,
      "Overwatch coins available: "
    );
  }

  function renderSoldOutNews(news) {
    renderNewsBanner(
      redeemSoldOutBanner,
      redeemSoldOutBannerText,
      news,
      "No longer available: "
    );
  }

  // Developer Option only (2026-09-03): previews every banner the extension
  // can raise at the top — a restocked amount, a sold-out one, the un-done
  // Bing-app check-in — with sample payloads, so the wording and styling can
  // be checked without waiting for the real thing. DOM-only: nothing touches
  // storage, so the preview vanishes on the next popup open (or the next
  // real record landing).
  testNotificationsBtn.addEventListener("click", () => {
    renderRestockNews({ at: Date.now(), labels: ["500 coins"] });
    renderSoldOutNews({ at: Date.now(), labels: ["2000 coins"] });
    bingAppBanner.hidden = false;
    bingAppBannerText.textContent = "Bing app check-in not done yet today.";
    syncHeight();
  });

  // Developer Option only (2026-09-04): opens the routine-done page — the
  // same page the routine itself opens at endRoutine — so its layout,
  // wording and motion can be checked without running a whole routine. The
  // page opens with the real LAST_STATS summary, exactly like the real call
  // (a demo query would lie about which streaks need doing).
  openRoutineDoneBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_ROUTINE_DONE" }).catch(() => {});
  });

  // Developer Option only (2026-09-05, user request): clears the routine's
  // once-per-day done-mark, so the next browser launch runs the startup
  // routine again — as if it had never run today. The background does the
  // clearing and reports it in the Tabs row (visible: the Activity card is
  // the developer option too); the launch itself still walks its own gates —
  // Run on startup, the confirm dialog.
  resetRoutineDayBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "RESET_ROUTINE_DAY" }).catch(() => {});
  });

  // ---------- stats ----------

  // Same shape as setLog() but with an em dash for the empty state — eight
  // "Nothing yet" cells would drown the card.
  function setStat(el, value) {
    const empty = !value;
    const next = empty ? "—" : value;
    const changed = el.textContent !== next;

    el.textContent = next;
    el.classList.toggle("is-empty", empty);

    if (live && changed) replay(el, "is-fresh");
  }

  // Display strings exactly as the dashboard showed them, plus a plain HH:MM
  // stamp — the read is always recent enough that a date would only add noise.
  // The earn bar's arithmetic, lifted from the third build's pure/verdicts.js
  // (user request 2026-09-07). These popups are classic scripts, not modules,
  // so the two functions are inlined rather than imported — same logic, and a
  // change to one must be mirrored in the other (the codebase's existing
  // mirror convention for normalizeOrder / STEP_IDS).
  //
  // The trailing "X/Y" pair of a stat value. Both stored shapes end with it
  // ("3/3" from the tiles, "Day 4 of 7 · 3/3" from the streak cards);
  // returns [done, total] or null when the value carries no pair.
  function progressPair(value) {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/(\d+)\s*\/\s*(\d+)$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2])];
  }

  // A read answers for today only: every one of these values resets at
  // midnight, so yesterday's "40/60" says nothing about today.
  function statsAreCurrent(stats) {
    if (!stats || typeof stats.at !== "number") return false;
    const dayKey = date =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return dayKey(new Date(stats.at)) === dayKey(new Date());
  }

  // The earn bar: the search-points pair ("40/60") as a fill. Hidden until a
  // today-fresh read carries a pair — a stale read has no bar worth showing.
  function renderEarnBar() {
    const pair = progressPair(lastStatsSeen && lastStatsSeen.searchPoints);
    const show = statsAreCurrent(lastStatsSeen) && !!pair;
    searchPointsBar.hidden = !show;
    if (!show) return;
    const pct = pair[1] > 0 ? (pair[0] / pair[1]) * 100 : 0;
    const clamped = Math.min(100, Math.max(0, pct));
    todayEarnFill.style.setProperty("--fill", `${clamped}%`);
    todayEarnFill.classList.toggle("is-done", pair[0] >= pair[1]);
  }

  function renderStats(lastStats) {
    lastStatsSeen = lastStats || null;
    const stats = lastStats || {};
    const activities = stats.activities || {};

    setStat(statValueEls.availablePoints, stats.availablePoints);
    setStat(statValueEls.readyToClaim, stats.readyToClaim);
    setStat(statValueEls.dailyStreak, stats.dailyStreak);
    setStat(statValueEls.stampBonus, stats.stampBonus);
    // The Bing-search daily cap ("out of 60"), read from the Today's points
    // breakdown — the points counterpart of the Bing search streak below.
    setStat(statValueEls.searchPoints, stats.searchPoints);
    setStat(statValueEls.bingSearch, activities.bingSearch);
    setStat(statValueEls.dailySet, activities.dailySet);
    setStat(statValueEls.bingApp, activities.bingApp);
    setStat(statValueEls.visualSearch, activities.visualSearch);

    // The Bing-app activity is the one step the routine genuinely cannot
    // do — it only counts from the real phone app — so an untouched 0/N
    // after a read gets a warning at the top of the main view. The value is
    // a display string: the Earn page's streak card answers "Day 0 of 1 ·
    // 0/1" (the shape live runs actually store, and the one mergeStats
    // prefers), the dashboard's tile a bare "0/1" — the trailing progress
    // pair is the check-in state in both (null / no pair leaves the banner
    // off).
    const appMatch = String(activities.bingApp || "").match(/(\d+)\s*\/\s*(\d+)\s*$/);
    const appStalled =
      !!appMatch && Number(appMatch[1]) === 0 && Number(appMatch[2]) > 0;
    bingAppBanner.hidden = !appStalled;
    if (appStalled) {
      // Short by request (2026-09-03): the banner only says the check-in
      // wasn't done; the why rides along as hover text.
      bingAppBannerText.textContent = "Bing app check-in not done yet today.";
      bingAppBanner.title =
        "This one only counts from the Bing phone app — the routine can't finish it for you.";
    }
    // The bar rides on the same read the rows above just took.
    renderEarnBar();
    // The banner pushes every card down, so the fold moves with it.
    syncHeight();

    if (stats.at) {
      const date = new Date(Number(stats.at));
      const pad = n => String(n).padStart(2, "0");
      statsUpdatedEl.textContent = `Updated ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    } else {
      statsUpdatedEl.textContent = "Not yet updated";
    }

    // The Redeem button's label is an affordability verdict, and the balance
    // half of it just changed — re-run the verdict (the amounts half comes
    // from lastRedeem, unchanged here).
    updateRedeemButton();
  }

  // The Redeem card's half of the lastRedeem read (the Overwatch amounts no
  // longer render inside the Stats card, user request 2026-09-03 — the card
  // is dashboard numbers only): the picker mirrors the `variants` list (the
  // amounts the product's own page sells, each with its stock state), and
  // the URL travels with them so the picker and the button stay a pair. The
  // stats stamp covers this card too: the routine reads both back to back
  // and the Refresh button refreshes both.
  function renderRedeem(lastRedeem) {
    const variants =
      lastRedeem && Array.isArray(lastRedeem.variants) ? lastRedeem.variants : [];

    // Every amount listed, sold-out ones disabled so the choice stays
    // honest, and the selection kept across re-reads when the amount is
    // still there.
    const previous = redeemSelect.value;
    redeemSelect.textContent = "";
    let fallback = "";
    variants.forEach(variant => {
      const option = document.createElement("option");
      option.value = variant.label || "";
      option.textContent = variant.label || "—";
      if (variant.available === false) {
        option.disabled = true;
        option.textContent = `${option.textContent} — sold out`;
      } else if (!fallback) {
        fallback = option.value;
      }
      redeemSelect.append(option);
    });
    const stillThere = Array.from(redeemSelect.options).some(
      option => option.value === previous && !option.disabled
    );
    redeemSelect.value = stillThere ? previous : fallback;
    redeemUrl =
      lastRedeem && typeof lastRedeem.variantUrl === "string"
        ? lastRedeem.variantUrl
        : "";
    updateRedeemButton();

    // The picker's option list changes the Redeem card's height whenever a
    // read lands, and the cached heights popup-boot.js reuses have to be
    // re-measured (same reasoning as applyCloseMode).
    syncHeight();
  }

  // Overwatch coins price at 10 points per coin (user-confirmed 2026-09-03):
  // "500 coins" costs 5,000 points. The button's label is this verdict.
  function coinPricePts(label) {
    const match = /^([\d.,]+)\s+coins?$/i.exec(String(label || "").trim());
    if (!match) return null;
    const coins = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(coins) && coins > 0 ? Math.round(coins * 10) : null;
  }

  // availablePoints is the dashboard's display string ("5,113"); strip it to
  // a number for the affordability check. null = no stats read yet.
  function availablePointsNumber() {
    const raw = lastStatsSeen && lastStatsSeen.availablePoints;
    const digits = String(raw == null ? "" : raw).replace(/[^\d]/g, "");
    return digits ? Number(digits) : null;
  }

  // The Redeem button needs both halves of the pair: a selectable amount from
  // the last read, and the detail page to redeem it on. The label is the
  // affordability verdict above — "Redeem" when the last stats read covers
  // the amount (the background presses Redeem Now on the page), "View page"
  // when it can't (the page opens, nothing pressed). The note says which
  // case and why, so the label is never a mystery. The page is the real
  // authority either way: a stale stats read can only mislabel, never
  // mis-press — the picker refuses a disabled Redeem Now.
  function updateRedeemButton() {
    const chosen = redeemSelect.selectedOptions[0];
    redeemBtn.disabled = !(chosen && !chosen.disabled && redeemUrl);

    if (!redeemSelect.options.length) {
      redeemBtnLabelEl.textContent = "View page";
      redeemNoteEl.textContent = "No amounts yet — Refresh in Stats reads them.";
    } else if (!chosen || chosen.disabled) {
      redeemBtnLabelEl.textContent = "View page";
      redeemNoteEl.textContent = "Every amount is sold out right now.";
    } else if (!redeemUrl) {
      redeemBtnLabelEl.textContent = "View page";
      redeemNoteEl.textContent = "No redeem page yet — Refresh in Stats finds it.";
    } else {
      const price = coinPricePts(chosen.value);
      const points = availablePointsNumber();
      if (price == null) {
        redeemBtnLabelEl.textContent = "View page";
        redeemNoteEl.textContent = "Opens the amount's own redeem page.";
      } else if (points == null) {
        redeemBtnLabelEl.textContent = "View page";
        redeemNoteEl.textContent = `${price.toLocaleString("en-US")} pts needed — Refresh in Stats to check yours.`;
      } else if (points >= price) {
        redeemBtnLabelEl.textContent = "Redeem";
        redeemNoteEl.textContent = `You have ${points.toLocaleString("en-US")} pts — Redeem Now is pressed on the page.`;
      } else {
        redeemBtnLabelEl.textContent = "View page";
        redeemNoteEl.textContent = `${price.toLocaleString("en-US")} pts needed — the page opens, nothing pressed.`;
      }
    }
  }

  // The read is fire-and-forget on the background side (see REFRESH_STATS), so
  // the button disables itself and comes back when lastStats lands — or on the
  // safety timer, in case the worker died mid-read. Deliberately not sendRun():
  // that guard disables every Run-now button for the duration, and a stats read
  // has nothing to do with them.
  let statsRefreshPending = false;
  let statsRefreshTimer = null;

  function settleStatsRefresh() {
    if (!statsRefreshPending) return;
    statsRefreshPending = false;
    window.clearTimeout(statsRefreshTimer);
    statsRefreshTimer = null;
    refreshStatsBtn.disabled = false;
    // If the read never answered, fall back to the last values we had.
    renderStats(lastStatsSeen);
  }

  // One refresh per 30 seconds (user request 2026-09-05): opening the popup
  // repeatedly must not re-read the dashboard every time — a burst just
  // fetched numbers that are seconds old. The stamp is popup-local
  // (localStorage, like the pre-paint mirrors): no storage.local key, nothing
  // for the background to know about. Any burst stamps the window — the
  // button's reads are as fresh as the opening one — but only the
  // refresh-on-open consults it: the Refresh button is a deliberate press
  // and always works.
  const STATS_REFRESH_COOLDOWN_MS = 30000;
  const REFRESHED_AT_KEY = "meowStatsRefreshedAt";

  function statsRefreshedInWindow() {
    const at = Number(localStorage.getItem(REFRESHED_AT_KEY));
    return Number.isFinite(at) && Date.now() - at < STATS_REFRESH_COOLDOWN_MS;
  }

  // One burst refreshes both halves of the card: the stats read and the redeem
  // watch. Whichever lands first settles the button — the other still renders
  // through the storage listener — and the safety timer covers a read that
  // stored nothing at all (both keep their last value in that case, so there
  // is nothing else to wait for). Shared by the Refresh button and the
  // refresh-on-open below.
  function startStatsRefresh() {
    if (statsRefreshPending) return;
    statsRefreshPending = true;
    try {
      localStorage.setItem(REFRESHED_AT_KEY, String(Date.now()));
    } catch (e) {
      // No localStorage — the stamp is a nicety; the burst still runs.
    }
    refreshStatsBtn.disabled = true;
    statsUpdatedEl.textContent = "Updating…";
    chrome.runtime
      .sendMessage({ type: "REFRESH_STATS" })
      .catch(() => settleStatsRefresh());
    chrome.runtime
      .sendMessage({ type: "REFRESH_REDEEM" })
      .catch(() => settleStatsRefresh());
    statsRefreshTimer = window.setTimeout(settleStatsRefresh, 45000);
  }

  refreshStatsBtn.addEventListener("click", startStatsRefresh);

  // Every popup open re-reads the stats (user request 2026-09-03): the popup
  // is usually opened to CHECK the numbers, so they should be a few seconds
  // old, not as old as the last routine — unless a burst ran moments ago
  // (the 30s window above), in which case the second open shows what the
  // first just fetched. Reuses the button's pending guard, so a Refresh
  // click during the opening read is one burst, not two — and the toggle
  // above turns the whole thing off for users who would rather not spend
  // the tabs (the button keeps working either way).
  if (refreshOnOpenToggle.checked && !statsRefreshedInWindow()) {
    startStatsRefresh();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.lastQuery) updateLastQuery(changes.lastQuery.newValue);
    if (changes.status) updateStatus(changes.status.newValue);
    if (changes.lastRewards) updateRewards(changes.lastRewards.newValue);
    if (changes.lastStatsLog) updateStatsLog(changes.lastStatsLog.newValue);
    if (changes.lastRedeemLog) updateRedeemLog(changes.lastRedeemLog.newValue);
    if (changes.lastImageSearch) updateImageSearch(changes.lastImageSearch.newValue);
    if (changes.lastTabAction) updateTabAction(changes.lastTabAction.newValue);
    if (changes.lastStats) {
      // Covers both a routine-start read and this popup's own Refresh — and
      // settles the button either way.
      renderStats(changes.lastStats.newValue);
      settleStatsRefresh();
    }
    if (changes.lastRedeem) {
      // Same contract as lastStats above: renders the read and settles the
      // Refresh button whichever of the two reads lands first.
      renderRedeem(changes.lastRedeem.newValue);
      settleStatsRefresh();
    }
    if (changes.lastCoupons) {
      updateCouponButton(changes.lastCoupons.newValue);
    }
    if (changes.redeemRestockNews || changes.redeemSoldOutNews) {
      // A flip landed while the popup was open — the banner appears live.
      // The watch's flip-back clear also lands here: removing a key fires a
      // change with newValue undefined, which renders that banner away.
      if (changes.redeemRestockNews) {
        renderRestockNews(changes.redeemRestockNews.newValue);
      }
      if (changes.redeemSoldOutNews) {
        renderSoldOutNews(changes.redeemSoldOutNews.newValue);
      }
    }
  });
});
