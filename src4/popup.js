// A module script (ADR-018 pattern): the popup imports the routine's own pure
// verdicts, so the plan preview it renders is computed by the same code the
// routine itself runs — not a re-implementation that can drift from it. The
// history module (ADR-020) joins them: the goal card and the sparkline are
// the same math the stats read's recording step uses.
import { routinePlan } from "./pure/plan.js";
import { statsAreCurrent, progressPair, rightSizedCount } from "./pure/verdicts.js";
import { earnedToday, trendPerDay, goalDaysRemaining } from "./pure/history.js";
import { localDayKey } from "./lib/day.js";

document.addEventListener("DOMContentLoaded", async () => {
  // Canonical step ids in default order — mirrors STARTUP_STEPS in background.js.
  const STEP_IDS = ["stats", "claim", "dailySet", "keepEarning", "search", "imageSearch"];

  // Query-source ids in default order — mirrors QUERY_SOURCES in background.js.
  const SOURCE_IDS = ["bingAutosuggest", "googleTrends", "wikipedia", "uselessFacts", "local"];

  // Tab ids in default order — mirrors settings.sectionOrder in lib/settings.js
  // (keyed by each view's data-view attribute and each tab button's data-tab).
  // The fourth build replaced the card stack with the tabbed app shell
  // (ADR-020): this order is the TAB BAR's order, set by the Tabs card in the
  // Settings view. Saved orders are normalized on load (unknown ids dropped,
  // missing ones slotted at their default spot).
  const SECTION_IDS = ["today", "runNow", "redeem", "activity"];
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

  // Popup height. Declared up here because the init block below uses them
  // before the section that owns them, and a const is not hoisted.
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
  const accentBtns = Array.from(document.querySelectorAll(".theme-btn[data-accent-choice]"));

  const runRoutineBtn = document.getElementById("runRoutineBtn");
  const runDailySetBtn = document.getElementById("runDailySetBtn");
  const runKeepEarningBtn = document.getElementById("runKeepEarningBtn");
  const claimBtn = document.getElementById("claimBtn");
  const startSearchBtn = document.getElementById("startSearchBtn");
  const stopBtn = document.getElementById("stopBtn");
  const runImageSearchBtn = document.getElementById("runImageSearchBtn");
  const clearTabsBtn = document.getElementById("clearTabsBtn");
  const clearTabsLabel = document.getElementById("clearTabsLabel");

  // The app shell (ADR-020): the main view is four tabbed views plus a
  // bottom tab bar, and the Settings view is still a gear click away. The
  // former layout-edit machinery (pencil, eye, × buttons, hidden-menu) is
  // gone — the Tabs card in the Settings view owns order and visibility now.
  const mainEl = document.getElementById("mainView");
  const settingsViewEl = document.getElementById("settingsView");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsBackBtn = document.getElementById("settingsBackBtn");
  const tabbar = document.querySelector(".tabbar");
  const tabBtns = Array.from(tabbar.querySelectorAll(".tab"));
  // The Tabs card's ordered list (the tab bar's order, by drag) and its
  // per-view show/hide switches.
  const viewOrderEl = document.getElementById("viewOrder");
  const viewToggles = Array.from(viewOrderEl.querySelectorAll("[data-view-toggle]"));

  const statusPill = document.getElementById("statusPill");
  const statusText = document.getElementById("statusText");
  const lastApiEl = document.getElementById("lastApi");
  const lastRewardsEl = document.getElementById("lastRewards");
  const lastStatsLogEl = document.getElementById("lastStatsLog");
  const lastRedeemLogEl = document.getElementById("lastRedeemLog");
  const lastQueryTextEl = document.getElementById("lastQueryText");
  const lastImageSearchEl = document.getElementById("lastImageSearch");
  const lastTabActionEl = document.getElementById("lastTabAction");

  // The Today card (the src2 Stats card, redesigned — ADR-019). Keys mirror
  // the shape background.js stores in lastStats,
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
  // The Today view's ring, goal, sparkline and plan preview (ADR-019's card,
  // reshaped by ADR-020), and the two background-run toggles: the Redeem
  // view's restock watcher and the Settings view's scheduled run.
  const ringFill = document.getElementById("ringFill");
  const earnedTodayEl = document.getElementById("earnedToday");
  const goalEmptyEl = document.getElementById("goalEmpty");
  const goalProgressEl = document.getElementById("goalProgress");
  const goalBalanceEl = document.getElementById("goalBalance");
  const goalTargetEl = document.getElementById("goalTarget");
  const goalFill = document.getElementById("goalFill");
  const goalNoteEl = document.getElementById("goalNote");
  const goalEditEl = document.getElementById("goalEdit");
  const goalEditBtn = document.getElementById("goalEditBtn");
  const goalPtsInput = document.getElementById("goalPtsInput");
  const goalSaveBtn = document.getElementById("goalSaveBtn");
  const sparkBlock = document.getElementById("sparkBlock");
  const sparkChart = document.getElementById("sparkChart");
  const sparkNoteEl = document.getElementById("sparkNote");
  const setGoalBtn = document.getElementById("setGoalBtn");
  const planBlock = document.getElementById("planBlock");
  const planList = document.getElementById("planList");
  const restockWatcherToggle = document.getElementById("restockWatcherEnabled");
  const scheduledRunToggle = document.getElementById("scheduledRunEnabled");
  const scheduledRunTimeInput = document.getElementById("scheduledRunTime");

  // One drag-reorder implementation, three lists (makeSortableList, below):
  // each instance owns its own drag/settle state, so the lists never interact.
  const startupOrderList = makeSortableList(stepList, {
    idKey: "step",
    save: order => {
      patchSettings({ startupOrder: order });
      // The plan preview follows the routine's order.
      renderPlan();
    }
  });
  const querySourceList = makeSortableList(sourceList, {
    idKey: "source",
    save: order => patchSettings({ querySourceOrder: order })
  });
  // The Tabs card's list: the tab bar's order. Same machinery, same
  // renumbering (the rows carry step-index circles), one difference — the
  // saved order has to be applied to the tab bar itself, not just this list.
  const viewOrderList = makeSortableList(viewOrderEl, {
    idKey: "view",
    save: order => {
      patchSettings({ sectionOrder: order });
      applyTabOrder(order);
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
  // Sections hidden through the Tabs card's switches, in the order they were
  // hidden. Init-time state for the same TDZ reason: the visibility functions
  // run during init, before the handlers section is reached.
  let hiddenSections = [];
  // The points history (ADR-020): one {day, first, last, at} per local day,
  // recorded by the stats read. The popup only renders from it — the writes
  // belong to the read.
  let history = Array.isArray(pointsHistory) ? pointsHistory : [];
  // The redeem goal (ADR-020), in points; 0 = no goal. Declared here for the
  // same TDZ reason: the goal renders run during init.
  let redeemGoalPts = 0;

  // settings live in sync; the run state/lastQuery churn too fast for the
  // sync quota. The run state is ONE document (runState — see
  // src2/lib/run-state.js): batch != null means the search batch is running
  // with its remaining count, activity != null means a manual run with its
  // label. The old "status" key's {running, label, remaining} shape is what
  // updateStatus consumes, so the small adapter below translates at each
  // boundary the popup touches.
  const { settings } = await chrome.storage.sync.get("settings");
  const {
    runState,
    lastQuery,
    lastImageSearch,
    lastTabAction,
    lastRewards,
    lastStatsLog,
    lastRedeemLog,
    lastStats,
    lastRedeem,
    lastCoupons,
    pointsHistory,
    redeemRestockNews,
    redeemSoldOutNews
  } = await chrome.storage.local.get([
    "runState",
    "lastQuery",
    "lastImageSearch",
    "lastTabAction",
    "lastRewards",
    "lastStatsLog",
    "lastRedeemLog",
    "lastStats",
    "lastRedeem",
    "lastCoupons",
    "pointsHistory",
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
  restockWatcherToggle.checked = effectiveSettings.restockWatcherEnabled ?? false;
  scheduledRunToggle.checked = effectiveSettings.scheduledRunEnabled ?? false;
  scheduledRunTimeInput.value = effectiveSettings.scheduledRunTime || "09:00";
  scheduledRunTimeInput.disabled = !scheduledRunToggle.checked;

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
  // Both visibility gates have to be on the root before the first paint
  // settles — the two disagreeing for a frame is a visible flash.
  applyDeveloperMode(devToggle.checked);
  // Same reasoning as the developer gate above: the coupon button joins the
  // Run grid before the first paint or not at all.
  applyExperimental(experimentalToggle.checked);
  applySectionVisibility();
  // "the meow" defaults to catppuccin; geist and primer remain.
  const theme = ["geist", "primer", "catppuccin"].includes(
    effectiveSettings.theme
  )
    ? effectiveSettings.theme
    : "catppuccin";
  applyTheme(theme);
  // The second theme axis (ADR-003): light/dark/auto, independent of the
  // palette choice.
  const mode = ["auto", "light", "dark"].includes(effectiveSettings.appearance)
    ? effectiveSettings.appearance
    : "auto";
  applyMode(mode);
  // The accent axis (ADR-020): an explicit brand color over the theme's own.
  // Only the picker's known values count — a corrupt string must read as
  // "the theme's choice", never paint the popup a surprising color.
  const accent = accentBtns.some(btn => btn.dataset.accentChoice === effectiveSettings.accentColor)
    ? effectiveSettings.accentColor
    : "";
  applyAccent(accent);
  // The redeem goal (ADR-020): 0 means no goal.
  redeemGoalPts = Number.isFinite(Number(effectiveSettings.redeemGoalPts))
    ? Math.max(0, Math.round(Number(effectiveSettings.redeemGoalPts)))
    : 0;
  startupOrderList.applyOrder(normalizeOrder(effectiveSettings.startupOrder));
  querySourceList.applyOrder(
    normalizeOrder(effectiveSettings.querySourceOrder, SOURCE_IDS)
  );
  // The tab bar's order follows the Tabs card's list (same saved order).
  const sectionOrder = normalizeOrder(effectiveSettings.sectionOrder, SECTION_IDS);
  viewOrderList.applyOrder(sectionOrder);
  applyTabOrder(sectionOrder);
  // The view switches mirror hiddenSections (on = the tab shows).
  viewToggles.forEach(input => {
    input.checked = !hiddenSections.includes(input.dataset.viewToggle);
  });
  applyViewPage("main");
  setView(rememberedView());
  applyStartupMaster();
  updateStepSummaries();
  updateStatus(statusFromRunState(runState));
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
  renderSparkline();
  renderGoal();

  // The height preference (or the CSS default) holds from here on; cache the
  // resolved value for popup-boot.js to reuse before the next paint.
  syncHeight();
  live = true;

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
      // A step joining or leaving the plan changes the preview.
      renderPlan();
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

  // ---------- views + the tab bar (ADR-020) ----------
  //
  // One view shows at a time (html[data-view] picks it; popup-boot.js mirrors
  // the choice into localStorage so the popup reopens where it was left).
  // A view the user switched off in the Tabs card — or the dev-gated
  // Activity view — can't be selected, so the fallback is the first tab that
  // can.

  function viewAvailable(id) {
    if (hiddenSections.includes(id)) return false;
    if (id === "activity" && !devToggle.checked) return false;
    return true;
  }

  function rememberedView() {
    let view = null;
    try {
      view = localStorage.getItem("meowView");
    } catch (e) {
      // No localStorage — the default (Today) holds.
    }
    return SECTION_IDS.includes(view) && viewAvailable(view) ? view : SECTION_IDS.find(viewAvailable);
  }

  function setView(view) {
    if (!viewAvailable(view)) view = SECTION_IDS.find(viewAvailable);
    root.dataset.view = view;
    tabBtns.forEach(btn => {
      btn.setAttribute("aria-selected", String(btn.dataset.tab === view));
    });
    try {
      localStorage.setItem("meowView", view);
    } catch (e) {
      // No localStorage — the choice still holds for this session.
    }
    // Entering a view lands at its top.
    mainEl.scrollTo({ top: 0 });
  }

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.tab));
  });

  // The Tabs card's drag list and the tab bar share one saved order; this
  // applies it to the bar (the list applies it to itself through
  // makeSortableList's applyOrder).
  function applyTabOrder(order) {
    order.forEach(id => {
      const btn = tabBtns.find(tab => tab.dataset.tab === id);
      if (btn) tabbar.appendChild(btn);
    });
  }

  // ---------- hidden views + the developer option ----------
  //
  // Two gates share one mechanism: attribute selectors on the root that
  // display:none the view and its tab (see popup.css). Both are mirrored
  // into localStorage so popup-boot.js can apply them before the first
  // paint. chrome.storage stays canonical.

  function applySectionVisibility() {
    if (hiddenSections.length) root.dataset.hidden = hiddenSections.join(" ");
    else delete root.dataset.hidden;
    try {
      localStorage.setItem("meowHidden", hiddenSections.join(" "));
    } catch (e) {
      // No localStorage — the attribute still applies for this session.
    }
  }

  // The Tabs card's switches: off writes the view into hiddenSections (and
  // takes its tab with it); on pulls it back out.
  viewToggles.forEach(input => {
    input.addEventListener("change", () => {
      const id = input.dataset.viewToggle;
      if (input.checked) {
        hiddenSections = hiddenSections.filter(sectionId => sectionId !== id);
      } else if (!hiddenSections.includes(id)) {
        hiddenSections = [...hiddenSections, id];
      }
      patchSettings({ hiddenSections: hiddenSections.slice() });
      applySectionVisibility();
      // Switching off the view you're standing in moves you to the first
      // tab that still exists.
      if (!viewAvailable(root.dataset.view)) setView(root.dataset.view);
    });
  });

  // The Activity view is the Developer Option: it stays out of the tab bar
  // unless the Settings toggle shows it. Gating it this way — rather than
  // through hiddenSections — keeps the two lists from fighting over one
  // view: the Tabs switch stays honest about what it controls.
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
  // Coupons button in the Run grid. Same mirror pattern as the developer
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

  devToggle.addEventListener("change", () => {
    applyDeveloperMode(devToggle.checked);
    patchSettings({ developerOptionsEnabled: devToggle.checked });
    if (!viewAvailable(root.dataset.view)) setView(root.dataset.view);
  });

  experimentalToggle.addEventListener("change", () => {
    applyExperimental(experimentalToggle.checked);
    patchSettings({ experimentalFeatures: experimentalToggle.checked });
  });

  // ---------- the goal card (ADR-020) ----------
  //
  // A points target with a progress bar and a "~N days at your pace"
  // estimate off the history's trend. Two ways in: the Edit button's inline
  // number field, and the Redeem view's "Set as goal" (the chosen coin
  // amount's price). 0 is "no goal" — the empty state.

  function renderGoal() {
    const hasGoal = redeemGoalPts > 0;
    goalEmptyEl.hidden = hasGoal;
    goalProgressEl.hidden = !hasGoal;
    if (!hasGoal) return;

    const balance = availablePointsNumber();
    goalTargetEl.textContent = `${redeemGoalPts.toLocaleString("en-US")} pts`;
    const pct =
      balance != null && balance > 0
        ? Math.min(100, (balance / redeemGoalPts) * 100)
        : 0;
    goalFill.style.setProperty("--fill", `${pct}%`);
    goalFill.classList.toggle("is-done", balance != null && balance >= redeemGoalPts);
    goalBalanceEl.textContent =
      balance != null ? `${balance.toLocaleString("en-US")} pts` : "—";

    if (balance != null && balance >= redeemGoalPts) {
      goalNoteEl.textContent = "Goal reached — pick the next one.";
    } else if (balance == null) {
      goalNoteEl.textContent = "Refresh in Today to see where you stand.";
    } else {
      const perDay = trendPerDay(history, 7);
      const days = goalDaysRemaining(balance, redeemGoalPts, perDay);
      goalNoteEl.textContent =
        days == null
          ? `${(redeemGoalPts - balance).toLocaleString("en-US")} pts to go.`
          : `~${days} ${days === 1 ? "day" : "days"} at your pace (${(redeemGoalPts - balance).toLocaleString("en-US")} pts to go).`;
    }
  }

  function openGoalEdit() {
    goalPtsInput.value = redeemGoalPts > 0 ? String(redeemGoalPts) : "";
    goalEditEl.hidden = false;
    goalPtsInput.focus();
  }

  async function saveGoalEdit() {
    const raw = Number(goalPtsInput.value);
    // Empty or 0 is a deliberate "no goal"; a negative or absurd value is
    // clamped away rather than trusted.
    const value = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    redeemGoalPts = value;
    goalEditEl.hidden = true;
    await patchSettings({ redeemGoalPts: value });
    renderGoal();
  }

  goalEditBtn.addEventListener("click", () => {
    if (goalEditEl.hidden) openGoalEdit();
    else goalEditEl.hidden = true;
  });

  goalSaveBtn.addEventListener("click", saveGoalEdit);

  goalPtsInput.addEventListener("keydown", event => {
    if (event.key === "Enter") saveGoalEdit();
    if (event.key === "Escape") goalEditEl.hidden = true;
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

  // ---------- restock watcher + scheduled run ----------
  //
  // Both follow the same contract: the popup writes the setting, then tells
  // the worker to reschedule its alarm from what was just written. The worker
  // reads the setting back itself (syncRedeemWatch/syncScheduledRun), so the
  // stored value stays the one truth.

  restockWatcherToggle.addEventListener("change", async () => {
    await patchSettings({ restockWatcherEnabled: restockWatcherToggle.checked });
    chrome.runtime.sendMessage({ type: "SET_RESTOCK_WATCH" }).catch(() => {});
  });

  scheduledRunToggle.addEventListener("change", async () => {
    scheduledRunTimeInput.disabled = !scheduledRunToggle.checked;
    await patchSettings({ scheduledRunEnabled: scheduledRunToggle.checked });
    chrome.runtime.sendMessage({ type: "SYNC_SCHEDULED_RUN" }).catch(() => {});
  });

  // An empty field is not a time: keep the stored schedule rather than fire
  // at a surprising default. The worker's strict parse would treat it as "no
  // schedule" anyway — this way the setting never degrades in the first place.
  scheduledRunTimeInput.addEventListener("change", async () => {
    if (!scheduledRunTimeInput.value) return;
    await patchSettings({ scheduledRunTime: scheduledRunTimeInput.value });
    chrome.runtime.sendMessage({ type: "SYNC_SCHEDULED_RUN" }).catch(() => {});
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

  // ---------- accent (ADR-020) ----------
  //
  // An explicit brand color over the theme's own --brand: the ring, the
  // fills, the switches, the primary buttons all follow it. "" (the "Theme"
  // button) restores the palette's choice. Mirrored into localStorage for
  // popup-boot.js, like every other pre-paint axis.

  function applyAccent(color) {
    if (color) root.style.setProperty("--brand", color);
    else root.style.removeProperty("--brand");
    accentBtns.forEach(btn => {
      btn.setAttribute("aria-pressed", String(btn.dataset.accentChoice === color));
    });
    try {
      localStorage.setItem("meowAccent", color);
    } catch (e) {
      // No localStorage — the attribute still applies for this session.
    }
  }

  accentBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      applyAccent(btn.dataset.accentChoice);
      patchSettings({ accentColor: btn.dataset.accentChoice });
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
  // The app shell (ADR-020) made the window a fixed-height frame, so the
  // fold-measuring machinery is gone: the Advanced field's value (0 = the
  // CSS default of 440) is all there is to apply, clamped to the window
  // Chromium allows a popup (240–600). The resolved height is cached for
  // popup-boot.js to reuse before the next paint.

  function clampHeight(h) {
    return Math.round(Math.min(MAX_H, Math.max(MIN_H, h)));
  }

  // The user's height preference, when it holds a usable value: 0 means the
  // CSS default (no override at all).
  function userPopupHeight() {
    const h = Number(popupHeightInput.value);
    return Number.isFinite(h) && h >= MIN_H && h <= MAX_H ? h : null;
  }

  function syncHeight() {
    const user = userPopupHeight();
    if (user) root.style.setProperty("--popup-h", `${clampHeight(user)}px`);
    else root.style.removeProperty("--popup-h");

    try {
      localStorage.setItem("popupHeight", String(user ? clampHeight(user) : 0));
    } catch (e) {
      // Without the cache the popup just re-reads the setting on each open.
    }
  }

  // ---------- the Settings view ----------
  //
  // The topbar's gear switches between the tabbed views and the Settings
  // view (the startup plan, the tabs and the former Advanced panel live
  // there). Not persisted: every popup opens on the tabs — the settings are
  // consulted occasionally, the tabs are acted on daily.

  function applyViewPage(page) {
    const settings = page === "settings";
    root.dataset.page = settings ? "settings" : "main";
    mainEl.hidden = settings;
    settingsViewEl.hidden = !settings;
    settingsBtn.setAttribute("aria-pressed", String(settings));
    // Land at the top of whichever view was just entered.
    (settings ? settingsViewEl : mainEl).scrollTo({ top: 0 });
  }

  settingsBtn.addEventListener("click", () => {
    applyViewPage(root.dataset.page === "settings" ? "main" : "settings");
  });

  settingsBackBtn.addEventListener("click", () => applyViewPage("main"));

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
      patchSettings({ rightSizeSearchBatch: searchModeAutomatic.checked });
      // Automatic sizes the plan's search line to today's read.
      renderPlan();
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

  // The Run view's hero (ADR-020): the whole startup plan on demand. The
  // press IS the confirmation (the background's manual flag opts out of the
  // master switch, the once-per-day gate and the confirm dialog), so it goes
  // through the same double-click guard as the other runs.
  runRoutineBtn.addEventListener("click", () => {
    sendRun({ type: "RUN_FULL_ROUTINE" }, () =>
      setLog(lastRewardsEl, "Routine — starting…", null)
    );
  });

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
      const { runState: fresh } = await chrome.storage.local.get("runState");
      updateStatus(statusFromRunState(fresh));
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

  // The runState document (src2/lib/run-state.js) squeezed into the shape
  // updateStatus has always consumed: {running, label, remaining}. The batch
  // owns the countdown; a manual activity owns the label; anything else —
  // including a stop's one nulling write — reads as idle.
  function statusFromRunState(state) {
    if (state && state.batch) {
      return { running: true, label: null, remaining: state.batch.remaining };
    }
    if (state && state.activity) {
      return { running: true, label: state.activity.label, remaining: null };
    }
    return { running: false, remaining: 0 };
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

  // The ring: the search-points pair ("40/60") as an arc. With no today-fresh
  // pair the ring keeps its empty "—" state (the CSS default offset holds the
  // arc at zero). 2πr with r=36 — kept in one place so the SVG and the math
  // can't drift apart.
  const RING_CIRCUMFERENCE = 226.2;

  function renderRing() {
    const pair = progressPair(lastStatsSeen && lastStatsSeen.searchPoints);
    if (!statsAreCurrent(lastStatsSeen) || !pair) {
      ringFill.style.removeProperty("--ring-offset");
      ringFill.classList.remove("is-done");
      return;
    }
    const pct = pair[1] > 0 ? (pair[0] / pair[1]) * 100 : 0;
    const clamped = Math.min(100, Math.max(0, pct));
    ringFill.style.setProperty(
      "--ring-offset",
      String(RING_CIRCUMFERENCE * (1 - clamped / 100))
    );
    ringFill.classList.toggle("is-done", pair[0] >= pair[1]);
  }

  // The earned-today delta under the balance: the history's first-to-last
  // movement of the local day. Honest about a redeem (negative), quiet when
  // there is nothing recorded yet.
  function renderEarnedDelta() {
    const earned = earnedToday(history, localDayKey());
    if (earned == null) {
      earnedTodayEl.textContent = "";
      return;
    }
    const sign = earned > 0 ? "+" : "";
    earnedTodayEl.textContent = `${sign}${earned.toLocaleString("en-US")} today`;
  }

  // The sparkline: the last 7 days' deltas as one polyline. The SVG's
  // viewBox is 240×48; points are spread evenly across the width and scaled
  // to the biggest absolute delta so a spend day doesn't flatten the rest.
  // Hidden until two days exist — one point is not a line.
  function renderSparkline() {
    const days = history.slice(-7);
    sparkBlock.hidden = days.length < 2;
    if (days.length < 2) return;

    const deltas = days.map(entry => entry.last - entry.first);
    const span = Math.max(...deltas.map(d => Math.abs(d)), 1);
    const stepX = 240 / (deltas.length - 1);
    const points = deltas
      .map((delta, i) => {
        const x = i * stepX;
        // 0 sits mid-height; gains climb, spends dip.
        const y = 24 - (delta / span) * 20;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    const polyline = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "polyline"
    );
    polyline.setAttribute("points", points);
    sparkChart.replaceChildren(polyline);

    const trend = trendPerDay(history, 7);
    sparkNoteEl.textContent =
      trend != null
        ? `≈${Math.round(trend).toLocaleString("en-US")} pts/day over the last ${days.length} days`
        : `Last ${days.length} days`;
  }

  // The plan preview's run-side wording. Only the search step gets a count —
  // and only in automatic mode, where today's read can size it (the same
  // rightSizedCount verdict the routine itself uses).
  function planRunText(id) {
    if (id !== "search") return "will run";
    const perBatch = Number(searchesInput.value) || 30;
    if (!searchModeAutomatic.checked) return `${perBatch} searches`;
    const right = rightSizedCount(lastStatsSeen, perBatch);
    return right.trimmed ? `${right.count} searches to the cap` : `${perBatch} searches`;
  }

  // The plan preview: one line per ENABLED step in the current order, its
  // verdict computed by routinePlan — the routine's own pure verdict code,
  // imported at the top of this module. The stats read is skipped (it is the
  // read itself, never a "step" from the user's point of view) and disabled
  // steps don't appear; the whole block hides until a today-fresh read
  // exists, because a stale read has no verdicts to show.
  const PLAN_STEP_TITLES = {
    claim: "Claim",
    dailySet: "Daily set",
    keepEarning: "Keep earning",
    search: "Web searches",
    imageSearch: "Image search"
  };

  function renderPlan() {
    const stepEnabled = id => {
      const input = document.getElementById(ENABLED_KEY[id]);
      return !!input && input.checked;
    };
    const order = statsAreCurrent(lastStatsSeen)
      ? startupOrderList.currentOrder().filter(id => id !== "stats" && stepEnabled(id))
      : [];
    planBlock.hidden = !order.length;
    planList.replaceChildren(
      ...routinePlan(lastStatsSeen, order).map(entry => {
        const li = document.createElement("li");
        li.className = entry.willRun ? "plan-step" : "plan-step is-skip";
        const title = document.createElement("span");
        title.className = "plan-title";
        title.textContent = PLAN_STEP_TITLES[entry.id] || entry.id;
        const verdict = document.createElement("span");
        verdict.className = "plan-verdict";
        verdict.textContent = entry.willRun ? planRunText(entry.id) : entry.reason;
        li.append(title, verdict);
        return li;
      })
    );
    // The block appearing or leaving moves the fold; while it stays, the
    // re-render is called from places that re-measure anyway.
    syncHeight();
  }

  // Display strings exactly as the dashboard showed them, plus a plain HH:MM
  // stamp — the read is always recent enough that a date would only add noise.
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
    // The banner pushes every view down, so it moves with it — and the ring,
    // the goal and the plan preview below just got their verdicts too.
    renderRing();
    renderEarnedDelta();
    renderGoal();
    renderPlan();
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
  // longer render inside the Today card, user request 2026-09-03 — the card
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
      redeemNoteEl.textContent = "No amounts yet — Refresh in Today reads them.";
    } else if (!chosen || chosen.disabled) {
      redeemBtnLabelEl.textContent = "View page";
      redeemNoteEl.textContent = "Every amount is sold out right now.";
    } else if (!redeemUrl) {
      redeemBtnLabelEl.textContent = "View page";
      redeemNoteEl.textContent = "No redeem page yet — Refresh in Today finds it.";
    } else {
      const price = coinPricePts(chosen.value);
      const points = availablePointsNumber();
      if (price == null) {
        redeemBtnLabelEl.textContent = "View page";
        redeemNoteEl.textContent = "Opens the amount's own redeem page.";
      } else if (points == null) {
        redeemBtnLabelEl.textContent = "View page";
        redeemNoteEl.textContent = `${price.toLocaleString("en-US")} pts needed — Refresh in Today to check yours.`;
      } else if (points >= price) {
        redeemBtnLabelEl.textContent = "Redeem";
        redeemNoteEl.textContent = `You have ${points.toLocaleString("en-US")} pts — Redeem Now is pressed on the page.`;
      } else {
        redeemBtnLabelEl.textContent = "View page";
        redeemNoteEl.textContent = `${price.toLocaleString("en-US")} pts needed — the page opens, nothing pressed.`;
      }
    }
    updateSetGoalBtn();
  }

  // The "Set as goal" button (ADR-020): enabled exactly when the chosen
  // amount has a parseable price — the same verdict the Redeem button's
  // label just made, one affordance over.
  function updateSetGoalBtn() {
    const chosen = redeemSelect.selectedOptions[0];
    const price = chosen && !chosen.disabled ? coinPricePts(chosen.value) : null;
    setGoalBtn.disabled = price == null;
  }

  // Copying the chosen amount's price into the Today view's goal, then
  // taking the user there to see it land.
  setGoalBtn.addEventListener("click", async () => {
    const chosen = redeemSelect.selectedOptions[0];
    const price = chosen ? coinPricePts(chosen.value) : null;
    if (price == null) return;
    redeemGoalPts = price;
    await patchSettings({ redeemGoalPts: price });
    renderGoal();
    setView("today");
  });

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
    if (changes.runState) updateStatus(statusFromRunState(changes.runState.newValue));
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
    if (changes.pointsHistory) {
      // The read recorded a day (or moved today's `last`): the delta, the
      // sparkline and the goal's ETA all follow.
      history = Array.isArray(changes.pointsHistory.newValue)
        ? changes.pointsHistory.newValue
        : [];
      renderEarnedDelta();
      renderSparkline();
      renderGoal();
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
