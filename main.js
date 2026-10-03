import localforage from 'localforage';
import {
    escapeHTML, renderErrorHTML, cleanSubjects,
    ANNA_ARCHIVE_URL, API_BASE, API_CONTACT_EMAIL,
    parseSafeInt, getCleanProxyBase, normalizeCacheKey,
    langMapToOL, langMapToAA, LANGUAGE_ALIASES, CANONICAL_LANG_MAP,
    normalizeLanguageCode, editionLangMatches
} from './utils.js';
import { DOM, watchInputs, INPUT_IDS, RENDER_CHUNK } from './dom.js';
import {
    safeStorage, translationCache, translationCoverCache, translationGenerationToken,
    libraryKeySet, syncLibraryKeySet, isLibraryWork, descriptionCache,
    translationReverseIndex, rebuildTranslationReverseIndex, setTranslationCache,
    deleteTranslationCache, pruneTranslationCacheIfLarge, translationPromiseCache,
    TranslationQueue, translationQueue, loadTranslationCache, saveTranslationCacheTimer,
    saveTranslationCache, bumpTranslationGeneration, setTelemetryHub, COVER_CACHE_TTL, COVER_DB_PREFIX,
    COVER_404_DB_PREFIX, coverFetchInFlight, coverMemoryCache, cover404MemoryCache,
    COVER_MEMORY_CACHE_MAX, COVER_FETCH_MAX_CONCURRENT, coverFetchActive, coverFetchQueue,
    normalizeCoverId, getCoverUrl, rememberCoverInMemory, getCoverFromMemory,
    hasCoverInMemory, COVER_404_MEMORY_CACHE_MAX, rememberCoverNegative,
    getNegativeCachedCover, getCachedCoverDataUrl, getWorkApiUrl, cacheCoverInBackground,
    processCoverFetchQueue, fetchCoverDataUrl, COVER_SEQ_PARALLEL, coverSeqToken,
    coverIdbSuspect, loadOneCover, hydrateCachedCovers, SYNOPSIS_DB_PREFIX,
    SYNOPSIS_CACHE_TTL, getCachedSynopsis, cacheSynopsis, TITLE_CASE_LOWER,
    ROMAN_NUMERALS, toCleanSubjectTitleCase, isCleanLibrarySubjectsEnabled,
    isSynopsisCleanupEnabled, cleanSynopsis, setStorageProxyUrl, setLibrarySource,
    TRENDING_KEY, TRENDING_LS_KEY, TRENDING_TTL
} from './storage-cache.js';
import {
    apiTelemetry, apiBlockResumeTime, isApiBlocked, fetchOpenLibrary,
    fetchDiscoverBundleFromProxy,
    schedulerMode, schedulerMinDelayMs, schedulerMaxConnections,
    schedulerBurstCapacity, customProxyUrl, DEFAULT_PROXY_URL,
    setSchedulerMode, setSchedulerMinDelayMs, setSchedulerMaxConnections,
    setSchedulerBurstCapacity, setCustomProxyUrl
} from './network-engine.js';
import {
    updateLibraryBadge, setupTagInput, syncSortNoteState, updateSortDirBtn,
    saveCurrentModeState, restoreModeState, getHashStateObj, saveStateToHash,
    hasActiveSearchCriteria, loadStateFromHash, checkInputs, appendKeyboardListeners,
    clearAllFilters, getLocalFilteredBooks, getFilteredSubjectCounts, setupAutocomplete,
    isAuthorNameOnly, containsAuthorName, stripAuthorCredit, isJunkPhrase, isValidSubtitle,
    isTranslateCoversEnabled, JUNK_TERMS, JUNK_REGEX, stripJunkTitleSuffix, isJunkTitleFragment,
    extractForeignSegment, formatDisplayTitle, escapeRegex, isValidEditionForWork,
    normalizeForCompare, pickBestEdition, trimEditionPayload, fetchWorkEditions, isDuplicateTitle,
    getExplicitTargetLang, modifyTagFilter, showStageToast, processTags, mapSubjectWorkToDoc,
    fetchDiscoverSeed, fetchGenreShelves, prewarmCachedGenreCovers, prewarmCachedTrendingCovers,
    parseTrendingPayload, cleanLibraryForExport, downloadFile,
    showImportStatus, exportLibraryJSON, exportLibraryCSV, parseImportCSV, handleImportFile,
    performSearch, currentTotalHidden, activeQueryParams, activeMinStar, activeMinRCount,
    activeSort, lastSearchTimingHTML, fetchTimerInterval, clearTranslationAndCoverCache,
    applyLocalFilters, renderNextChunk, createLibraryDoc, cacheBookTokens, renderDiscoverDashboard,
    SORT_DEFAULTS
} from './book-features.js';
import {
    openDetailsDrawer, closeDetailsDrawer, renderResults, renderSavedCollection,
    updateToggleAllBtnState, refreshGridCardTags, getGridCardWidth, validateAndApplyInputLimit,
    applyListView, initTranslationObserver, syncSettingsCategoriesForMode,
    collapseMobileSidebarIfOpen, isMobileViewport, updateSelectionBar, setSettingsPanelOpen,
    updateMobileHeaderHeight, checkMobileSidebarState, getSidebarSide, applySidebarSide,
    closeTagsPopup, handleScrollState, sidebarToggleBtn,
    railFilterBtn, railSortBtn, mobileSidebarBackdrop, resultsMainEl, resultsHeaderEl,
    syncThemeCheckboxes, lastWasMobileViewport, openTagsPopupEl,
    syncSidebarSideUI, relocateSidebarToggleForSide, wireRailShortcut, railPopoverState,
    legacyCollapsedRail, applyLegacyLayout, restoreHeaderElementsToTop, applyCompactHeader,
    syncRightGroupGap, scheduleRightGroupSync, applyOverlayedSidebar, mobileLayoutToggle,
    applyMobileLegacyLayout, syncMobileEarOffset, updateSwipeHintState, updateSwipeHintVisibility,
    resetAllSettingsToDefault, cancelAllSmoothScrolls, syncSmoothScrollBodyClass,
    syncWheelListener,
    syncSchedulerControls, updateTelemetryPinState, toggleTelemetryHUD, syncTelemetryHUD,
    initDraggableTelemetry, updateDiscoverToggleLabels,
    positionRailPopovers, closeAllRailPopovers, renderSynopsis, currentDrawerWorkKey
} from './app-ui.js';
// → utils.js: _escMap, escapeHTML, renderErrorHTML, cleanSubjects
// → storage-cache.js: safeStorage
// → utils.js: ANNA_ARCHIVE_URL, API_BASE, API_CONTACT_EMAIL
// → network-engine.js: apiBlockResumeTime, isApiBlocked
// → book-features.js: searchRequestToken, bumpSearchRequestToken (+ query state below)

// → network-engine.js: apiTelemetry (+ apiBlock lets above)

// ── Decoupled Adaptive Network Scheduler ──────────────────────────────────
// Owned by network-engine.js; re-exported here for app-ui and other modules.
export {
    schedulerMode, schedulerMinDelayMs, schedulerMaxConnections,
    schedulerBurstCapacity, customProxyUrl, DEFAULT_PROXY_URL,
    setSchedulerMode, setSchedulerMinDelayMs, setSchedulerMaxConnections,
    setSchedulerBurstCapacity, setCustomProxyUrl
};

// → network-engine.js: OPTIMIZED_* invariants

// Module wiring: inject the telemetry hub and library source into storage-cache,
// and snapshot manual-mode burst tokens.
setTelemetryHub(apiTelemetry);
setStorageProxyUrl(customProxyUrl);
setLibrarySource(() => library);
fetchOpenLibrary.initBurstTokens();

// → utils.js: getCleanProxyBase, normalizeCacheKey

// → utils.js: getCleanProxyBase, normalizeCacheKey
// → network-engine.js: fetchOpenLibrary (+ OPTIMIZED_* above)
// → utils.js: langMapToOL, langMapToAA, LANGUAGE_ALIASES, CANONICAL_LANG_MAP, normalizeLanguageCode, editionLangMatches
// → dom.js: DOM, watchInputs, INPUT_IDS
export let currentPage = 1;
// → book-features.js: currentTotalHidden, activeQueryParams, activeMinStar, activeMinRCount, activeSort (search-query state)
export let allDisplayedDocs = [];
export let currentViewMode = 'search';
let toggleAllConfirmTimeoutId = null;
export let lastSearchTotalFound = 0;
// → book-features.js: lastSearchTimingHTML (search-query state)
export let sortDirection = 'desc';
export let renderIndex = 0;
export let cachedSubjectCounts = null;
export let cachedLocalFilteredBooks = null;
export let cachedTrendingBooks = null;
export let cachedGenreShelves = null;
export let currentDiscoverTab = 'trending';
// → book-features.js: fetchTimerInterval (search-query state)
// → app-ui.js: currentDrawerWorkKey
// Cross-module setters: book-features.js / app-ui.js own no shared `let`s;
// they mutate hub state through these (ESM forbids reassigning imports).
// Each setter is added alongside the flip whose moved code needs it.
export const setCachedTrendingBooks = (v) => { cachedTrendingBooks = v; };
export const setCachedGenreShelves = (v) => { cachedGenreShelves = v; };
export const setCachedSubjectCounts = (v) => { cachedSubjectCounts = v; };
export const setCachedLocalFilteredBooks = (v) => { cachedLocalFilteredBooks = v; };
export const setRenderIndex = (v) => { renderIndex = v; };
export const setCurrentViewMode = (v) => { currentViewMode = v; };
export const setSortDirection = (v) => { sortDirection = v; };
export const setAllDisplayedDocs = (v) => { allDisplayedDocs = v; };
export const setLastSearchTotalFound = (v) => { lastSearchTotalFound = v; };
export const setCurrentPage = (v) => { currentPage = v; };
// → dom.js: RENDER_CHUNK
// → dom.js: RENDER_CHUNK
// → app-ui.js: selectionMode, selectedKeys, holdTimer, holdSuppressClick, holdStart, lastSelectionModeChange, SELECTION_HOLD_MS, SELECTION_MOVE_TOLERANCE
// → storage-cache.js: translationCache … translationPromiseCache
// → storage-cache.js: TranslationQueue, translationQueue, loadTranslationCache, saveTranslationCache(+Timer), bumpTranslationGeneration

// → storage-cache.js: TranslationQueue, translationQueue, loadTranslationCache, saveTranslationCache(+Timer), bumpTranslationGeneration
// → book-features.js: clearTranslationAndCoverCache
// → book-features.js: clearTranslationAndCoverCache
// → book-features.js: appStates, SORT_DEFAULTS, updateLibraryBadge, createLibraryDoc (library stays hub-owned)
export let library = [];
// We no longer load from localStorage here because IndexedDB is asynchronous
updateLibraryBadge();
// → book-features.js: updateLibraryBadge, createLibraryDoc, renderNextChunk, toggleLibrary
// → app-ui.js: syncThemeCheckboxes
document.addEventListener('change', (e) => {
    if (e.target && (e.target.id === 'mobileThemeCheckbox' || e.target.id === 'checkbox')) {
        syncThemeCheckboxes(e.target.checked, true);
    }
});
const savedTheme = safeStorage.getItem('ole_theme');
if (savedTheme) {
    syncThemeCheckboxes(savedTheme === 'dark');
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    syncThemeCheckboxes(true);
} else {
    syncThemeCheckboxes(false);
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!safeStorage.getItem('ole_theme')) {
        syncThemeCheckboxes(e.matches);
    }
});
// → book-features.js: setupTagInput
// → app-ui.js: collapseMobileSidebarIfOpen
// → book-features.js: syncSortNoteState, updateSortDirBtn, saveCurrentModeState, restoreModeState, getHashStateObj, saveStateToHash, hasActiveSearchCriteria, loadStateFromHash
if (DOM.persistToggle) {
    DOM.persistToggle.checked = safeStorage.getItem('ole_persist_url') !== 'false';
    DOM.persistToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_persist_url', DOM.persistToggle.checked ? 'true' : 'false');
        if (DOM.persistToggle.checked) saveStateToHash(true);
        else history.replaceState(null, '', window.location.pathname + window.location.search);
    });
}
window.addEventListener('popstate', () => {
    if (DOM.persistToggle.checked) {
        if (loadStateFromHash()) {
            checkInputs();
            if (currentViewMode === 'library') {
                applyLocalFilters();
            } else {
                if (hasActiveSearchCriteria()) {
                    performSearch(false);
                } else {
                    renderDiscoverDashboard();
                }
            }
        } else {
            // No hash, clear values and render discover dashboard
            watchInputs.forEach(input => { input.value = ''; });
            tagManagerInc.clear();
            tagManagerExc.clear();
            DOM.globalSearchInput.value = '';
            DOM.globalSearchClearBtn.style.display = 'none';
            currentViewMode = 'search';
            DOM.viewSavedBtn.classList.remove('active');
            DOM.sortDateOpt.style.display = 'none';
            DOM.sortRelevanceOpt.style.display = 'block';
            syncSettingsCategoriesForMode(currentViewMode);
            checkInputs();
            renderDiscoverDashboard();
        }
    }
});
DOM.copyUrlBtn.addEventListener('click', e => {
    e.preventDefault();
    const state = getHashStateObj();
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete('debug');
    const searchStr = searchParams.toString() ? `?${searchParams.toString()}` : '';
    const url = window.location.origin + window.location.pathname + searchStr + '#' + encodeURIComponent(JSON.stringify(state));
    navigator.clipboard.writeText(url).then(() => {
        const orig = DOM.copyUrlBtn.innerHTML;
        DOM.copyUrlBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => { DOM.copyUrlBtn.innerHTML = orig; }, 2000);
    });
});
// → app-ui.js: syncSettingsCategoriesForMode
// → book-features.js: checkInputs, appendKeyboardListeners
appendKeyboardListeners();
let localFilterTimer = null;
watchInputs.forEach(input => {
    input.addEventListener('input', () => {
        checkInputs();
        if (currentViewMode === 'library') {
            clearTimeout(localFilterTimer);
            localFilterTimer = setTimeout(applyLocalFilters, 150);
        }
    });
    input.addEventListener('change', checkInputs);
});
DOM.sort.addEventListener('change', () => {
    const v = DOM.sort.value;
    syncSortNoteState();
    sortDirection = SORT_DEFAULTS[v] || 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'library') applyLocalFilters();
});
document.getElementById('sortDirBtn').addEventListener('click', () => {
    const isApiMode = currentViewMode === 'search';
    const val = DOM.sort.value;
    if (val === 'random') return;
    if (isApiMode && val !== 'new' && val !== 'rating' && val !== 'reviews') return;
    sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'library') {
        applyLocalFilters();
    } else {
        if (val === 'reviews') {
            allDisplayedDocs.sort((a, b) => (sortDirection === 'desc' ? 1 : -1) * ((b.ratings_count || 0) - (a.ratings_count || 0)));
            renderResults(allDisplayedDocs.length, lastSearchTotalFound, false, currentTotalHidden, 0, true);
        } else {
            performSearch(false);
        }
    }
});
// → book-features.js: clearAllFilters
document.getElementById('sortResetBtn').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (currentViewMode === 'library') DOM.sort.value = 'date';
    else DOM.sort.value = 'relevance';
    syncSortNoteState();
    sortDirection = SORT_DEFAULTS[DOM.sort.value] || 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'library') applyLocalFilters();
});
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        clearAllFilters();
    });
}
document.querySelectorAll('.sub-reset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const target = btn.getAttribute('data-target');
        if (target === 'include') {
            tagManagerInc.clear();
            ['incLang', 'incTitle', 'incAuthor', 'incPlace', 'incPerson'].forEach(id => document.getElementById(id).value = '');
        } else if (target === 'exclude') {
            tagManagerExc.clear();
            ['excLang', 'excPlace', 'excPerson'].forEach(id => document.getElementById(id).value = '');
        } else if (target === 'metrics') {
            ['minYear', 'maxYear', 'minStarRating', 'minRatings'].forEach(id => document.getElementById(id).value = '');
        }
        checkInputs();
        if (currentViewMode === 'library') applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash();
    });
});
DOM.resetBtn.addEventListener('click', () => {
    watchInputs.forEach(input => { input.value = ''; });
    tagManagerInc.clear(); tagManagerExc.clear();
    DOM.globalSearchInput.value = '';
    DOM.globalSearchClearBtn.style.display = 'none';
    if (currentViewMode === 'library') {
        DOM.sort.value = 'date';
        syncSortNoteState();
        checkInputs();
        applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash(true);
        return;
    }
    DOM.sort.value = 'relevance';
    syncSortNoteState();
    DOM.grid.innerHTML = '';
    DOM.footer.style.display = 'none';
    DOM.resultsMeta.style.display = 'none';
    allDisplayedDocs = [];
    lastSearchTotalFound = 0;
    currentPage = 1;
    if (DOM.persistToggle.checked) history.pushState(null, '', window.location.pathname + window.location.search);
    checkInputs();
    renderDiscoverDashboard();
});
// Legacy Layout (switch ON) replaces Reset + Find Books with one combined
// action. The main reset handler above already clears every filter input,
// both tag managers, the search box AND resets sort — exactly the promised
// behavior — so this button simply delegates to it (single source of truth).
const resetFiltersSortBtn = document.getElementById('resetFiltersSortBtn');
if (resetFiltersSortBtn) {
    resetFiltersSortBtn.addEventListener('click', () => { DOM.resetBtn.click(); });
}
// → book-features.js: tokenize, getBookTokens, arrayHasAnyToken, arrayHasAllTokens, cacheBookTokens
// → book-features.js: tokenize, getBookTokens, arrayHasAnyToken, arrayHasAllTokens, cacheBookTokens
// → book-features.js: getLocalFilteredBooks
// → book-features.js: getLocalFilteredBooks
// → book-features.js: getFilteredSubjectCounts
// → book-features.js: getFilteredSubjectCounts
// → book-features.js: setupAutocomplete
export const tagManagerInc = setupTagInput('incSubject', 'incSubjectContainer', () => document.getElementById('incSubjectGhost').innerHTML = '');
export const tagManagerExc = setupTagInput('excSubject', 'excSubjectContainer', () => document.getElementById('excSubjectGhost').innerHTML = '');
setupAutocomplete('incSubject', 'incSubjectList', 'incSubjectLoading', 'incSubjectGhost', () => currentViewMode === 'library', tagManagerInc);
setupAutocomplete('excSubject', 'excSubjectList', 'excSubjectLoading', 'excSubjectGhost', () => currentViewMode === 'library', tagManagerExc);
// → book-features.js: resolvedTitlesInActivePass … getExplicitTargetLang (translation helpers)
// → book-features.js: applyLocalFilters, modifyTagFilter, showStageToast, processTags, mapSubjectWorkToDoc
// → book-features.js: modifyTagFilter, showStageToast, processTags, mapSubjectWorkToDoc
// → storage-cache.js: cover caches (COVER_* … rememberCoverNegative)
// → storage-cache.js: getNegativeCachedCover … processCoverFetchQueue
// → storage-cache.js: getNegativeCachedCover … processCoverFetchQueue
// → storage-cache.js: fetchCoverDataUrl, COVER_SEQ_PARALLEL, coverSeqToken, coverIdbSuspect
// → storage-cache.js: fetchCoverDataUrl, COVER_SEQ_PARALLEL, coverSeqToken, coverIdbSuspect
// → storage-cache.js: loadOneCover … isSynopsisCleanupEnabled
// → storage-cache.js: loadOneCover … isSynopsisCleanupEnabled
// → storage-cache.js: cleanSynopsis
// → storage-cache.js: cleanSynopsis
// → app-ui.js: renderSynopsis, prefetchTrendingSynopses



// → book-features.js: DISCOVER_GENRES, cachedDiscoverSeedPromise, fetchDiscoverSeed
// → book-features.js: DISCOVER_GENRES, cachedDiscoverSeedPromise, fetchDiscoverSeed
// → book-features.js: fetchGenreShelves
// → book-features.js: fetchGenreShelves
// → book-features.js: prewarmCachedGenreCovers, prewarmCachedTrendingCovers, TRENDING_KEY/_LS_KEY/_TTL, parseTrendingPayload
// → book-features.js: prewarmCachedGenreCovers, prewarmCachedTrendingCovers, TRENDING_KEY/_LS_KEY/_TTL, parseTrendingPayload
// → book-features.js: renderDiscoverDashboard
// → book-features.js: renderDiscoverDashboard
// → book-features.js: renderDiscoverDashboard
// → app-ui.js: injectSkeletonScreen
// → app-ui.js: openDetailsDrawer (below)
// → app-ui.js: injectSkeletonScreen
// → app-ui.js: openDetailsDrawer (part 1)
// → app-ui.js: openDetailsDrawer (part 2), closeDetailsDrawer, currentDrawerWorkKey
// → app-ui.js: openDetailsDrawer (part 2), closeDetailsDrawer, currentDrawerWorkKey
// → app-ui.js: needsTranslation, shouldReplaceTitle, updateCardTitleInGrid, updateCardCoverInGrid
// ── Unified IntersectionObserver for Progressive Translation (50% Leeway) ──
// → app-ui.js: needsTranslation, shouldReplaceTitle, updateCardTitleInGrid, updateCardCoverInGrid
// → app-ui.js: translationObserver, initTranslationObserver, scheduleSingleCardTranslation
// → app-ui.js: translationObserver, initTranslationObserver, scheduleSingleCardTranslation
// → app-ui.js: syncCardTitles
// → app-ui.js: translationObserver, initTranslationObserver, scheduleSingleCardTranslation
// → app-ui.js: syncCardTitles
// → app-ui.js: renderResults
// → app-ui.js: syncCardTitles
// → app-ui.js: renderResults
// → app-ui.js: renderSavedCollection, updateToggleAllBtnState
// Event
// Listener
// Section
// Initialize Infinite Scroll Sentinel dynamically
const infiniteScrollSentinel = document.createElement('div');
infiniteScrollSentinel.id = 'infiniteScrollSentinel';
infiniteScrollSentinel.style.height = '1px';
infiniteScrollSentinel.style.margin = '0';
DOM.grid.parentNode.insertBefore(infiniteScrollSentinel, DOM.grid.nextSibling);
const infiniteScrollObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
        const listLen = currentViewMode === 'library' ? getLocalFilteredBooks().length : allDisplayedDocs.length;
        if (renderIndex < listLen) {
            const isEditionsSort = DOM.sort.value === 'editions';
            const rawIncLang = DOM.incLang.value.trim().toLowerCase();
            const filterLangAA = rawIncLang ? (langMapToAA[rawIncLang] || rawIncLang) : null;
            renderNextChunk(isEditionsSort, filterLangAA);
        }
    }
}, {
    root: document.querySelector('main.results'),
    rootMargin: '400px'
});
infiniteScrollObserver.observe(infiniteScrollSentinel);
if (DOM.customLimitToggle) {
    const savedCustomLimit = safeStorage.getItem('ole_custom_limit') === 'true';
    DOM.customLimitToggle.checked = savedCustomLimit;
    if (DOM.customLimitContainer) DOM.customLimitContainer.style.display = savedCustomLimit ? 'flex' : 'none';
    if (DOM.extendedLimitWrapper) {
        DOM.extendedLimitWrapper.style.opacity = savedCustomLimit ? '1' : '0.5';
        DOM.extendedLimitWrapper.style.pointerEvents = savedCustomLimit ? 'auto' : 'none';
    }
    if (DOM.extendedLimitToggle) DOM.extendedLimitToggle.disabled = !savedCustomLimit;

    DOM.customLimitToggle.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        safeStorage.setItem('ole_custom_limit', isChecked ? 'true' : 'false');
        DOM.customLimitContainer.style.display = isChecked ? 'flex' : 'none';
        if (isChecked) {
            DOM.extendedLimitWrapper.style.opacity = '1';
            DOM.extendedLimitWrapper.style.pointerEvents = 'auto';
            DOM.extendedLimitToggle.disabled = false;
        } else {
            DOM.extendedLimitWrapper.style.opacity = '0.5';
            DOM.extendedLimitWrapper.style.pointerEvents = 'none';
            DOM.extendedLimitToggle.disabled = true;
            // Force the extended limit off if the parent is turned off
            DOM.extendedLimitToggle.checked = false;
            DOM.extendedLimitToggle.dispatchEvent(new Event('change'));
        }
    });
}
if (DOM.fetchLimitSlider) {
    const savedFetchLimit = parseInt(safeStorage.getItem('ole_fetch_limit') || '100');
    if (!isNaN(savedFetchLimit) && savedFetchLimit >= 10 && savedFetchLimit <= 1000) {
        DOM.fetchLimitSlider.value = savedFetchLimit;
        if (DOM.limitValueDisplay) DOM.limitValueDisplay.value = savedFetchLimit.toLocaleString();
    }
    DOM.fetchLimitSlider.addEventListener('change', () => {
        safeStorage.setItem('ole_fetch_limit', DOM.fetchLimitSlider.value);
    });
}
if (DOM.extendedLimitToggle) {
    DOM.extendedLimitToggle.addEventListener('change', (e) => {
        const isExtended = e.target.checked;
        DOM.extendedWarning.style.display = isExtended ? 'block' : 'none';
        if (isExtended) {
            DOM.fetchLimitSlider.min = '100'; // Changes min offset to fix 100000 cap
            DOM.fetchLimitSlider.max = '100000';
            DOM.fetchLimitSlider.step = '100';
        } else {
            const currentVal = parseInt(DOM.fetchLimitSlider.value);
            DOM.fetchLimitSlider.min = '10';
            DOM.fetchLimitSlider.max = '1000';
            DOM.fetchLimitSlider.step = '10';
            DOM.fetchLimitSlider.value = Math.min(currentVal, 1000);
            DOM.limitValueDisplay.value = parseInt(DOM.fetchLimitSlider.value).toLocaleString();
            safeStorage.setItem('ole_fetch_limit', DOM.fetchLimitSlider.value);
        }
    });
}
// → app-ui.js: validateAndApplyInputLimit
DOM.fetchLimitSlider.addEventListener('input', (e) => {
    DOM.limitValueDisplay.value = parseInt(e.target.value).toLocaleString();
});
// Editable Input field focus tracking logic
DOM.limitValueDisplay.addEventListener('focus', (e) => {
    // Strip formatting commas when user clicks to type
    e.target.value = DOM.fetchLimitSlider.value;
    e.target.select();
});
DOM.limitValueDisplay.addEventListener('blur', validateAndApplyInputLimit);
DOM.limitValueDisplay.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        validateAndApplyInputLimit();
        DOM.limitValueDisplay.blur();
    }
});
DOM.viewSavedBtn.addEventListener('click', () => {
    initTranslationObserver();
    DOM.btn.disabled = false;
    saveCurrentModeState();
    if (currentViewMode === 'search') {
        currentViewMode = 'library';
        DOM.viewSavedBtn.classList.add('active');
        DOM.sortDateOpt.style.display = 'block';
        DOM.sortRelevanceOpt.style.display = 'none';
        DOM.discoverDashboard.style.display = 'none';
        DOM.discoverDashboardToggles.style.display = 'none';
        if (typeof updateSwipeHintVisibility === 'function') updateSwipeHintVisibility();
        DOM.settingsPanel.style.display = 'none';
        restoreModeState('library');
        applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash(true);
        syncSettingsCategoriesForMode('library');
        syncSortNoteState();
    } else {
        currentViewMode = 'search';
        if (toggleAllConfirmTimeoutId) {
            clearTimeout(toggleAllConfirmTimeoutId);
            toggleAllConfirmTimeoutId = null;
        }
        DOM.toggleAllBtn.classList.remove('confirming');
        DOM.viewSavedBtn.classList.remove('active');
        DOM.sortDateOpt.style.display = 'none';
        DOM.sortRelevanceOpt.style.display = 'block';
        DOM.totalCount.textContent = '';
        restoreModeState('search');
        DOM.grid.innerHTML = '';
        if (DOM.persistToggle.checked) saveStateToHash(true);
        syncSettingsCategoriesForMode('search');
        syncSortNoteState();
        if (allDisplayedDocs.length > 0) {
            renderResults(allDisplayedDocs.length, lastSearchTotalFound, false, 0, 0, false);
            if (lastSearchTimingHTML) {
                DOM.querySpeedTooltip.innerHTML = lastSearchTimingHTML;
                DOM.querySpeedContainer.style.display = 'inline-flex';
                DOM.totalCount.style.cursor = 'help';
            }
        } else {
            DOM.resultsMeta.style.display = 'none';
            // Check for any active filters/search criteria
            const textInputs = Array.from(watchInputs).filter(el =>
                (el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.id !== 'sortSelect'
            );
            const hasActiveFilters = textInputs.some(input => input.value.trim() !== '') ||
                tagManagerInc.getTags().length > 0 ||
                tagManagerExc.getTags().length > 0 ||
                DOM.globalSearchInput.value.trim() !== '';
            if (hasActiveFilters) {
                DOM.status.style.display = 'none';
            } else {
                renderDiscoverDashboard();
            }
        }
    }
    // Guarantee the UI state updates the Library All button when switching to an empty screen
    updateToggleAllBtnState();
});
// → app-ui.js: applyListView
if (DOM.listViewToggle) {
    // Mobile defaults to list view (both mobile layouts) on actual touch devices
    // since cards are too cramped on small screens; the saved preference still wins
    // whenever the user has made an explicit choice. Desktop browsers resized to
    // mobile dimensions keep the default grid view.
    const isDesktopMouse = window.matchMedia('(pointer: fine)').matches || window.matchMedia('(hover: hover)').matches;
    const savedListView = safeStorage.getItem('ole_list_view');
    DOM.listViewToggle.checked = savedListView !== null
        ? savedListView === 'true'
        : (!isDesktopMouse && window.innerWidth <= 768);
    applyListView(DOM.listViewToggle.checked);
    DOM.listViewToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_list_view', DOM.listViewToggle.checked);
        applyListView(DOM.listViewToggle.checked);
    });
}
DOM.btn.addEventListener('click', () => {
    collapseMobileSidebarIfOpen();
    if (DOM.incSub.value.trim()) tagManagerInc.addTag(DOM.incSub.value);
    if (DOM.excSub.value.trim()) tagManagerExc.addTag(DOM.excSub.value);
    if (currentViewMode === 'library') applyLocalFilters();
    else performSearch(false);
});
DOM.toggleAllBtn.addEventListener('click', () => {
    const isDiscoverVisible = DOM.discoverDashboard.style.display !== 'none';
    if (isDiscoverVisible && currentDiscoverTab === 'genres') return; // nothing to add/remove here
    const currentList = isDiscoverVisible
        ? (cachedTrendingBooks || [])
        : (currentViewMode === 'library' ? getLocalFilteredBooks() : allDisplayedDocs);
    if (!currentList || currentList.length === 0) return;
    const allInLibrary = currentList.every(b => isLibraryWork(b.key));
    if (allInLibrary && currentViewMode === 'library' && !DOM.toggleAllBtn.classList.contains('confirming')) {
        DOM.toggleAllBtn.classList.add('confirming');
        DOM.toggleAllBtn.title = 'Click again to confirm';
        DOM.toggleAllBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        toggleAllConfirmTimeoutId = setTimeout(() => {
            if (DOM.toggleAllBtn.classList.contains('confirming')) {
                DOM.toggleAllBtn.classList.remove('confirming');
                updateToggleAllBtnState();
            }
        }, 3000);
        return;
    }
    let changed = false;
    currentList.forEach(b => {
        const idx = library.findIndex(s => s.key === b.key);
        if (!allInLibrary && idx === -1) {
            library.push(createLibraryDoc(b));
            changed = true;
        } else if (allInLibrary && idx > -1) {
            library.splice(idx, 1);
            changed = true;
        }
    });
    if (changed) {
        cachedSubjectCounts = null; // Invalidate cache
        cachedLocalFilteredBooks = null;
        syncLibraryKeySet();
        localforage.setItem('ole_bookmarks', library).catch(console.error);
        updateLibraryBadge();
        if (currentViewMode === 'search') {
            DOM.grid.querySelectorAll('.library-btn').forEach(btn => {
                btn.classList.toggle('in-library', !allInLibrary);
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${!allInLibrary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
            });
            const featuredGrid = document.getElementById('featuredClassicsGrid');
            if (featuredGrid) {
                featuredGrid.querySelectorAll('.library-btn').forEach(btn => {
                    btn.classList.toggle('in-library', !allInLibrary);
                    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${!allInLibrary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
                });
            }
        } else applyLocalFilters();
    }
    if (toggleAllConfirmTimeoutId) {
        clearTimeout(toggleAllConfirmTimeoutId);
        toggleAllConfirmTimeoutId = null;
    }
    DOM.toggleAllBtn.classList.remove('confirming');
    updateToggleAllBtnState();
});
DOM.loadMoreBtn.addEventListener('click', () => performSearch(true));
// ── Bulletproof Storage Boot Loader ─────────────────────────────────────
// The root cause of "first load broken until refresh": on cold boot or after
// clearing browser data, IndexedDB can hang for 5-15s (service-worker
// spin-up, permission check, unpartitioned storage initialization).
// Previously the entire app initialization chained off Promise.all on
// localforage reads -- when any read hung or errored, the promise never
// settled and the UI was stranded in its uninitialized skeleton state.
// Now: every read is individually guarded, storage reads race a timeout so
// a hung IndexedDB can't stall boot forever, library normalization is
// per-book isolated, and the UI ALWAYS boots.
const STORAGE_BOOT_TIMEOUT_MS = 4000;
const withBootTimeout = (promise) => Promise.race([
    promise.catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), STORAGE_BOOT_TIMEOUT_MS))
]);
const bootAppUI = (data) => {
    try {
        library = Array.isArray(data) ? data.filter(b => b && typeof b === 'object') : [];
        library.forEach(b => {
            // Isolate each book: one unreadable entry must not kill the rest
            try {
                if (!b.original_title) b.original_title = b.title;
                if (!b.original_cover_i && b.cover_i && parseInt(b.cover_i) > 0) b.original_cover_i = parseInt(b.cover_i);
                if (b.subject) b.subject = cleanSubjects(b.subject);
                cacheBookTokens(b);
            } catch { }
        });
    } catch {
        library = [];
    }
    syncLibraryKeySet();
    updateLibraryBadge();

    // Show initial cooldown message if blocked on page load
    if (isApiBlocked && DOM.status) {
        DOM.status.innerHTML = renderErrorHTML(
            "API Cooldown Active",
            "OpenLibrary has temporarily blocked requests. Please wait 5 minutes before trying again."
        );
        DOM.status.style.display = 'block';
    }
    // Boot the app UI once the data is loaded
    let booted = false;
    try {
        if (loadStateFromHash()) {
            DOM.persistToggle.checked = true;
            syncSortNoteState();
            checkInputs();
            if (currentViewMode === 'library') {
                applyLocalFilters();
            } else {
                if (hasActiveSearchCriteria()) {
                    performSearch(false);
                } else {
                    renderDiscoverDashboard();
                }
            }
            booted = true;
        }
    } catch (e) {
        console.error('Hash-state restore failed during boot:', e);
    }
    if (!booted) {
        try {
            if (currentViewMode === 'library') applyLocalFilters();
            else renderDiscoverDashboard();
        } catch (e) {
            console.error('Dashboard boot failed:', e);
            // Absolute last resort: never leave the content area blank
            try { renderDiscoverDashboard(); } catch { }
        }
    }
    checkInputs();
    updateSortDirBtn();
    syncSortNoteState();
    updateToggleAllBtnState();
};
Promise.all([
    withBootTimeout(localforage.getItem('ole_bookmarks')),
    withBootTimeout(loadTranslationCache()),
    withBootTimeout(localforage.getItem(TRENDING_KEY)),
    withBootTimeout(localforage.getItem('ole_genre_shelves_cache_v3'))
]).then(async ([data, , trendingRaw, genresRaw]) => {
    if (trendingRaw && !cachedTrendingBooks) {
        const parsed = parseTrendingPayload(trendingRaw);
        if (parsed && Array.isArray(parsed.books)) {
            cachedTrendingBooks = parsed.books;
            let dirty = false;
            cachedTrendingBooks.forEach(b => {
                b.original_title = b.title;
                if (b.subject) {
                    const cleaned = cleanSubjects(b.subject);
                    if (JSON.stringify(cleaned) !== JSON.stringify(b.subject)) {
                        b.subject = cleaned;
                        dirty = true;
                    }
                }
            });
            if (dirty) {
                const payload = JSON.stringify({ ts: parsed.ts || Date.now(), books: cachedTrendingBooks });
                localforage.setItem(TRENDING_KEY, payload).catch(() => { });
                safeStorage.setItem(TRENDING_LS_KEY, payload);
            }
        }
    }
    if (!cachedTrendingBooks) {
        // IndexedDB unreadable/empty → localStorage mirror fallback
        const mirrored = parseTrendingPayload(safeStorage.getItem(TRENDING_LS_KEY));
        if (mirrored && Array.isArray(mirrored.books)) {
            cachedTrendingBooks = mirrored.books;
            let dirty = false;
            cachedTrendingBooks.forEach(b => {
                b.original_title = b.title;
                if (b.subject) {
                    const cleaned = cleanSubjects(b.subject);
                    if (JSON.stringify(cleaned) !== JSON.stringify(b.subject)) {
                        b.subject = cleaned;
                        dirty = true;
                    }
                }
            });
            if (dirty) {
                const payload = JSON.stringify({ ts: mirrored.ts || Date.now(), books: cachedTrendingBooks });
                localforage.setItem(TRENDING_KEY, payload).catch(() => { });
                safeStorage.setItem(TRENDING_LS_KEY, payload);
            }
        }
    }
    if (genresRaw && !cachedGenreShelves) {
        try {
            const parsed = typeof genresRaw === 'string' ? JSON.parse(genresRaw) : genresRaw;
            if (parsed && parsed.timestamp && (Date.now() - parsed.timestamp) < 30 * 24 * 60 * 60 * 1000 && parsed.data) {
                cachedGenreShelves = parsed.data;
            }
        } catch { }
    }
    // Fast parallel RAM warming from IndexedDB for trending covers before initial UI paint
    try {
        await prewarmCachedTrendingCovers();
    } catch { }

    // If IndexedDB is empty, check if they have old LocalStorage data to rescue
    if (!data && safeStorage.getItem('ole_bookmarks')) {
        try {
            data = JSON.parse(safeStorage.getItem('ole_bookmarks'));
            localforage.setItem('ole_bookmarks', data).catch(() => { });
            safeStorage.removeItem('ole_bookmarks'); // Clean up the old storage
        } catch (e) {
            console.warn('Legacy bookmark migration skipped (corrupt JSON):', e);
            data = null;
        }
    }
    bootAppUI(data);
    prewarmCachedGenreCovers();
}).catch((e) => {
    // Storage layer exploded entirely — boot the UI anyway with empty data
    console.error('Storage boot failed; starting UI without persisted data.', e);
    bootAppUI(null);
});
// Global Search Box Event Listeners
DOM.globalSearchInput.addEventListener('input', () => {
    DOM.globalSearchClearBtn.style.display = DOM.globalSearchInput.value ? 'block' : 'none';
    checkInputs();
    if (currentViewMode === 'library') {
        applyLocalFilters();
    }
});
if (DOM.globalSearchClearBtn) {
    DOM.globalSearchClearBtn.addEventListener('click', () => {
        DOM.globalSearchInput.value = '';
        DOM.globalSearchClearBtn.style.display = 'none';
        checkInputs();
        DOM.globalSearchInput.focus();
        if (currentViewMode === 'library') {
            applyLocalFilters();
        }
    });
}
if (DOM.homeBtn) {
    DOM.homeBtn.addEventListener('click', () => {
        if (DOM.resetBtn) DOM.resetBtn.click();
        DOM.globalSearchInput.value = '';
        DOM.globalSearchClearBtn.style.display = 'none';
        checkInputs();
        if (currentViewMode === 'library') {
            DOM.viewSavedBtn.click();
        }
        currentDiscoverTab = 'trending';
        renderDiscoverDashboard();
        saveStateToHash(true);
    });
}
DOM.globalSearchBtn.addEventListener('click', () => {
    collapseMobileSidebarIfOpen();
    if (currentViewMode === 'library') {
        applyLocalFilters();
    } else if (hasActiveSearchCriteria()) {
        performSearch(false);
    }
});
DOM.globalSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        collapseMobileSidebarIfOpen();
        if (currentViewMode === 'library') {
            applyLocalFilters();
        } else if (hasActiveSearchCriteria()) {
            performSearch(false);
        }
    }
});
// Settings dropdown floating panel listeners
// On mobile, reparent the settings sheet to be a direct child of <body>.
// It's already position:fixed so this doesn't change where it renders, but
// it WAS a descendant of <header>, which creates its own stacking context —
// meaning no z-index set on the panel could ever out-rank a body-level
// backdrop that needed to sit *above* the header (to blur it) while still
// staying *below* the panel itself. Moving it out from under header removes
// that ceiling.
if (DOM.settingsPanel && DOM.settingsPanel.parentElement !== document.body) {
    document.body.appendChild(DOM.settingsPanel);
}
// → app-ui.js: setSettingsPanelOpen
DOM.settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSettingsPanelOpen(!document.body.classList.contains('settings-open'));
});
// Initialize settings category visibility for the starting view mode
syncSettingsCategoriesForMode(currentViewMode);
DOM.settingsCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSettingsPanelOpen(false);
});

// Settings Tab Navigation (Preferences vs Advanced)
document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetTab = tab.dataset.tab;
        document.querySelectorAll('.settings-tab').forEach(t => {
            const isActive = t === tab;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        const prefPane = document.getElementById('settingsTabPreferences');
        const advPane = document.getElementById('settingsTabAdvanced');
        if (prefPane && advPane) {
            prefPane.style.display = targetTab === 'preferences' ? 'flex' : 'none';
            advPane.style.display = targetTab === 'advanced' ? 'flex' : 'none';
            prefPane.classList.toggle('active', targetTab === 'preferences');
            advPane.classList.toggle('active', targetTab === 'advanced');
        }
    });
});

export const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
if (mobileSettingsBtn) {
    mobileSettingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setSettingsPanelOpen(DOM.settingsPanel.style.display === 'none');
    });
}
window.addEventListener('click', (e) => {
    // Pin Settings only guards desktop; mobile bottom sheets always dismiss on outside clicks
    if (window.innerWidth > 768 && safeStorage.getItem('ole_pin_settings') === 'true') return;
    if (DOM.settingsPanel.style.display === 'block' && !DOM.settingsPanel.contains(e.target) && e.target !== DOM.settingsBtn && e.target !== mobileSettingsBtn && !mobileSettingsBtn?.contains(e.target) && !DOM.shortcutsModal?.contains(e.target)) {
        setSettingsPanelOpen(false);
    }
});

if (DOM.settingsPanel) {
    let dragStart = null;
    DOM.settingsPanel.addEventListener('touchstart', (e) => {
        const panelRect = DOM.settingsPanel.getBoundingClientRect();
        const touchY = e.touches[0].clientY;
        if (touchY - panelRect.top > 48) return;
        dragStart = touchY;
        // .dragging carries `transition: none !important` in CSS, which beats
        // the base rule's own !important (higher specificity) — setting
        // style.transition here directly wouldn't, since an inline style
        // never overrides a stylesheet rule marked !important.
        DOM.settingsPanel.classList.add('dragging');
    }, { passive: true });
    DOM.settingsPanel.addEventListener('touchmove', (e) => {
        if (dragStart === null) return;
        const dy = e.touches[0].clientY - dragStart;
        if (dy > 0) DOM.settingsPanel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    DOM.settingsPanel.addEventListener('touchend', (e) => {
        if (dragStart === null) return;
        const dy = e.changedTouches[0].clientY - dragStart;
        DOM.settingsPanel.classList.remove('dragging');
        if (dy > 80) {
            // Dragged past the dismiss threshold: slide the rest of the way
            // off-screen instead of just snapping to display:none, and fade
            // the backdrop out over roughly the same span so it feels like
            // one continuous motion rather than a hard cut.
            document.body.classList.remove('settings-open');
            DOM.settingsPanel.classList.add('dismissing');
            DOM.settingsPanel.style.transform = '';
            const onDismissEnd = (ev) => {
                if (ev.propertyName !== 'transform') return;
                DOM.settingsPanel.style.display = 'none';
                DOM.settingsPanel.classList.remove('dismissing');
                DOM.settingsPanel.removeEventListener('transitionend', onDismissEnd);
            };
            DOM.settingsPanel.addEventListener('transitionend', onDismissEnd);
        } else {
            // Not far enough — bounce back up to rest.
            DOM.settingsPanel.style.transform = '';
        }
        dragStart = null;
    });
    DOM.settingsPanel.addEventListener('touchcancel', () => {
        if (dragStart === null) return;
        DOM.settingsPanel.classList.remove('dragging');
        DOM.settingsPanel.style.transform = '';
        dragStart = null;
    });
}
// → app-ui.js: mobileSidebarBackdrop (decl), lastWasMobileViewport, cachedHeaderHeight, updateMobileHeaderHeight, checkMobileSidebarState
let resizeRafPending = false;
window.addEventListener('resize', () => {
    const isMobileNow = window.innerWidth <= 768;
    if (isMobileNow) {
        document.body.classList.remove('compact-header');
        if (typeof restoreHeaderElementsToTop === 'function' && !document.body.classList.contains('mobile-legacy-layout')) {
            restoreHeaderElementsToTop();
        }
    }
    if (!resizeRafPending) {
        resizeRafPending = true;
        requestAnimationFrame(() => {
            const wasMobile = lastWasMobileViewport;
            if (typeof mobileLayoutToggle !== 'undefined' && mobileLayoutToggle) {
                const isDesktopMouse = window.matchMedia('(pointer: fine)').matches || window.matchMedia('(hover: hover)').matches;
                const shouldBeEnabled = !isDesktopMouse && mobileLayoutToggle.checked && isMobileViewport();
                const isEnabled = document.body.classList.contains('mobile-legacy-layout');
                if (shouldBeEnabled !== isEnabled) applyMobileLegacyLayout(shouldBeEnabled);
            }
            checkMobileSidebarState();
            syncMobileEarOffset();
            if (typeof positionRailPopovers === 'function') positionRailPopovers();
            if (typeof closeTagsPopup === 'function') closeTagsPopup();
            if (typeof updateDiscoverToggleLabels === 'function') updateDiscoverToggleLabels();
            if (wasMobile !== lastWasMobileViewport && typeof applyLegacyLayout === 'function' && DOM.legacyLayoutToggle) {
                applyLegacyLayout(!DOM.legacyLayoutToggle.checked); scheduleRightGroupSync();
            }
            // Idempotent: re-evaluate overlay engagement on every resize so a
            // desktop↔mobile viewport crossing can never leave body.overlayed-sidebar
            // stuck on while the sidebar is back in normal push-flow mode. If
            // engagement CHANGED, the library buttons must move between the
            // results header and the sidebar header immediately.
            const overlayChanged = applyOverlayedSidebar();
            if (overlayChanged && typeof applyLegacyLayout === 'function' && DOM.legacyLayoutToggle) {
                applyLegacyLayout(!DOM.legacyLayoutToggle.checked); scheduleRightGroupSync();
            }
            if (typeof applyCompactHeader === 'function' && DOM.compactHeaderToggle) {
                applyCompactHeader(DOM.compactHeaderToggle.checked); scheduleRightGroupSync();
            }
            syncRightGroupGap();
            refreshGridCardTags();
            resizeRafPending = false;
        });
    }
});

updateMobileHeaderHeight();

if (window.innerWidth <= 768) {
    const container = document.querySelector('.app-container');
    if (container) {
        container.classList.add('sidebar-collapsed');
        if (mobileSidebarBackdrop) {
            mobileSidebarBackdrop.classList.remove('active');
        }
    }
}

if (mobileSidebarBackdrop) {
    mobileSidebarBackdrop.addEventListener('click', () => {
        const container = document.querySelector('.app-container');
        if (container) {
            container.classList.add('sidebar-collapsed');
            mobileSidebarBackdrop.classList.remove('active');
            if (typeof updateSwipeHintState === 'function') updateSwipeHintState();
        }
    });
}
// Details drawer close event listeners
DOM.detailsCloseBtn.addEventListener('click', closeDetailsDrawer);
DOM.detailsBackdrop.addEventListener('click', closeDetailsDrawer);
// → app-ui.js: sidebarToggleBtn, railFilterBtn, railSortBtn (decls; hub imports them above)
// → app-ui.js: legacyCollapsedRail (decl; hub imports it above)

// Settings is a fifth collapsed-rail control. Keeping it inside the rail
// avoids the legacy sidebar's hide/fade rules for ordinary form content.
if (mobileSettingsBtn && legacyCollapsedRail) {
    legacyCollapsedRail.appendChild(mobileSettingsBtn);
}

let sidebarExpandRevealTimeoutId = null;
// → app-ui.js: mobileLegacyRevealTimeoutId (decl; hub imports it above)
if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', () => {
        closeAllRailPopovers();
        const container = document.querySelector('.app-container');
        if (container) {

            // Overlayed Sidebar: content never reflows on open/close, so the
            // tag-fade mask is unnecessary - and its flicker is visible.
            clearTimeout(sidebarExpandRevealTimeoutId);
            document.body.classList.add('legacy-sidebar-transitioning');
            document.body.classList.add('overlay-sidebar-transitioning');
            const collapsing = !container.classList.contains('sidebar-collapsed');
            container.classList.toggle('sidebar-collapsed');
            if (mobileSidebarBackdrop) {
                mobileSidebarBackdrop.classList.toggle('active', !container.classList.contains('sidebar-collapsed'));
            }
            syncRightGroupGap();
            sidebarExpandRevealTimeoutId = setTimeout(() => {
                document.body.classList.remove('legacy-sidebar-transitioning');
                document.body.classList.remove('overlay-sidebar-transitioning');
            }, 280);
            const sidebar = document.querySelector('aside.filters');
            let settled = false;
            const onSettled = () => {
                if (settled) return;
                settled = true;
                if (sidebar) sidebar.removeEventListener('transitionend', onTransitionEnd);
                // Stock relocation: rail <-> header once the slide has settled
                if (document.body.classList.contains('legacy-layout') || window.innerWidth <= 768) {
                    if (collapsing) {
                        if (legacyCollapsedRail && railFilterBtn) {
                            legacyCollapsedRail.insertBefore(DOM.viewSavedBtn, railFilterBtn);
                            legacyCollapsedRail.insertBefore(DOM.toggleAllBtn, railFilterBtn);
                        }
                    } else {
                        if (DOM.sidebarStickyHeader && DOM.legacySlotAnchor) {
                            DOM.sidebarStickyHeader.insertBefore(DOM.viewSavedBtn, DOM.legacySlotAnchor);
                            DOM.sidebarStickyHeader.insertBefore(DOM.toggleAllBtn, DOM.legacySlotAnchor);
                        }
                    }
                }
                refreshGridCardTags();
                syncRightGroupGap();
                document.body.classList.remove('sidebar-tag-transitioning');
                document.body.classList.remove('legacy-sidebar-transitioning');
                document.body.classList.remove('overlay-sidebar-transitioning');
            };
            const onTransitionEnd = (e) => {
                if (e.target === sidebar && e.propertyName === 'width') {
                    onSettled();
                }
            };
            if (sidebar) sidebar.addEventListener('transitionend', onTransitionEnd);
            setTimeout(onSettled, 280);
        }
    });
}

// ── Overlayed Sidebar interaction wiring ────────────────────────────────
// Both controls are pure delegates to #sidebarToggleBtn: the collapse state
// lives in exactly one place (.app-container's sidebar-collapsed class, flipped
// by the real toggle handler), so overlay open/close can never drift out of
// sync with the outer toggle, the icon states, or layout-mode switches.
const sidebarOverlayBackdrop = document.getElementById('sidebarOverlayBackdrop');
if (sidebarOverlayBackdrop) {
    sidebarOverlayBackdrop.addEventListener('click', () => {
        const container = document.querySelector('.app-container');
        if (container && !container.classList.contains('sidebar-collapsed') && sidebarToggleBtn) {
            sidebarToggleBtn.click();
        }
    });
}
const sidebarOverlayCloseBtn = document.getElementById('sidebarOverlayCloseBtn');
if (sidebarOverlayCloseBtn) {
    sidebarOverlayCloseBtn.addEventListener('click', () => {
        if (sidebarToggleBtn) sidebarToggleBtn.click();
    });
}
// Filter/Sort rail shortcuts: when the sidebar is collapsed, open the
// corresponding group in a floating popover instead of expanding the
// sidebar. The real <details> node is reparented into the popover (not
// cloned), so every existing id/listener on its inputs keeps working, then
// moved back to its original spot in the sidebar when the popover closes.
// A comment node marks that original spot so it can be restored precisely.
// → app-ui.js: railPopoverState, RAIL_POPOVER_ORDER, positionRailPopovers, closeRailPopover, closeAllRailPopovers, openRailPopover, wireRailShortcut
wireRailShortcut(railFilterBtn, 'filterGroup');
wireRailShortcut(railSortBtn, 'sortGroup');
document.addEventListener('toggle', (e) => {
    if (e.target && e.target.closest && e.target.closest('.rail-popover')) {
        positionRailPopovers();
    }
}, true);

// Tap a "N tags" badge (list view) or a "+N" tag-overflow badge (grid view)
// to see the full subject list in a small popup, instead of only what fit in
// a hover title tooltip (which doesn't work on tap anyway).
// → app-ui.js: openTagsPopupEl, activeTagsPopupAnchor, tagsPopupBackdropEl, _tagsPopupClosedAt, closeTagsPopup

document.addEventListener('click', (e) => {
    if (!openTagsPopupEl) return;
    if (openTagsPopupEl.contains(e.target)) return;
    if (e.target.closest('.tags-compact-badge, .tag-overflow')) return;
    closeTagsPopup();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTagsPopup();
});

// → app-ui.js: openTagsPopup


document.addEventListener('click', (e) => {
    const openIds = Object.keys(railPopoverState).filter(id => railPopoverState[id].open);
    if (!openIds.length) return;
    const clickedInsideAny = openIds.some(id => railPopoverState[id].popoverEl.contains(e.target));
    const clickedRailBtn = e.target.closest('.rail-btn');
    if (!clickedInsideAny && !clickedRailBtn) closeAllRailPopovers();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllRailPopovers();
});
// → app-ui.js: scrollClassTimeout, resultsMainEl, resultsHeaderEl, handleScrollState
if (resultsMainEl) {
    resultsMainEl.addEventListener('scroll', handleScrollState, { passive: true });
}
window.addEventListener('scroll', handleScrollState, { passive: true });
// Legacy Layout: relocate toggleAllBtn, viewSavedBtn, and sidebarToggleBtn into the
// sidebar sticky header (replacing Reset/Find Books visually) when enabled, and
// restore them to the results header when disabled.
// → app-ui.js: railPopoverState, RAIL_POPOVER_ORDER, positionRailPopovers, closeRailPopover, closeAllRailPopovers, openRailPopover, wireRailShortcut
// → app-ui.js: applyLegacyLayout (part 1)
// → app-ui.js: applyLegacyLayout (part 1)
// → app-ui.js: applyLegacyLayout (part 2)
// ── Compact Desktop Mode ────────────────────────────────────────────────
// Merges the top header's 3-combo search section and Settings button into
// the main results header, and displays the slogan in the sidebar footer.
// NOTE: Deliberately a hoisted `function` declaration, NOT a const arrow.
// The resize handler (registered ~500 lines above) calls this behind a
// typeof guard — but a `const` binding is in its temporal dead zone until
// this line executes, and `typeof` on a TDZ binding THROWS. The top-level
// applySidebarSide() call below synchronously dispatches a resize event
// during script evaluation, so on narrow viewports this function used to
// be invoked while still uninitialized — the resulting ReferenceError
// aborted the rest of the script (layout init, listeners, everything).
// → app-ui.js: applyLegacyLayout (part 2)
// → app-ui.js: restoreHeaderElementsToTop
// → app-ui.js: applyCompactHeader
if (DOM.compactHeaderToggle) {
    DOM.compactHeaderToggle.checked = safeStorage.getItem('ole_compact_header') !== 'false'; // default ON
    DOM.compactHeaderToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_compact_header', DOM.compactHeaderToggle.checked);
        applyCompactHeader(DOM.compactHeaderToggle.checked); scheduleRightGroupSync();
    });
}

if (DOM.legacyLayoutToggle) {
    DOM.legacyLayoutToggle.checked = safeStorage.getItem('ole_classic_layout') === 'true';
    DOM.legacyLayoutToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_classic_layout', DOM.legacyLayoutToggle.checked);
        applyLegacyLayout(!DOM.legacyLayoutToggle.checked); scheduleRightGroupSync();
        // Overlay engagement depends on the Legacy Layout switch state —
        // re-evaluate whenever it changes (also runs on boot below).
        applyOverlayedSidebar();
    });
    applyLegacyLayout(!DOM.legacyLayoutToggle.checked); scheduleRightGroupSync();
}

if (DOM.compactHeaderToggle) {
    applyCompactHeader(DOM.compactHeaderToggle.checked); scheduleRightGroupSync();
}

// ── Overlayed Sidebar (desktop, Legacy Layout switch ON only) ───────────
// When enabled, the expanded sidebar floats OVER the content instead of
// squeezing it: body.overlayed-sidebar drives all the CSS (absolute sidebar,
// blurred backdrop, results header kept crisp above the blur). The close
// button inside the sidebar header is a pure delegate to #sidebarToggleBtn,
// so collapse state always keeps a single source of truth.
// Deliberately a hoisted `function` declaration, NOT a const arrow:
// applyLegacyLayout executes during initial evaluation and calls this from
// its tail and from its change listener — a const here would sit in the
// temporal dead zone at that moment (the exact class of bug that used to
// abort the whole script).
// → app-ui.js: applyCompactHeader
// → app-ui.js: syncRightGroupGap, scheduleRightGroupSync, rightGroupSyncTimer
// → app-ui.js: syncRightGroupGap, scheduleRightGroupSync, rightGroupSyncTimer
// → app-ui.js: applyOverlayedSidebar

const overlayedSidebarToggle = document.getElementById('overlayedSidebarToggle');
if (overlayedSidebarToggle) {
    overlayedSidebarToggle.checked = safeStorage.getItem('ole_overlayed_sidebar') !== 'false'; // default ON
    overlayedSidebarToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_overlayed_sidebar', overlayedSidebarToggle.checked);
        // Class FIRST, then layout: applyLegacyLayout's relocation branches
        // read body.overlayed-sidebar, so it must observe the fresh state.
        applyOverlayedSidebar();
        if (DOM.legacyLayoutToggle) applyLegacyLayout(!DOM.legacyLayoutToggle.checked); scheduleRightGroupSync();
    });
}
// Boot application. If the persisted preference engages the overlay, re-run
// the legacy layout application so the library buttons land inside the
// sidebar header on this very first pass (the earlier boot-time
// applyLegacyLayout ran before body.overlayed-sidebar existed).
if (applyOverlayedSidebar() && DOM.legacyLayoutToggle && DOM.legacyLayoutToggle.checked) {
    applyLegacyLayout(!DOM.legacyLayoutToggle.checked); scheduleRightGroupSync();
}
if (DOM.sidebarSideToggle) {
    DOM.sidebarSideToggle.addEventListener('change', () => {
        applySidebarSide(DOM.sidebarSideToggle.checked ? 'right' : 'left', true);
    });
}
applySidebarSide(getSidebarSide(), false);


// ── Mobile Legacy Layout (experimental) ─────────────────────────────────
// A second, independent mobile sidebar mode, entirely separate from the
// desktop Legacy Layout above. It never runs on desktop and never runs
// unless explicitly enabled, so the existing mobile rail behaviour is
// completely unaffected by default. When on, the sidebar has just two
// states — fully hidden or fully shown — controlled by left/right swipes
// instead of a toggle button, and the Settings icon relocates into the
// main results header (the toggle button's old spot) since there's no
// collapsed rail left to host it.
// → app-ui.js: mobileLayoutToggle (decl; hub imports it above)
// → app-ui.js: isMobileViewport

// → app-ui.js: mobileLayoutToggle (decl; hub imports it above)
// → app-ui.js: isMobileViewport
// → app-ui.js: desktopLegacyWasEnabled, applyMobileLegacyLayout
if (mobileLayoutToggle) {
    mobileLayoutToggle.checked = safeStorage.getItem('ole_mobile_legacy_layout') !== 'false'; // default ON (Alternative)
    mobileLayoutToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_mobile_legacy_layout', mobileLayoutToggle.checked);
        const isDesktopMouse = window.matchMedia('(pointer: fine)').matches || window.matchMedia('(hover: hover)').matches;
        applyMobileLegacyLayout(!isDesktopMouse && mobileLayoutToggle.checked && isMobileViewport());
    });
    const isDesktopMouse = window.matchMedia('(pointer: fine)').matches || window.matchMedia('(hover: hover)').matches;
    applyMobileLegacyLayout(!isDesktopMouse && mobileLayoutToggle.checked && isMobileViewport());
}

// Timestamp of the most recent finished sidebar drag — the release that
// completes a drag can also surface as a click on the hint, and the hint's
// tap handler below must not fight the snap the drag just settled on.
// → app-ui.js: syncMobileEarOffset, updateSwipeHintState, updateSwipeHintVisibility
// → app-ui.js: lastDragEndTime, triggerMobileLegacyReveal, mobileSidebarSwipeHint tap wiring, drag IIFE

// Reduce Animations: persist the setting and expose it as a body class so
// CSS-driven decorative animations (the swipe hint's nudge, etc.) respect it
// too — previously this only gated the translation-highlight animation
// directly in JS and had no saved state or CSS hook at all.
if (DOM.reduceAnimationsToggle) {
    DOM.reduceAnimationsToggle.checked = safeStorage.getItem('ole_reduce_animations') === 'true';
    const syncReduceAnimations = () => {
        document.body.classList.toggle('reduce-animations', DOM.reduceAnimationsToggle.checked);
        if (typeof syncSmoothScrollBodyClass === 'function') syncSmoothScrollBodyClass();
        if (typeof syncWheelListener === 'function') syncWheelListener();
    };
    DOM.reduceAnimationsToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_reduce_animations', DOM.reduceAnimationsToggle.checked);
        syncReduceAnimations();
    });
    syncReduceAnimations();
}
if (DOM.cleanSynopsisToggle) {
    DOM.cleanSynopsisToggle.checked = isSynopsisCleanupEnabled();
    DOM.cleanSynopsisToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_clean_synopsis', DOM.cleanSynopsisToggle.checked ? 'true' : 'false');
        if (currentDrawerWorkKey && descriptionCache.has(currentDrawerWorkKey)) {
            renderSynopsis(descriptionCache.get(currentDrawerWorkKey));
        }
    });
}
if (DOM.cleanLibrarySubjectsToggle) {
    DOM.cleanLibrarySubjectsToggle.checked = isCleanLibrarySubjectsEnabled();
    DOM.cleanLibrarySubjectsToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_clean_library_subjects', DOM.cleanLibrarySubjectsToggle.checked ? 'true' : 'false');
        cachedSubjectCounts = null;
        if (currentViewMode === 'library') {
            applyLocalFilters();
        }
    });
}
if (DOM.translateToggle) {
    DOM.translateToggle.checked = safeStorage.getItem('ole_translate') !== 'false';
    const syncTranslationRows = () => {
        const isEnabled = DOM.translateToggle.checked;
        if (DOM.translateCoversRow) DOM.translateCoversRow.style.display = isEnabled ? 'flex' : 'none';
        if (DOM.completeTranslationRow) DOM.completeTranslationRow.style.display = isEnabled ? 'flex' : 'none';
        if (currentViewMode === 'library') applyLocalFilters();
    };
    DOM.translateToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_translate', DOM.translateToggle.checked ? 'true' : 'false');
        syncTranslationRows();
    });
    syncTranslationRows();
}
if (DOM.translateCoversToggle) {
    DOM.translateCoversToggle.checked = safeStorage.getItem('ole_translate_covers') !== 'false';
    DOM.translateCoversToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_translate_covers', DOM.translateCoversToggle.checked ? 'true' : 'false');
        if (currentViewMode === 'library') applyLocalFilters();
    });
}
if (DOM.completeTranslateToggle) {
    DOM.completeTranslateToggle.checked = safeStorage.getItem('ole_complete_translation') === 'true';
    DOM.completeTranslateToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_complete_translation', DOM.completeTranslateToggle.checked ? 'true' : 'false');
        if (currentViewMode === 'library') applyLocalFilters();
    });
}
if (DOM.enhancedAutofillToggle) {
    DOM.enhancedAutofillToggle.checked = safeStorage.getItem('ole_enhanced_autofill') !== 'false';
    DOM.enhancedAutofillToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_enhanced_autofill', DOM.enhancedAutofillToggle.checked ? 'true' : 'false');
    });
}

// ── Reset All Settings to Default ───────────────────────────────────────
// → app-ui.js: resetAllSettingsToDefault
if (DOM.resetSettingsBtn) {
    DOM.resetSettingsBtn.addEventListener('click', resetAllSettingsToDefault);
}

// → app-ui.js: resetAllSettingsToDefault
// → app-ui.js: syncWheelListener (registers the non-passive wheel
// interceptor only while the smooth engine can engage; otherwise wheel
// input stays fully native/off-thread)
syncWheelListener();
window.addEventListener('resize', () => {
    cancelAllSmoothScrolls();
    syncSmoothScrollBodyClass();
    syncWheelListener();
}, { passive: true });
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelAllSmoothScrolls();
});

if (DOM.smoothScrollingToggle) {
    DOM.smoothScrollingToggle.checked = safeStorage.getItem('ole_smooth_scrolling') !== 'false';
    syncSmoothScrollBodyClass();
    DOM.smoothScrollingToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_smooth_scrolling', DOM.smoothScrollingToggle.checked ? 'true' : 'false');
        syncSmoothScrollBodyClass();
        syncWheelListener();
        if (!DOM.smoothScrollingToggle.checked) {
            cancelAllSmoothScrolls();
        }
    });
}

// ── Misc Settings & Cache Management ──────────────────────────────────────
if (DOM.pinSettingsToggle) {
    const isPinned = safeStorage.getItem('ole_pin_settings') === 'true';
    DOM.pinSettingsToggle.checked = isPinned;
    DOM.pinSettingsToggle.addEventListener('change', () => {
        safeStorage.setItem('ole_pin_settings', DOM.pinSettingsToggle.checked ? 'true' : 'false');
    });
}

// Mobile Developer Unlock Gesture: 5 rapid taps on the version banner at bottom of Settings
const versionBanner = document.getElementById('settingsVersionBanner');
if (versionBanner) {
    let versionTapCount = 0;
    let versionTapTimer = null;
    let lastTapTimestamp = 0;
    const registerVersionTap = (e) => {
        const now = Date.now();
        if (now - lastTapTimestamp < 80) return; // Deduplicate synthetic ghost clicks
        lastTapTimestamp = now;
        if (e) e.stopPropagation();
        versionTapCount++;
        if (versionTapTimer) clearTimeout(versionTapTimer);
        if (versionTapCount >= 5) {
            versionTapCount = 0;
            toggleTelemetryHUD();
            if (window.innerWidth <= 768 && typeof setSettingsPanelOpen === 'function') {
                setSettingsPanelOpen(false);
            }
        } else {
            versionTapTimer = setTimeout(() => { versionTapCount = 0; }, 1800);
        }
    };
    versionBanner.addEventListener('pointerdown', registerVersionTap);
    versionBanner.addEventListener('click', registerVersionTap);
}
if (DOM.clearLibraryCacheBtn) {
    let confirmTimer = null;
    let isConfirming = false;
    DOM.clearLibraryCacheBtn.addEventListener('click', (e) => {
        if (!isConfirming) {
            e.preventDefault();
            e.stopPropagation();
            isConfirming = true;
            DOM.clearLibraryCacheBtn.textContent = 'Confirm Clear?';
            DOM.clearLibraryCacheBtn.style.borderColor = '#ef4444';
            DOM.clearLibraryCacheBtn.style.color = '#ef4444';
            confirmTimer = setTimeout(() => {
                isConfirming = false;
                DOM.clearLibraryCacheBtn.textContent = 'Clear Cache';
                DOM.clearLibraryCacheBtn.style.borderColor = '';
                DOM.clearLibraryCacheBtn.style.color = '';
            }, 3500);
            return;
        }
        if (confirmTimer) clearTimeout(confirmTimer);
        isConfirming = false;
        clearTranslationAndCoverCache(e);
    });
}

// ── Sliders and Input Binding ─────────────────────────────────────────────
// → app-ui.js: resetAllSettingsToDefault
// → app-ui.js: syncSchedulerControls
const schedulerModeToggle = document.getElementById('schedulerModeToggle');
if (schedulerModeToggle) {
    schedulerModeToggle.addEventListener('change', () => {
        setSchedulerMode(schedulerModeToggle.checked ? 'optimized' : 'manual');
        safeStorage.setItem('ole_scheduler_mode', schedulerMode);
        syncSchedulerControls();
        if (typeof fetchOpenLibrary !== 'undefined' && typeof fetchOpenLibrary.triggerPacingUpdate === 'function') {
            fetchOpenLibrary.triggerPacingUpdate();
        }
    });
}

const debugDelaySlider = document.getElementById('debugDelaySlider');
const debugDelayVal = document.getElementById('debugDelayVal');
if (debugDelaySlider && debugDelayVal) {
    debugDelaySlider.value = schedulerMinDelayMs;
    debugDelaySlider.addEventListener('input', (e) => {
        setSchedulerMinDelayMs(parseSafeInt(e.target.value, 250));
        debugDelayVal.textContent = `${schedulerMinDelayMs}ms`;
        debugDelayVal.title = `Manual Start Spacing: Fixed delay of ${schedulerMinDelayMs}ms between dispatched requests.`;
        safeStorage.setItem('ole_sched_delay', schedulerMinDelayMs.toString());
        if (typeof fetchOpenLibrary !== 'undefined' && typeof fetchOpenLibrary.triggerPacingUpdate === 'function') {
            fetchOpenLibrary.triggerPacingUpdate();
        }
    });
}

const debugMaxConnSlider = document.getElementById('debugMaxConnSlider');
const debugMaxConnVal = document.getElementById('debugMaxConnVal');
if (debugMaxConnSlider && debugMaxConnVal) {
    debugMaxConnSlider.value = schedulerMaxConnections;
    debugMaxConnSlider.addEventListener('input', (e) => {
        setSchedulerMaxConnections(parseSafeInt(e.target.value, 3));
        debugMaxConnVal.textContent = schedulerMaxConnections;
        debugMaxConnVal.title = `Manual Max Concurrency: Up to ${schedulerMaxConnections} concurrent connections.`;
        safeStorage.setItem('ole_sched_max_conn', schedulerMaxConnections.toString());
        if (typeof fetchOpenLibrary !== 'undefined' && typeof fetchOpenLibrary.triggerPacingUpdate === 'function') {
            fetchOpenLibrary.triggerPacingUpdate();
        }
    });
}

const debugBurstSlider = document.getElementById('debugBurstSlider');
const debugBurstVal = document.getElementById('debugBurstVal');
if (debugBurstSlider && debugBurstVal) {
    debugBurstSlider.value = schedulerBurstCapacity;
    debugBurstSlider.addEventListener('input', (e) => {
        setSchedulerBurstCapacity(parseSafeInt(e.target.value, 3));
        debugBurstVal.textContent = schedulerBurstCapacity;
        debugBurstVal.title = `Manual Burst Capacity: Up to ${schedulerBurstCapacity} burst tokens replenished over time.`;
        safeStorage.setItem('ole_sched_burst', schedulerBurstCapacity.toString());
        if (typeof fetchOpenLibrary !== 'undefined') {
            if (typeof fetchOpenLibrary.clampBurstTokens === 'function') fetchOpenLibrary.clampBurstTokens();
            if (typeof fetchOpenLibrary.triggerPacingUpdate === 'function') fetchOpenLibrary.triggerPacingUpdate();
        }
    });
}

const debugProxyInput = document.getElementById('debugProxyInput');
if (debugProxyInput) {
    debugProxyInput.value = customProxyUrl;
    const updateProxy = (e) => {
        setCustomProxyUrl(getCleanProxyBase(e.target.value));
        setStorageProxyUrl(customProxyUrl);
        safeStorage.setItem('ole_custom_proxy_url', customProxyUrl);
        syncSchedulerControls();
        syncTelemetryHUD();
    };
    debugProxyInput.addEventListener('input', updateProxy);
    debugProxyInput.addEventListener('change', (e) => {
        updateProxy(e);
        debugProxyInput.value = customProxyUrl;
    });
}

const resetSchedulerBtn = document.getElementById('resetSchedulerBtn');
if (resetSchedulerBtn) {
    resetSchedulerBtn.addEventListener('click', () => {
        setSchedulerMode('optimized');
        setSchedulerMinDelayMs(334);
        setSchedulerMaxConnections(3);
        setSchedulerBurstCapacity(3);
        setCustomProxyUrl(DEFAULT_PROXY_URL);
        setStorageProxyUrl(customProxyUrl);
        safeStorage.setItem('ole_custom_proxy_url', DEFAULT_PROXY_URL);
        const pInput = DOM.debugProxyInput || document.getElementById('debugProxyInput');
        if (pInput) { pInput.value = DEFAULT_PROXY_URL; }

        safeStorage.setItem('ole_scheduler_mode', 'optimized');
        safeStorage.removeItem('ole_sched_delay');
        safeStorage.removeItem('ole_sched_max_conn');
        safeStorage.removeItem('ole_sched_burst');

        syncSchedulerControls();
        if (typeof fetchOpenLibrary !== 'undefined') {
            if (typeof fetchOpenLibrary.clampBurstTokens === 'function') fetchOpenLibrary.clampBurstTokens();
            if (typeof fetchOpenLibrary.triggerPacingUpdate === 'function') fetchOpenLibrary.triggerPacingUpdate();
        }
        syncTelemetryHUD();

        const origText = resetSchedulerBtn.textContent;
        resetSchedulerBtn.textContent = '✓ Defaults Reset!';
        resetSchedulerBtn.style.color = '#10b981';
        resetSchedulerBtn.style.borderColor = '#10b981';
        setTimeout(() => {
            resetSchedulerBtn.textContent = origText;
            resetSchedulerBtn.style.color = '';
            resetSchedulerBtn.style.borderColor = '';
        }, 1500);
    });
}

syncSchedulerControls();

// → app-ui.js: switchTelemetryHUDTab, updateTelemetryPinState, toggleTelemetryHUD
const telemetryPinBtn = document.getElementById('telemetryPinBtn');
if (telemetryPinBtn) {
    telemetryPinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCurrentlyPinned = safeStorage.getItem('ole_telemetry_pinned') === 'true';
        safeStorage.setItem('ole_telemetry_pinned', (!isCurrentlyPinned).toString());
        updateTelemetryPinState();
    });
}

if (DOM.telemetryCloseBtn) {
    DOM.telemetryCloseBtn.addEventListener('click', () => {
        safeStorage.setItem('ole_telemetry_pinned', 'false');
        updateTelemetryPinState();
        toggleTelemetryHUD(false);
    });
}

// Desktop Shortcut: Alt+Shift+D (layout-safe via e.code === 'KeyD', ignores input focus, repeat, and IME)
window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyD') {
        if (e.repeat || e.isComposing) return;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
        e.preventDefault();
        toggleTelemetryHUD();
    }
});

// → app-ui.js: switchTelemetryHUDTab, updateTelemetryPinState, toggleTelemetryHUD
// → app-ui.js: syncTelemetryHUD
setInterval(syncTelemetryHUD, 500);

// → app-ui.js: switchTelemetryHUDTab, updateTelemetryPinState, toggleTelemetryHUD
// → app-ui.js: syncTelemetryHUD
// → app-ui.js: initDraggableTelemetry
initDraggableTelemetry();

const exportTelemetryBtn = document.getElementById('exportTelemetryBtn');
if (exportTelemetryBtn) {
    exportTelemetryBtn.addEventListener('click', () => {
        const snap = apiTelemetry.getSnapshot();
        const exportData = {
            timestamp: new Date().toISOString(),
            config: {
                minDelayMs: schedulerMinDelayMs,
                maxConnections: schedulerMaxConnections,
                burstCapacity: schedulerBurstCapacity,
                transportMode: customProxyUrl ? 'proxy' : 'direct',
                proxyUrl: customProxyUrl || null
            },
            telemetry: snap
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `openlibrary_telemetry_${Date.now()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

const resetTelemetryBtn = document.getElementById('resetTelemetryBtn');
if (resetTelemetryBtn) {
    resetTelemetryBtn.addEventListener('click', () => {
        apiTelemetry.reset();
        cover404MemoryCache.clear();
        coverMemoryCache.clear();
        coverFetchInFlight.clear();
        try {
            localforage.keys().then(keys => {
                keys.forEach(k => {
                    if (k.startsWith(COVER_404_DB_PREFIX) || k.startsWith(COVER_DB_PREFIX)) {
                        localforage.removeItem(k).catch(() => {});
                    }
                });
            }).catch(() => {});
        } catch { }
        syncTelemetryHUD();
        const origText = resetTelemetryBtn.textContent;
        resetTelemetryBtn.textContent = 'Metrics Reset!';
        resetTelemetryBtn.style.color = '#10b981';
        resetTelemetryBtn.style.borderColor = '#10b981';
        setTimeout(() => {
            resetTelemetryBtn.textContent = origText;
            resetTelemetryBtn.style.color = '';
            resetTelemetryBtn.style.borderColor = '';
        }, 1500);
    });
}

// ── Mobile Alternative Layout: selection mode ─────────────────────────────
// Hold-to-select on book cards, gated to the Alternative mobile layout
// (body.mobile-legacy-layout) + ≤768px. Long-pressing a card enters
// selection mode; tapping cards then toggles their selection; the pinned
// selection bar below the header provides select-all + bulk add/remove.
// → app-ui.js: selectionMode, selectedKeys, holdTimer, holdSuppressClick, holdStart, lastSelectionModeChange, SELECTION_HOLD_MS, SELECTION_MOVE_TOLERANCE, mobileLegacyRevealTimeoutId, lastDragEndTime
// → app-ui.js: mainResultsEl, isSelectionEligible, getCurrentSelectionList, setSelectionMode, toggleCardSelection, clearHoldTimer, cancelHold, hold gesture + selection-bar + Escape wiring
// → app-ui.js: selectionMode, selectedKeys, holdTimer, holdSuppressClick, holdStart, lastSelectionModeChange, SELECTION_HOLD_MS, SELECTION_MOVE_TOLERANCE, mobileLegacyRevealTimeoutId, lastDragEndTime
// → app-ui.js: mainResultsEl, isSelectionEligible, getCurrentSelectionList, setSelectionMode, toggleCardSelection, clearHoldTimer, cancelHold, hold gesture + selection-bar + Escape wiring
// → app-ui.js: handleGridClick (+ grid registrations below)
// → app-ui.js: handleGridClick (+ grid registrations below)
// → app-ui.js: grid click registrations (DOM.grid + DOM.discoverDashboard)
if (DOM.toggleTrendingBtn && DOM.toggleGenresBtn) {
    DOM.toggleTrendingBtn.addEventListener('click', () => {
        if (currentDiscoverTab !== 'trending') {
            currentDiscoverTab = 'trending';
            renderDiscoverDashboard();
        }
    });
    DOM.toggleGenresBtn.addEventListener('click', () => {
        if (currentDiscoverTab !== 'genres') {
            currentDiscoverTab = 'genres';
            renderDiscoverDashboard();
        }
    });
}

// → app-ui.js: grid click registrations (DOM.grid + DOM.discoverDashboard)
// → app-ui.js: updateDiscoverToggleLabels (+ observers + init call below)

// ── Library Export & Import ──────────────────────────────────────────
// → book-features.js: renderDiscoverDashboard
// → book-features.js: cleanLibraryForExport … handleImportFile
if (DOM.exportLibraryBtn) DOM.exportLibraryBtn.addEventListener('click', (e) => exportLibraryJSON(e));
if (DOM.importLibraryBtn && DOM.importFileInput) {
    DOM.importLibraryBtn.addEventListener('click', () => DOM.importFileInput.click());
    DOM.importFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
            handleImportFile(file);
            DOM.importFileInput.value = '';
        }
    });
}

// ── Keyboard Shortcuts Modal & Navigation ──────────────────────────────
export const openShortcutsModal = () => {
    if (!DOM.shortcutsModal) return;
    closeAllRailPopovers();
    document.body.classList.add('shortcuts-modal-open');
    DOM.shortcutsModal.style.display = 'flex';
    DOM.shortcutsModal.offsetHeight; // Force reflow
    DOM.shortcutsModal.classList.add('active');
};

export const closeShortcutsModal = () => {
    if (!DOM.shortcutsModal || !DOM.shortcutsModal.classList.contains('active')) return;
    document.body.classList.remove('shortcuts-modal-open');
    DOM.shortcutsModal.classList.remove('active');
    setTimeout(() => {
        if (DOM.shortcutsModal && !DOM.shortcutsModal.classList.contains('active')) {
            DOM.shortcutsModal.style.display = 'none';
        }
    }, 200);
};

if (DOM.viewShortcutsBtn) {
    DOM.viewShortcutsBtn.addEventListener('click', () => {
        openShortcutsModal();
    });
}
if (DOM.shortcutsModalCloseBtn) {
    DOM.shortcutsModalCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeShortcutsModal();
    });
}
if (DOM.shortcutsModalBackdrop) {
    DOM.shortcutsModalBackdrop.addEventListener('click', (e) => {
        e.stopPropagation();
        closeShortcutsModal();
    });
}
if (DOM.shortcutsModal) {
    DOM.shortcutsModal.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

// ── Global Keyboard Shortcuts Engine (T, L, F, S, V) with Tap-Protection ───
window.addEventListener('keydown', (e) => {
    // 1. Guard against modifier keys (including Shift)
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

    // 2. Guard against active text inputs / editables
    const activeEl = document.activeElement;
    const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
    );
    const targetTag = e.target?.tagName?.toUpperCase();
    if (isInputFocused || targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT' || e.target?.isContentEditable) {
        return;
    }

    const key = e.key.toLowerCase();
    if (!['t', 'l', 'f', 's', 'v'].includes(key)) return;

    // 3. Tap Protection / Dismiss-First Check:
    // If any modal, details drawer, settings panel, rail popover, mobile sidebar, or tags popup is open,
    // the first tap closes the open item instead of firing the secondary command (following LIFO priority).
    const isShortcutsOpen = DOM.shortcutsModal && DOM.shortcutsModal.classList.contains('active');
    if (isShortcutsOpen) {
        e.preventDefault();
        closeShortcutsModal();
        return;
    }

    const hasOpenRailPopover = Object.values(railPopoverState).some(p => p.open);
    const isSettingsOpen = DOM.settingsPanel && DOM.settingsPanel.style.display !== 'none';
    const isDetailsOpen = DOM.detailsDrawer && DOM.detailsDrawer.classList.contains('active');
    const hasTagsPopup = !!openTagsPopupEl;
    const container = document.querySelector('.app-container');
    const isMobileSidebarOpen = window.innerWidth <= 768 && container && !container.classList.contains('sidebar-collapsed');

    if (hasOpenRailPopover || isSettingsOpen || isDetailsOpen || hasTagsPopup || isMobileSidebarOpen) {
        e.preventDefault();
        if (hasOpenRailPopover) closeAllRailPopovers();
        if (isSettingsOpen) setSettingsPanelOpen(false);
        if (isDetailsOpen) closeDetailsDrawer();
        if (hasTagsPopup) closeTagsPopup();
        if (isMobileSidebarOpen) collapseMobileSidebarIfOpen();
        return;
    }

    // 4. Dispatch Commands via simulated button clicks for full compatibility
    if (key === 't') {
        e.preventDefault();
        if (sidebarToggleBtn) sidebarToggleBtn.click();
    } else if (key === 'l') {
        e.preventDefault();
        if (DOM.viewSavedBtn) DOM.viewSavedBtn.click();
    } else if (key === 'v') {
        e.preventDefault();
        if (DOM.listViewToggle) DOM.listViewToggle.click();
    } else if (key === 'f' || key === 's') {
        const isCollapsedRail = container && container.classList.contains('sidebar-collapsed')
            && document.body.classList.contains('legacy-layout')
            && railFilterBtn && railFilterBtn.offsetParent !== null;
        if (isCollapsedRail) {
            e.preventDefault();
            if (key === 'f') railFilterBtn.click();
            else if (railSortBtn) railSortBtn.click();
        }
    }
});

// Universal Escape key dismissal across all floating dialogs (LIFO order)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (DOM.shortcutsModal && DOM.shortcutsModal.classList.contains('active')) {
            closeShortcutsModal();
            return;
        }
        if (DOM.detailsDrawer && DOM.detailsDrawer.classList.contains('active')) {
            closeDetailsDrawer();
            return;
        }
        if (DOM.settingsPanel && DOM.settingsPanel.style.display !== 'none') {
            setSettingsPanelOpen(false);
            return;
        }
    }
});

// ── Reduced-Motion Notice (one-time) ──────────────────────────────────────
// Users asked to be told when entrance effects silently skip: an OS-level
// "reduce motion" setting (Windows: Accessibility → Visual effects off,
// macOS/iOS: Reduce Motion, some battery savers) makes the app skip card,
// reveal and cover entrances by design. Shows once ever in the stage toast
// stack; timeout fallback removal because under reduced-motion the toastOut
// animation itself may never run to trigger cleanup.
try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        && safeStorage.getItem('ole_motion_notice_shown') !== 'true') {
        safeStorage.setItem('ole_motion_notice_shown', 'true');
        setTimeout(() => {
            const stack = document.getElementById('stageToasts');
            if (!stack) return;
            const toast = document.createElement('div');
            toast.className = 'stage-toast';
            toast.title = 'Your OS has animations disabled, so card and cover entrance effects are skipped. Change this in your OS accessibility settings.';
            const text = document.createElement('span');
            text.className = 'toast-text';
            text.textContent = 'OS motion is off — entrances skipped';
            toast.appendChild(text);
            toast.addEventListener('animationend', (ev) => { if (ev.animationName === 'toastOut') toast.remove(); });
            stack.appendChild(toast);
            while (stack.children.length > 2) stack.removeChild(stack.children[0]);
            setTimeout(() => { if (toast.parentNode) toast.remove(); }, 5000);
        }, 1500);
    }
} catch { /* notice is best-effort only */ }

