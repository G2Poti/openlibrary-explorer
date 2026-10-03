// book-features.js — domain logic: library core, search/filter/sort,
// tag inputs, autocomplete, translation + edition orchestration, discover
// data + dashboard, import/export. Rendering and settings UI live in
// app-ui.js; shared mutable state lives in the hub (main.js) and is imported
// read-only, with setter functions for the few
// cross-module writes. All cross-module uses are deferred (inside function
// bodies), so hub↔features↔ui cycles are evaluation-safe.
import localforage from 'localforage';
import {
    library, currentViewMode, allDisplayedDocs, currentPage, lastSearchTotalFound,
    renderIndex,
    setCachedTrendingBooks, setCachedGenreShelves, setCachedSubjectCounts,
    setCachedLocalFilteredBooks, setRenderIndex, sortDirection, tagManagerInc, tagManagerExc,
    setCurrentViewMode, setSortDirection, setAllDisplayedDocs, setLastSearchTotalFound,
    setCurrentPage,
    cachedSubjectCounts, cachedLocalFilteredBooks,
    cachedGenreShelves, cachedTrendingBooks, currentDiscoverTab,
    customProxyUrl
} from './main.js';
import {
    buildCard, resolveMissingCover, needsTranslation, shouldReplaceTitle, injectSkeletonScreen,
    renderSavedCollection, initTranslationObserver, prefetchTrendingSynopses, syncCardTitles,
    updateToggleAllBtnState, renderResults, updateSelectionBar, isMobileViewport,
    syncSettingsCategoriesForMode, collapseMobileSidebarIfOpen, updateSwipeHintVisibility,
    selectionMode, selectedKeys, collapseSidebarForSearch
} from './app-ui.js';
import {
    bumpTranslationGeneration, saveTranslationCacheTimer, translationQueue,
    translationCache, translationCoverCache, translationReverseIndex,
    translationPromiseCache, coverMemoryCache, cover404MemoryCache, coverFetchInFlight,
    COVER_DB_PREFIX, COVER_404_DB_PREFIX, syncLibraryKeySet, descriptionCache,
    getCachedSynopsis, getWorkApiUrl, cacheSynopsis, hydrateCachedCovers, safeStorage,
    isCleanLibrarySubjectsEnabled, toCleanSubjectTitleCase,
    setTranslationCache, saveTranslationCache, fetchCoverDataUrl, translationGenerationToken,
    hasCoverInMemory, getCachedCoverDataUrl, rememberCoverInMemory, cacheCoverInBackground,
    getCoverFromMemory, TRENDING_KEY, TRENDING_LS_KEY, TRENDING_TTL
} from './storage-cache.js';
import { fetchOpenLibrary, isApiBlocked, apiBlockResumeTime, apiTelemetry, fetchDiscoverBundleFromProxy } from './network-engine.js';
import { DOM, RENDER_CHUNK, watchInputs, INPUT_IDS } from './dom.js';
import { cleanSubjects, normalizeLanguageCode, escapeHTML, editionLangMatches, API_BASE, API_CONTACT_EMAIL, renderErrorHTML } from './utils.js';

export const resolvedTitlesInActivePass = new Set();
// Developer Cache Clear Protocol:
// 1. Invalidates translation generation token to discard any in-flight background worker tasks
// 2. Wipes RAM maps, clears translation queue, and rebuilds reverse index
// 3. Deletes scoped translation stores in IndexedDB (guaranteeing ole_bookmarks remains untouched)
// 4. Re-hydrates library books in memory back to canonical titles & covers and re-indexes tokens
// 5. Re-runs local filters to cleanly re-translate active view and provides visual button feedback
export const clearTranslationAndCoverCache = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();

    // 1. Immediate Button feedback (instant, visible before async wipe)
    const btn = DOM.clearLibraryCacheBtn || document.getElementById('clearLibraryCacheBtn');
    if (btn) {
        btn.textContent = 'Cleared. Reloading...';
        btn.classList.add('is-reloading');
        btn.disabled = true;
    }

    // 2. If telemetry HUD is not pinned, ensure it stays closed on reload
    if (safeStorage.getItem('ole_telemetry_pinned') !== 'true') {
        safeStorage.removeItem('ole_telemetry_pinned');
    }

    bumpTranslationGeneration();
    if (saveTranslationCacheTimer) clearTimeout(saveTranslationCacheTimer);

    if (translationQueue && typeof translationQueue.clear === 'function') {
        translationQueue.clear();
    }
    translationCache.clear();
    translationCoverCache.clear();
    translationReverseIndex.clear();
    translationPromiseCache.clear();
    coverMemoryCache.clear();
    cover404MemoryCache.clear();
    coverFetchInFlight.clear();
    setCachedTrendingBooks(null);
    setCachedGenreShelves(null);
    resolvedTitlesInActivePass.clear();

    try {
        await localforage.removeItem('ole_translation_cache_v10');
        await localforage.removeItem('ole_translation_cover_cache_v3');
        await localforage.removeItem('ole_translation_cover_cache_v2');
        await localforage.removeItem('ole_translation_cover_cache_v1');
        await localforage.removeItem('ole_trending_cache_v4');
        await localforage.removeItem('ole_genre_shelves_cache_v3');
        safeStorage.removeItem('ole_trending_cache_v4_lsmirror');

        const allKeys = await localforage.keys();
        for (const k of allKeys) {
            if (k.startsWith(COVER_DB_PREFIX) || k.startsWith(COVER_404_DB_PREFIX)) {
                await localforage.removeItem(k).catch(() => {});
            }
        }
    } catch (err) {
        console.error('Error clearing translation cache from storage:', err);
    }

    // 3. Clean single reload after 750ms
    setTimeout(() => {
        window.location.reload();
    }, 750);
};
export const appStates = {
    search: { tagsInc: [], tagsExc: [], inputs: {}, sort: 'relevance', sortDir: 'desc' },
    library: { tagsInc: [], tagsExc: [], inputs: {}, sort: 'date', sortDir: 'desc' }
};
export const SORT_DEFAULTS = { relevance: 'desc', rating: 'desc', reviews: 'desc', editions: 'desc', new: 'desc', date: 'desc', random: 'desc' };
// We no longer load from localStorage here because IndexedDB is asynchronous
export function updateLibraryBadge() { DOM.savedCount.textContent = library.length; }
export const createLibraryDoc = (bookData) => {
    let cleanKey = bookData.key || '';
    if (cleanKey && !cleanKey.startsWith('/')) {
        if (cleanKey.startsWith('OL') && cleanKey.endsWith('W')) cleanKey = `/works/${cleanKey}`;
        else if (cleanKey.startsWith('OL') && cleanKey.endsWith('M')) cleanKey = `/books/${cleanKey}`;
        else cleanKey = `/${cleanKey}`;
    }
    const cleanCoverEdition = bookData.cover_edition_key ? String(bookData.cover_edition_key).replace(/^\/books\//, '') : null;
    const cleanCoverI = bookData.cover_i && parseInt(bookData.cover_i) > 0 ? parseInt(bookData.cover_i) : null;
    const rawLangs = Array.isArray(bookData.language)
        ? bookData.language
        : (bookData.language ? String(bookData.language).split(/[,;]/) : []);
    const cleanLangs = rawLangs.map(l => String(l).replace('/languages/', '').trim().toLowerCase()).filter(Boolean);

    const doc = {
        key: cleanKey,
        title: bookData.title || 'Untitled Work',
        original_title: bookData.original_title || bookData.title || 'Untitled Work',
        author_name: Array.isArray(bookData.author_name)
            ? bookData.author_name.filter(Boolean)
            : (bookData.author_name ? [bookData.author_name] : ['Unknown Author']),
        cover_i: cleanCoverI,
        original_cover_i: bookData.original_cover_i && parseInt(bookData.original_cover_i) > 0 ? parseInt(bookData.original_cover_i) : cleanCoverI,
        cover_edition_key: cleanCoverEdition,
        first_publish_year: bookData.first_publish_year || 'N/A',
        subject: cleanSubjects(bookData.subject),
        place: Array.isArray(bookData.place) ? bookData.place : (bookData.place ? [bookData.place] : []),
        person: Array.isArray(bookData.person) ? bookData.person : (bookData.person ? [bookData.person] : []),
        language: cleanLangs,
        ratings_average: bookData.ratings_average != null ? parseFloat(bookData.ratings_average) : null,
        ratings_count: parseInt(bookData.ratings_count) || 0,
        edition_count: parseInt(bookData.edition_count) || 1,
        savedAt: parseInt(bookData.savedAt) || Date.now()
    };
    cacheBookTokens(doc);
    return doc;
};
export const renderNextChunk = (isEditionsSort, filterLangAA) => {
    const listToRender = currentViewMode === 'library' ? getLocalFilteredBooks() : allDisplayedDocs;
    const fragment = document.createDocumentFragment();
    const endIdx = Math.min(renderIndex + RENDER_CHUNK, listToRender.length);
    const chunkDocs = listToRender.slice(renderIndex, endIdx);
    for (let i = renderIndex; i < endIdx; i++) {
        const card = buildCard(listToRender[i], isEditionsSort, filterLangAA);
        card.style.setProperty('--card-index', i - renderIndex);
        fragment.appendChild(card);
    }
    DOM.grid.appendChild(fragment);
    hydrateCachedCovers(DOM.grid);
    setRenderIndex(endIdx);
    if (currentViewMode === 'search') {
        if (renderIndex < allDisplayedDocs.length) {
            DOM.loadMoreBtn.style.display = 'none'; // Still rendering current local batch
        } else {
            DOM.loadMoreBtn.style.display = ((currentPage * lastFetchLimit) >= lastSearchTotalFound) ? 'none' : 'inline-block';
        }
    }
    // Asynchronously check and sync titles for all chunks in both search and library modes
    syncCardTitles(chunkDocs);
    updateToggleAllBtnState();
};
export const toggleLibrary = (bookData) => {
    const idx = library.findIndex(b => b.key === bookData.key);
    const wasRemoval = idx > -1;
    if (wasRemoval) {
        library.splice(idx, 1);
    } else {
        library.push(createLibraryDoc(bookData));
    }
    setCachedSubjectCounts(null);
    setCachedLocalFilteredBooks(null);
    syncLibraryKeySet();
    localforage.setItem('ole_bookmarks', library).catch(console.error);
    updateLibraryBadge();

    if (currentViewMode === 'library') {
        if (wasRemoval) {
            // In-place DOM removal: completely eliminates scroll jumping
            const cardEl = DOM.grid.querySelector(`.book-card[data-key="${CSS.escape(bookData.key)}"]`);
            if (cardEl) cardEl.remove();

            const filtered = getLocalFilteredBooks();
            if (filtered.length === 0) {
                DOM.status.textContent = library.length === 0
                    ? 'Your Library is currently empty. Add books from search results to build your collection.'
                    : 'No books in your Library match the current filters.';
                DOM.status.style.display = 'block';
                DOM.resultsMeta.style.display = 'none';
                DOM.grid.style.display = 'none';
            } else {
                DOM.status.style.display = 'none';
                const isLibraryUnfiltered = library.length === filtered.length;
                const showLibraryCountInText = document.body.classList.contains('mobile-legacy-layout') && isMobileViewport();
                DOM.totalCount.textContent = isLibraryUnfiltered
                    ? (showLibraryCountInText ? `Showing all ${library.length} books in your library` : "Showing all books in your library")
                    : `Showing ${filtered.length} of ${library.length} books in your library (filtered)`;
            }
            updateToggleAllBtnState();
        } else {
            applyLocalFilters();
        }
    }
    // Background prefetch synopsis for newly added single book
    if (!wasRemoval && bookData.key && typeof getCachedSynopsis === 'function' && !descriptionCache.has(bookData.key)) {
        getCachedSynopsis(bookData.key).then(cached => {
            if (!cached) {
                const workUrl = typeof getWorkApiUrl === 'function' ? getWorkApiUrl(bookData.key) : `https://openlibrary.org${bookData.key}.json`;
                if (workUrl) {
                    fetchOpenLibrary(workUrl, { passType: 'work_detail' })
                        .then(r => r.ok ? r.json() : null)
                        .then(workData => {
                            if (workData) {
                                let desc = '';
                                if (workData.description) {
                                    desc = typeof workData.description === 'string' ? workData.description : (workData.description.value || '');
                                }
                                if (!desc && workData.notes) {
                                    desc = typeof workData.notes === 'string' ? workData.notes : (workData.notes.value || '');
                                }
                                if (desc) {
                                    cacheSynopsis(bookData.key, desc);
                                } else if (workData.title || workData.key) {
                                    cacheSynopsis(bookData.key, 'No synopsis available for this work.');
                                }
                            }
                        })
                        .catch(() => { });
                }
            }
        }).catch(() => { });
    }
    if (selectionMode) updateSelectionBar();
};
export const tokenize = (val) => val.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
// Helper to rip formatting out and return an array of clean, pure words
export const getBookTokens = (arr) => {
    if (!arr) return [];
    if (typeof arr === 'string') arr = [arr];
    if (!Array.isArray(arr) || arr.length === 0) return [];
    return arr.flatMap(item => String(item).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean));
};
export const arrayHasAnyToken = (arr, tokens) => {
    if (!arr || arr.length === 0 || tokens.length === 0) return false;
    const allWords = getBookTokens(arr);
    return tokens.some(tok => allWords.includes(tok)); // Exact word match
};
export const arrayHasAllTokens = (arr, tokens) => {
    if (!arr || arr.length === 0 || tokens.length === 0) return false;
    const allWords = getBookTokens(arr);
    return tokens.every(tok => allWords.includes(tok)); // Exact word match
};
// Pre-calculate Search Tokens to eliminate regex parsing bottlenecks
export const cacheBookTokens = (b) => {
    if (b._tokensCached) return;
    b._sub = new Set(getBookTokens(b.subject));
    b._plc = new Set(getBookTokens(b.place));
    b._per = new Set(getBookTokens(b.person));
    b._lang = new Set(getBookTokens(b.language).map(l => normalizeLanguageCode(l)));
    b._auth = new Set(getBookTokens(b.author_name));
    b._ttl = b.title ? b.title.toLowerCase() : '';
    b._tokensCached = true;
};
export function setupTagInput(inputId, containerId, onInputCleared) {
    const input = document.getElementById(inputId);
    const container = document.getElementById(containerId);
    let tags = [];
    let tagsWrap = container.querySelector('.ui-tags-wrap');
    if (!tagsWrap) {
        tagsWrap = document.createElement('div');
        tagsWrap.className = 'ui-tags-wrap';
        container.insertBefore(tagsWrap, input.parentElement);
    }
    const render = () => {
        tagsWrap.innerHTML = '';
        tags.forEach((tag, idx) => {
            const tagEl = document.createElement('div');
            tagEl.className = 'ui-tag';
            tagEl.innerHTML = `<span>${escapeHTML(tag)}</span><span class="ui-tag-close" data-idx="${idx}">&times;</span>`;
            tagsWrap.appendChild(tagEl);
        });
        tagsWrap.querySelectorAll('.ui-tag-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTag(parseInt(btn.getAttribute('data-idx')));
            });
        });
    };
    const addTag = (text) => {
        // Split the incoming text by commas only, trimming whitespace
        const newTags = text.split(/[,]+/).map(t => t.trim()).filter(t => t.length > 0);
        let added = false;
        newTags.forEach(t => {
            const clean = t;
            // Prevent duplicates (case-insensitive)
            if (clean && !tags.some(existing => existing.toLowerCase() === clean.toLowerCase())) {
                tags.push(clean);
                added = true;
            }
        });
        if (added) {
            render();
            if (onInputCleared) onInputCleared();
            checkInputs();
            if (currentViewMode === 'library') applyLocalFilters();
        }
        input.value = '';
        input.placeholder = tags.length ? '' : 'e.g., Fantasy';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const acList = document.getElementById(inputId + 'List');
        if (acList) acList.style.display = 'none';
        const acInd = document.getElementById(inputId + 'Loading');
        if (acInd) {
            acInd.style.display = 'none';
            acInd.classList.remove('blocked');
        }
        const acGhost = document.getElementById(inputId + 'Ghost');
        if (acGhost) acGhost.innerHTML = '';
    };
    const removeTag = (idx) => {
        tags.splice(idx, 1);
        input.placeholder = tags.length ? '' : 'e.g., Fantasy';
        render();
        checkInputs();
        if (currentViewMode === 'library') applyLocalFilters();
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Coordination with setupAutocomplete (registered AFTER this
            // listener): while the suggestion dropdown is open, the typed text
            // is pinned as row 0 of that list and the autocomplete handler
            // commits whatever is highlighted — so this raw path stands down.
            // With no dropdown, Enter keeps its classic behavior: insert tag,
            // or trigger Find Books when empty.
            const acList = document.getElementById(inputId + 'List');
            if (acList && acList.style.display === 'block') {
                return;
            }
            const val = input.value.trim();
            if (val) {
                addTag(val);
            } else {
                if (!DOM.btn.disabled) DOM.btn.click();
            }
        } else if (e.key === ',') {
            e.preventDefault();
            const val = input.value.trim();
            if (val) {
                addTag(val);
            } else {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const acList = document.getElementById(inputId + 'List');
            if (acList) acList.style.display = 'none';
            const acInd = document.getElementById(inputId + 'Loading');
            if (acInd) {
                acInd.style.display = 'none';
                acInd.classList.remove('blocked');
            }
            const acGhost = document.getElementById(inputId + 'Ghost');
            if (acGhost) acGhost.innerHTML = '';
        } else if (e.key === 'Backspace' && input.value === '') {
            // Finished bubbles are never touched by Backspace: it deletes
            // letters only (Delete removes bubbles instantly, below).
            // When the field is empty, Backspace does nothing.
            e.preventDefault();
        } else if (e.key === 'Delete' && input.value === '' && tags.length > 0) {
            e.preventDefault();
            tags.pop();
            input.placeholder = tags.length ? '' : 'e.g., Fantasy';
            render();
            checkInputs();
            if (currentViewMode === 'library') applyLocalFilters();
        }
    });
    input.addEventListener('input', () => {
        if (input.value === '') {
            input.placeholder = tags.length ? '' : 'e.g., Fantasy';
            if (onInputCleared) onInputCleared();
        }
    });
    container.addEventListener('click', () => input.focus());
    return { getTags: () => tags, addTag, removeTag, clear: () => { tags = []; render(); input.value = ''; input.placeholder = 'e.g., Fantasy'; if (onInputCleared) onInputCleared(); }, setTags: (newTags) => { tags = [...newTags]; render(); input.value = ''; input.placeholder = tags.length ? '' : 'e.g., Fantasy'; if (onInputCleared) onInputCleared(); } };
};
export const syncSortNoteState = () => {
    if (DOM.sortNote && DOM.sort) {
        DOM.sortNote.style.display = (DOM.sort.value === 'reviews' && currentViewMode === 'search') ? 'block' : 'none';
    }
};
export const updateSortDirBtn = () => {
    const btn = document.getElementById('sortDirBtn');
    const isApiMode = currentViewMode === 'search';
    const val = DOM.sort.value;
    const supportsApiDirection = (val === 'new' || val === 'rating' || val === 'reviews');
    const descIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10M11 9h7M11 13h4M3 17l4 4 4-4M7 5v16"/></svg>`;
    const ascIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17h10M11 13h7M11 9h4M3 7l4-4 4 4M7 21V5"/></svg>`;
    if (val === 'random' || (isApiMode && !supportsApiDirection)) {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.title = "Toggle sort direction (Unavailable with this sort option)";
    } else {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.title = "Toggle sort direction";
    }
    btn.innerHTML = sortDirection === 'desc' ? descIcon : ascIcon;
};
export const saveCurrentModeState = () => {
    const state = appStates[currentViewMode];
    state.tagsInc = tagManagerInc.getTags();
    state.tagsExc = tagManagerExc.getTags();
    INPUT_IDS.forEach(id => { state.inputs[id] = document.getElementById(id).value; });
    state.sort = DOM.sort.value;
    state.sortDir = sortDirection;
};
export const restoreModeState = (mode) => {
    const state = appStates[mode];
    tagManagerInc.setTags(state.tagsInc);
    tagManagerExc.setTags(state.tagsExc);
    INPUT_IDS.forEach(id => { document.getElementById(id).value = state.inputs[id] || ''; });
    DOM.sort.value = state.sort;
    setSortDirection(state.sortDir);
    updateSortDirBtn();
    syncSortNoteState();
    checkInputs();
};
export const getHashStateObj = () => {
    const state = {};
    INPUT_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value.trim()) state[id] = el.value.trim();
    });
    const incTags = tagManagerInc.getTags();
    if (incTags.length) state['incSubject'] = incTags.join(',');
    const excTags = tagManagerExc.getTags();
    if (excTags.length) state['excSubject'] = excTags.join(',');
    if (DOM.sort.value !== 'relevance' && DOM.sort.value !== 'date') state.sort = DOM.sort.value;

    const defaultSortDir = SORT_DEFAULTS[DOM.sort.value] || 'desc';
    if (sortDirection !== defaultSortDir) state.sortDir = sortDirection;

    if (currentViewMode === 'library') state.view = 'library';
    return state;
};
export const saveStateToHash = (isPush = false) => {
    if (!DOM.persistToggle.checked) return;
    const state = getHashStateObj();
    const isEmpty = Object.keys(state).length === 0;
    const hash = isEmpty ? '' : '#' + encodeURIComponent(JSON.stringify(state));
    const url = window.location.pathname + window.location.search + hash;
    if (isPush) {
        if (window.location.hash !== hash) {
            history.pushState(null, '', url);
        }
    } else {
        history.replaceState(null, '', url);
    }
};
export const hasActiveSearchCriteria = () => {
    const textInputs = Array.from(watchInputs).filter(el =>
        (el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.id !== 'sortSelect'
    );
    return textInputs.some(input => input.value.trim() !== '') ||
        (typeof tagManagerInc !== 'undefined' && tagManagerInc.getTags().length > 0) ||
        (typeof tagManagerExc !== 'undefined' && tagManagerExc.getTags().length > 0) ||
        (DOM.globalSearchInput && DOM.globalSearchInput.value.trim() !== '');
};
export const loadStateFromHash = () => {
    if (!window.location.hash || window.location.hash === '#') return false;
    try {
        const state = JSON.parse(decodeURIComponent(window.location.hash.slice(1)));
        const view = state.view === 'library' ? 'library' : 'search';
        const targetState = appStates[view];
        // Reset old fields first to prevent leakage between page history steps
        targetState.tagsInc = [];
        targetState.tagsExc = [];
        INPUT_IDS.forEach(id => { targetState.inputs[id] = ''; });
        targetState.sort = view === 'library' ? 'date' : 'relevance';
        targetState.sortDir = 'desc';
        // Load new hash states
        INPUT_IDS.forEach(id => { if (state[id] != null) targetState.inputs[id] = state[id]; });
        if (state['incSubject']) targetState.tagsInc = state['incSubject'].split(',');
        if (state['excSubject']) targetState.tagsExc = state['excSubject'].split(',');
        if (state.sort) targetState.sort = state.sort;
        if (state.sortDir) targetState.sortDir = state.sortDir;
        if (view === 'library') {
            setCurrentViewMode('library');
            DOM.viewSavedBtn.classList.add('active');
            DOM.sortDateOpt.style.display = 'block';
            DOM.sortRelevanceOpt.style.display = 'none';
        } else {
            setCurrentViewMode('search');
            DOM.viewSavedBtn.classList.remove('active');
            DOM.sortDateOpt.style.display = 'none';
            DOM.sortRelevanceOpt.style.display = 'block';
        }
        syncSettingsCategoriesForMode(currentViewMode);
        restoreModeState(currentViewMode);
        return true;
    } catch { return false; }
};
export function checkInputs() {
    if (DOM.globalSearchClearBtn && DOM.globalSearchInput) {
        DOM.globalSearchClearBtn.style.display = DOM.globalSearchInput.value ? 'block' : 'none';
    }
    const hasValue = hasActiveSearchCriteria();
    if (currentViewMode === 'library') {
        // Library results filter live as the user types, so this button never
        // has anything to "do" - keep it permanently disabled/greyed out.
        DOM.btn.disabled = true;
        DOM.btn.textContent = 'Filter Library';
        if (DOM.globalSearchBtn) DOM.globalSearchBtn.disabled = false;
        return;
    }
    DOM.btn.textContent = 'Find Books';
    DOM.btn.disabled = !hasValue;
    if (DOM.globalSearchBtn) {
        DOM.globalSearchBtn.disabled = !hasValue;
    }
};
export function appendKeyboardListeners() {
    // globalSearchInput has its own dedicated Enter handler below; skip it here
    // to avoid firing performSearch() twice on the same keypress (was causing
    // duplicated results when searching from the header bar).
    document.querySelectorAll('input:not(.watch-input-tag):not(#globalSearchInput), select').forEach(element => {
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                collapseMobileSidebarIfOpen();
                if (currentViewMode === 'library') applyLocalFilters();
                else if (!DOM.btn.disabled && hasActiveSearchCriteria()) DOM.btn.click();
            }
        });
    });
};
export const clearAllFilters = () => {
    watchInputs.forEach(input => {
        if (input.id !== 'sortSelect') {
            input.value = '';
        }
    });
    tagManagerInc.clear();
    tagManagerExc.clear();
    DOM.globalSearchInput.value = '';
    DOM.globalSearchClearBtn.style.display = 'none';
    checkInputs();
    if (currentViewMode === 'library') {
        applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash(true);
    } else {
        DOM.grid.innerHTML = '';
        DOM.footer.style.display = 'none';
        DOM.resultsMeta.style.display = 'none';
        setAllDisplayedDocs([]);
        setLastSearchTotalFound(0);
        setCurrentPage(1);
        if (DOM.persistToggle.checked) history.pushState(null, '', window.location.pathname + window.location.search);
        renderDiscoverDashboard();
    }
};
export const getLocalFilteredBooks = () => {
    if (cachedLocalFilteredBooks !== null) {
        return cachedLocalFilteredBooks;
    }
    let filtered = [...library];
    const incSub = tagManagerInc.getTags().flatMap(t => getBookTokens([t]));
    const excSub = tagManagerExc.getTags().flatMap(t => getBookTokens([t]));
    const incPlace = getBookTokens([DOM.incPlace.value]);
    const incPerson = getBookTokens([DOM.incPerson.value]);
    const incLang = getBookTokens([DOM.incLang.value]).map(l => normalizeLanguageCode(l));
    const excPlace = getBookTokens([DOM.excPlace.value]);
    const excPerson = getBookTokens([DOM.excPerson.value]);
    const excLang = getBookTokens([DOM.excLang.value]).map(l => normalizeLanguageCode(l));
    const incTitle = DOM.incTitle.value.trim().toLowerCase();
    const incAuthor = getBookTokens([DOM.incAuthor.value]);
    const globalSearchText = DOM.globalSearchInput.value.trim().toLowerCase();
    const minYear = parseInt(DOM.minY.value) || null;
    const maxYear = parseInt(DOM.maxY.value) || null;
    const minStar = parseFloat(DOM.minStarRating.value) || 0;
    const minRCount = parseInt(DOM.minRatings.value) || 0;
    const hasAll = (set, arr) => arr.length > 0 && arr.every(t => set.has(t));
    const hasAny = (set, arr) => arr.length > 0 && arr.some(t => set.has(t));
    if (incSub.length) filtered = filtered.filter(b => hasAll(b._sub, incSub));
    if (incPlace.length) filtered = filtered.filter(b => hasAll(b._plc, incPlace));
    if (incPerson.length) filtered = filtered.filter(b => hasAll(b._per, incPerson));
    if (incLang.length) filtered = filtered.filter(b => hasAll(b._lang, incLang));
    if (excSub.length) filtered = filtered.filter(b => !hasAny(b._sub, excSub));
    if (excPlace.length) filtered = filtered.filter(b => !hasAny(b._plc, excPlace));
    if (excPerson.length) filtered = filtered.filter(b => !hasAny(b._per, excPerson));
    if (excLang.length) filtered = filtered.filter(b => !hasAny(b._lang, excLang));
    if (incTitle) filtered = filtered.filter(b => b._ttl.includes(incTitle));
    if (incAuthor.length) filtered = filtered.filter(b => hasAny(b._auth, incAuthor));
    if (globalSearchText) {
        filtered = filtered.filter(b => {
            const titleMatch = b._ttl.includes(globalSearchText);
            const authorMatch = b.author_name && b.author_name.some(n => n.toLowerCase().includes(globalSearchText));
            const subjectMatch = b.subject && b.subject.some(s => s.toLowerCase().includes(globalSearchText));
            const placeMatch = b.place && b.place.some(p => p.toLowerCase().includes(globalSearchText));
            const personMatch = b.person && b.person.some(p => p.toLowerCase().includes(globalSearchText));
            return titleMatch || authorMatch || subjectMatch || placeMatch || personMatch;
        });
    }
    if (minYear != null) filtered = filtered.filter(b => (b.first_publish_year || 0) >= minYear);
    if (maxYear != null) filtered = filtered.filter(b => (b.first_publish_year || 0) <= maxYear);
    if (minStar > 0) filtered = filtered.filter(b => (b.ratings_average || 0) >= minStar);
    if (minRCount > 0) filtered = filtered.filter(b => (b.ratings_count || 0) >= minRCount);
    const sortVal = DOM.sort.value;
    const d = sortDirection === 'desc' ? 1 : -1;
    if (sortVal === 'date') filtered.sort((a, b) => d * ((b.savedAt || 0) - (a.savedAt || 0)));
    else if (sortVal === 'rating') filtered.sort((a, b) => d * ((b.ratings_average || 0) - (a.ratings_average || 0)));
    else if (sortVal === 'reviews') filtered.sort((a, b) => d * ((b.ratings_count || 0) - (a.ratings_count || 0)));
    else if (sortVal === 'editions') filtered.sort((a, b) => d * ((b.edition_count || 0) - (a.edition_count || 0)));
    else if (sortVal === 'new') filtered.sort((a, b) => d * ((b.first_publish_year || 0) - (a.first_publish_year || 0)));
    else if (sortVal === 'random') filtered.sort(() => Math.random() - 0.5);
    setCachedLocalFilteredBooks(filtered);
    return filtered;
};
export const getFilteredSubjectCounts = () => {
    const filteredBooks = getLocalFilteredBooks();
    const signatureMap = new Map();
    // 1. Extract unique signatures and aggressively deduplicate their inner tokens
    filteredBooks.forEach(b => {
        (b.subject || []).forEach(s => {
            const tokens = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
            if (tokens.length === 0) return;
            // Deduplicate tokens to collapse items like "fiction fantasy fiction" into "fantasy fiction"
            const uniqueTokens = [...new Set(tokens)];
            const sig = [...uniqueTokens].sort().join(',');
            if (!signatureMap.has(sig)) {
                signatureMap.set(sig, { name: s, tokens: uniqueTokens, count: 0 });
            } else {
                const existing = signatureMap.get(sig);
                if (s.length < existing.name.length) existing.name = s;
            }
        });
    });
    // 2. Pre-compute book token Sets for fast lookups
    const bookTokensList = filteredBooks.map(b => new Set(getBookTokens(b.subject)));
    const results = Array.from(signatureMap.values());
    // 3. Count exact matches
    results.forEach(group => {
        let trueCount = 0;
        const gTokens = group.tokens;
        const len = gTokens.length;
        for (let i = 0; i < bookTokensList.length; i++) {
            const bSet = bookTokensList[i];
            let hasAll = true;
            for (let j = 0; j < len; j++) {
                if (!bSet.has(gTokens[j])) {
                    hasAll = false;
                    break;
                }
            }
            if (hasAll) trueCount++;
        }
        group.count = trueCount;
    });
    // 4. Collapse Redundant Subsets sharing the exact same book counts (Anti-Spam)
    // Sort by token array length descending so we analyze specific long phrases first
    results.sort((a, b) => b.tokens.length - a.tokens.length);
    const cleanResults = [];
    results.forEach(current => {
        // If a longer, more specific phrase already exists with the EXACT same book count 
        // and completely covers these tokens, this entry is redundant spam.
        const isRedundantSubset = cleanResults.some(stored =>
            stored.count === current.count &&
            current.tokens.every(t => stored.tokens.includes(t))
        );
        if (!isRedundantSubset) {
            cleanResults.push(current);
        }
    });
    // 5. Return final sanitized results sorted by count descending
    if (isCleanLibrarySubjectsEnabled()) {
        cleanResults.forEach(item => {
            if (item.name) item.name = toCleanSubjectTitleCase(item.name);
        });
    }
    return cleanResults.sort((a, b) => b.count - a.count);
};
export function setupAutocomplete(inputId, listId, indicatorId, ghostId, isLocalMode, managerRef) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    const indicator = document.getElementById(indicatorId);
    const ghost = document.getElementById(ghostId);
    let timeout = null;
    let isFocused = false;
    let currentMatches = [];
    let activeIndex = 0;
    // The grey inline "ghost" preview is retired: the typed text itself now
    // always appears as the FIRST row of the suggestion list (see below), so
    // the ghost duplicated it and made Enter semantics ambiguous.
    if (ghost) ghost.style.display = 'none';
    const isApiCooldownActive = () => isApiBlocked && Date.now() < apiBlockResumeTime;
    const renderList = () => {
        list.innerHTML = '';
        indicator.style.display = 'none';
        indicator.classList.remove('blocked');
        if (currentMatches.length > 0) {
            currentMatches.forEach((subj, idx) => {
                const li = document.createElement('li');
                li.className = 'autocomplete-item' + (idx === activeIndex ? ' active' : '');
                const name = subj.name || subj;
                // A numeric count — INCLUDING 0, which matters for the typed
                // row ("this subject exists but has no works") — renders as a
                // badge. null/undefined/'' means "count unknown": no badge.
                const rawCount = subj.work_count ?? subj.count;
                const countHtml = (rawCount !== undefined && rawCount !== null && rawCount !== '')
                    ? `<span class="ac-count">(${rawCount})</span>`
                    : (subj.isTyped && !(isLocalMode && isLocalMode()) ? `<span class="ac-count">( ? )</span>` : '');
                li.innerHTML = `<span>${escapeHTML(name)}</span> ${countHtml}`;
                li.addEventListener('mousedown', (evt) => {
                    evt.preventDefault();
                    managerRef.addTag(name);
                    list.style.display = 'none';
                    ghost.innerHTML = '';
                });
                list.appendChild(li);
            });
            list.style.display = 'block';
        } else {
            list.style.display = 'none';
        }
    };
    const renderLocalSuggestions = (query) => {
        if (!cachedSubjectCounts) {
            setCachedSubjectCounts(getFilteredSubjectCounts());
        }
        activeIndex = 0;
        const matches = query.length === 0
            ? cachedSubjectCounts.slice(0, 10)
            : cachedSubjectCounts.filter(s => s.name.toLowerCase().includes(query)).slice(0, 10);
        currentMatches = matches;
        renderList();
    };
    input.addEventListener('focus', () => {
        isFocused = true;
        if (isLocalMode && isLocalMode() && library.length > 0) {
            renderLocalSuggestions(input.value.trim().toLowerCase());
        }
    });
    input.addEventListener('blur', () => {
        isFocused = false;
        setTimeout(() => { list.style.display = 'none'; indicator.style.display = 'none'; indicator.classList.remove('blocked'); ghost.innerHTML = ''; input.placeholder = managerRef.getTags().length ? '' : 'e.g., Fantasy'; }, 250);
    });
    input.addEventListener('keydown', (e) => {
        if (list.style.display === 'block' && currentMatches.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = (activeIndex + 1) % currentMatches.length;
                renderList();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
                renderList();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                let targetMatch = currentMatches[activeIndex];
                // If activeIndex is at 0 (the default typed row) and user hasn't explicitly navigated with arrows:
                if (activeIndex === 0) {
                    const row0Count = currentMatches[0] && currentMatches[0].work_count !== '' && currentMatches[0].work_count !== undefined
                        ? Number(currentMatches[0].work_count)
                        : -1;
                    // If row 0 is an exact catalog category with real works (e.g. "Fantasy" with 500k works),
                    // Tab commits row 0 directly rather than skipping to the second option.
                    if (row0Count > 0) {
                        targetMatch = currentMatches[0];
                    } else {
                        // Otherwise (user typed a partial prefix like "fant"), pick the top catalog suggestion.
                        let bestCandidate = null;
                        let maxCount = -1;
                        for (let i = 0; i < currentMatches.length; i++) {
                            const m = currentMatches[i];
                            const count = m.work_count !== undefined ? Number(m.work_count) : (m.count !== undefined ? Number(m.count) : -1);
                            if (!m.isTyped && count > maxCount) {
                                maxCount = count;
                                bestCandidate = m;
                            }
                        }
                        if (bestCandidate) {
                            targetMatch = bestCandidate;
                        } else if (currentMatches.length > 1 && currentMatches[0].isTyped) {
                            targetMatch = currentMatches[1];
                        }
                    }
                }
                const name = targetMatch ? (targetMatch.name || targetMatch) : input.value.trim();
                if (name) managerRef.addTag(name);
                list.style.display = 'none';
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const typedNow = input.value.trim();
                if (!typedNow) {
                    // Empty input with the library quick-list open: classic
                    // semantics — close and trigger Find Books.
                    list.style.display = 'none';
                    if (!DOM.btn.disabled) DOM.btn.click();
                    return;
                }
                // The highlighted suggestion IS the commitment — and since the
                // typed text is always pinned as row 0, plain Enter (no arrows)
                // naturally commits exactly what was typed. setupTagInput's raw
                // handler stands down while the dropdown is open, so nothing
                // can double-insert.
                if (currentMatches[activeIndex]) {
                    const name = currentMatches[activeIndex].name || currentMatches[activeIndex];
                    managerRef.addTag(name);
                }
                list.style.display = 'none';
            }
        }
    });
    input.addEventListener('input', (e) => {
        clearTimeout(timeout);
        const query = e.target.value.trim().toLowerCase();
        if (isLocalMode && isLocalMode()) {
            renderLocalSuggestions(query);
            return;
        }
        if (query.length < 2) {
            list.style.display = 'none';
            indicator.style.display = 'none';
            currentMatches = [];
            ghost.innerHTML = '';
            input.placeholder = managerRef.getTags().length ? '' : 'e.g., Fantasy';
            return;
        }
        indicator.style.display = 'inline-block';
        if (isApiCooldownActive()) {
            // Cooldown in effect -- show the static red arrow and don't fire the
            // doomed subject query (it would just reject inside fetchOpenLibrary).
            indicator.classList.add('blocked');
            return;
        }
        indicator.classList.remove('blocked');
        timeout = setTimeout(async () => {
            if (!isFocused) return;
            try {
                // Fire the wildcard AND exact queries in parallel. OpenLibrary's
                // wildcard relevance-ranking can bury the exact subject under
                // compound names (typing "romance" returns Rhaeto-Romance/
                // Romansh literature and never plain Romance), so the exact
                // result set is always merged in — the old code only consulted
                // it when the wildcard set was completely empty, which for
                // "romance*" never happens.
                let docsWild = [];
                let docsExact = [];
                await Promise.all([
                    fetchOpenLibrary(`https://openlibrary.org/search/subjects.json?q=${encodeURIComponent(query + '*')}&limit=20`, { passType: 'autocomplete' })
                        .then(async res => { if (res.ok) docsWild = (await res.json()).docs || []; })
                        .catch(() => { }),
                    fetchOpenLibrary(`https://openlibrary.org/search/subjects.json?q=${encodeURIComponent(query)}&limit=20`, { passType: 'autocomplete' })
                        .then(async res => { if (res.ok) docsExact = (await res.json()).docs || []; })
                        .catch(() => { })
                ]);
                if (docsWild.length === 0 && docsExact.length === 0) throw new Error();
                const processDocs = (rawDocs) => {
                    const mergedMap = new Map();
                    rawDocs.forEach(d => {
                        if (!mergedMap.has(d.name.toLowerCase())) mergedMap.set(d.name.toLowerCase(), d);
                    });
                    return Array.from(mergedMap.values())
                        .filter(d => (d.work_count || 0) >= 10)
                        .map(d => {
                            const tokens = d.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
                            return { ...d, tokens };
                        });
                };
                // Exact-query docs go FIRST so their entries win the dedupe.
                let viableCandidates = processDocs([...docsExact, ...docsWild]);
                // EXPERIMENTAL LOGIC: Order-agnostic, punctuation-agnostic aggregation
                if (DOM.enhancedAutofillToggle.checked) {
                    // EXPERIMENTAL LOGIC: Order-agnostic, punctuation-agnostic aggregation
                    viableCandidates.forEach(anchor => {
                        let aggregatedCount = 0;
                        viableCandidates.forEach(target => {
                            const isSubset = anchor.tokens.every(token => target.tokens.includes(token));
                            if (isSubset) aggregatedCount += target.work_count || 0;
                        });
                        anchor.aggregated_count = aggregatedCount;
                    });
                    viableCandidates.forEach(c => { c.work_count = c.aggregated_count; });
                }
                // Rank: exact matches first, then prefix matches, then the rest —
                // each tier by work count. This guarantees the subject the user
                // is literally typing can never be crowded out of the list.
                viableCandidates.sort((a, b) => b.work_count - a.work_count);
                const nameOf = d => (d.name || '').toLowerCase();
                const tiered = [
                    ...viableCandidates.filter(d => nameOf(d) === query),
                    ...viableCandidates.filter(d => nameOf(d) !== query && nameOf(d).startsWith(query)),
                    ...viableCandidates.filter(d => !nameOf(d).startsWith(query))
                ];
                // The typed text itself is ALWAYS row 0 — even if it matches
                // nothing (nonsense word). When OpenLibrary knows the exact
                // subject, its real work count rides along on row 0; a genuine
                // 0-work subject shows (0). Plain Enter commits it; a real
                // subject is only one ArrowDown away. The exact duplicate from
                // the candidate list is folded into it.
                const typedText = input.value.trim();
                const typedLower = typedText.toLowerCase();
                const exactDoc = tiered.find(d => nameOf(d) === typedLower)
                    || (docsExact && docsExact.find(d => (d.name || '').toLowerCase() === typedLower))
                    || (docsWild && docsWild.find(d => (d.name || '').toLowerCase() === typedLower));
                const exactCount = exactDoc ? (exactDoc.work_count !== undefined ? exactDoc.work_count : (exactDoc.count !== undefined ? exactDoc.count : 0)) : '';
                currentMatches = [{
                    name: typedText,
                    work_count: exactCount,
                    isTyped: true
                }]
                    .concat(tiered.filter(d => nameOf(d) !== typedLower))
                    .slice(0, 10);
                activeIndex = 0;
                renderList();
            } catch {
                if (isApiCooldownActive()) {
                    // A fetch got blocked mid-flight -- keep the static red arrow.
                    indicator.classList.add('blocked');
                    indicator.style.display = 'inline-block';
                } else {
                    indicator.classList.remove('blocked');
                    indicator.style.display = 'none';
                }
                list.style.display = 'none';
                ghost.innerHTML = '';
                input.placeholder = managerRef.getTags().length ? '' : 'e.g., Fantasy';
            }
        }, 300);
    });
};
export const isValidEditionForWork = (entry, workKey) => {
    if (!entry.works || entry.works.length === 0) return false;
    if (entry.works.length > 1) {
        console.warn(`[Translation] Skipping edition ${entry.key} because it covers multiple works (omnibus):`, entry.works.map(w => w.key));
        return false;
    }
    if (entry.works.length === 1 && entry.works[0].key !== workKey) {
        return false;
    }
    return true;
};
export const normalizeForCompare = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|an?)\s+/, '').replace(/[.,!?'":;]/g, '').trim();
export const isAuthorNameOnly = (text, authorNames) => {
    if (!text || !authorNames || authorNames.length === 0) return false;
    const norm = normalizeForCompare(text);
    if (!norm) return false;
    return authorNames.some(a => normalizeForCompare(a) === norm);
};
// Catches the author's name appearing anywhere within a string (not just an
// exact match), e.g. a subtitle like "Ayn Rand's Anthem" or "Notes by Ayn Rand".
export const containsAuthorName = (text, authorNames) => {
    if (!text || !authorNames || authorNames.length === 0) return false;
    const foldedText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return authorNames.some(a => {
        const an = (a || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        return an.length > 2 && foldedText.includes(an);
    });
};
// Some editions store "Title by Author" in the title field itself (metadata
// bleed from the source catalog). Strip the trailing "by <author>" credit so
// the base title stays clean, e.g. "Anthem by Ayn Rand" -> "Anthem".
export const stripAuthorCredit = (title, authorNames) => {
    if (!title || !authorNames || authorNames.length === 0) return title;
    const match = title.match(/^(.*?)\s+by\s+(.+)$/i);
    if (!match) return title;
    const [, base, creditedName] = match;
    if (base.trim() && authorNames.some(a => normalizeForCompare(a) === normalizeForCompare(creditedName))) {
        return base.trim();
    }
    return title;
};
// Junk-content checks shared between subtitle validation and the title/subtitle
// swap heuristic below — flags marketing blurbs, attribution credits, generic
// genre labels, edition/print/publisher descriptors, and overly long strings.
export const isJunkPhrase = (text) => {
    if (!text || typeof text !== 'string') return true;
    const lower = text.toLowerCase().trim();
    if (!lower) return true;
    const marketingTerms = ["#1", "bestsell", "author of", "new york times", "sunday times", "million copy"];
    if (marketingTerms.some(term => lower.includes(term))) return true;
    const attributionPatterns = [
        /\btranslated (from|by)\b/, /\btrans(l|lation)?\.?\s*by\b/,
        /\bwith an? (introd(uction)?|foreword|afterword|preface)\b/,
        /\b(introduction|foreword|afterword|preface|notes?|annotated|edited|abridged|adapted)\s+by\b/,
        /\bed\.\s*by\b/, /\bintrod\.\s*by\b/,
        /\bby\b/ // catch-all: any "by <someone>" credit line, anywhere in the text
    ];
    if (attributionPatterns.some(re => re.test(lower))) return true;
    // Generic genre labels: "A Novel", "A Story", "A Tale", "A Book", "A Novella",
    // and variants with a modifier in between ("A Love Story", "A War Novel").
    // Matched as a leading clause (not just the whole string) so things like
    // "A Novel; Volume II" are still caught.
    if (/^an?\s+(\S+\s+){0,3}(story|novel|tale|book|novella)\b/i.test(lower)) return true;
    const editionTerms = [
        "ebook", "e-book", "audiobook", "bilingual edition", "unabridged", "abridged",
        "movie tie-in", "tie-in edition", "annotated edition",
        "reprint", "revised edition", "anniversary edition", "library edition",
        "student edition", "teacher's edition", "deluxe edition", "gift edition",
        "collector's edition", "box set", "boxed set", "special edition",
        "illustrated edition", "graphic novel edition", "mass market edition"
    ];
    if (editionTerms.some(term => lower === term || lower.startsWith(term + " ") || lower.endsWith(" " + term))) return true;
    if (/\bedition\b/i.test(lower)) return true; // any "___ Edition" mention, anywhere in the text
    if (/\bversion\b/i.test(lower)) return true; // any "___ Version" mention, anywhere in the text
    if (/\bprint\b/i.test(lower)) return true; // "Large Print", "Fine Print Edition", etc.
    if (/\bpress\b/i.test(lower)) return true; // publisher-imprint mentions, e.g. "SeaWolf Press Classic"
    if (/\be-?book\b/i.test(lower)) return true; // "Ebook" / "E-book", anywhere
    if (/\bpaperback\b/i.test(lower)) return true; // "Paperback", anywhere
    if (text.split(/\s+/).length > 10) return true;
    return false;
};
export const isValidSubtitle = (subtitle, authorNames, title) => {
    if (!subtitle || typeof subtitle !== 'string') return false;
    if (isJunkPhrase(subtitle)) return false;
    // Subtitle that's just the author's name, or that mentions it anywhere, adds nothing.
    if (isAuthorNameOnly(subtitle, authorNames) || containsAuthorName(subtitle, authorNames)) return false;
    // Subtitle that just repeats the title adds nothing either.
    if (title && normalizeForCompare(subtitle) === normalizeForCompare(title)) return false;
    return true;
};
export const isTranslateCoversEnabled = () => {
    if (!DOM.translateCoversToggle) return true;
    return DOM.translateCoversToggle.checked;
};

export const JUNK_TERMS = [
    'testo inglese a fronte',
    'testo a fronte',
    'bilingual parallel text',
    'parallel text',
    'edizione critica',
    'boxed set',
    'box set',
    'e-book',
    'edizione',
    'edicion',
    'edition',
    'version',
    'paperback',
    'ebook',
    'print',
    'press',
    'bilingual',
    'bilingue',
    'trilingual',
    'multilingual',
    'unabridged',
    'abridged',
    'annotated',
    'annotato',
    'annotata',
    'illustrated',
    'illustrato',
    'illustrata'
];

export const JUNK_REGEX = new RegExp(`\\b(${JUNK_TERMS.join('|')})\\b`, 'gi');

export function stripJunkTitleSuffix(title) {
    if (!title) return '';
    return title.replace(JUNK_REGEX, '').trim();
}

export const isJunkTitleFragment = (title) => {
    if (!title) return true;
    const folded = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return JUNK_TERMS.some(term => new RegExp(`\\b${term}\\b`).test(folded));
};

// Universal Structural Segment Decomposition (ISBD Standard):
// Matches space-padded structural dividers: " / ", " - ", " — ", " | ", " : ", " -- "
// Note: Character class [/\-—|:] contains literal slash, escaped hyphen, em-dash, pipe, and colon.
// In international library cataloging (ISBD/MARC21), the 1st segment is the primary Title Proper.
// If the 1st segment happens to be the English reference echo, extracts the 2nd segment; otherwise returns the 1st segment.
export function extractForeignSegment(title, normRef) {
    if (!title) return '';
    const match = title.match(/\s+([/\-—|:]|--)\s+/);
    if (!match) return title;

    const parts = title.split(match[0]).map(p => p.trim()).filter(Boolean);
    if (parts.length === 2) {
        const p0Norm = normalizeForCompare(parts[0]);
        const p1Norm = normalizeForCompare(parts[1]);
        if (normRef && p0Norm === normRef && p1Norm !== normRef) return parts[1];
        return parts[0];
    }
    return title;
}

// Universal Output Typography Safeguard:
// Ensures titles aren't left in all-caps shouting (which triggers spam guards) or raw lowercase.
export function formatDisplayTitle(title) {
    if (!title) return '';
    const letters = title.replace(/[^A-Za-z\u00C0-\u024F]/g, '');
    if (letters.length >= 4 && letters === letters.toUpperCase()) {
        return title.toLowerCase().replace(/(?:^|\s|\/|-|\()\w/g, m => m.toUpperCase());
    }
    return title.charAt(0).toUpperCase() + title.slice(1);
}

export const escapeRegex = (s) => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Picks the best edition to source a translated title and cover from via Hierarchical Lexicographical Sieve.
// Resolves foreign target translations without English reference bias, groups by in-batch consensus,
// and strictly scopes cover discovery to the winning consensus group.
export const pickBestEdition = (rawEditions, authorNames, referenceTitle, preferCovers = isTranslateCoversEnabled(), targetLang = '') => {
    if (!rawEditions || rawEditions.length === 0) return null;

    const isForeignTarget = targetLang && normalizeLanguageCode(targetLang) !== 'eng';

    // STEP 0: Target Language Gate
    const targetEditions = targetLang
        ? rawEditions.filter(e => e.languages && Array.isArray(e.languages) && e.languages.some(l => editionLangMatches(l?.key || l, targetLang)))
        : rawEditions;

    if (targetEditions.length === 0) return null;

    // Symmetrical reference title normalization
    const cleanRef = stripJunkTitleSuffix(stripAuthorCredit(referenceTitle, authorNames));
    const normRef = normalizeForCompare(cleanRef || referenceTitle);

    // Upstream candidate quality filter: rejects messy parallel text / spam titles before selection
    const isQualityTitleCandidate = (e) => {
        if (!e.cleanTitle || e.cleanTitle.length < 2 || e.cleanTitle.length > 120) return false;
        if ((e.cleanTitle.match(/:/g) || []).length > 2) return false;
        if (isJunkTitleFragment(e.cleanTitle)) return false;
        if (normRef && e.normTitle.startsWith(normRef) && e.normTitle.length - normRef.length > 8) return false;
        return true;
    };

    // 1. Clean, decompose segments, precompute properties, and normalize all candidate titles in a single O(N) pass
    const cleaned = targetEditions.map(e => {
        const withoutAuthor = stripAuthorCredit(e.title, authorNames);
        const decomposed = extractForeignSegment(withoutAuthor, normRef);
        const stripped = stripJunkTitleSuffix(decomposed);
        const finalClean = stripped || decomposed || withoutAuthor || (e.title || '').trim();
        const norm = normalizeForCompare(finalClean);
        const coverId = (e.covers && Array.isArray(e.covers)) ? e.covers.find(c => parseInt(c) > 0) : null;

        const uniqueLangs = (e.languages && Array.isArray(e.languages))
            ? new Set(e.languages.map(l => normalizeLanguageCode(l?.key || l)).filter(Boolean))
            : new Set();
        const isPure = uniqueLangs.size === 1 && uniqueLangs.has(normalizeLanguageCode(targetLang));
        const isBilingualEng = uniqueLangs.has('eng') && uniqueLangs.size > 1;

        return {
            ...e,
            cleanTitle: finalClean,
            normTitle: norm,
            _hasCover: !!coverId,
            _coverId: coverId ? parseInt(coverId) : null,
            _isPure: isPure,
            _isBilingualEng: isBilingualEng
        };
    }).filter(e => e.normTitle.length > 0);

    if (cleaned.length === 0) return { ...targetEditions[0], localizedCoverId: null };

    // Single-edition Fast Path (Zero Map allocation, safe title preservation)
    if (cleaned.length === 1) {
        const chosen = cleaned[0];
        const cleanKey = chosen.key ? String(chosen.key).replace(/^\/books\//, '') : null;
        return { ...chosen, title: formatDisplayTitle(chosen.cleanTitle), key: cleanKey, localizedCoverId: chosen._coverId };
    }

    // TIER 1: Language-Directional & Quality Filtering
    const qualityEditions = cleaned.filter(isQualityTitleCandidate);
    let eligible = qualityEditions.length > 0 ? qualityEditions : cleaned;

    if (isForeignTarget) {
        const withoutEnglishBilinguals = eligible.filter(e => !(e._isBilingualEng && e.normTitle === normRef));
        if (withoutEnglishBilinguals.length > 0) {
            eligible = withoutEnglishBilinguals;
        }
    }

    // TIER 2: Consensus Grouping
    const groups = new Map();
    eligible.forEach(e => {
        if (!groups.has(e.normTitle)) {
            groups.set(e.normTitle, []);
        }
        groups.get(e.normTitle).push(e);
    });

    const groupEntries = Array.from(groups.entries());
    const groupRankings = groupEntries.map(([normTitle, list]) => {
        const hasCoverCount = list.filter(e => e._hasCover).length;
        const isPureCount = list.filter(e => e._isPure).length;
        const isJunk = isJunkTitleFragment(normTitle);

        let rankScore = list.length * 10;
        if (hasCoverCount > 0 && preferCovers) rankScore += 20;
        if (isPureCount > 0) rankScore += 10;
        if (isJunk) rankScore -= 50;

        // Pure Substring Cluster Consensus (Language-Agnostic, Zero Word Lists)
        groupEntries.forEach(([otherNorm, otherList]) => {
            if (otherNorm !== normTitle && normTitle.length >= 3 && otherNorm.length > normTitle.length) {
                const subphraseRegex = new RegExp(`(?:^|[\\s:;–—/(\\[])${escapeRegex(normTitle)}(?:$|[\\s:;–—/)\\]])`, 'i');
                if (subphraseRegex.test(otherNorm)) {
                    rankScore += (otherList.length * 4);
                }
            }
        });

        // Micro Occam Penalty (Tie-breaker for equal-vote candidates)
        rankScore -= (normTitle.length * 0.05);

        return { normTitle, list, rankScore };
    });

    groupRankings.sort((a, b) => b.rankScore - a.rankScore);
    const winningGroup = groupRankings[0].list;

    // TIER 3: Consensus Typography & Exemplar Harvesting
    const sortedByTypography = [...winningGroup].sort((a, b) => {
        const aLetters = a.cleanTitle.replace(/[^A-Za-z\u00C0-\u024F]/g, '');
        const bLetters = b.cleanTitle.replace(/[^A-Za-z\u00C0-\u024F]/g, '');

        // 1. Penalize ALL CAPS shouting
        const aAllUpper = aLetters.length >= 4 && aLetters === aLetters.toUpperCase() ? 1 : 0;
        const bAllUpper = bLetters.length >= 4 && bLetters === bLetters.toUpperCase() ? 1 : 0;
        if (aAllUpper !== bAllUpper) return aAllUpper - bAllUpper;

        // 2. Prefer starting with a capital letter
        const aCap = /^[A-Z\u00C0-\u024F]/.test(a.cleanTitle) ? 1 : 0;
        const bCap = /^[A-Z\u00C0-\u024F]/.test(b.cleanTitle) ? 1 : 0;
        if (aCap !== bCap) return bCap - aCap;

        // 3. Prefer pure target language
        const aPure = a._isPure ? 1 : 0;
        const bPure = b._isPure ? 1 : 0;
        if (aPure !== bPure) return bPure - aPure;

        // 4. Prefer clean subtitle
        const aSub = a.subtitle ? 0 : 1;
        const bSub = b.subtitle ? 0 : 1;
        if (aSub !== bSub) return bSub - aSub;

        return 0;
    });

    const chosenText = sortedByTypography[0];
    const coverId = (preferCovers && winningGroup.find(e => e._hasCover)?._coverId)
        || chosenText._coverId
        || null;

    const cleanKey = chosenText.key ? String(chosenText.key).replace(/^\/books\//, '') : null;
    return {
        ...chosenText,
        title: formatDisplayTitle(chosenText.cleanTitle),
        key: cleanKey,
        localizedCoverId: coverId ? parseInt(coverId) : null
    };
};

export const trimEditionPayload = (e) => ({
    key: e.key,
    title: e.title,
    subtitle: e.subtitle,
    languages: e.languages,
    covers: e.covers,
    works: e.works // Preserved for isValidEditionForWork validation
});

// Dynamic Tiered Edition Discovery Engine:
// Pass 1: Requests first 100 editions (fast lane, ~200ms, resolves 93% of books).
// Pass 2: If no covered match is found and more editions exist, performs a single wide sweep
//         (limit=1000&offset=100) to find deep classic editions without serial pagination roundtrips.
export const fetchWorkEditions = async (workKey, targetLang, totalEditions = null, signal = null) => {
    if (!workKey) return null;
    apiTelemetry.recordWorkTranslated();
    let allEntries = [];
    const preferCovers = isTranslateCoversEnabled();

    // Pass 1: Always fetch first 100 editions
    const pass1Url = `https://openlibrary.org${workKey}/editions.json?limit=100&offset=0`;
    let res;
    let data;
    try {
        res = await fetchOpenLibrary(pass1Url, { signal, passType: 'pass1' });
        if (!res.ok) return null;
        data = await res.json();
        const entries = (data.entries || []).map(trimEditionPayload);
        allEntries = allEntries.concat(entries);

        // Early exit: if target language edition with cover was discovered in Pass 1
        const hasTargetWithCover = entries.some(e =>
            e.covers && Array.isArray(e.covers) && e.covers.some(c => c > 0) &&
            e.languages && e.languages.some(l => editionLangMatches(l.key, targetLang))
        );
        if (hasTargetWithCover) return allEntries;

        // If covers not preferred and any language match found in Pass 1, return
        if (!preferCovers && entries.some(e => e.languages && e.languages.some(l => editionLangMatches(l.key, targetLang)))) {
            return allEntries;
        }

        // Pass 2: Deep Tail Sweep (if more editions exist beyond the first 100)
        const hasMore = entries.length === 100 || (data.size && data.size > 100) || (totalEditions && totalEditions > 100);
        if (hasMore) {
            const pass2Url = `https://openlibrary.org${workKey}/editions.json?limit=1000&offset=100`;
            const res2 = await fetchOpenLibrary(pass2Url, { signal, passType: 'pass2' });
            if (res2.ok) {
                const data2 = await res2.json();
                const entries2 = (data2.entries || []).map(trimEditionPayload);
                allEntries = allEntries.concat(entries2);
            }
        }
    } catch {
        return null;
    }

    return allEntries;
};
export const isDuplicateTitle = (title, currentKey, targetLang) => {
    const lowerTitle = title.trim().toLowerCase();
    if (resolvedTitlesInActivePass.has(lowerTitle)) {
        console.warn(`[Translation] Suspicious duplicate title detected in active pass: "${title}" for work ${currentKey}. Reverting to original title.`);
        return true;
    }
    const langIndex = translationReverseIndex.get(targetLang);
    if (langIndex && langIndex.has(lowerTitle)) {
        const existingKey = langIndex.get(lowerTitle);
        if (existingKey !== currentKey) {
            console.warn(`[Translation] Cache duplicate title detected: "${title}" for work ${currentKey} (collides with cached work ${existingKey}). Reverting to original title.`);
            return true;
        }
    }
    const list = currentViewMode === 'library' ? getLocalFilteredBooks() : allDisplayedDocs;
    const isDup = list.some(book => book.key !== currentKey && book.title.trim().toLowerCase() === lowerTitle);
    if (isDup) {
        console.warn(`[Translation] Suspicious duplicate title detected in current list: "${title}" for work ${currentKey}. Reverting to original title.`);
    }
    return isDup;
};
// ── Translation target gating ────────────────────────────────────────────
// Returns the EXPLICIT translation target language, or '' when the user has
// not chosen a language filter. An empty result means the entire translation
// system must stand down: displayed titles are already canonical, and the
// old behavior of defaulting to 'eng' launched a mass "translate to English"
// pass on every boot/search that fetched alternate English editions for
// perfectly-correct titles and frequently replaced them with worse ones
// (different subtitles, sloppy punctuation/spelling).
export function getExplicitTargetLang() {
    return DOM.incLang && DOM.incLang.value ? DOM.incLang.value.trim().toLowerCase() : '';
}
export const applyLocalFilters = async () => {
    bumpSearchRequestToken(); // entering/using Library view cancels any in-flight search
    resolvedTitlesInActivePass.clear();
    setCachedSubjectCounts(null); // Invalidate cache when filters change
    setCachedLocalFilteredBooks(null);
    const filtered = getLocalFilteredBooks();
    const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
    const isSyncMode = DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked;
    const targetLang = getExplicitTargetLang();
    // No explicit language filter -> no translation pass at all. Titles shown
    // are canonical; there is nothing to translate towards.
    if (isTransEnabled && targetLang) {
        const preferCovers = isTranslateCoversEnabled();
        // Pre-apply cache
        filtered.forEach(b => {
            const cacheKey = `${b.key}_${targetLang}`;
            if (translationCache.has(cacheKey)) {
                apiTelemetry.recordCacheHit('ram', 'title');
                b.title = translationCache.get(cacheKey);
            }
            if (preferCovers && translationCoverCache.has(cacheKey)) {
                apiTelemetry.recordCacheHit('ram', 'cover');
                const cov = translationCoverCache.get(cacheKey);
                if (cov && cov.cover_i && cov.cover_i > 0) b.cover_i = cov.cover_i;
            }
        });
        if (isSyncMode) {
            // SYNC Mode (blocking with live progress indicator)
            const docsToTranslate = filtered.filter(b => needsTranslation(b, targetLang));
            if (docsToTranslate.length > 0) {
                const total = filtered.length;
                let completed = filtered.filter(b => !needsTranslation(b, targetLang)).length;
                injectSkeletonScreen(false, total);

                const activeToken = translationGenerationToken;
                const coverPrewarmPromises = [];

                if (DOM.querySpeedContainer) DOM.querySpeedContainer.style.display = 'flex';
                if (DOM.libraryTranslateProgress) {
                    DOM.libraryTranslateProgress.style.display = 'block';
                    requestAnimationFrame(() => {
                        if (DOM.libraryTranslateProgress) DOM.libraryTranslateProgress.classList.add('is-active');
                    });
                }
                if (DOM.libraryTranslateProgressBar) DOM.libraryTranslateProgressBar.style.width = '0%';

                const updateProgress = () => {
                    if (activeToken !== translationGenerationToken) return;
                    const pct = Math.round((completed / total) * 100);
                    if (DOM.totalCount) {
                        DOM.totalCount.textContent = `Translating library - ${completed} / ${total} (${pct}%)`;
                    }
                    if (DOM.libraryTranslateProgressBar) {
                        DOM.libraryTranslateProgressBar.style.width = `${pct}%`;
                    }
                };

                updateProgress();

                const fetchTask = async (b) => {
                    const cacheKey = `${b.key}_${targetLang}`;
                    try {
                        const entries = await fetchWorkEditions(b.key, targetLang, b.edition_count);
                        if (activeToken !== translationGenerationToken) return;
                        if (Array.isArray(entries)) {
                            const validEditions = entries.filter(entry => {
                                if (!entry.languages) return false;
                                if (!isValidEditionForWork(entry, b.key)) return false;
                                return entry.languages.some(lang => {
                                    const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                                    return editionLangMatches(code, targetLang);
                                });
                            });
                            const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title, preferCovers, targetLang);
                            if (matchingEdition && matchingEdition.title) {
                                const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                                const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                                if (shouldReplaceTitle(b.title, fullTitle) && !isDuplicateTitle(fullTitle, b.key, targetLang)) {
                                    resolvedTitlesInActivePass.add(fullTitle.trim().toLowerCase());
                                    setTranslationCache(cacheKey, fullTitle, matchingEdition.localizedCoverId, matchingEdition.key);
                                    saveTranslationCache();
                                    b.title = fullTitle;
                                    if (preferCovers && matchingEdition.localizedCoverId) {
                                        b.cover_i = matchingEdition.localizedCoverId;
                                        coverPrewarmPromises.push(fetchCoverDataUrl(matchingEdition.localizedCoverId));
                                    }
                                } else {
                                    setTranslationCache(cacheKey, b.title, matchingEdition.localizedCoverId, matchingEdition.key);
                                    saveTranslationCache();
                                    if (preferCovers && matchingEdition.localizedCoverId) {
                                        coverPrewarmPromises.push(fetchCoverDataUrl(matchingEdition.localizedCoverId));
                                    }
                                }
                            } else {
                                // Valid API response received, but no matching foreign edition exists in OL -> cache original title as negative hit
                                setTranslationCache(cacheKey, b.original_title || b.title);
                                saveTranslationCache();
                            }
                        } else {
                            // 404 Not Found or Missing record in OL -> Negatively cache canonical title so we never retry a missing work
                            setTranslationCache(cacheKey, b.original_title || b.title);
                            saveTranslationCache();
                        }
                    } catch { } finally {
                        completed++;
                        updateProgress();
                    }
                };

                // Dispatch all tasks into the scheduler-managed queue without artificial caller sleeps
                await Promise.all(docsToTranslate.map(fetchTask));

                // Immediately flush persistent translation cache to IndexedDB
                saveTranslationCache(true);

                // Guarantee all in-flight cover downloads finish before rendering (0ms pop-in)
                if (coverPrewarmPromises.length > 0 && activeToken === translationGenerationToken) {
                    try {
                        await Promise.all(coverPrewarmPromises);
                    } catch { }
                }

                if (DOM.libraryTranslateProgress) {
                    DOM.libraryTranslateProgress.classList.remove('is-active');
                    setTimeout(() => {
                        if (DOM.libraryTranslateProgress) DOM.libraryTranslateProgress.style.display = 'none';
                    }, 300);
                }
            }
            renderSavedCollection(filtered);
        } else {
            // ASYNC Mode
            renderSavedCollection(filtered);
            syncCardTitles(filtered);
        }
    } else {
        // When no language filter is active or translation is toggled off,
        // ensure displayed titles and covers revert to their canonical original state
        filtered.forEach(b => {
            if (b.original_title) b.title = b.original_title;
            if (b.original_cover_i) b.cover_i = b.original_cover_i;
        });
        renderSavedCollection(filtered);
    }
};
export const modifyTagFilter = (tagValue, tagManager) => {
    const cleanValue = tagValue.trim();
    const currentTags = tagManager.getTags();
    const index = currentTags.findIndex(t => t.toLowerCase() === cleanValue.toLowerCase());
    let added = false;
    if (index > -1) {
        tagManager.removeTag(index);
    } else {
        tagManager.addTag(cleanValue);
        added = true;
    }
    return added;
};
export const showStageToast = (mode, tagText, added) => {
    const toast = document.createElement('div');
    toast.className = `stage-toast`;
    const actionLabel = added ? 'Added to' : 'Removed from';
    const modeLabel = mode === 'include' ? 'Include' : 'Exclude';
    const dotColor = added ? (mode === 'include' ? '#16a34a' : '#dc2626') : '#94a3b8';
    toast.innerHTML = `<span class="dot" style="background: ${dotColor};"></span><span class="toast-text">${actionLabel} ${modeLabel}: ${escapeHTML(tagText)}</span>`;
    toast.addEventListener('animationend', (e) => { if (e.animationName === 'toastOut') toast.remove(); });
    DOM.stageToasts.appendChild(toast);
    while (DOM.stageToasts.children.length > 2) DOM.stageToasts.removeChild(DOM.stageToasts.children[0]);
};
export const processTags = (tagArray, prefix, qArray) => {
    if (!tagArray || tagArray.length === 0) return;
    tagArray.forEach(t => {
        if (prefix.startsWith('-')) qArray.push(`-${prefix.slice(1)}:"${t}"`);
        else qArray.push(`+${prefix}:"${t}"`);
    });
};
export const mapSubjectWorkToDoc = (w) => ({
    key: w.key,
    title: w.title,
    author_name: w.authors ? w.authors.map(a => a.name) : ['Unknown Author'],
    cover_i: w.cover_id,
    first_publish_year: w.first_publish_year || 'N/A',
    subject: cleanSubjects(w.subject || []),
    edition_count: w.edition_count || 1,
    ratings_average: w.ratings_average || null,
    ratings_count: w.ratings_count || 0
});
export const DISCOVER_GENRES = ['Fantasy', 'Science Fiction', 'Mystery', 'Romance', 'History', 'Biography', 'Thriller', 'Classics', 'Horror', 'Adventure', 'Young Adult', 'Graphic Novels'];

export let cachedDiscoverSeedPromise = null;
export const fetchDiscoverSeed = async () => {
    // Legacy fallback: seed inlined by an older cached index.html
    if (typeof window !== 'undefined' && window.OLE_DISCOVER_SEED && Array.isArray(window.OLE_DISCOVER_SEED.trending)) {
        window.OLE_DISCOVER_SEED.trending.forEach(b => {
            if (b.subject) b.subject = cleanSubjects(b.subject);
        });
        return window.OLE_DISCOVER_SEED;
    }
    // Lazy path: fetch the static seed JSON only when Discover needs it,
    // so its ~120 KB never costs parse time on initial page boot.
    // The promise is shared so concurrent callers trigger a single request.
    if (!cachedDiscoverSeedPromise) {
        cachedDiscoverSeedPromise = fetch('./discover_seed.json', { cache: 'force-cache' })
            .then(res => {
                if (!res.ok) throw new Error(`seed HTTP ${res.status}`);
                return res.json();
            })
            .then(seed => {
                if (seed && Array.isArray(seed.trending) && seed.trending.length > 0) {
                    seed.trending.forEach(b => {
                        if (b.subject) b.subject = cleanSubjects(b.subject);
                    });
                    return seed;
                }
                throw new Error('seed malformed');
            })
            .catch(err => {
                console.warn('Discover seed unavailable, continuing without it:', err);
                cachedDiscoverSeedPromise = null; // allow retry on next visit
                return null;
            });
    }
    return cachedDiscoverSeedPromise;
};

export const fetchGenreShelves = async () => {
    if (cachedGenreShelves && typeof cachedGenreShelves === 'object' && Object.keys(cachedGenreShelves).length > 0) {
        return cachedGenreShelves;
    }
    const GENRES_KEY = 'ole_genre_shelves_cache_v3';
    const GENRES_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
    let isStale = false;
    try {
        const raw = await localforage.getItem(GENRES_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.timestamp > GENRES_TTL) isStale = true;
            else setCachedGenreShelves(parsed.data);
        } else {
            isStale = true;
        }
    } catch (e) {
        console.warn('Failed to read genre cache', e);
        isStale = true;
    }

    if (!cachedGenreShelves || isStale) {
        // Fast path: try fetching consolidated Discover bundle from Cloudflare proxy
        if (customProxyUrl) {
            const bundle = await fetchDiscoverBundleFromProxy();
            if (bundle && bundle.genres && Object.keys(bundle.genres).length > 0) {
                setCachedGenreShelves(bundle.genres);
                localforage.setItem(GENRES_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    data: cachedGenreShelves
                })).catch(() => { });
                // Also unpack trending if not yet loaded
                if (!cachedTrendingBooks && Array.isArray(bundle.trending) && bundle.trending.length > 0) {
                    bundle.trending.forEach(b => {
                        b.original_title = b.title;
                        if (b.subject) b.subject = cleanSubjects(b.subject);
                    });
                    setCachedTrendingBooks(bundle.trending);
                    const payload = JSON.stringify({ ts: Date.now(), books: cachedTrendingBooks });
                    localforage.setItem(TRENDING_KEY, payload).catch(() => { });
                    safeStorage.setItem(TRENDING_LS_KEY, payload);
                }
                return cachedGenreShelves;
            }
        }

        // Direct/fallback path: fetch all 12 genres in parallel
        try {
            const results = {};
            await Promise.all(DISCOVER_GENRES.map(async (genre) => {
                try {
                    const res = await fetchOpenLibrary(`${API_BASE}?q=subject:"${encodeURIComponent(genre.toLowerCase())}"+AND+ratings_count:[10+TO+*]&limit=5&sort=editions`, { passType: 'discovery' });
                    const data = await res.json();
                    results[genre] = (data.docs || []).slice(0, 5).map(d => ({
                        key: d.key,
                        title: d.title,
                        cover_i: d.cover_i,
                        author_name: d.author_name
                    }));
                } catch (err) {
                    console.error('Error fetching genre', genre, err);
                    results[genre] = [];
                }
            }));
            setCachedGenreShelves(results);
            try {
                await localforage.setItem(GENRES_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    data: cachedGenreShelves
                }));
            } catch (e) {
                console.warn('Failed to save genre cache', e);
            }
        } catch (e) {
            console.error('Failed to fetch genre shelves', e);
            if (!cachedGenreShelves) setCachedGenreShelves({});
        }
    }
    return cachedGenreShelves;
};

export const prewarmCachedGenreCovers = async () => {
    if (!cachedGenreShelves) {
        try {
            await fetchGenreShelves();
        } catch { }
    }
    if (typeof cachedGenreShelves !== 'object' || !cachedGenreShelves) return;
    const coverIds = [];
    Object.values(cachedGenreShelves).forEach(books => {
        if (Array.isArray(books)) {
            books.forEach(b => {
                if (b && (b.cover_i || b.cover_edition_key)) coverIds.push(b.cover_i || b.cover_edition_key);
            });
        }
    });
    if (coverIds.length === 0) return;

    // Fast parallel RAM warming from IndexedDB (reads all cached covers into RAM concurrently)
    const uncachedInRam = coverIds.filter(cid => !hasCoverInMemory(cid));
    if (uncachedInRam.length > 0) {
        await Promise.all(uncachedInRam.map(cid =>
            getCachedCoverDataUrl(cid)
                .then(dataUrl => { if (dataUrl) rememberCoverInMemory(cid, dataUrl); })
                .catch(() => { })
        ));
    }

    // Background pre-fetch for missing covers (fresh device / cold cache) without blocking UI
    const missingFromCache = coverIds.filter(cid => !hasCoverInMemory(cid));
    if (missingFromCache.length > 0) {
        missingFromCache.forEach(cid => {
            cacheCoverInBackground(cid);
        });
    }
};

export const prewarmCachedTrendingCovers = async () => {
    if (!Array.isArray(cachedTrendingBooks) || cachedTrendingBooks.length === 0) return;
    const coverIds = cachedTrendingBooks.map(b => b && (b.cover_i || b.cover_edition_key)).filter(Boolean);
    if (coverIds.length === 0) return;

    // Fast parallel RAM warming from IndexedDB (reads all cached trending covers into RAM concurrently)
    const uncachedInRam = coverIds.filter(cid => !hasCoverInMemory(cid));
    if (uncachedInRam.length > 0) {
        await Promise.all(uncachedInRam.map(cid =>
            getCachedCoverDataUrl(cid)
                .then(dataUrl => { if (dataUrl) rememberCoverInMemory(cid, dataUrl); })
                .catch(() => { })
        ));
    }
};
// IndexedDB is the primary store, but if it's corrupted, quota-blocked or
// disabled the app used to fall back to a cold network fetch on EVERY
// refresh (slow Home). A localStorage mirror keeps Home instant even when
// IndexedDB is unusable. Both writes are best-effort.

export const parseTrendingPayload = (raw) => {
    if (!raw) return null;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!parsed) return null;
        const ts = parsed.ts || parsed.timestamp;
        const books = parsed.books || parsed.data;
        if (!ts || !Array.isArray(books) || books.length === 0) return null;
        if (Date.now() - ts > TRENDING_TTL) return null;
        return { books: books, ts: ts, timestamp: ts };
    } catch {
        return null;
    }
};

export const renderDiscoverDashboard = async () => {
    initTranslationObserver();
    bumpSearchRequestToken(); // navigating away cancels any in-flight search
    DOM.status.style.display = 'none';
    DOM.grid.style.display = 'none';
    DOM.footer.style.display = 'none';
    DOM.resultsMeta.style.display = 'none';

    DOM.discoverDashboardToggles.style.display = 'flex';
    DOM.discoverDashboard.style.display = 'block';
    if (typeof updateSwipeHintVisibility === 'function') updateSwipeHintVisibility();

    // Setup the tabs
    if (currentDiscoverTab === 'trending') {
        DOM.toggleTrendingBtn.classList.add('active');
        DOM.toggleGenresBtn.classList.remove('active');

        const initialSkeletonsHtml = Array(12).fill(0).map(() => `
            <div class="skeleton-card">
                <div class="card-main">
                    <div class="skeleton-cover skeleton-anim"></div>
                    <div class="card-details" style="width:100%;">
                        <div class="skeleton-title skeleton-anim"></div>
                        <div class="skeleton-author skeleton-anim"></div>
                    </div>
                </div>
                <div class="skeleton-meta skeleton-anim"></div>
            </div>
        `).join('');

        DOM.discoverDashboard.innerHTML = `
            <div>
                <div id="featuredClassicsGrid" class="book-grid">
                    ${initialSkeletonsHtml}
                </div>
            </div>
        `;
    } else {
        DOM.toggleGenresBtn.classList.add('active');
        DOM.toggleTrendingBtn.classList.remove('active');

        DOM.discoverDashboard.innerHTML = `
            <div id="genreShelvesContainer" class="genre-grid"></div>
        `;
    }

    if (currentDiscoverTab === 'genres') {
        const shelvesContainer = document.getElementById('genreShelvesContainer');
        shelvesContainer.innerHTML = '<div style="opacity:0.6; padding:1rem;">Loading...</div>';
        updateToggleAllBtnState();

        const shelves = await fetchGenreShelves();
        if (currentDiscoverTab !== 'genres' || DOM.discoverDashboard.style.display === 'none') return;

        shelvesContainer.innerHTML = '';
        DISCOVER_GENRES.forEach(genre => {
            const books = shelves[genre] || [];
            const shelfDiv = document.createElement('div');
            shelfDiv.className = 'genre-shelf-container';
            shelfDiv.setAttribute('data-genre', genre);

            let coversHtml = '';
            books.forEach(b => {
                const cid = b.cover_i || b.cover_edition_key;
                if (cid) {
                    const cached = getCoverFromMemory(cid);
                    if (cached) {
                        // Instant synchronous memory hit: no async sequencer yield needed
                        coversHtml += `<img class="shelf-book-cover" src="${cached}" data-cover-id="${cid}" alt="Cover" />`;
                    } else {
                        // Pending img: the ordered loader assigns covers in order.
                        coversHtml += `<img class="shelf-book-cover cover-pending" data-cover-id="${cid}" alt="Cover" />`;
                    }
                }
            });

            shelfDiv.innerHTML = `
                <div class="shelf-covers">${coversHtml}</div>
                <div class="shelf-base"></div>
                <span class="genre-name">${genre}</span>
            `;
            shelvesContainer.appendChild(shelfDiv);

            shelfDiv.addEventListener('click', () => {
                tagManagerInc.clear();
                tagManagerInc.addTag(genre);
                if (currentViewMode === 'library') {
                    DOM.viewSavedBtn.click(); // switch back to search mode
                }
                performSearch(false);
            });
        });
        // Only run async hydration if there are uncached pending covers
        if (shelvesContainer.querySelector('img.cover-pending')) {
            hydrateCachedCovers(shelvesContainer);
        }
        updateToggleAllBtnState();
        return;
    }


    // Render featured books — check if the cache is expired even if stored in-memory
    const featuredGrid = document.getElementById('featuredClassicsGrid');
    featuredGrid.style.display = 'grid';
    // Apply current list/grid view mode
    if (DOM.grid.classList.contains('list-view')) featuredGrid.classList.add('list-view');
    else featuredGrid.classList.remove('list-view');
    const TRENDING_COUNT = 60;
    let isStale = false;
    let stored = null;
    if (!cachedTrendingBooks) {
        try {
            // Race a timeout so a hung IndexedDB read can't stall the
            // dashboard before skeletons even appear.
            const storedRaw = await Promise.race([
                localforage.getItem(TRENDING_KEY).catch(() => null),
                new Promise(resolve => setTimeout(() => resolve(null), 3000))
            ]);
            if (storedRaw) {
                stored = parseTrendingPayload(storedRaw);
                if (!stored) isStale = true; // expired or corrupt
            }
        } catch { }
        if (!stored) {
            // IndexedDB empty, corrupt or unreadable → try the localStorage mirror
            stored = parseTrendingPayload(safeStorage.getItem(TRENDING_LS_KEY));
        }
        if (isStale || !stored) {
            setCachedTrendingBooks(null);
            safeStorage.removeItem(TRENDING_LS_KEY);
            localforage.removeItem(TRENDING_KEY).catch(() => { });

            // Cold-start / first-time user: attempt instant seed load for 0ms Frame 1 rendering
            const seed = await fetchDiscoverSeed();
            if (seed && Array.isArray(seed.trending) && seed.trending.length > 0) {
                seed.trending.forEach(b => {
                    b.original_title = b.title;
                    if (b.subject) b.subject = cleanSubjects(b.subject);
                });
                setCachedTrendingBooks(seed.trending);
                if (!cachedGenreShelves && seed.genres) {
                    setCachedGenreShelves(seed.genres);
                    localforage.setItem('ole_genre_shelves_cache_v3', JSON.stringify({
                        timestamp: Date.now(),
                        data: cachedGenreShelves
                    })).catch(() => { });
                }
                // Silently refresh from Cloudflare proxy in background
                if (customProxyUrl) {
                    fetchDiscoverBundleFromProxy().then(bundle => {
                        if (bundle && Array.isArray(bundle.trending) && bundle.trending.length > 0) {
                            setCachedTrendingBooks(bundle.trending);
                            cachedTrendingBooks.forEach(b => {
                                b.original_title = b.title;
                                if (b.subject) b.subject = cleanSubjects(b.subject);
                            });
                            const payload = JSON.stringify({ ts: Date.now(), books: cachedTrendingBooks });
                            localforage.setItem(TRENDING_KEY, payload).catch(() => { });
                            safeStorage.setItem(TRENDING_LS_KEY, payload);
                            if (bundle.genres) {
                                setCachedGenreShelves(bundle.genres);
                                localforage.setItem('ole_genre_shelves_cache_v3', JSON.stringify({
                                    timestamp: Date.now(),
                                    data: cachedGenreShelves
                                })).catch(() => { });
                            }
                        }
                    });
                }
            }
        } else if (stored && Array.isArray(stored.books) && stored.books.length > 0) {
            let dirty = false;
            stored.books.forEach(b => {
                b.original_title = b.title;
                if (b.subject) {
                    const cleaned = cleanSubjects(b.subject);
                    if (JSON.stringify(cleaned) !== JSON.stringify(b.subject)) {
                        b.subject = cleaned;
                        dirty = true;
                    }
                }
            });
            setCachedTrendingBooks(stored.books);
            if (dirty) {
                const payload = JSON.stringify({ ts: stored.ts || Date.now(), books: cachedTrendingBooks });
                localforage.setItem(TRENDING_KEY, payload).catch(() => { });
                safeStorage.setItem(TRENDING_LS_KEY, payload);
            }
        }
    }
    if (cachedTrendingBooks) {
        featuredGrid.innerHTML = '';
        const fragment = document.createDocumentFragment();
        cachedTrendingBooks.forEach((b, idx) => {
            const card = buildCard(b, false, null);
            card.style.setProperty('--card-index', idx);
            fragment.appendChild(card);
        });
        featuredGrid.appendChild(fragment);
        hydrateCachedCovers(featuredGrid);
        syncCardTitles(cachedTrendingBooks);
        prefetchTrendingSynopses(cachedTrendingBooks);
        updateToggleAllBtnState();
        return;
    }
    const skeletonFragment = document.createDocumentFragment();
    for (let i = 0; i < TRENDING_COUNT; i++) {
        const s = document.createElement('div');
        s.className = 'skeleton-card';
        s.innerHTML = `
            <div class="card-main">
                <div class="skeleton-cover skeleton-anim"></div>
                <div class="card-details" style="width:100%;">
                    <div class="skeleton-title skeleton-anim"></div>
                    <div class="skeleton-author skeleton-anim"></div>
                </div>
            </div>
            <div class="skeleton-meta skeleton-anim"></div>
        `;
        skeletonFragment.appendChild(s);
    }
    featuredGrid.appendChild(skeletonFragment);
    try {
        let merged = [];
        if (customProxyUrl) {
            const bundle = await fetchDiscoverBundleFromProxy();
            if (bundle && Array.isArray(bundle.trending) && bundle.trending.length > 0) {
                merged = bundle.trending;
                if (bundle.genres && !cachedGenreShelves) {
                    setCachedGenreShelves(bundle.genres);
                    localforage.setItem('ole_genre_shelves_cache_v3', JSON.stringify({
                        timestamp: Date.now(),
                        data: cachedGenreShelves
                    })).catch(() => { });
                }
            }
        }

        if (merged.length === 0) {
            const sharedFields = 'key,title,author_name,cover_i,first_publish_year,subject,place,edition_count,ratings_average,ratings_count,cover_edition_key,language,person';
            const currentYear = new Date().getFullYear();
            const recentSince = currentYear - 6;
            // Two pools fetched in parallel:
            // 1) Long-standing, widely-read books (proven classics/staples)
            // 2) Recently published books that are currently well-rated and being read now (actually trendy)
            const [classicsResponse, recentResponse] = await Promise.all([
                fetchOpenLibrary(`${API_BASE}?q=ratings_count:[100+TO+*]&limit=36&sort=editions&fields=${sharedFields}&contact=${API_CONTACT_EMAIL}`, { passType: 'discovery' }),
                fetchOpenLibrary(`${API_BASE}?q=first_publish_year:[${recentSince}+TO+${currentYear}]+AND+ratings_count:[20+TO+*]&limit=36&sort=rating&fields=${sharedFields}&contact=${API_CONTACT_EMAIL}`, { passType: 'discovery' })
            ]);
            if (!classicsResponse.ok && !recentResponse.ok) throw new Error();
            const classicsData = classicsResponse.ok ? await classicsResponse.json() : { docs: [] };
            const recentData = recentResponse.ok ? await recentResponse.json() : { docs: [] };
            const classicsDocs = classicsData.docs || [];
            const recentDocs = recentData.docs || [];

            // Interleave the two pools (recent first, since that's the "trendier" signal) and dedupe by work key
            const seenKeys = new Set();
            const maxLen = Math.max(classicsDocs.length, recentDocs.length);
            for (let i = 0; i < maxLen && merged.length < TRENDING_COUNT; i++) {
                if (recentDocs[i] && !seenKeys.has(recentDocs[i].key)) {
                    seenKeys.add(recentDocs[i].key);
                    merged.push(recentDocs[i]);
                }
                if (merged.length >= TRENDING_COUNT) break;
                if (classicsDocs[i] && !seenKeys.has(classicsDocs[i].key)) {
                    seenKeys.add(classicsDocs[i].key);
                    merged.push(classicsDocs[i]);
                }
            }
        }

        featuredGrid.innerHTML = '';
        if (merged.length === 0) {
            featuredGrid.innerHTML = '<div style="opacity: 0.6; font-style: italic; padding: 1rem 0;">No trending books available at the moment.</div>';
            return;
        }
        setCachedTrendingBooks(merged.slice(0, TRENDING_COUNT));
        // Clean subjects before caching and preserve original title
        cachedTrendingBooks.forEach(b => {
            b.original_title = b.title;
            if (b.subject) b.subject = cleanSubjects(b.subject);
        });
        const booksFragment = document.createDocumentFragment();
        cachedTrendingBooks.forEach((b, idx) => {
            const card = buildCard(b, false, null);
            card.style.setProperty('--card-index', idx);
            booksFragment.appendChild(card);
        });
        featuredGrid.appendChild(booksFragment);
        hydrateCachedCovers(featuredGrid);
        // Persist AFTER rendering (fire-and-forget, no await): in private/
        // incognito windows an IndexedDB write can stall, and blocking on it
        // here used to delay the first cover fetches until the user pressed
        // Home. Storage is an optimization - never gate rendering on it.
        (async () => {
            try {
                const payload = JSON.stringify({ ts: Date.now(), books: cachedTrendingBooks });
                await localforage.setItem(TRENDING_KEY, payload);
                safeStorage.setItem(TRENDING_LS_KEY, payload);
            } catch { /* ignore */ }
        })();
        // Background sync trending titles and prefetch synopses if needed
        syncCardTitles(cachedTrendingBooks);
        prefetchTrendingSynopses(cachedTrendingBooks);
        updateToggleAllBtnState();
    } catch {
        featuredGrid.innerHTML = '<div style="opacity: 0.6; font-style: italic; padding: 1rem 0;">Failed to load trending books. Check your connection.</div>';
    }
};
export const cleanLibraryForExport = (books) => {
    return books.map(b => {
        let cleanKey = b.key || '';
        if (cleanKey && !cleanKey.startsWith('/')) {
            if (cleanKey.startsWith('OL') && cleanKey.endsWith('W')) cleanKey = `/works/${cleanKey}`;
            else if (cleanKey.startsWith('OL') && cleanKey.endsWith('M')) cleanKey = `/books/${cleanKey}`;
            else cleanKey = `/${cleanKey}`;
        }
        const cleanEdition = b.cover_edition_key ? String(b.cover_edition_key).replace(/^\/books\//, '') : null;
        const cleanCoverI = b.cover_i && parseInt(b.cover_i) > 0 ? parseInt(b.cover_i) : null;
        return {
            key: cleanKey,
            title: b.title || 'Untitled Work',
            original_title: b.original_title || b.title || 'Untitled Work',
            author_name: Array.isArray(b.author_name) ? b.author_name : [b.author_name || 'Unknown Author'],
            cover_i: cleanCoverI,
            original_cover_i: b.original_cover_i && parseInt(b.original_cover_i) > 0 ? parseInt(b.original_cover_i) : cleanCoverI,
            cover_edition_key: cleanEdition,
            first_publish_year: b.first_publish_year || 'N/A',
            subject: Array.isArray(b.subject) ? b.subject : [],
            place: Array.isArray(b.place) ? b.place : [],
            person: Array.isArray(b.person) ? b.person : [],
            language: Array.isArray(b.language) ? b.language : [],
            ratings_average: b.ratings_average != null ? parseFloat(b.ratings_average) : null,
            ratings_count: parseInt(b.ratings_count) || 0,
            edition_count: parseInt(b.edition_count) || 1,
            savedAt: parseInt(b.savedAt) || Date.now()
        };
    });
};

export const downloadFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
};

export const showImportStatus = (msg, isError = false) => {
    if (!DOM.importStatusMsg) return;
    DOM.importStatusMsg.textContent = msg;
    DOM.importStatusMsg.style.display = 'block';
    DOM.importStatusMsg.style.background = isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)';
    DOM.importStatusMsg.style.color = isError ? '#ef4444' : 'var(--text)';
    setTimeout(() => {
        if (DOM.importStatusMsg) DOM.importStatusMsg.style.display = 'none';
    }, 4000);
};

export const exportLibraryJSON = () => {
    if (library.length === 0) {
        showImportStatus("Your library is currently empty.", true);
        return;
    }
    const exportData = {
        app: "OpenLibrary Explorer",
        version: "1.7b",
        exportedAt: new Date().toISOString(),
        count: library.length,
        library: cleanLibraryForExport(library)
    };
    downloadFile(JSON.stringify(exportData, null, 2), `openlibrary_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8');
};

export const exportLibraryCSV = () => {
    if (library.length === 0) {
        showImportStatus("Your library is currently empty.", true);
        return;
    }
    const escapeCSV = (val) => {
        if (val === null || val === undefined) return '""';
        let str = String(val);
        if (Array.isArray(val)) str = val.join('; ');
        str = str.replace(/"/g, '""');
        return `"${str}"`;
    };
    const headers = ['key', 'title', 'original_title', 'author_name', 'cover_i', 'cover_edition_key', 'first_publish_year', 'ratings_average', 'ratings_count', 'edition_count', 'subject', 'place', 'person', 'language', 'savedAt'];
    const rows = [headers.join(',')];
    library.forEach(b => {
        const cleanKey = b.key && !b.key.startsWith('/') && b.key.startsWith('OL') && b.key.endsWith('W') ? `/works/${b.key}` : b.key;
        const cleanEdition = b.cover_edition_key ? String(b.cover_edition_key).replace(/^\/books\//, '') : '';
        rows.push([
            escapeCSV(cleanKey),
            escapeCSV(b.title),
            escapeCSV(b.original_title),
            escapeCSV(b.author_name),
            escapeCSV(b.cover_i),
            escapeCSV(cleanEdition),
            escapeCSV(b.first_publish_year),
            escapeCSV(b.ratings_average),
            escapeCSV(b.ratings_count),
            escapeCSV(b.edition_count),
            escapeCSV(b.subject),
            escapeCSV(b.place),
            escapeCSV(b.person),
            escapeCSV(b.language),
            escapeCSV(b.savedAt)
        ].join(','));
    });
    downloadFile(rows.join('\n'), `openlibrary_backup_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
};

export const parseImportCSV = (csvText) => {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < csvText.length) {
        const char = csvText[i];
        const nextChar = csvText[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    currentField += '"';
                    i += 2;
                    continue;
                } else {
                    inQuotes = false;
                    i++;
                    continue;
                }
            } else {
                currentField += char;
                i++;
                continue;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
                i++;
                continue;
            } else if (char === ',') {
                currentRow.push(currentField.trim());
                currentField = '';
                i++;
                continue;
            } else if (char === '\r' || char === '\n') {
                currentRow.push(currentField.trim());
                currentField = '';
                if (currentRow.some(f => f.length > 0)) {
                    rows.push(currentRow);
                }
                currentRow = [];
                if (char === '\r' && nextChar === '\n') i++;
                i++;
                continue;
            } else {
                currentField += char;
                i++;
                continue;
            }
        }
    }
    if (currentField.length > 0 || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f.length > 0)) {
            rows.push(currentRow);
        }
    }

    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.toLowerCase().trim().replace(/[^a-z0-9_]/g, ''));
    const result = [];

    const getCol = (row, ...aliases) => {
        for (const alias of aliases) {
            const idx = headers.indexOf(alias);
            if (idx > -1 && row[idx] !== undefined && row[idx] !== '') return row[idx];
        }
        return '';
    };

    const parseList = (str) => {
        if (!str) return [];
        const delimiter = str.includes(';') ? ';' : ',';
        return str.split(delimiter).map(s => s.trim()).filter(Boolean);
    };

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const rawKey = getCol(row, 'key', 'work_key', 'work', 'olid', 'book_id', 'id');
        const rawTitle = getCol(row, 'title', 'book_title', 'name', 'work_title');
        const rawOrigTitle = getCol(row, 'original_title', 'orig_title', 'originaltitle') || rawTitle;
        const rawAuthor = getCol(row, 'author_name', 'author', 'authors', 'author_names');
        const rawCoverI = getCol(row, 'cover_i', 'cover_id', 'cover', 'coverid');
        const rawCoverEd = getCol(row, 'cover_edition_key', 'edition_key', 'edition', 'coveredition');
        const rawYear = getCol(row, 'first_publish_year', 'publish_year', 'year', 'published', 'date');
        const rawRating = getCol(row, 'ratings_average', 'rating', 'average_rating', 'stars');
        const rawRatingsCount = getCol(row, 'ratings_count', 'ratings', 'num_ratings');
        const rawEditionCount = getCol(row, 'edition_count', 'editions', 'num_editions');
        const rawSubject = getCol(row, 'subject', 'subjects', 'genres', 'tags', 'categories', 'bookshelves');
        const rawPlace = getCol(row, 'place', 'places', 'locations');
        const rawPerson = getCol(row, 'person', 'persons', 'characters');
        const rawLang = getCol(row, 'language', 'languages', 'lang', 'langs');
        const rawSavedAt = getCol(row, 'savedat', 'saved_at', 'date_added', 'added_at', 'created_at');

        if (rawKey || rawTitle) {
            result.push({
                key: rawKey,
                title: rawTitle,
                original_title: rawOrigTitle,
                author_name: parseList(rawAuthor),
                cover_i: rawCoverI ? (parseInt(rawCoverI) || null) : null,
                cover_edition_key: rawCoverEd || null,
                first_publish_year: parseInt(rawYear) || rawYear || 'N/A',
                ratings_average: parseFloat(rawRating) || null,
                ratings_count: parseInt(rawRatingsCount) || 0,
                edition_count: parseInt(rawEditionCount) || 1,
                subject: parseList(rawSubject),
                place: parseList(rawPlace),
                person: parseList(rawPerson),
                language: parseList(rawLang),
                savedAt: parseInt(rawSavedAt) || Date.now()
            });
        }
    }
    return result;
};

export const handleImportFile = async (file) => {
    if (!file) return;
    try {
        const text = await file.text();
        let importedDocs = [];
        if (file.name.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
            const parsed = JSON.parse(text);
            importedDocs = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.library) ? parsed.library : []);
        } else {
            importedDocs = parseImportCSV(text);
        }

        if (importedDocs.length === 0) {
            showImportStatus("No valid books found in the selected file.", true);
            return;
        }

        let addedCount = 0;
        let updatedCount = 0;
        importedDocs.forEach(item => {
            if (!item.key && !item.title) return;
            const validDoc = createLibraryDoc(item);
            if (!validDoc.key) {
                // If key is totally missing, generate a local collision-free fallback key based on title + author + unique token
                const rawTitle = validDoc.title || item.title || 'Untitled';
                const normTitle = String(rawTitle).toLowerCase().replace(/[^a-z0-9]/g, '') || 'untitled';
                const rawAuthor = Array.isArray(validDoc.author_name) ? validDoc.author_name[0] : (validDoc.author_name || '');
                const normAuthor = String(rawAuthor).toLowerCase().replace(/[^a-z0-9]/g, '');
                const uniqueSuffix = Math.random().toString(36).substring(2, 7);
                validDoc.key = `/works/LOCAL_${normTitle}${normAuthor ? '_' + normAuthor : ''}_${uniqueSuffix}`;
            }
            const existingIdx = library.findIndex(b => b.key === validDoc.key);
            if (existingIdx > -1) {
                library[existingIdx] = validDoc;
                updatedCount++;
            } else {
                library.push(validDoc);
                addedCount++;
            }
        });

        setCachedSubjectCounts(null);
        setCachedLocalFilteredBooks(null);
        syncLibraryKeySet();
        await localforage.setItem('ole_bookmarks', library);
        updateLibraryBadge();
        if (currentViewMode === 'library') applyLocalFilters();
        showImportStatus(`Imported ${addedCount} new, updated ${updatedCount} books!`);

        // Asynchronously resolve missing covers for any imported books lacking cover IDs
        library.forEach(b => {
            if (!b.cover_i && !b.cover_edition_key && b.key) {
                resolveMissingCover(b);
            }
        });
    } catch (err) {
        console.error('Import error:', err);
        showImportStatus("Failed to parse the backup file.", true);
    }
};
// Search-query state: owned here — performSearch is the sole writer of every
// binding below (reset wiring only touches currentPage/allDisplayedDocs,
// which stay hub-owned). The hub imports what its wiring/boot reads.
// Catalog Search Result Deduplication (by normalized title + primary author)
export const getDocRichnessScore = (doc) => {
    if (!doc) return 0;
    let score = 0;
    if ((doc.ratings_count || 0) > 0) score += 10;
    if (doc.ratings_average != null && doc.ratings_average > 0) score += 2;
    if (doc.cover_i && doc.cover_i > 0) score += 5;
    score += Math.min(doc.edition_count || 0, 20);
    score += Math.min(Array.isArray(doc.subject) ? doc.subject.length : 0, 10);
    return score;
};

export const mergeDocMetadata = (target, incoming) => {
    if (!target || !incoming) return;
    // Ratings
    if ((!target.ratings_count || target.ratings_count === 0) && (incoming.ratings_count || 0) > 0) {
        target.ratings_count = incoming.ratings_count;
        target.ratings_average = incoming.ratings_average;
    }
    // Cover
    if ((!target.cover_i || target.cover_i <= 0) && incoming.cover_i && incoming.cover_i > 0) {
        target.cover_i = incoming.cover_i;
        target.cover_edition_key = incoming.cover_edition_key;
    }
    // Subjects union
    if (Array.isArray(incoming.subject) && incoming.subject.length > 0) {
        target.subject = cleanSubjects([...(Array.isArray(target.subject) ? target.subject : []), ...incoming.subject]);
    }
    // Edition count
    target.edition_count = Math.max(target.edition_count || 1, incoming.edition_count || 1);
    // Earliest publish year
    if (!target.first_publish_year || (incoming.first_publish_year && incoming.first_publish_year < target.first_publish_year)) {
        target.first_publish_year = incoming.first_publish_year;
    }
    // Languages union
    if (Array.isArray(incoming.language) && incoming.language.length > 0) {
        const set = new Set([...(Array.isArray(target.language) ? target.language : []), ...incoming.language]);
        target.language = Array.from(set);
    }
};

export const deduplicateSearchDocs = (docs, existingDocs = []) => {
    if (!Array.isArray(docs) || docs.length === 0) return [];

    const existingKeyMap = new Map();
    if (Array.isArray(existingDocs) && existingDocs.length > 0) {
        existingDocs.forEach(d => {
            const title = (d.title || d.original_title || '').trim().toLowerCase().replace(/[:\-\s]+/g, ' ');
            const author = (d.author_name && d.author_name[0]) ? d.author_name[0].trim().toLowerCase() : '';
            if (title && author) {
                existingKeyMap.set(`${title}:::${author}`, d);
            }
        });
    }

    const deduped = [];
    const batchKeyMap = new Map();

    docs.forEach(doc => {
        const title = (doc.title || doc.original_title || '').trim().toLowerCase().replace(/[:\-\s]+/g, ' ');
        const author = (doc.author_name && doc.author_name[0]) ? doc.author_name[0].trim().toLowerCase() : '';

        // Fallback to individual record if no author or no title to prevent false merges of anonymous works
        if (!title || !author) {
            deduped.push(doc);
            return;
        }

        const compKey = `${title}:::${author}`;

        // 1. Cross-page check: if already displayed in previous pages
        if (existingKeyMap.has(compKey)) {
            const existing = existingKeyMap.get(compKey);
            mergeDocMetadata(existing, doc);
            return; // Omit duplicate from current page batch
        }

        // 2. Intra-batch check: if already seen in current batch
        if (batchKeyMap.has(compKey)) {
            const prior = batchKeyMap.get(compKey);
            const priorScore = getDocRichnessScore(prior);
            const currentScore = getDocRichnessScore(doc);

            if (currentScore > priorScore) {
                mergeDocMetadata(doc, prior);
                const idx = deduped.indexOf(prior);
                if (idx !== -1) {
                    deduped[idx] = doc;
                }
                batchKeyMap.set(compKey, doc);
            } else {
                mergeDocMetadata(prior, doc);
            }
            return;
        }

        batchKeyMap.set(compKey, doc);
        deduped.push(doc);
    });

    return deduped;
};

export let searchRequestToken = 0;
export const bumpSearchRequestToken = () => ++searchRequestToken;
export let currentTotalHidden = 0;
export let activeQueryParams = new URLSearchParams();
// Page size of the in-flight search query. Single source of truth for the
// "Find More Books" visibility math: the fetch uses 50 when the custom
// limit is off (see performSearch), so display paths must never assume the
// slider default of 100 — that mismatch hid the button on every default
// search. Set on fresh searches only; load-more pages reuse the original
// query (and its limit) verbatim.
export let lastFetchLimit = 50;
export let activeMinStar = 0;
export let activeMinRCount = 0;
export let activeSort = 'relevance';
export let lastSearchTimingHTML = '';
export let fetchTimerInterval = null;
export const performSearch = async (isLoadMore = false) => {
    if (!isLoadMore) collapseMobileSidebarIfOpen();
    resolvedTitlesInActivePass.clear();
    if (currentViewMode === 'library') return;
    if (!isLoadMore && !hasActiveSearchCriteria()) return;
    // A query is going through: collapse the sidebar for results width.
    // (Library live-filtering returns above, so it never collapses there.)
    if (!isLoadMore) collapseSidebarForSearch();
    if (!isLoadMore) {
        translationQueue.clear();
        initTranslationObserver();
        setCurrentPage(1);
        currentTotalHidden = 0;
        setAllDisplayedDocs([]);
        activeSort = DOM.sort.value;
        DOM.footer.style.display = 'none';
        DOM.resultsMeta.style.display = 'none';
        let qParts = [];
        processTags(tagManagerInc.getTags(), 'subject', qParts);
        processTags(tokenize(DOM.incPlace.value), 'place', qParts);
        processTags(tokenize(DOM.incPerson.value), 'person', qParts);
        processTags(tokenize(DOM.incLang.value), 'language', qParts);
        processTags(tagManagerExc.getTags(), '-subject', qParts);
        processTags(tokenize(DOM.excPlace.value), '-place', qParts);
        processTags(tokenize(DOM.excPerson.value), '-person', qParts);
        processTags(tokenize(DOM.excLang.value), '-language', qParts);
        if (DOM.incTitle.value.trim()) qParts.push(`+title:"${DOM.incTitle.value.trim()}"`);
        if (DOM.incAuthor.value.trim()) qParts.push(`+author:"${DOM.incAuthor.value.trim()}"`);
        if (DOM.globalSearchInput.value.trim()) qParts.push(DOM.globalSearchInput.value.trim());
        DOM.discoverDashboard.style.display = 'none';
        DOM.discoverDashboardToggles.style.display = 'none';
        if (typeof updateSwipeHintVisibility === 'function') updateSwipeHintVisibility();
        const min = DOM.minY.value.trim() || '*';
        const max = DOM.maxY.value.trim() || '*';
        if (min !== '*' || max !== '*') qParts.push(`+first_publish_year:[${min} TO ${max}]`);
        activeMinStar = parseFloat(DOM.minStarRating.value) || 0;
        activeMinRCount = parseInt(DOM.minRatings.value) || 0;
        // Min Reviews maps directly to the indexed ratings_count field, so it's pushed
        // server-side. Min Rating (ratings_average) has no matching indexed/rangeable
        // field on the API, so it's always filtered client-side further below.
        if (activeMinRCount > 0) {
            qParts.push(`+ratings_count:[${activeMinRCount} TO *]`);
        }
        activeQueryParams = new URLSearchParams();
        // Join with spaces. The + and - prefixes natively enforce the strict Boolean logic.
        activeQueryParams.append('q', qParts.length > 0 ? qParts.join(' ') : '*');
        let apiSort = activeSort;
        if (apiSort === 'rating') {
            // 'rating' is a genuine, supported sort facet (sorts by ratings_sortable).
            apiSort = sortDirection === 'asc' ? 'rating asc' : 'rating desc';
        } else if (apiSort === 'reviews') {
            // No indexed sort facet exists for ratings_count/review count — this always
            // stays a client-side sort of the fetched page.
            apiSort = 'editions';
        } else if (apiSort === 'new') apiSort = sortDirection === 'desc' ? 'new' : 'old';
        if (apiSort !== 'relevance') {
            activeQueryParams.append('sort', apiSort);
        }
        // Apply custom limit if toggled, otherwise default to 50 for ultra-fast query times
        let currentLimit = '50';
        if (DOM.customLimitToggle.checked) {
            currentLimit = DOM.fetchLimitSlider.value;
        }
        activeQueryParams.append('limit', currentLimit);
        lastFetchLimit = parseInt(currentLimit, 10) || 50;

        const needsPlace = !!(DOM.incPlace.value.trim() || DOM.excPlace.value.trim());
        const needsPerson = !!(DOM.incPerson.value.trim() || DOM.excPerson.value.trim());
        const searchFields = [
            'key', 'title', 'author_name', 'cover_i', 'first_publish_year', 'subject',
            'edition_count', 'ratings_average', 'ratings_count', 'cover_edition_key', 'language'
        ];
        if (needsPlace) searchFields.push('place');
        if (needsPerson) searchFields.push('person');

        activeQueryParams.append('fields', searchFields.join(','));
        activeQueryParams.append('contact', API_CONTACT_EMAIL);
        saveStateToHash(true);
    } else {
        setCurrentPage(currentPage + 1);
    }
    activeQueryParams.set('page', currentPage);
    const requestToken = ++searchRequestToken;
    injectSkeletonScreen(isLoadMore);
    const currentSortDir = sortDirection;
    // Fetch feedback: start elapsed timer
    clearInterval(fetchTimerInterval);
    const fetchStartTime = performance.now();
    DOM.resultsMeta.style.display = 'flex';
    DOM.querySpeedContainer.style.display = 'inline-flex'; // Always show the count during query
    lastSearchTimingHTML = '';
    DOM.querySpeedTooltip.innerHTML = ''; // Clear tooltip while querying (no hover data yet)
    DOM.totalCount.style.cursor = 'default'; // No tooltip yet, no help cursor
    DOM.totalCount.textContent = ''; // Clear totalCount
    DOM.fetchStatus.style.opacity = ''; // Reset opacity so it's fully visible at the start of search
    DOM.fetchStatus.textContent = 'Querying OpenLibrary...';
    fetchTimerInterval = setInterval(() => {
        const elapsed = ((performance.now() - fetchStartTime) / 1000).toFixed(1);
        DOM.fetchStatus.textContent = `Querying OpenLibrary... (${elapsed}s)`;
    }, 100);
    if (isLoadMore) {
        DOM.loadMoreBtn.disabled = true;
        DOM.loadMoreBtn.textContent = 'Loading...';
    } else {
        DOM.btn.disabled = true;
        DOM.btn.textContent = 'Searching...';
    }
    let queryTime = 0;
    let processingTime = 0;
    let renderTime = 0;
    const totalStartTime = performance.now();
    try {
        const response = await fetchOpenLibrary(`${API_BASE}?${activeQueryParams.toString()}`, { passType: 'search' });
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data = await response.json();
        // A newer search superseded this one -- don't render stale results.
        if (requestToken !== searchRequestToken) return;
        queryTime = (performance.now() - fetchStartTime) / 1000;
        clearInterval(fetchTimerInterval);
        // Start Processing Phase
        const procStartTime = performance.now();
        DOM.fetchStatus.textContent = 'Processing results... (0.0s)';
        fetchTimerInterval = setInterval(() => {
            const elapsed = ((performance.now() - procStartTime) / 1000).toFixed(1);
            DOM.fetchStatus.textContent = `Processing results... (${elapsed}s)`;
        }, 100);
        setLastSearchTotalFound(data.numFound || 0);
        const rawDocs = data.docs || [];
        apiTelemetry.recordSearchDocs(rawDocs.length);
        rawDocs.forEach(d => {
            d.original_title = d.title;
            if (d.subject) d.subject = cleanSubjects(d.subject);
        });
        const docs = deduplicateSearchDocs(rawDocs, isLoadMore ? allDisplayedDocs : []);
        const filteredDocs = docs.filter(b => {
            const avg = b.ratings_average || 0;
            const count = b.ratings_count || 0;
            if (activeMinStar > 0 && avg < activeMinStar) return false;
            if (activeMinRCount > 0 && count < activeMinRCount) return false;
            return true;
        });
        const hiddenInBatch = docs.length - filteredDocs.length;
        currentTotalHidden += hiddenInBatch;
        // Translation Sub-step inside Processing
        const targetLang = getExplicitTargetLang();
        const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
        // Gated on an explicit language filter: with no filter set the titles
        // are already canonical and any swap pass only degrades them.
        if (isTransEnabled && targetLang) {
            const preferCovers = isTranslateCoversEnabled();
            // Apply cached title and cover updates first
            filteredDocs.forEach(b => {
                const cacheKey = `${b.key}_${targetLang}`;
                if (translationCache.has(cacheKey)) {
                    apiTelemetry.recordCacheHit('ram', 'title');
                    b.title = translationCache.get(cacheKey);
                }
                if (preferCovers && translationCoverCache.has(cacheKey)) {
                    apiTelemetry.recordCacheHit('ram', 'cover');
                    const cov = translationCoverCache.get(cacheKey);
                    if (cov && cov.cover_i && cov.cover_i > 0) b.cover_i = cov.cover_i;
                }
            });
            const isSyncMode = DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked;
            if (isSyncMode) {
                const docsToTranslate = filteredDocs.filter(b => needsTranslation(b, targetLang));
                if (docsToTranslate.length > 0) {
                    // Stop the "Processing results... (Ns)" ticker so it doesn't fight with
                    // the translation progress text below and cause flicker.
                    clearInterval(fetchTimerInterval);
                    const total = filteredDocs.length;
                    let completed = filteredDocs.filter(b => !needsTranslation(b, targetLang)).length;
                    const coverPrewarmPromises = [];

                    if (DOM.libraryTranslateProgress) {
                        DOM.libraryTranslateProgress.style.display = 'block';
                        requestAnimationFrame(() => {
                            if (DOM.libraryTranslateProgress) DOM.libraryTranslateProgress.classList.add('is-active');
                        });
                    }
                    const initialPct = Math.round((completed / total) * 100);
                    if (DOM.libraryTranslateProgressBar) DOM.libraryTranslateProgressBar.style.width = `${initialPct}%`;

                    DOM.fetchStatus.textContent = `Translating titles - ${completed} / ${total} (${initialPct}%)`;
                    const fetchTask = async (b) => {
                        const cacheKey = `${b.key}_${targetLang}`;
                        try {
                            const entries = await fetchWorkEditions(b.key, targetLang, b.edition_count);
                            if (Array.isArray(entries)) {
                                const validEditions = entries.filter(entry => {
                                    if (!entry.languages) return false;
                                    if (!isValidEditionForWork(entry, b.key)) return false;
                                    return entry.languages.some(lang => {
                                        const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                                        return editionLangMatches(code, targetLang);
                                    });
                                });
                                const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title, preferCovers, targetLang);
                                if (matchingEdition && matchingEdition.title) {
                                    const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                                    const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                                    if (shouldReplaceTitle(b.title, fullTitle) && !isDuplicateTitle(fullTitle, b.key, targetLang)) {
                                        resolvedTitlesInActivePass.add(fullTitle.trim().toLowerCase());
                                        setTranslationCache(cacheKey, fullTitle, matchingEdition.localizedCoverId, matchingEdition.key);
                                        saveTranslationCache();
                                        if (fullTitle !== b.title) {
                                            b.title = fullTitle;
                                        }
                                        if (preferCovers && matchingEdition.localizedCoverId) {
                                            b.cover_i = matchingEdition.localizedCoverId;
                                            coverPrewarmPromises.push(fetchCoverDataUrl(matchingEdition.localizedCoverId));
                                        }
                                    } else {
                                        setTranslationCache(cacheKey, b.title, matchingEdition.localizedCoverId, matchingEdition.key);
                                        saveTranslationCache();
                                        if (preferCovers && matchingEdition.localizedCoverId) {
                                            coverPrewarmPromises.push(fetchCoverDataUrl(matchingEdition.localizedCoverId));
                                        }
                                    }
                                } else {
                                    // Valid API response received, but no matching foreign edition exists in OL -> cache original title as negative hit
                                    setTranslationCache(cacheKey, b.original_title || b.title);
                                    saveTranslationCache();
                                }
                            } else {
                                // 404 Not Found or Missing record in OL -> Negatively cache canonical title so we never retry a missing work
                                setTranslationCache(cacheKey, b.original_title || b.title);
                                saveTranslationCache();
                            }
                        } catch { } finally {
                            completed++;
                            const pct = Math.round((completed / total) * 100);
                            DOM.fetchStatus.textContent = `Translating titles - ${completed} / ${total} (${pct}%)`;
                            if (DOM.libraryTranslateProgressBar) {
                                DOM.libraryTranslateProgressBar.style.width = `${pct}%`;
                            }
                        }
                    };

                    // Dispatch all tasks into the scheduler-managed queue without artificial caller sleeps
                    await Promise.all(docsToTranslate.map(fetchTask));

                    // Immediately flush persistent translation cache to IndexedDB
                    saveTranslationCache(true);

                    // Guarantee all in-flight cover downloads finish before rendering (0ms pop-in)
                    if (coverPrewarmPromises.length > 0) {
                        try {
                            await Promise.all(coverPrewarmPromises);
                        } catch { }
                    }

                    if (DOM.libraryTranslateProgress) {
                        DOM.libraryTranslateProgress.classList.remove('is-active');
                        setTimeout(() => {
                            if (DOM.libraryTranslateProgress) DOM.libraryTranslateProgress.style.display = 'none';
                        }, 300);
                    }
                }
            }
        }
        if (requestToken !== searchRequestToken || currentViewMode !== 'search') {
            clearInterval(fetchTimerInterval);
            return;
        }
        const newStartIdx = allDisplayedDocs.length;
        setAllDisplayedDocs(allDisplayedDocs.concat(filteredDocs));
        const needsFullRerender = (activeSort === 'rating' || activeSort === 'reviews');
        if (activeSort === 'rating') {
            allDisplayedDocs.sort((a, b) => (currentSortDir === 'desc' ? 1 : -1) * ((b.ratings_average || 0) - (a.ratings_average || 0)));
        } else if (activeSort === 'reviews') {
            allDisplayedDocs.sort((a, b) => (currentSortDir === 'desc' ? 1 : -1) * ((b.ratings_count || 0) - (a.ratings_count || 0)));
        }
        processingTime = (performance.now() - procStartTime) / 1000;
        clearInterval(fetchTimerInterval);
        // Rendering Phase
        const renderStartTime = performance.now();
        DOM.fetchStatus.textContent = 'Rendering results... (0.0s)';
        fetchTimerInterval = setInterval(() => {
            const elapsed = ((performance.now() - renderStartTime) / 1000).toFixed(1);
            DOM.fetchStatus.textContent = `Rendering results... (${elapsed}s)`;
        }, 100);
        // Pass the RAW api count (pre-dedup, pre-filter): the short-page
        // heuristic below must see what the API returned for this request.
        // Dedup/filter shrinkage of a full page is not exhaustion.
        renderResults(rawDocs.length, lastSearchTotalFound, isLoadMore, hiddenInBatch, newStartIdx, needsFullRerender);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                renderTime = (performance.now() - renderStartTime) / 1000;
                clearInterval(fetchTimerInterval);
                const totalTime = (performance.now() - totalStartTime) / 1000;
                apiTelemetry.recordSearchBenchmark(totalTime, queryTime, processingTime, renderTime);

                // Prepare query speed hover stats
                let speedTooltipHTML = `<strong>Last Query Speed:</strong><div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px;">`;
                speedTooltipHTML += `<span>Query: <strong>${queryTime.toFixed(2)}s</strong></span>`;
                speedTooltipHTML += `<span>Processing: <strong>${processingTime.toFixed(2)}s</strong></span>`;
                speedTooltipHTML += `<span>Render: <strong>${renderTime.toFixed(2)}s</strong></span>`;
                speedTooltipHTML += `<span style="margin-top: 2px; padding-top: 2px; border-top: 1px dashed var(--border); font-weight: bold; color: var(--accent);">Total: ${totalTime.toFixed(2)}s</span>`;
                speedTooltipHTML += `</div>`;
                DOM.querySpeedTooltip.innerHTML = speedTooltipHTML;
                lastSearchTimingHTML = speedTooltipHTML;
                // Keep tooltip populated but don't change container visibility (it's already shown)
                // Disappearing progress status message
                DOM.fetchStatus.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: block; flex-shrink: 0;"><circle cx="12" cy="12" r="9"></circle><polyline points="12 6 12 12 15 15"></polyline></svg><span style="font-size: 0.85rem; font-weight: 700; font-style: normal; line-height: 1; display: inline-block;">${totalTime.toFixed(1)}s</span>`;
                // Clear fetch status after a brief moment with a smooth CSS fade-out transition, then collapse into hoverable icon
                setTimeout(() => {
                    DOM.fetchStatus.style.opacity = '0';
                    setTimeout(() => {
                        DOM.fetchStatus.innerHTML = '';
                        DOM.fetchStatus.style.opacity = ''; // Reset opacity state for next search
                        DOM.totalCount.style.cursor = 'help'; // Now tooltip is ready
                    }, 1000); // Match CSS opacity transition duration
                }, 3000);
            });
        });
    } catch (error) {
        // A newer search superseded this failure -- its UI is the current one.
        if (requestToken !== searchRequestToken) return;
        clearInterval(fetchTimerInterval);
        DOM.fetchStatus.textContent = '';
        DOM.fetchStatus.style.opacity = ''; // Reset opacity state on error
        // Leave a clean header under the error box (don't strand a warped,
        // empty "Found X results" row in the results meta area).
        if (!isLoadMore) {
            DOM.totalCount.textContent = '';
            lastSearchTimingHTML = '';
            DOM.querySpeedTooltip.innerHTML = '';
            DOM.querySpeedContainer.style.display = 'none';
            DOM.resultsMeta.style.display = 'none';
        }
        // Clean up any hanging skeletons first
        const activeSkeletons = DOM.grid.querySelectorAll('.skeleton-card');
        activeSkeletons.forEach(skel => skel.remove());
        const isCooldown = error.message && error.message.includes("cooldown period");
        const isGatewayTimeout = error.message && (error.message.includes("522") || error.message.includes("524") || error.message.includes("504") || error.message.includes("502"));
        const isFailedFetch = error.message && error.message.toLowerCase().includes("failed to fetch");
        // NOTE (ESM migration fix): this was an implicit sloppy-mode global in
        // the classic script; strict-mode modules throw on undeclared
        // assignment, so it is now a proper function-scoped binding.
        let finalErrorMsg = '';
        if (isCooldown) {
            finalErrorMsg = renderErrorHTML(
                "API Cooldown Active",
                "OpenLibrary has temporarily blocked requests. Please wait 5 minutes before trying again."
            );
        } else if (isGatewayTimeout) {
            finalErrorMsg = renderErrorHTML(
                "OpenLibrary Server Timed Out (HTTP 522/524)",
                "The OpenLibrary origin servers took too long to respond to this query. This happens when searching very broad terms or when OpenLibrary is under high traffic. Try searching with more specific terms (like Author or Subject tags) or try again in a few seconds.",
                error.message
            );
        } else if (isFailedFetch) {
            finalErrorMsg = renderErrorHTML(
                "Connection / Network Error",
                "OpenLibrary is currently unreachable, the request timed out, or too many matches were returned. Try narrowing your search criteria (like specifying an Author, adding Subject tags, or avoiding broad year ranges) and try again shortly.",
                error.message
            );
        } else {
            finalErrorMsg = renderErrorHTML(
                "Search Failed",
                "OpenLibrary request failed. This often happens if the query matches too many books (e.g., broad search criteria like a simple year filter) or if the API is timing out. Try adding more specific filters to narrow your search.",
                error.message
            );
        }
        if (!isLoadMore) {
            DOM.grid.innerHTML = '';
            DOM.status.innerHTML = finalErrorMsg;
            DOM.status.style.display = 'block';
        } else {
            DOM.hiddenMsg.innerHTML = finalErrorMsg;
            DOM.hiddenMsg.style.display = 'block';
        }
        checkInputs();
        DOM.btn.textContent = 'Find Books';
        DOM.loadMoreBtn.disabled = false;
        DOM.loadMoreBtn.textContent = 'Find More Books';
    }
};
