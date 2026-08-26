var rightGroupSyncTimer = null; // hoisted: scheduleRightGroupSync() runs during initial evaluation (init-block hooks)
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
const escapeHTML = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => _escMap[tag]);
};
const renderErrorHTML = (title, description, details = '') => {
    return `
        <div class="error-display-box">
            <div class="error-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <span>${escapeHTML(title)}</span>
            </div>
            <p class="error-desc">${description}</p>
            ${details ? `<div class="error-details">Original Error: ${escapeHTML(details)}</div>` : ''}
        </div>
    `;
};
const cleanSubjects = (arr) => {
    if (!arr) return [];
    // Tolerate legacy/imported entries where subjects were saved as a plain
    // string instead of an array — a single malformed book must never be
    // able to crash the storage-boot chain (it used to blank the whole app).
    if (typeof arr === 'string') arr = arr.split(/\s*[,;\/]\s*|\s+-\s+/);
    if (!Array.isArray(arr)) return [];
    let res = [];
    const seen = new Set();
    arr.forEach(s => {
        s.split(/\s*[,;\/]\s*|\s+-\s+/).forEach(part => {
            const t = part.trim();
            if (t && !seen.has(t.toLowerCase())) {
                seen.add(t.toLowerCase());
                res.push(t);
            }
        });
    });
    return res;
};
const safeStorage = (() => {
    const mem = new Map();
    let available = false;
    try {
        const k = '__ole_probe__';
        localStorage.setItem(k, k);
        localStorage.removeItem(k);
        available = true;
    } catch (e) {
        available = false;
    }
    return {
        getItem(k) {
            try { if (available) return localStorage.getItem(k); } catch { }
            return mem.has(k) ? mem.get(k) : null;
        },
        setItem(k, v) {
            try { if (available) { localStorage.setItem(k, String(v)); return; } } catch { }
            mem.set(k, String(v));
        },
        removeItem(k) {
            try { if (available) localStorage.removeItem(k); } catch { }
            mem.delete(k);
        }
    };
})();
const ANNA_ARCHIVE_URL = 'https://annas-archive.gl';
const API_BASE = 'https://openlibrary.org/search.json';
const API_CONTACT_EMAIL = 'infinitestoragespaceheckyeah@gmail.com';
let apiBlockResumeTime = parseInt(safeStorage.getItem('ole_api_block_resume_time') || '0');
let isApiBlocked = Date.now() < apiBlockResumeTime;
// Monotonic token so only the latest performSearch request may touch the UI;
// stale (superseded) searches bail out instead of racing and corrupting the
// status/results rendering (e.g. a cooldown error next to "Found X results").
let searchRequestToken = 0;
const fetchOpenLibrary = (() => {
    const apiResponseCache = new Map();
    const API_CACHE_MAX = 50;
    const API_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    let lastRequestTime = 0;
    const minDelayMs = 250;
    let activeConnections = 0;
    const maxConnections = 3;
    const queue = [];
    const processQueue = () => {
        if (activeConnections >= maxConnections || queue.length === 0) return;

        const now = Date.now();
        const timeSinceLast = now - lastRequestTime;

        if (timeSinceLast < minDelayMs) {
            setTimeout(processQueue, minDelayMs - timeSinceLast);
            return;
        }
        lastRequestTime = Date.now();
        activeConnections++;
        const { url: finalUrl, options, resolve, reject } = queue.shift();
        // Check block state before execution
        if (isApiBlocked) {
            if (Date.now() < apiBlockResumeTime) {
                activeConnections--;
                reject(new Error("OpenLibrary API is in a cooldown period."));
                processQueue();
                return;
            } else {
                isApiBlocked = false;
                safeStorage.removeItem('ole_api_block_resume_time');
                if (DOM.status) DOM.status.style.display = 'none';
            }
        }
        const isGet = !options.method || options.method.toUpperCase() === 'GET';
        fetch(finalUrl, options)
            .then(async res => {
                if (res.status === 429 || res.status === 403) {
                    throw new Error(`API Blocked: ${res.status}`);
                }
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") === -1) {
                    throw new Error(`API Error: non-JSON response`);
                }
                if (isGet && res.ok) {
                    res.clone().text().then(text => {
                        try {
                            JSON.parse(text);
                            apiResponseCache.set(finalUrl, { text, time: Date.now() });
                            if (apiResponseCache.size > API_CACHE_MAX) {
                                const oldest = apiResponseCache.keys().next().value;
                                apiResponseCache.delete(oldest);
                            }
                        } catch { }
                    });
                }
                resolve(res);
            })
            .catch(err => {
                const msg = err.message || '';
                if (msg.includes('API Blocked')) {
                    if (!isApiBlocked) {
                        isApiBlocked = true;
                        apiBlockResumeTime = Date.now() + (5 * 60 * 1000); // 5 mins
                        safeStorage.setItem('ole_api_block_resume_time', apiBlockResumeTime.toString());
                        if (DOM.status) {
                            DOM.status.innerHTML = renderErrorHTML(
                                "API Cooldown Active",
                                "OpenLibrary has temporarily blocked requests. Please wait 5 minutes before trying again."
                            );
                            DOM.status.style.display = 'block';
                        }
                    }
                }
                reject(err);
            })
            .finally(() => {
                activeConnections--;
                setTimeout(processQueue, minDelayMs);
            });
    };
    const queuedFetch = (url, options = {}) => {
        let finalUrl = url;
        try {
            const urlObj = new URL(url.startsWith('http') ? url : `https://openlibrary.org${url}`);
            if (!urlObj.searchParams.has('contact')) {
                urlObj.searchParams.set('contact', API_CONTACT_EMAIL);
            }
            finalUrl = urlObj.toString();
        } catch (e) { }
        const isGet = !options.method || options.method.toUpperCase() === 'GET';
        if (isGet && apiResponseCache.has(finalUrl)) {
            const entry = apiResponseCache.get(finalUrl);
            if (Date.now() - entry.time < API_CACHE_TTL) {
                return Promise.resolve(new Response(entry.text, {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                }));
            }
            apiResponseCache.delete(finalUrl);
        }
        return new Promise((resolve, reject) => {
            const resumeTime = parseInt(safeStorage.getItem('ole_api_block_resume_time') || '0');
            if (Date.now() < resumeTime) {
                isApiBlocked = true;
                apiBlockResumeTime = resumeTime;
                return reject(new Error("OpenLibrary API is in a cooldown period."));
            }
            // Priority lane: user-initiated requests (details drawer, synopsis)
            // pass {priority:'high'} and jump ahead of the background backlog
            // (title translations flood this queue right after a search).
            const entry = { url: finalUrl, options, resolve, reject };
            if (options && options.priority === 'high') queue.unshift(entry);
            else queue.push(entry);
            processQueue();
        });
    };
    // Low-priority background jobs (e.g. synopsis prefetching) poll this to
    // wait until the shared throttled queue is fully drained, so user-facing
    // traffic (searches, cover lookups, title translations) always goes first.
    queuedFetch.isQueueIdle = () => queue.length === 0 && activeConnections === 0;
    return queuedFetch;
})();
const langMapToOL = {
    'en': 'eng', 'nl': 'dut', 'es': 'spa', 'ar': 'ara', 'it': 'ita', 'zh': 'chi', 'ru': 'rus',
    'fr': 'fre', 'de': 'ger', 'pt': 'por', 'ja': 'jpn', 'bg': 'bul', 'pl': 'pol', 'la': 'lat',
    'he': 'heb', 'zh-hant': 'chi', 'tr': 'tur', 'hu': 'hun', 'cs': 'cze', 'sv': 'swe', 'da': 'dan',
    'ko': 'kor', 'uk': 'ukr', 'id': 'ind', 'el': 'gre', 'ro': 'rum', 'lt': 'lit', 'bn': 'ben',
    'ca': 'cat', 'no': 'nor', 'af': 'afr', 'fi': 'fin', 'hr': 'hrv', 'sr': 'srp', 'th': 'tha',
    'hi': 'hin', 'ga': 'gle', 'lv': 'lav', 'fa': 'per', 'vi': 'vie', 'sk': 'slo', 'kn': 'kan',
    'bo': 'tib', 'cy': 'wel', 'jv': 'jav', 'ur': 'urd', 'yi': 'yid', 'hy': 'arm', 'be': 'bel',
    'rw': 'kin', 'ta': 'tam', 'kk': 'kaz', 'sl': 'slv', 'ml': 'mal', 'shn': 'shn', 'mn': 'mon',
    'ka': 'geo', 'mr': 'mar', 'eo': 'epo', 'et': 'est', 'te': 'tel', 'fil': 'fil', 'gu': 'guj',
    'gl': 'glg', 'ky': 'kir', 'ms': 'may', 'az': 'aze', 'sw': 'swa', 'qu': 'que', 'pa': 'pan',
    'ba': 'bak', 'sq': 'alb', 'uz': 'uzb', 'bs': 'bos', 'eu': 'baq', 'my': 'bur', 'am': 'amh',
    'ku': 'kur', 'fy': 'fry', 'zu': 'zul', 'ps': 'pus', 'ne': 'nep', 'so': 'som', 'ug': 'uig',
    'om': 'orm', 'mk': 'mac', 'ht': 'hat', 'lo': 'lao', 'tt': 'tat', 'si': 'sin', 'ckb': 'kur',
    'tg': 'tgk', 'sn': 'sna', 'su': 'sun', 'nb': 'nob', 'mg': 'mlg', 'xh': 'xho', 'ha': 'hau',
    'sd': 'snd', 'ny': 'nya'
};
const langMapToAA = {};
for (const [k, v] of Object.entries(langMapToOL)) {
    if (!langMapToAA[v]) langMapToAA[v] = k;
}
const DOM = {
    btn: document.getElementById('searchBtn'), loadMoreBtn: document.getElementById('loadMoreBtn'), resetBtn: document.getElementById('resetBtn'),
    grid: document.getElementById('bookGrid'), status: document.getElementById('statusMessage'),
    footer: document.getElementById('resultsFooter'), hiddenMsg: document.getElementById('hiddenMessage'),
    resultsHeader: document.getElementById('resultsHeader'), resultsMeta: document.getElementById('resultsMeta'),
    totalCount: document.getElementById('totalCount'), stageToasts: document.getElementById('stageToasts'),
    fetchStatus: document.getElementById('fetchStatus'),
    copyUrlBtn: document.getElementById('copyUrlBtn'), persistToggle: document.getElementById('persistToggle'),
    incSub: document.getElementById('incSubject'), incLang: document.getElementById('incLang'),
    incTitle: document.getElementById('incTitle'), incAuthor: document.getElementById('incAuthor'),
    incPlace: document.getElementById('incPlace'), incPerson: document.getElementById('incPerson'),
    excSub: document.getElementById('excSubject'), excLang: document.getElementById('excLang'),
    excPlace: document.getElementById('excPlace'), excPerson: document.getElementById('excPerson'),
    minY: document.getElementById('minYear'), maxY: document.getElementById('maxYear'),
    minStarRating: document.getElementById('minStarRating'), minRatings: document.getElementById('minRatings'),
    sort: document.getElementById('sortSelect'), sortNote: document.getElementById('sortNote'),
    sortDateOpt: document.getElementById('sortDateOpt'), sortRelevanceOpt: document.getElementById('sortRelevanceOpt'),
    viewSavedBtn: document.getElementById('viewSavedBtn'), savedCount: document.getElementById('savedCount'),
    customLimitToggle: document.getElementById('customLimitToggle'),
    customLimitContainer: document.getElementById('customLimitContainer'),
    fetchLimitSlider: document.getElementById('fetchLimitSlider'),
    limitValueDisplay: document.getElementById('limitValueDisplay'),
    extendedLimitWrapper: document.getElementById('extendedLimitWrapper'),
    extendedLimitToggle: document.getElementById('extendedLimitToggle'),
    extendedWarning: document.getElementById('extendedWarning'),
    enhancedAutofillToggle: document.getElementById('enhancedAutofillToggle'),
    apiAdvancedSettings: document.getElementById('apiAdvancedSettings'),
    searchOptionsCategory: document.getElementById('searchOptionsCategory'),
    querySpeedContainer: document.getElementById('querySpeedContainer'),
    querySpeedTooltip: document.getElementById('querySpeedTooltip'),
    listViewToggle: document.getElementById('listViewToggle'),
    toggleAllBtn: document.getElementById('toggleAllBtn'),
    globalSearchInput: document.getElementById('globalSearchInput'),
    globalSearchClearBtn: document.getElementById('globalSearchClearBtn'),
    homeBtn: document.getElementById('homeBtn'),
    globalSearchBtn: document.getElementById('globalSearchBtn'),
    discoverDashboard: document.getElementById('discoverDashboard'),
    discoverDashboardToggles: document.getElementById('discoverDashboardToggles'),
    toggleTrendingBtn: document.getElementById('toggleTrendingBtn'),
    toggleGenresBtn: document.getElementById('toggleGenresBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    settingsCloseBtn: document.getElementById('settingsCloseBtn'),
    translateToggle: document.getElementById('translateToggle'),
    completeTranslateToggle: document.getElementById('completeTranslateToggle'),
    completeTranslationRow: document.getElementById('completeTranslationRow'),
    reduceAnimationsToggle: document.getElementById('reduceAnimationsToggle'),
    compactHeaderToggle: document.getElementById('compactHeaderToggle'),
    legacyLayoutToggle: document.getElementById('legacyLayoutToggle'),
    sidebarSideToggle: document.getElementById('sidebarSideToggle'),
    cleanSynopsisToggle: document.getElementById('cleanSynopsisToggle'),
    resetSettingsBtn: document.getElementById('resetSettingsBtn'),
    sidebarStickyHeader: document.getElementById('sidebarStickyHeader'),
    legacySlotAnchor: document.getElementById('legacySlotAnchor'),
    detailsDrawer: document.getElementById('detailsDrawer'),
    detailsBackdrop: document.getElementById('detailsBackdrop'),
    detailsCloseBtn: document.getElementById('detailsCloseBtn'),
    detailsCoverContainer: document.getElementById('detailsCoverContainer'),
    detailsTitle: document.getElementById('detailsTitle'),
    detailsAuthor: document.getElementById('detailsAuthor'),
    detailsYear: document.getElementById('detailsYear'),
    detailsRating: document.getElementById('detailsRating'),
    detailsDescription: document.getElementById('detailsDescription'),
    detailsSubjects: document.getElementById('detailsSubjects'),
    detailsLibraryBtn: document.getElementById('detailsLibraryBtn'),
    detailsDownloadLink: document.getElementById('detailsDownloadLink'),
    detailsOlBtn: document.getElementById('detailsOlBtn'),
    selectionBar: document.getElementById('selectionBar'),
    selectionCloseBtn: document.getElementById('selectionCloseBtn'),
    selectionCount: document.getElementById('selectionCount'),
    selectionSelectAllBtn: document.getElementById('selectionSelectAllBtn'),
    selectionBulkBtn: document.getElementById('selectionBulkBtn'),
    exportLibraryBtn: document.getElementById('exportLibraryBtn'),
    importLibraryBtn: document.getElementById('importLibraryBtn'),
    importFileInput: document.getElementById('importFileInput'),
    importStatusMsg: document.getElementById('importStatusMsg'),
    sidebarSideToggle: document.getElementById('sidebarSideToggle'),
    cleanSynopsisToggle: document.getElementById('cleanSynopsisToggle'),
    cleanLibrarySubjectsToggle: document.getElementById('cleanLibrarySubjectsToggle')
};
const watchInputs = document.querySelectorAll('.watch-input');
const INPUT_IDS = ['globalSearchInput', 'incLang', 'incTitle', 'incAuthor', 'incPlace', 'incPerson', 'excLang', 'excPlace', 'excPerson', 'minYear', 'maxYear', 'minStarRating', 'minRatings'];
let currentPage = 1;
let currentTotalHidden = 0;
let activeQueryParams = new URLSearchParams();
let activeMinStar = 0;
let activeMinRCount = 0;
let activeSort = 'relevance';
let allDisplayedDocs = [];
let currentViewMode = 'search';
let toggleAllConfirmTimeoutId = null;
let lastSearchTotalFound = 0;
let lastSearchTimingHTML = '';
let sortDirection = 'desc';
let renderIndex = 0;
let cachedSubjectCounts = null;
let cachedLocalFilteredBooks = null;
let cachedTrendingBooks = null;
let cachedGenreShelves = null;
let currentDiscoverTab = 'trending';
let fetchTimerInterval = null;
let currentDrawerWorkKey = null;
const RENDER_CHUNK = 50;
// Mobile Alternative Layout only: multi-select mode state.
let selectionMode = false;
let selectedKeys = new Set();
let holdTimer = null;
let holdSuppressClick = false;
let holdStart = null;
let lastSelectionModeChange = 0;
const SELECTION_HOLD_MS = 450;
const SELECTION_MOVE_TOLERANCE = 10;
// Global Translation Cache to prevent duplicate and rapid CDNs IP-blocking API requests
const translationCache = new Map();
// Session cache for work-key -> synopsis, so re-opening the details drawer
// doesn't re-fetch the work JSON just to show the description again.
const descriptionCache = new Map();
const translationReverseIndex = new Map();
const rebuildTranslationReverseIndex = () => {
    translationReverseIndex.clear();
    for (const [cacheKey, translatedTitle] of translationCache.entries()) {
        const lastUnderscore = cacheKey.lastIndexOf('_');
        if (lastUnderscore === -1) continue;
        const workKey = cacheKey.substring(0, lastUnderscore);
        const lang = cacheKey.substring(lastUnderscore + 1);

        if (!translationReverseIndex.has(lang)) {
            translationReverseIndex.set(lang, new Map());
        }
        translationReverseIndex.get(lang).set(translatedTitle.trim().toLowerCase(), workKey);
    }
};
const setTranslationCache = (cacheKey, title) => {
    translationCache.set(cacheKey, title);
    const lastUnderscore = cacheKey.lastIndexOf('_');
    if (lastUnderscore !== -1) {
        const workKey = cacheKey.substring(0, lastUnderscore);
        const lang = cacheKey.substring(lastUnderscore + 1);
        if (!translationReverseIndex.has(lang)) {
            translationReverseIndex.set(lang, new Map());
        }
        translationReverseIndex.get(lang).set(title.trim().toLowerCase(), workKey);
    }
};
const deleteTranslationCache = (cacheKey) => {
    if (translationCache.has(cacheKey)) {
        const title = translationCache.get(cacheKey);
        translationCache.delete(cacheKey);
        const lastUnderscore = cacheKey.lastIndexOf('_');
        if (lastUnderscore !== -1) {
            const lang = cacheKey.substring(lastUnderscore + 1);
            const langIndex = translationReverseIndex.get(lang);
            if (langIndex) {
                langIndex.delete(title.trim().toLowerCase());
            }
        }
    }
};
// Promise-based cache for in-flight requests to avoid duplicate fetches
const translationPromiseCache = new Map();
class TranslationQueue {
    constructor() {
        this.queue = [];
        this.activeCount = 0;
        this.maxConcurrent = 3;
        this.delayMs = 200;
    }
    add(cacheKey, taskFn) {
        // Prevent duplicate queuing
        if (this.queue.some(item => item.cacheKey === cacheKey)) return;
        this.queue.push({ cacheKey, taskFn });
        this.process();
    }
    clear() {
        this.queue = [];
    }
    async process() {
        if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) return;
        const { taskFn } = this.queue.shift();
        this.activeCount++;
        try {
            await taskFn();
        } catch (e) {
            console.error('Translation task failed:', e);
        } finally {
            this.activeCount--;
            // Minimal delay to let other synchronous tasks breathe
            setTimeout(() => this.process(), 50);
        }
    }
}
const translationQueue = new TranslationQueue();
const loadTranslationCache = async () => {
    try {
        const cached = await localforage.getItem('ole_translation_cache_v8');
        if (cached) {
            for (const [k, v] of Object.entries(cached)) {
                translationCache.set(k, v);
            }
            rebuildTranslationReverseIndex();
        }
    } catch (e) {
        console.error('Failed to load translation cache:', e);
    }
};
let saveTranslationCacheTimer = null;
const saveTranslationCache = () => {
    if (saveTranslationCacheTimer) clearTimeout(saveTranslationCacheTimer);
    saveTranslationCacheTimer = setTimeout(async () => {
        try {
            const obj = {};
            for (const [k, v] of translationCache.entries()) {
                obj[k] = v;
            }
            await localforage.setItem('ole_translation_cache_v8', obj);
        } catch (e) {
            console.error('Failed to save translation cache:', e);
        }
    }, 500);
};
const appStates = {
    search: { tagsInc: [], tagsExc: [], inputs: {}, sort: 'relevance', sortDir: 'desc' },
    library: { tagsInc: [], tagsExc: [], inputs: {}, sort: 'date', sortDir: 'desc' }
};
const SORT_DEFAULTS = { relevance: 'desc', rating: 'desc', reviews: 'desc', editions: 'desc', new: 'desc', date: 'desc', random: 'desc' };
let library = [];
// We no longer load from localStorage here because IndexedDB is asynchronous
const updateLibraryBadge = () => { DOM.savedCount.textContent = library.length; };
updateLibraryBadge();
const createLibraryDoc = (bookData) => {
    const doc = {
        key: bookData.key,
        title: bookData.title,
        original_title: bookData.original_title || bookData.title,
        author_name: Array.isArray(bookData.author_name) ? bookData.author_name : (bookData.author_name ? [bookData.author_name] : ['Unknown Author']),
        cover_i: bookData.cover_i || null,
        cover_edition_key: bookData.cover_edition_key || null,
        first_publish_year: bookData.first_publish_year || 'N/A',
        subject: cleanSubjects(bookData.subject),
        place: Array.isArray(bookData.place) ? bookData.place : (bookData.place ? [bookData.place] : []),
        person: Array.isArray(bookData.person) ? bookData.person : (bookData.person ? [bookData.person] : []),
        language: Array.isArray(bookData.language) ? bookData.language : (bookData.language ? [bookData.language] : []),
        ratings_average: bookData.ratings_average != null ? bookData.ratings_average : null,
        ratings_count: bookData.ratings_count || 0,
        edition_count: bookData.edition_count || 1,
        savedAt: bookData.savedAt || Date.now()
    };
    cacheBookTokens(doc);
    return doc;
};
const renderNextChunk = (isEditionsSort, filterLangAA) => {
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
    renderIndex = endIdx;
    if (currentViewMode === 'search') {
        const currentLimit = parseInt(DOM.customLimitToggle && DOM.customLimitToggle.checked ? DOM.fetchLimitSlider.value : 100);
        if (renderIndex < allDisplayedDocs.length) {
            DOM.loadMoreBtn.style.display = 'none'; // Still rendering current local batch
        } else {
            DOM.loadMoreBtn.style.display = ((currentPage * currentLimit) >= lastSearchTotalFound) ? 'none' : 'inline-block';
        }
        // Asynchronously check and sync titles
        syncCardTitles(chunkDocs);
    }
    updateToggleAllBtnState();
};
const toggleLibrary = (bookData) => {
    const idx = library.findIndex(b => b.key === bookData.key);
    const wasRemoval = idx > -1;
    if (wasRemoval) {
        library.splice(idx, 1);
    } else {
        library.push(createLibraryDoc(bookData));
    }
    cachedSubjectCounts = null;
    cachedLocalFilteredBooks = null;
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
                    fetchOpenLibrary(workUrl)
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
const syncThemeCheckboxes = (isDark, save = false) => {
    const cbMobile = document.getElementById('mobileThemeCheckbox');
    if (cbMobile) cbMobile.checked = isDark;
    document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (save) {
        safeStorage.setItem('ole_theme', isDark ? 'dark' : 'light');
    }
};
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
const setupTagInput = (inputId, containerId, onInputCleared) => {
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
        // Split the incoming text by commas, spaces, or hyphens
        const newTags = text.split(/[\s,-]+/).filter(t => t.trim().length > 0);
        let added = false;
        newTags.forEach(t => {
            const clean = t.trim();
            // Prevent duplicates (case-insensitive)
            if (clean && !tags.some(existing => existing.toLowerCase() === clean.toLowerCase())) {
                tags.push(clean);
                added = true;
            }
        });
        if (added) {
            input.value = '';
            input.placeholder = '';
            render();
            if (onInputCleared) onInputCleared();
            checkInputs();
            if (currentViewMode === 'library') applyLocalFilters();
        }
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
            if (input.value.trim()) addTag(input.value);
        } else if (e.key === 'Backspace' && input.value === '' && tags.length > 0) {
            e.preventDefault();
            const lastTag = tags.pop();
            input.value = lastTag.slice(0, -1);
            input.placeholder = '';
            render();
            checkInputs();
            if (currentViewMode === 'library') applyLocalFilters();
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
const collapseMobileSidebarIfOpen = () => {
    // Mobile-only by design (its name says it): on desktop, the sidebar's
    // expanded/collapsed state is the user's own choice, and collapsing it
    // here — e.g. when switching the sidebar side or running a search — would
    // yank the sidebar shut unexpectedly. The mobile collapse behaviors all
    // run at ≤768px, so nothing below is lost.
    if (window.innerWidth > 768) return;
    const container = document.querySelector('.app-container');
    const backdrop = document.getElementById('mobileSidebarBackdrop');
    if (container && !container.classList.contains('sidebar-collapsed')) {
        container.classList.add('sidebar-collapsed');
        if (backdrop) backdrop.classList.remove('active');
        if (typeof updateSwipeHintState === 'function') updateSwipeHintState();
    }
};
const syncSortNoteState = () => {
    if (DOM.sortNote && DOM.sort) {
        DOM.sortNote.style.display = (DOM.sort.value === 'reviews' && currentViewMode === 'search') ? 'block' : 'none';
    }
};
const updateSortDirBtn = () => {
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
const saveCurrentModeState = () => {
    const state = appStates[currentViewMode];
    state.tagsInc = tagManagerInc.getTags();
    state.tagsExc = tagManagerExc.getTags();
    INPUT_IDS.forEach(id => { state.inputs[id] = document.getElementById(id).value; });
    state.sort = DOM.sort.value;
    state.sortDir = sortDirection;
};
const restoreModeState = (mode) => {
    const state = appStates[mode];
    tagManagerInc.setTags(state.tagsInc);
    tagManagerExc.setTags(state.tagsExc);
    INPUT_IDS.forEach(id => { document.getElementById(id).value = state.inputs[id] || ''; });
    DOM.sort.value = state.sort;
    sortDirection = state.sortDir;
    updateSortDirBtn();
    syncSortNoteState();
    checkInputs();
};
const getHashStateObj = () => {
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
const saveStateToHash = (isPush = false) => {
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
const hasActiveSearchCriteria = () => {
    const textInputs = Array.from(watchInputs).filter(el =>
        (el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.id !== 'sortSelect'
    );
    return textInputs.some(input => input.value.trim() !== '') ||
        (typeof tagManagerInc !== 'undefined' && tagManagerInc.getTags().length > 0) ||
        (typeof tagManagerExc !== 'undefined' && tagManagerExc.getTags().length > 0) ||
        (DOM.globalSearchInput && DOM.globalSearchInput.value.trim() !== '');
};
const loadStateFromHash = () => {
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
            currentViewMode = 'library';
            DOM.viewSavedBtn.classList.add('active');
            DOM.sortDateOpt.style.display = 'block';
            DOM.sortRelevanceOpt.style.display = 'none';
        } else {
            currentViewMode = 'search';
            DOM.viewSavedBtn.classList.remove('active');
            DOM.sortDateOpt.style.display = 'none';
            DOM.sortRelevanceOpt.style.display = 'block';
        }
        syncSettingsCategoriesForMode(currentViewMode);
        restoreModeState(currentViewMode);
        return true;
    } catch { return false; }
};
DOM.persistToggle.addEventListener('change', () => {
    if (DOM.persistToggle.checked) saveStateToHash(true);
    else history.replaceState(null, '', window.location.pathname + window.location.search);
});
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
    const url = window.location.origin + window.location.pathname + window.location.search + '#' + encodeURIComponent(JSON.stringify(state));
    navigator.clipboard.writeText(url).then(() => {
        const orig = DOM.copyUrlBtn.innerHTML;
        DOM.copyUrlBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => { DOM.copyUrlBtn.innerHTML = orig; }, 2000);
    });
});
const syncSettingsCategoriesForMode = (mode) => {
    // Search-only settings (.search-only-row) are hidden while in Library view.
    // Library-only settings (.library-only-row) are hidden while in Search view.
    // A category whose rows are ALL hidden that way hides its title and container too.
    const inLibrary = mode === 'library';
    document.querySelectorAll('.settings-category').forEach((cat) => {
        const rows = Array.from(cat.querySelectorAll('.settings-row'));
        if (!rows.length) return;
        let visibleCount = 0;
        rows.forEach((row) => {
            const hide = (inLibrary && row.classList.contains('search-only-row')) ||
                (!inLibrary && row.classList.contains('library-only-row'));
            row.style.display = hide ? 'none' : '';
            if (!hide) visibleCount++;
        });
        cat.style.display = visibleCount === 0 ? 'none' : '';
    });
};
const checkInputs = () => {
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
const appendKeyboardListeners = () => {
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
const clearAllFilters = () => {
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
        allDisplayedDocs = [];
        lastSearchTotalFound = 0;
        currentPage = 1;
        if (DOM.persistToggle.checked) history.pushState(null, '', window.location.pathname + window.location.search);
        renderDiscoverDashboard();
    }
};
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
const tokenize = (val) => val.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
// Helper to rip formatting out and return an array of clean, pure words
const getBookTokens = (arr) => {
    if (!arr) return [];
    if (typeof arr === 'string') arr = [arr];
    if (!Array.isArray(arr) || arr.length === 0) return [];
    return arr.flatMap(item => String(item).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean));
};
const arrayHasAnyToken = (arr, tokens) => {
    if (!arr || arr.length === 0 || tokens.length === 0) return false;
    const allWords = getBookTokens(arr);
    return tokens.some(tok => allWords.includes(tok)); // Exact word match
};
const arrayHasAllTokens = (arr, tokens) => {
    if (!arr || arr.length === 0 || tokens.length === 0) return false;
    const allWords = getBookTokens(arr);
    return tokens.every(tok => allWords.includes(tok)); // Exact word match
};
// Pre-calculate Search Tokens to eliminate regex parsing bottlenecks
const cacheBookTokens = (b) => {
    if (b._tokensCached) return;
    b._sub = new Set(getBookTokens(b.subject));
    b._plc = new Set(getBookTokens(b.place));
    b._per = new Set(getBookTokens(b.person));
    b._lang = new Set(getBookTokens(b.language));
    b._auth = new Set(getBookTokens(b.author_name));
    b._ttl = b.title ? b.title.toLowerCase() : '';
    b._tokensCached = true;
};
const getLocalFilteredBooks = () => {
    if (cachedLocalFilteredBooks !== null) {
        return cachedLocalFilteredBooks;
    }
    let filtered = [...library];
    const incSub = tagManagerInc.getTags().flatMap(t => getBookTokens([t]));
    const excSub = tagManagerExc.getTags().flatMap(t => getBookTokens([t]));
    const incPlace = getBookTokens([DOM.incPlace.value]);
    const incPerson = getBookTokens([DOM.incPerson.value]);
    const incLang = getBookTokens([DOM.incLang.value]);
    const excPlace = getBookTokens([DOM.excPlace.value]);
    const excPerson = getBookTokens([DOM.excPerson.value]);
    const excLang = getBookTokens([DOM.excLang.value]);
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
    cachedLocalFilteredBooks = filtered;
    return filtered;
};
const getFilteredSubjectCounts = () => {
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
const setupAutocomplete = (inputId, listId, indicatorId, ghostId, isLocalMode, managerRef) => {
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
            cachedSubjectCounts = getFilteredSubjectCounts();
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
                    fetchOpenLibrary(`https://openlibrary.org/search/subjects.json?q=${encodeURIComponent(query + '*')}&limit=20`)
                        .then(async res => { if (res.ok) docsWild = (await res.json()).docs || []; })
                        .catch(() => { }),
                    fetchOpenLibrary(`https://openlibrary.org/search/subjects.json?q=${encodeURIComponent(query)}&limit=20`)
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
const tagManagerInc = setupTagInput('incSubject', 'incSubjectContainer', () => document.getElementById('incSubjectGhost').innerHTML = '');
const tagManagerExc = setupTagInput('excSubject', 'excSubjectContainer', () => document.getElementById('excSubjectGhost').innerHTML = '');
setupAutocomplete('incSubject', 'incSubjectList', 'incSubjectLoading', 'incSubjectGhost', () => currentViewMode === 'library', tagManagerInc);
setupAutocomplete('excSubject', 'excSubjectList', 'excSubjectLoading', 'excSubjectGhost', () => currentViewMode === 'library', tagManagerExc);
let resolvedTitlesInActivePass = new Set();
const isValidEditionForWork = (entry, workKey) => {
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
const normalizeForCompare = (s) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|an?)\s+/, '').replace(/[.,!?'":;]/g, '').trim();
const isAuthorNameOnly = (text, authorNames) => {
    if (!text || !authorNames || authorNames.length === 0) return false;
    const norm = normalizeForCompare(text);
    if (!norm) return false;
    return authorNames.some(a => normalizeForCompare(a) === norm);
};
// Catches the author's name appearing anywhere within a string (not just an
// exact match), e.g. a subtitle like "Ayn Rand's Anthem" or "Notes by Ayn Rand".
const containsAuthorName = (text, authorNames) => {
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
const stripAuthorCredit = (title, authorNames) => {
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
const isJunkPhrase = (text) => {
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
const isValidSubtitle = (subtitle, authorNames, title) => {
    if (!subtitle || typeof subtitle !== 'string') return false;
    if (isJunkPhrase(subtitle)) return false;
    // Subtitle that's just the author's name, or that mentions it anywhere, adds nothing.
    if (isAuthorNameOnly(subtitle, authorNames) || containsAuthorName(subtitle, authorNames)) return false;
    // Subtitle that just repeats the title adds nothing either.
    if (title && normalizeForCompare(subtitle) === normalizeForCompare(title)) return false;
    return true;
};
// Picks the best edition to source a translated title from. Prefers an edition
// with both a clean title and a clean subtitle; falls back to a clean title with
// no subtitle; falls back to any matching-language edition as a last resort so a
// book is never hidden just because every edition has messy metadata.
// Also cleans "Title by Author" bleed in title fields, and un-swaps editions
// where the title is just the author's name and the real title landed in the
// subtitle instead (e.g. title: "Emily Brontë", subtitle: "Wuthering Heights").
const pickBestEdition = (validEditions, authorNames, referenceTitle) => {
    if (!validEditions || validEditions.length === 0) return null;
    const cleaned = validEditions.map(e => {
        const cleanTitle = stripAuthorCredit(e.title, authorNames);
        if (isAuthorNameOnly(cleanTitle, authorNames) && e.subtitle && !isAuthorNameOnly(e.subtitle, authorNames)
            && !containsAuthorName(e.subtitle, authorNames) && !isJunkPhrase(e.subtitle)) {
            // Title/subtitle look swapped — the "subtitle" is actually the real title.
            return { ...e, title: e.subtitle, subtitle: '' };
        }
        return cleanTitle === e.title ? e : { ...e, title: cleanTitle };
    });
    // Same class of edition/format noise as isJunkPhrase, but scoped for titles:
    // deliberately excludes the "A ___ Novel/Story/Tale" genre-pattern check,
    // since that would wrongly flag genuine titles like "A Tale of Two Cities".
    // Accent-folded so foreign-language variants (e.g. "Bilingüe") are caught too.
    const isJunkTitleFragment = (title) => {
        if (!title) return true;
        const folded = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const junkWords = [
            'edition', 'version', 'paperback', 'ebook', 'e-book', 'print', 'press',
            'bilingual', 'bilingue', 'trilingual', 'multilingual', 'unabridged', 'abridged',
            'annotated', 'illustrated', 'boxed set', 'box set'
        ];
        return junkWords.some(term => new RegExp(`\\b${term}\\b`).test(folded));
    };
    const goodTitle = (e) => e.title && !isAuthorNameOnly(e.title, authorNames) && !containsAuthorName(e.title, authorNames)
        && !isJunkTitleFragment(e.title);
    const matchesReference = (e) => referenceTitle && normalizeForCompare(e.title) === normalizeForCompare(referenceTitle);
    // Preference order: a subtitle is the single biggest source of clutter, so
    // we only ever attach one when there's no clean subtitle-free edition to
    // use instead. Among bare-title editions, prefer one matching the title
    // the book was already showing (closest to OpenLibrary's canonical title).
    return cleaned.find(e => goodTitle(e) && !e.subtitle && matchesReference(e))
        || cleaned.find(e => goodTitle(e) && !e.subtitle)
        || cleaned.find(e => goodTitle(e) && isValidSubtitle(e.subtitle, authorNames, e.title))
        || cleaned.find(e => goodTitle(e))
        || cleaned[0];
};
const isDuplicateTitle = (title, currentKey, targetLang) => {
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
function getExplicitTargetLang() {
    return DOM.incLang && DOM.incLang.value ? DOM.incLang.value.trim().toLowerCase() : '';
}
// Accepts an edition language code for a given target. Strict equality on
// the normalized code plus the historical en<->eng aliasing — the old
// `code.includes(targetLang)` matching was loose enough that e.g. an 'en'
// target matched 'eng' editions and vice versa through substring accidents.
function editionLangMatches(code, targetLang) {
    if (!code) return false;
    const c = String(code).toLowerCase();
    if (c === targetLang) return true;
    if (targetLang === 'eng' && c === 'en') return true;
    if (targetLang === 'en' && c === 'eng') return true;
    return false;
}
const applyLocalFilters = async () => {
    searchRequestToken++; // entering/using Library view cancels any in-flight search
    resolvedTitlesInActivePass.clear();
    cachedSubjectCounts = null; // Invalidate cache when filters change
    cachedLocalFilteredBooks = null;
    const filtered = getLocalFilteredBooks();
    const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
    const isSyncMode = DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked;
    const targetLang = getExplicitTargetLang();
    // No explicit language filter -> no translation pass at all. Titles shown
    // are canonical; there is nothing to translate towards.
    if (isTransEnabled && targetLang) {
        // Pre-apply cache
        filtered.forEach(b => {
            const cacheKey = `${b.key}_${targetLang}`;
            if (translationCache.has(cacheKey)) {
                b.title = translationCache.get(cacheKey);
            }
        });
        if (isSyncMode) {
            // SYNC Mode (blocking)
            const docsToTranslate = filtered.filter(b => needsTranslation(b, targetLang));
            if (docsToTranslate.length > 0) {
                // Show loading state
                injectSkeletonScreen(false, docsToTranslate.length);
                DOM.totalCount.textContent = 'Translating library titles...';
                const fetchTask = async (b) => {
                    const cacheKey = `${b.key}_${targetLang}`;
                    try {
                        const res = await fetchOpenLibrary(`https://openlibrary.org${b.key}/editions.json?limit=40`);
                        if (!res.ok) return;
                        const edData = await res.json();
                        if (edData && edData.entries && edData.entries.length > 0) {
                            const validEditions = edData.entries.filter(entry => {
                                if (!entry.languages) return false;
                                if (!isValidEditionForWork(entry, b.key)) return false;
                                return entry.languages.some(lang => {
                                    const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                                    return editionLangMatches(code, targetLang);
                                });
                            });
                            const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title);
                            if (matchingEdition && matchingEdition.title) {
                                const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                                const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                                if (shouldReplaceTitle(b.title, fullTitle) && !isDuplicateTitle(fullTitle, b.key, targetLang)) {
                                    resolvedTitlesInActivePass.add(fullTitle.trim().toLowerCase());
                                    setTranslationCache(cacheKey, fullTitle);
                                    saveTranslationCache();
                                    b.title = fullTitle;
                                } else {
                                    setTranslationCache(cacheKey, b.title);
                                    saveTranslationCache();
                                }
                            }
                        }
                    } catch { }
                };
                const batchSize = 5;
                for (let i = 0; i < docsToTranslate.length; i += batchSize) {
                    const batch = docsToTranslate.slice(i, i + batchSize);
                    await Promise.all(batch.map(fetchTask));
                    if (i + batchSize < docsToTranslate.length) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
            }
            renderSavedCollection(filtered);
        } else {
            // ASYNC Mode
            renderSavedCollection(filtered);
            syncCardTitles(filtered);
        }
    } else {
        renderSavedCollection(filtered);
    }
};
const modifyTagFilter = (tagValue, tagManager) => {
    const currentTags = tagManager.getTags();
    const index = currentTags.findIndex(t => t.toLowerCase() === tagValue.toLowerCase());
    let added = false;
    if (index > -1) tagManager.removeTag(index);
    else { tagManager.addTag(tagValue); added = true; }
    return added;
};
const showStageToast = (mode, tagText, added) => {
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
const processTags = (tagArray, prefix, qArray) => {
    if (!tagArray || tagArray.length === 0) return;
    tagArray.forEach(t => {
        if (prefix.startsWith('-')) qArray.push(`-${prefix.slice(1)}:"${t}"`);
        else qArray.push(`+${prefix}:"${t}"`);
    });
};
const mapSubjectWorkToDoc = (w) => ({
    key: w.key,
    title: w.title,
    author_name: w.authors ? w.authors.map(a => a.name) : ['Unknown Author'],
    cover_i: w.cover_id,
    first_publish_year: w.first_publish_year || 'N/A',
    subject: w.subject || [],
    edition_count: w.edition_count || 1,
    ratings_average: w.ratings_average || null,
    ratings_count: w.ratings_count || 0
});
// ---- Cover image caching ----
// The metadata caches below (trending/genres) only ever saved *which* books
// to show — the actual cover images still had to hit covers.openlibrary.org
// over the network every single time, which is most of what "slow to load"
// actually was. This caches the decoded image itself (as a data URL) in
// IndexedDB, so a repeat view can paint the cover with zero network request
// at all. Non-destructive by design: every <img> still gets its normal live
// URL as `src` immediately, so nothing is slower than before if the cache
// misses or fails — this only ever swaps in something faster when it hits.
const COVER_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const COVER_DB_PREFIX = 'ole_cover_v1_';
const coverFetchInFlight = new Set();
const coverMemoryCache = new Map();
// Data URLs run ~133KB each (base64 of a ~100KB cover), so an unbounded
// in-memory map would quietly eat tens of MB over a long session (library +
// every trending/search cover ever painted). Keep only the most recent ones
// in RAM — IndexedDB still holds the rest, and re-hydration is cheap.
const COVER_MEMORY_CACHE_MAX = 300;
// hydrateCachedCovers can hand us a whole grid of uncached covers at once
// (24 on the trending dashboard). Firing every fetch simultaneously is a
// needless burst against covers.openlibrary.org; run them a few at a time.
const COVER_FETCH_MAX_CONCURRENT = 6;
let coverFetchActive = 0;
const coverFetchQueue = [];

const rememberCoverInMemory = (coverId, dataUrl) => {
    coverMemoryCache.set(coverId, dataUrl);
    if (coverMemoryCache.size > COVER_MEMORY_CACHE_MAX) {
        const oldest = coverMemoryCache.keys().next().value;
        coverMemoryCache.delete(oldest);
    }
};

const getCachedCoverDataUrl = async (coverId) => {
    if (!coverId) return null;
    if (coverMemoryCache.has(coverId)) return coverMemoryCache.get(coverId);
    try {
        const raw = await localforage.getItem(`${COVER_DB_PREFIX}${coverId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || Date.now() - parsed.ts > COVER_CACHE_TTL) return null;
        rememberCoverInMemory(coverId, parsed.dataUrl);
        return parsed.dataUrl;
    } catch {
        return null;
    }
};

const getWorkApiUrl = (key) => {
    if (!key) return '';
    if (key.startsWith('http')) return key.endsWith('.json') ? key : `${key}.json`;
    const cleanKey = key.startsWith('/') ? key : `/${key}`;
    if (!cleanKey.startsWith('/works/') && !cleanKey.startsWith('/books/')) {
        return `https://openlibrary.org/works${cleanKey}.json`;
    }
    return `https://openlibrary.org${cleanKey}.json`;
};

const cacheCoverInBackground = (coverId) => {
    if (!coverId || coverFetchInFlight.has(coverId)) return;
    coverFetchInFlight.add(coverId);
    coverFetchQueue.push(coverId);
    processCoverFetchQueue();
};

const processCoverFetchQueue = () => {
    while (coverFetchActive < COVER_FETCH_MAX_CONCURRENT && coverFetchQueue.length > 0) {
        const coverId = coverFetchQueue.shift();
        coverFetchActive++;
        const isOlid = String(coverId).startsWith('OL') || String(coverId).endsWith('M');
        const url = isOlid
            ? `https://covers.openlibrary.org/b/olid/${coverId}-M.jpg`
            : `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
        fetch(url)
            .then((res) => {
                if (!res.ok) throw new Error('Cover fetch failed');
                return res.blob();
            })
            .then((blob) => new Promise((resolve, reject) => {
                // Skip caching anything unexpectedly huge — covers are normally
                // a few KB to ~100KB; this just guards against ever bloating
                // IndexedDB on a weird response.
                if (blob.size > 400 * 1024) { resolve(null); return; }
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            }))
            .then((dataUrl) => {
                if (!dataUrl) return;
                rememberCoverInMemory(coverId, dataUrl);
                return localforage.setItem(`${COVER_DB_PREFIX}${coverId}`, JSON.stringify({ ts: Date.now(), dataUrl }));
            })
            .catch(() => { /* best-effort only */ })
            .finally(() => {
                coverFetchInFlight.delete(coverId);
                coverFetchActive--;
                processCoverFetchQueue();
            });
    }
};

// ── Ordered sequential cover loading ─────────────────────────────────────
// Covers used to race in whatever order the network/cache resolved them.
// Now every rendered batch loads strictly in READING ORDER (left→right,
// top→bottom = DOM order): exactly ONE network cover in flight at a time,
// while memory/IndexedDB hits fill instantly without stealing the slot.
// A generation token cancels stale sequences the moment a newer batch is
// scheduled (searches, view switches, chunk renders).
const fetchCoverDataUrl = (coverId) => {
    const isOlid = String(coverId).startsWith('OL') || String(coverId).endsWith('M');
    const url = isOlid
        ? `https://covers.openlibrary.org/b/olid/${coverId}-M.jpg`
        : `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
    return fetch(url)
        .then((res) => {
            if (!res.ok) throw new Error('Cover fetch failed');
            return res.blob();
        })
        .then((blob) => new Promise((resolve, reject) => {
            // Skip caching anything unexpectedly huge — covers are normally
            // a few KB to ~100KB; this just guards against ever bloating
            // IndexedDB on a weird response.
            if (blob.size > 400 * 1024) { resolve(null); return; }
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        }))
        .then((dataUrl) => {
            if (dataUrl) {
                rememberCoverInMemory(coverId, dataUrl);
                if (!coverIdbSuspect) localforage.setItem(`${COVER_DB_PREFIX}${coverId}`, JSON.stringify({ ts: Date.now(), dataUrl })).catch(() => { });
            }
            return dataUrl;
        })
        .catch(() => null /* best-effort only */);
};

// Call after inserting a batch of pending cover <img class="cover-pending"
// data-cover-id="..."> elements. Cached covers swap in near-instantly; the
// rest load through a SLIDING WINDOW of parallel requests that always starts
// work in reading order (left→right, top→bottom). covers.openlibrary.org is
// a CDN and comfortably sustains the old system's 6 concurrent image fetches,
// while strictly serial loading was ~6× slower for no benefit.
const COVER_SEQ_PARALLEL = 6;
let coverSeqToken = 0;
// Set when an IndexedDB cover read stalls past its timeout (private windows
// and quota-pressure states can hang the driver): all further covers skip
// the cache check entirely and load straight from the network, so one hung
// storage backend can never freeze the whole sequence.
let coverIdbSuspect = false;
const loadOneCover = async (img) => {
    const coverId = img.dataset.coverId;
    if (!coverId || !img.isConnected) return;
    let dataUrl = coverMemoryCache.get(coverId) || null;
    if (!dataUrl && !coverIdbSuspect) {
        // Race a short timeout: a stalled IndexedDB read must never freeze
        // the cover sequence. First timeout poisons the flag above.
        try {
            dataUrl = await Promise.race([
                getCachedCoverDataUrl(coverId),
                new Promise(resolve => setTimeout(() => { coverIdbSuspect = true; resolve(null); }, 1200))
            ]);
        } catch { dataUrl = null; }
    }
    if (!dataUrl) dataUrl = await fetchCoverDataUrl(coverId);
    if (!img.isConnected) return;
    if (dataUrl) {
        img.src = dataUrl;
        img.classList.remove('cover-pending');
    } else {
        img.onerror = null;
        img.outerHTML = '<div class=\'no-cover\'>No Cover</div>';
    }
};
const hydrateCachedCovers = (container) => {
    if (!container) return;
    const token = ++coverSeqToken;
    const imgs = Array.from(container.querySelectorAll('img.cover-pending[data-cover-id]'));
    let cursor = 0;
    const worker = async () => {
        while (token === coverSeqToken) {
            const i = cursor++;
            if (i >= imgs.length) return;
            await loadOneCover(imgs[i]);
        }
    };
    for (let w = 0; w < COVER_SEQ_PARALLEL && w < imgs.length; w++) worker();
};

// Persistent Synopsis Cache (IndexedDB + RAM)
const SYNOPSIS_DB_PREFIX = 'ole_desc_v1_';
const SYNOPSIS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

const getCachedSynopsis = async (workKey) => {
    if (!workKey) return null;
    if (descriptionCache.has(workKey)) {
        const val = descriptionCache.get(workKey);
        if (val && val !== 'No synopsis available for this work.') return val;
    }
    try {
        const raw = await localforage.getItem(`${SYNOPSIS_DB_PREFIX}${workKey}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || Date.now() - parsed.ts > SYNOPSIS_CACHE_TTL) return null;
        if (parsed.desc && parsed.desc !== 'No synopsis available for this work.') {
            descriptionCache.set(workKey, parsed.desc);
            return parsed.desc;
        }
        return null;
    } catch {
        return null;
    }
};

const cacheSynopsis = (workKey, desc) => {
    if (!workKey || !desc) return;
    descriptionCache.set(workKey, desc);
    localforage.setItem(`${SYNOPSIS_DB_PREFIX}${workKey}`, JSON.stringify({ ts: Date.now(), desc })).catch(() => { });
};

const TITLE_CASE_LOWER = new Set([
    'and', 'or', 'nor', 'but', 'a', 'an', 'the', 'as', 'at', 'by',
    'for', 'in', 'of', 'on', 'per', 'to', 'up', 'via', 'with', 'vs', 'v',
    'from', 'into', 'onto', 'upon', 'about'
]);
const ROMAN_NUMERALS = new Set(['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii']);

const toCleanSubjectTitleCase = (subject) => {
    if (!subject || typeof subject !== 'string') return subject || '';
    const words = subject.split(/\s+/);
    return words.map((w, idx) => {
        if (w.includes('-')) {
            return w.split('-').map((subW, subIdx) => {
                const cleanSub = subW.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                if (ROMAN_NUMERALS.has(cleanSub)) return subW.toUpperCase();
                if (idx > 0 && subIdx > 0 && TITLE_CASE_LOWER.has(cleanSub)) return subW.toLowerCase();
                if (subW.length === 0) return subW;
                return subW.charAt(0).toUpperCase() + subW.slice(1).toLowerCase();
            }).join('-');
        }
        const cleanWord = w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '').toLowerCase();
        if (ROMAN_NUMERALS.has(cleanWord)) return w.toUpperCase();
        if (idx > 0 && TITLE_CASE_LOWER.has(cleanWord)) {
            const match = w.match(/^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$/);
            if (match) return match[1] + match[2].toLowerCase() + match[3];
            return w.toLowerCase();
        }
        const match = w.match(/^([^a-zA-Z0-9]*)(.*?)([^a-zA-Z0-9]*)$/);
        if (match && match[2].length > 0) {
            const capped = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
            return match[1] + capped + match[3];
        }
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
};

const isCleanLibrarySubjectsEnabled = () => safeStorage.getItem('ole_clean_library_subjects') !== 'false';

const isSynopsisCleanupEnabled = () => safeStorage.getItem('ole_clean_synopsis') !== 'false';

const cleanSynopsis = (rawDesc) => {
    if (!rawDesc || typeof rawDesc !== 'string') return '';
    if (rawDesc === 'No synopsis available for this work.') {
        return `<span style="opacity: 0.7; font-style: italic;">No synopsis available for this work.</span>`;
    }

    let text = rawDesc.trim();

    // 1. Strip Promotional / Spam Download Links & SEO spam tags
    // e.g. **A Court of Silver Flames pdf[ https://... ](...)**
    text = text.replace(/(?:\*{0,2})[^*\n]*?\b(?:pdf|epub|download|free ebook|ebook)\b[^*\n]*?\[\s*https?:\/\/[^\]]+\]\([^\)]+\)\s*(?:\*{0,2})/gi, '');

    // 2. Comprehensive Markdown Link Filter (identifies [anchor](url), strips spam, formats legitimate links)
    const isSpamLink = (anchor, url) => {
        const a = (anchor || '').toLowerCase();
        const u = (url || '').toLowerCase();
        const spamWords = /\b(pdf|epub|ebook|download|free book|free download|read online|full book)\b/i;
        const spamDomains = /(chesserresources|oceanofpdf|z-lib|libgen|vk\.com|archive\.org\/details\/.*(?:pdf|epub)|\.pdf|\.epub|\/doc\/)/i;
        return spamWords.test(a) || spamDomains.test(u) || /^https?:\/\//i.test(a.trim()) || !a.trim();
    };

    text = text.replace(/(?:\*{0,2})\[([^\]]*)\]\((https?:\/\/[^\)]+)\)(?:\*{0,2})/gi, (match, anchor, url) => {
        if (isSpamLink(anchor, url)) {
            return ''; // Strip spam link completely
        }
        return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="synopsis-link">${escapeHTML(anchor)}</a>`;
    });

    // 3. Strip Wikipedia / Academic Citation Markers (e.g. [1], [citation needed], [note 2])
    text = text.replace(/\[\s*(?:\d+|citation needed|note \d+|when\?|who\?|source\?)\s*\]/gi, '');

    // 4. Extract Source Citations into Footer Attribution Badge
    let sourceAttribution = '';
    const sourceRegex = /(?:\(|\[)?\s*(?:Source|From Wikipedia|From Goodreads)\s*:\s*(?:\[([^\]]+)\]\((https?:\/\/[^\)]+)\)|<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>|([^)\n\]]+))(?:\)|\])?/i;
    const sourceMatch = text.match(sourceRegex);
    if (sourceMatch) {
        const sourceName = (sourceMatch[1] || sourceMatch[4] || sourceMatch[5] || 'Source').trim();
        const sourceUrl = sourceMatch[2] || sourceMatch[3] || (sourceName.toLowerCase().includes('wikipedia') ? 'https://wikipedia.org' : null);

        sourceAttribution = sourceUrl
            ? `<div class="synopsis-source-badge">Source: <a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(sourceName)} ↗</a></div>`
            : `<div class="synopsis-source-badge">Source: ${escapeHTML(sourceName)}</div>`;

        text = text.replace(sourceMatch[0], '').trim();
    }

    // 5. Handle Scene Breaks / Horizontal Decorative Dividers
    // e.g. *** or * * * or --- or ___
    text = text.replace(/^[ \t]*(?:\*\s*){3,}$/gm, '<hr class="synopsis-divider">');
    text = text.replace(/^[ \t]*(?:-\s*){3,}$/gm, '<hr class="synopsis-divider">');
    text = text.replace(/^[ \t]*(?:_\s*){3,}$/gm, '<hr class="synopsis-divider">');

    // 6. Safe HTML sanitization for pre-existing raw HTML
    text = text.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (match, url, linkText) => {
        if (/^(javascript:|data:)/i.test(url)) return escapeHTML(linkText);
        if (isSpamLink(linkText, url)) return '';
        return `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" class="synopsis-link">${escapeHTML(linkText)}</a>`;
    });
    text = text.replace(/<\/?(?:div|span|font|style|script|iframe|object|embed)[^>]*>/gi, '');

    // 6. Markdown Typographic Formatting (CommonMark-compliant emphasis)
    // Bold + Italic: ***text*** or ___text___
    text = text.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/___([\s\S]+?)___/g, '<strong><em>$1</em></strong>');

    // Bold: **text** (allowing single * inside for nested italics) or __text__
    text = text.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([\s\S]+?)__/g, '<strong>$1</strong>');

    // Italic: *text* (word-boundary safe, handles *word*, *multiple words*, *decoration*)
    text = text.replace(/(?<!\*)\*([^*\n\s](?:[^*\n]*?[^*\n\s])?)\*(?!\*)/g, '<em>$1</em>');
    // Italic single character or standalone word: e.g. *x*
    text = text.replace(/(?<!\*)\*([^*\n\s])\*(?!\*)/g, '<em>$1</em>');
    // Italic underscore: _text_
    text = text.replace(/(?<![a-zA-Z0-9_])_([^_\n\s](?:[^_\n]*?[^_\n\s])?)_(?![a-zA-Z0-9_])/g, '<em>$1</em>');

    // Headings: # Heading -> <strong>Heading</strong>
    text = text.replace(/^#+\s*(.*?)$/gm, '<strong>$1</strong>');

    // 7. Cleanup Stray / Hanging Formatting Asterisks
    text = text.replace(/(?:^\s*\*{1,2}|\*{1,2}\s*$)/gm, '');

    // 8. Semantic Paragraphs & Line Breaks
    const paragraphs = text
        .split(/\r?\n\s*\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => `<p class="synopsis-paragraph">${p.replace(/\r?\n/g, '<br>')}</p>`);

    return (paragraphs.join('') || `<p class="synopsis-paragraph">${escapeHTML(text)}</p>`) + sourceAttribution;
};

const renderSynopsis = (rawDesc) => {
    if (!DOM.detailsDescription) return;
    if (!rawDesc || rawDesc === 'No synopsis available for this work.') {
        DOM.detailsDescription.innerHTML = '<span style="opacity: 0.6; font-style: italic;">No synopsis available for this work.</span>';
        return;
    }
    if (isSynopsisCleanupEnabled()) {
        DOM.detailsDescription.innerHTML = cleanSynopsis(rawDesc);
    } else {
        DOM.detailsDescription.textContent = rawDesc;
    }
};

const prefetchTrendingSynopses = async (books) => {
    if (!books || books.length === 0) return;
    // LOWEST-priority background job: synopses are invisible on the Home grid
    // (they only matter once a details drawer opens), so this job waits for
    // the shared throttled request queue to fully drain before claiming it.
    // Covers, title translations and user searches always go first.
    setTimeout(async () => {
        for (const b of books.slice(0, 8)) {
            if (isApiBlocked) break;
            if (!b.key || descriptionCache.has(b.key)) continue;
            const cached = await getCachedSynopsis(b.key);
            if (cached) continue;
            const workUrl = getWorkApiUrl(b.key);
            if (!workUrl) continue;
            // Yield until nothing else needs the API (covers/translations/searches)
            const quietDeadline = Date.now() + 30000;
            while (!fetchOpenLibrary.isQueueIdle() && Date.now() < quietDeadline && !isApiBlocked) {
                await new Promise(r => setTimeout(r, 500));
            }
            if (isApiBlocked) break;
            try {
                const res = await fetchOpenLibrary(workUrl);
                if (res && res.ok) {
                    const workData = await res.json();
                    let desc = '';
                    if (workData && workData.description) {
                        desc = typeof workData.description === 'string' ? workData.description : (workData.description.value || '');
                    }
                    if (!desc && workData && workData.notes) {
                        desc = typeof workData.notes === 'string' ? workData.notes : (workData.notes.value || '');
                    }
                    if (desc) {
                        cacheSynopsis(b.key, desc);
                    } else if (workData && (workData.title || workData.key)) {
                        cacheSynopsis(b.key, 'No synopsis available for this work.');
                    }
                }
            } catch {
                if (isApiBlocked) break;
            }
            await new Promise(r => setTimeout(r, 600));
        }
    }, 3000);
};



const DISCOVER_GENRES = ['Fantasy', 'Science Fiction', 'Mystery', 'Romance', 'History', 'Biography', 'Thriller', 'Classics', 'Horror', 'Adventure', 'Young Adult', 'Graphic Novels'];

const fetchGenreShelves = async () => {
    if (cachedGenreShelves && typeof cachedGenreShelves === 'object' && Object.keys(cachedGenreShelves).length > 0) {
        return cachedGenreShelves;
    }
    const GENRES_KEY = 'ole_genre_shelves_cache_v3';
    const GENRES_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days (was 24 hours)
    let isStale = false;
    try {
        const raw = await localforage.getItem(GENRES_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Date.now() - parsed.timestamp > GENRES_TTL) isStale = true;
            else cachedGenreShelves = parsed.data;
        } else {
            isStale = true;
        }
    } catch (e) {
        console.warn('Failed to read genre cache', e);
        isStale = true;
    }

    if (!cachedGenreShelves || isStale) {
        try {
            const results = {};
            await Promise.all(DISCOVER_GENRES.map(async (genre) => {
                try {
                    const res = await fetchOpenLibrary(`${API_BASE}?q=subject:"${encodeURIComponent(genre.toLowerCase())}"+AND+ratings_count:[10+TO+*]&limit=5&sort=editions`);
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
            cachedGenreShelves = results;
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
            if (!cachedGenreShelves) cachedGenreShelves = {};
        }
    }
    return cachedGenreShelves;
};

const prewarmCachedGenreCovers = async () => {
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
                if (b && b.cover_i) coverIds.push(b.cover_i);
            });
        }
    });
    if (coverIds.length === 0) return;

    // Fast parallel RAM warming from IndexedDB (reads all cached covers into RAM concurrently)
    const uncachedInRam = coverIds.filter(cid => !coverMemoryCache.has(cid));
    if (uncachedInRam.length > 0) {
        await Promise.all(uncachedInRam.map(cid =>
            getCachedCoverDataUrl(cid)
                .then(dataUrl => { if (dataUrl) rememberCoverInMemory(cid, dataUrl); })
                .catch(() => {})
        ));
    }

    // Background pre-fetch for missing covers (fresh device / cold cache) without blocking UI
    const missingFromCache = coverIds.filter(cid => !coverMemoryCache.has(cid));
    if (missingFromCache.length > 0) {
        missingFromCache.forEach(cid => {
            cacheCoverInBackground(cid);
        });
    }
};

const prewarmCachedTrendingCovers = async () => {
    if (!Array.isArray(cachedTrendingBooks) || cachedTrendingBooks.length === 0) return;
    const coverIds = cachedTrendingBooks.map(b => b && (b.cover_i || b.cover_edition_key)).filter(Boolean);
    if (coverIds.length === 0) return;

    // Fast parallel RAM warming from IndexedDB (reads all cached trending covers into RAM concurrently)
    const uncachedInRam = coverIds.filter(cid => !coverMemoryCache.has(cid));
    if (uncachedInRam.length > 0) {
        await Promise.all(uncachedInRam.map(cid =>
            getCachedCoverDataUrl(cid)
                .then(dataUrl => { if (dataUrl) rememberCoverInMemory(cid, dataUrl); })
                .catch(() => {})
        ));
    }
};
// IndexedDB is the primary store, but if it's corrupted, quota-blocked or
// disabled the app used to fall back to a cold network fetch on EVERY
// refresh (slow Home). A localStorage mirror keeps Home instant even when
// IndexedDB is unusable. Both writes are best-effort.
const TRENDING_KEY = 'ole_trending_cache_v4';
const TRENDING_LS_KEY = 'ole_trending_cache_v4_lsmirror';
const TRENDING_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

const parseTrendingPayload = (raw) => {
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

const renderDiscoverDashboard = async () => {
    searchRequestToken++; // navigating away cancels any in-flight search
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

        DOM.discoverDashboard.innerHTML = `
            <div>
                <div id="featuredClassicsGrid" class="book-grid">
                    <!-- Skeletons will show here first -->
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
                if (b.cover_i) {
                    const cached = coverMemoryCache.get(b.cover_i);
                    if (cached) {
                        // Instant synchronous memory hit: no async sequencer yield needed
                        coversHtml += `<img class="shelf-book-cover" src="${cached}" data-cover-id="${b.cover_i}" alt="Cover" />`;
                    } else {
                        // Pending img: the ordered loader assigns covers in order.
                        coversHtml += `<img class="shelf-book-cover cover-pending" data-cover-id="${b.cover_i}" alt="Cover" />`;
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
            cachedTrendingBooks = null;
            safeStorage.removeItem(TRENDING_LS_KEY);
            localforage.removeItem(TRENDING_KEY).catch(() => { });
        } else if (stored && Array.isArray(stored.books) && stored.books.length > 0) {
            cachedTrendingBooks = stored.books;
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
        const sharedFields = 'key,title,author_name,cover_i,first_publish_year,subject,place,edition_count,ratings_average,ratings_count,cover_edition_key,language,person';
        const currentYear = new Date().getFullYear();
        const recentSince = currentYear - 6;
        // Two pools fetched in parallel:
        // 1) Long-standing, widely-read books (proven classics/staples)
        // 2) Recently published books that are currently well-rated and being read now (actually trendy)
        const [classicsResponse, recentResponse] = await Promise.all([
            fetchOpenLibrary(`${API_BASE}?q=ratings_count:[100+TO+*]&limit=36&sort=editions&fields=${sharedFields}&contact=${API_CONTACT_EMAIL}`),
            fetchOpenLibrary(`${API_BASE}?q=first_publish_year:[${recentSince}+TO+${currentYear}]+AND+ratings_count:[20+TO+*]&limit=36&sort=rating&fields=${sharedFields}&contact=${API_CONTACT_EMAIL}`)
        ]);
        if (!classicsResponse.ok && !recentResponse.ok) throw new Error();
        const classicsData = classicsResponse.ok ? await classicsResponse.json() : { docs: [] };
        const recentData = recentResponse.ok ? await recentResponse.json() : { docs: [] };
        const classicsDocs = classicsData.docs || [];
        const recentDocs = recentData.docs || [];

        // Interleave the two pools (recent first, since that's the "trendier" signal) and dedupe by work key
        const seenKeys = new Set();
        const merged = [];
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

        featuredGrid.innerHTML = '';
        if (merged.length === 0) {
            featuredGrid.innerHTML = '<div style="opacity: 0.6; font-style: italic; padding: 1rem 0;">No trending books available at the moment.</div>';
            return;
        }
        cachedTrendingBooks = merged.slice(0, TRENDING_COUNT);
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
const injectSkeletonScreen = (isLoadMore = false, count = null) => {
    if (!isLoadMore) DOM.grid.innerHTML = ''; // Only wipe the grid on a fresh search
    DOM.status.style.display = 'none';
    DOM.grid.style.display = 'grid';
    const defaultCount = DOM.grid.classList.contains('list-view') ? 10 : 8;
    // When a specific number of items is known (e.g. translating N saved books),
    // show that many placeholders instead of a fixed default so the loading
    // animation accurately reflects how much work is happening.
    const skeletonsCount = (count != null && count > 0) ? count : defaultCount;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < skeletonsCount; i++) {
        const s = document.createElement('div');
        s.className = 'skeleton-card';
        s.innerHTML = `
            <div class="card-main">
                <div class="skeleton-cover skeleton-anim"></div>
                <div class="card-details" style="width:100%;">
                    <div class="skeleton-title skeleton-anim"></div>
                    <div class="skeleton-author skeleton-anim"></div>
                    <div>
                        <div class="skeleton-tag skeleton-anim"></div>
                        <div class="skeleton-tag skeleton-anim"></div>
                        <div class="skeleton-tag skeleton-anim"></div>
                    </div>
                </div>
            </div>
            <div class="skeleton-meta skeleton-anim"></div>
        `;
        fragment.appendChild(s);
    }
    DOM.grid.appendChild(fragment);
};
const performSearch = async (isLoadMore = false) => {
    if (!isLoadMore) collapseMobileSidebarIfOpen();
    resolvedTitlesInActivePass.clear();
    if (currentViewMode === 'library') return;
    if (!isLoadMore && !hasActiveSearchCriteria()) return;
    if (!isLoadMore) {
        translationQueue.clear();
        currentPage = 1;
        currentTotalHidden = 0;
        allDisplayedDocs = [];
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
        // Apply custom limit if toggled, otherwise default to 100
        let currentLimit = '100';
        if (DOM.customLimitToggle.checked) {
            currentLimit = DOM.fetchLimitSlider.value;
        }
        activeQueryParams.append('limit', currentLimit);
        activeQueryParams.append('fields', 'key,title,author_name,cover_i,first_publish_year,subject,place,edition_count,ratings_average,ratings_count,cover_edition_key,language,person');
        activeQueryParams.append('contact', API_CONTACT_EMAIL);
        saveStateToHash(true);
    } else {
        currentPage++;
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
        const response = await fetchOpenLibrary(`${API_BASE}?${activeQueryParams.toString()}`);
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
        lastSearchTotalFound = data.numFound || 0;
        const docs = data.docs || [];
        docs.forEach(d => {
            d.original_title = d.title;
            if (d.subject) d.subject = cleanSubjects(d.subject);
        });
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
            // Apply cached title updates first
            filteredDocs.forEach(b => {
                const cacheKey = `${b.key}_${targetLang}`;
                if (translationCache.has(cacheKey)) {
                    b.title = translationCache.get(cacheKey);
                }
            });
            const isSyncMode = DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked;
            if (isSyncMode) {
                const docsToTranslate = filteredDocs.filter(b => needsTranslation(b, targetLang));
                if (docsToTranslate.length > 0) {
                    // Stop the "Processing results... (Ns)" ticker so it doesn't fight with
                    // the translation progress text below and cause flicker.
                    clearInterval(fetchTimerInterval);
                    let completed = 0;
                    DOM.fetchStatus.textContent = `Translating titles (0/${docsToTranslate.length})...`;
                    const fetchTask = async (b) => {
                        const cacheKey = `${b.key}_${targetLang}`;
                        try {
                            const res = await fetchOpenLibrary(`https://openlibrary.org${b.key}/editions.json?limit=40`);
                            if (!res.ok) return;
                            const edData = await res.json();
                            if (edData && edData.entries && edData.entries.length > 0) {
                                const validEditions = edData.entries.filter(entry => {
                                    if (!entry.languages) return false;
                                    if (!isValidEditionForWork(entry, b.key)) return false;
                                    return entry.languages.some(lang => {
                                        const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                                        return editionLangMatches(code, targetLang);
                                    });
                                });
                                const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title);
                                if (matchingEdition && matchingEdition.title) {
                                    const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                                    const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                                    if (shouldReplaceTitle(b.title, fullTitle) && !isDuplicateTitle(fullTitle, b.key, targetLang)) {
                                        resolvedTitlesInActivePass.add(fullTitle.trim().toLowerCase());
                                        setTranslationCache(cacheKey, fullTitle);
                                        saveTranslationCache();
                                        if (fullTitle !== b.title) {
                                            b.title = fullTitle;
                                        }
                                    } else {
                                        setTranslationCache(cacheKey, b.title);
                                        saveTranslationCache();
                                    }
                                }
                            }
                        } catch { } finally {
                            completed++;
                            DOM.fetchStatus.textContent = `Translating titles (${completed}/${docsToTranslate.length})...`;
                        }
                    };
                    const batchSize = 5;
                    for (let i = 0; i < docsToTranslate.length; i += batchSize) {
                        const batch = docsToTranslate.slice(i, i + batchSize);
                        await Promise.all(batch.map(fetchTask));
                        if (i + batchSize < docsToTranslate.length) {
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }
                    }
                }
            }
        }
        const newStartIdx = allDisplayedDocs.length;
        allDisplayedDocs = allDisplayedDocs.concat(filteredDocs);
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
        renderResults(docs.length, lastSearchTotalFound, isLoadMore, hiddenInBatch, newStartIdx, needsFullRerender);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                renderTime = (performance.now() - renderStartTime) / 1000;
                clearInterval(fetchTimerInterval);
                const totalTime = (performance.now() - totalStartTime) / 1000;
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
        let finalErrorMsg = "";
        const isCooldown = error.message && error.message.includes("cooldown period");
        const isFailedFetch = error.message && error.message.toLowerCase().includes("failed to fetch");
        if (isCooldown) {
            finalErrorMsg = renderErrorHTML(
                "API Cooldown Active",
                "OpenLibrary has temporarily blocked requests. Please wait 5 minutes before trying again."
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
const getGridRowCapacity = (cardWidth) => {
    // Character budget for one tag row. The divisor (7px/char) and the width
    // offset (150px for cover + padding + gap) are deliberately conservative:
    // real uppercase tag text renders closer to ~7.5-8px/char, so a budget
    // computed at 6.2px/char over-packed rows and clipped the tail tag
    // against .tag-row's overflow:hidden. Anything that doesn't fit now falls
    // through to the +N overflow badge instead of being cut off. The floor is
    // kept low (12) for the same reason — the old 28-char floor overflowed
    // narrow cards entirely.
    return Math.max(12, Math.floor((cardWidth - 150) / 7));
};

const packTagsIntoOneRow = (subjects, rowCapacity = 80) => {
    if (!subjects || subjects.length === 0) return '';
    const tagCost = subject => subject.length + 8;
    const remaining = subjects.filter(subject => subject.length <= 26);
    const overflow = subjects.filter(subject => subject.length > 26);
    const row = [];
    const capacity = (remaining.length > 0 || overflow.length > 0)
        ? Math.max(12, rowCapacity - 10)
        : rowCapacity;
    let used = 0;
    for (let i = 0; i < remaining.length;) {
        const subject = remaining[i];
        const cost = tagCost(subject);
        if (used + cost <= capacity) {
            row.push(subject);
            used += cost;
            remaining.splice(i, 1);
        } else {
            i++;
        }
    }
    overflow.push(...remaining);
    const overflowBadge = overflow.length > 0
        ? `<span class="tag-overflow" data-subjects="${escapeHTML(JSON.stringify(overflow))}" title="Tap to see all tags">+${overflow.length}</span>`
        : '';
    return `<span class="tag-row">${row.map(subject => `<span class="tag" title="${escapeHTML(subject)}">${escapeHTML(subject)}</span>`).join('')}${overflowBadge}</span>`;
};

const packTagsIntoTwoRows = (subjects, rowCapacity = 44) => {
    if (!subjects || subjects.length === 0) return '';
    const tagCost = subject => subject.length + 8;
    const remaining = subjects.filter(subject => subject.length <= 26);
    const overflow = subjects.filter(subject => subject.length > 26);
    const rows = [[], []];

    rows.forEach((row, rowIndex) => {
        // Reserve room for the +n indicator on the second row whenever
        // there are subjects we have not placed yet.
        const capacity = (rowIndex === 1 && (remaining.length > 0 || overflow.length > 0))
            ? Math.max(12, rowCapacity - 10)
            : rowCapacity;
        let used = 0;
        for (let i = 0; i < remaining.length;) {
            const subject = remaining[i];
            const cost = tagCost(subject);
            if (used + cost <= capacity) {
                row.push(subject);
                used += cost;
                remaining.splice(i, 1);
            } else {
                i++;
            }
        }
    });

    overflow.push(...remaining);
    const activeRows = rows.filter(row => row.length);
    const rowHtml = activeRows
        .map((row, index) => {
            const isLastRow = index === activeRows.length - 1;
            const overflowBadge = (isLastRow && overflow.length > 0)
                ? `<span class="tag-overflow" data-subjects="${escapeHTML(JSON.stringify(overflow))}" title="Tap to see all tags">+${overflow.length}</span>`
                : '';
            return `<span class="tag-row">${row.map(subject => `<span class="tag" title="${escapeHTML(subject)}">${escapeHTML(subject)}</span>`).join('')}${overflowBadge}</span>`;
        })
        .join('');
    return rowHtml || `<span class="tag-row"><span class="tag-overflow" data-subjects="${escapeHTML(JSON.stringify(overflow))}" title="Tap to see all tags">+${overflow.length}</span></span>`;
};

const renderTagsHTML = (subjects, maxCharsOrCapacity = 44) => {
    if (!subjects || subjects.length === 0) return '';
    return packTagsIntoTwoRows(subjects, maxCharsOrCapacity);
};

// The first rendered card's width is identical for every card in the same
// grid, and reading offsetWidth forces a synchronous layout pass. buildCard
// runs once per card (50 per chunk), so memoize the measurement per grid
// element instead of re-reading it for every single card. refreshGridCardTags
// below re-measures and refreshes the memo whenever the layout actually
// changes (resize, sidebar settle), so it can't go stale.
let lastMeasuredGridEl = null;
let lastMeasuredCardWidth = 0;
const getGridCardWidth = (gridEl) => {
    if (gridEl !== lastMeasuredGridEl) {
        lastMeasuredGridEl = gridEl;
        lastMeasuredCardWidth = 0;
    }
    if (!lastMeasuredCardWidth && gridEl) {
        const first = gridEl.querySelector('.book-card');
        if (first) lastMeasuredCardWidth = first.offsetWidth || 0;
    }
    return lastMeasuredCardWidth || (window.innerWidth >= 1200 ? 450 : 380);
};

// Re-pack only when the card width actually moved. Gating on the *width*
// rather than the char-bucket matters: resize rAFs and sidebar-collapse
// settle callbacks can measure mid-transition, and a mid-transition width
// can land in the same bucket as the settled one — the old bucket gate then
// skipped the final re-pack, leaving tags packed for a wider card clipped
// on the right (most visible in desktop legacy, whose 57px rail shifts the
// grid width around a lot).
let lastTagReflowWidth = 0;
const refreshGridCardTags = () => {
    if (window.innerWidth <= 768 || (DOM.grid && DOM.grid.classList.contains('list-view'))) return;
    // Overlayed Sidebar: opening/closing the sidebar never changes card widths
    // (the floating panel doesn't squeeze the grid), so the per-toggle tag
    // recalculation is pure waste. Engagement CHANGES still recalc —
    // applyOverlayedSidebar forces one pass when the mode flips.
    if (document.body.classList.contains('overlayed-sidebar')) return;
    const firstCard = DOM.grid ? DOM.grid.querySelector('.book-card') : null;
    if (!firstCard) return;
    const currentWidth = firstCard.offsetWidth;
    lastMeasuredGridEl = DOM.grid;
    lastMeasuredCardWidth = currentWidth;
    const currentCapacity = getGridRowCapacity(currentWidth);
    if (Math.abs(currentWidth - lastTagReflowWidth) < 2) return;
    lastTagReflowWidth = currentWidth;
    DOM.grid.querySelectorAll('.tags-list.grid-tags').forEach(el => {
        const subjectsJson = el.dataset.subjects;
        if (!subjectsJson) return;
        try {
            const subjects = JSON.parse(subjectsJson);
            el.innerHTML = packTagsIntoTwoRows(subjects, currentCapacity);
            el.querySelectorAll('.tag-overflow').forEach(badge => {
                badge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openTagsPopup(badge);
                });
            });
        } catch { }
    });
};
const resolvingCoverKeys = new Set();
const resolveMissingCover = async (b, cardEl) => {
    if (!b || (!b.key && !b.title) || b.cover_i || b.cover_edition_key) return;
    const key = b.key;
    if (!key || resolvingCoverKeys.has(key)) return;
    resolvingCoverKeys.add(key);

    try {
        let workUrl = '';
        if (key.startsWith('/works/') || key.startsWith('/books/')) {
            workUrl = `https://openlibrary.org${key}.json`;
        } else if (key.startsWith('OL') && key.endsWith('W')) {
            workUrl = `https://openlibrary.org/works/${key}.json`;
        } else if (key.startsWith('OL') && key.endsWith('M')) {
            workUrl = `https://openlibrary.org/books/${key}.json`;
        }
        if (!workUrl) return;

        const res = await fetchOpenLibrary(workUrl);
        if (!res.ok) return;
        const data = await res.json();
        let foundCoverId = null;
        let foundEditionKey = null;

        if (Array.isArray(data.covers) && data.covers.length > 0 && data.covers[0] > 0) {
            foundCoverId = data.covers[0];
        } else if (data.cover_edition_key) {
            foundEditionKey = data.cover_edition_key;
        }

        if (foundCoverId || foundEditionKey) {
            if (foundCoverId) b.cover_i = foundCoverId;
            if (foundEditionKey) b.cover_edition_key = foundEditionKey;

            const savedBook = library.find(item => item.key === key);
            if (savedBook) {
                if (foundCoverId) savedBook.cover_i = foundCoverId;
                if (foundEditionKey) savedBook.cover_edition_key = foundEditionKey;
                localforage.setItem('ole_bookmarks', library).catch(console.error);
            }

            const targetCoverUrl = foundCoverId
                ? `https://covers.openlibrary.org/b/id/${foundCoverId}-M.jpg`
                : `https://covers.openlibrary.org/b/olid/${foundEditionKey}-M.jpg`;

            const containerEl = cardEl ? cardEl.querySelector('.cover-container') : document.querySelector(`.book-card[data-key="${CSS.escape(key)}"] .cover-container`);
            if (containerEl) {
                containerEl.innerHTML = `<img src="${targetCoverUrl}" data-cover-id="${foundCoverId || foundEditionKey}" class="book-cover" alt="Cover Image" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';">`;
            }
        }
    } catch (err) {
        console.warn('Could not resolve cover for', key, err);
    }
};
const buildCard = (b, isEditionsSort, filterLangAA) => {
    const card = document.createElement('div');
    card.className = 'book-card';
    if (b.key) card.setAttribute('data-key', b.key);
    const coverId = b.cover_i || b.cover_edition_key;
    const cachedCover = coverId ? coverMemoryCache.get(coverId) : null;
    let cover;
    if (cachedCover) {
        // Memory hit: instant, no sequencer needed.
        cover = `<img src="${cachedCover}" data-cover-id="${coverId}" class="book-cover" alt="Cover Image" loading="lazy" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';">`;
    } else if (coverId) {
        // No src yet — the ordered loader (hydrateCachedCovers) assigns
        // network covers strictly in reading order, one at a time.
        cover = `<img class="book-cover cover-pending" data-cover-id="${coverId}" alt="Cover Image">`;
    } else {
        cover = `<div class="no-cover">No Cover</div>`;
    }
    if (!coverId && b.key) {
        resolveMissingCover(b, card);
    }
    const author = b.author_name ? b.author_name[0] : 'Unknown Author';
    const year = b.first_publish_year || 'N/A';
    const ratingCount = b.ratings_count ? `(${b.ratings_count})` : '';
    const ratingDisplay = b.ratings_average ? `★ ${parseFloat(b.ratings_average).toFixed(1)} ${ratingCount}` : 'No rating';
    const editionBadge = (isEditionsSort && b.edition_count) ? `<span class="edition-badge">${b.edition_count} Editions</span>` : '';
    const isCleanSubjects = (currentViewMode === 'library' && isCleanLibrarySubjectsEnabled());
    const displayedSubjects = isCleanSubjects
        ? (b.subject || []).map(toCleanSubjectTitleCase)
        : (b.subject || []);
    const subjectCount = displayedSubjects.length;
    const tagsCompactHtml = subjectCount > 0
        ? `<span class="tags-compact-badge" data-subjects="${escapeHTML(JSON.stringify(displayedSubjects))}" title="Tap to see all tags">${subjectCount} tag${subjectCount === 1 ? '' : 's'}</span>`
        : '';
    const isInLibrary = library.some(saved => saved.key === b.key);
    let bookLangAA = 'en';
    if (b.language && b.language.length > 0) {
        const cleanLangs = b.language.map(l => l.replace('/languages/', ''));
        const hasEnglish = cleanLangs.includes('eng') || cleanLangs.includes('en');
        const olLang = hasEnglish ? 'eng' : cleanLangs[0];
        bookLangAA = langMapToAA[olLang] || olLang;
    }
    const heartSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isInLibrary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    if (selectionMode && b.key && selectedKeys.has(b.key)) {
        card.classList.add('selected');
    }
    card.innerHTML = `
        <span class="card-select-indicator">✓</span>
        <div class="card-main">
            <div class="cover-container">${cover}</div>
            <div class="card-details">
                <div class="book-title" title="${escapeHTML(b.title)}">${escapeHTML(b.title)}</div>
                <div class="book-author">by <span title="Search other books by ${escapeHTML(author)}">${escapeHTML(author)}</span></div>
                <div class="action-buttons">
                    <button class="library-btn ${isInLibrary ? 'in-library' : ''}" title="${isInLibrary ? 'Remove from Library' : 'Add to Library'}">${heartSVG}</button>
                </div>
                <div class="tags-list grid-tags" data-subjects="${escapeHTML(JSON.stringify(displayedSubjects))}">${packTagsIntoTwoRows(displayedSubjects, (window.innerWidth > 768 && (!DOM.grid || !DOM.grid.classList.contains('list-view'))) ? getGridRowCapacity(DOM.grid ? getGridCardWidth(DOM.grid) : 380) : 44)}</div>
                <div class="tags-list list-tags">${packTagsIntoOneRow(displayedSubjects, 80)}</div>
                ${tagsCompactHtml}
            </div>
        </div>
        <div class="book-meta">
            <div class="meta-left">
                <span class="pub-year">Published: ${escapeHTML(year.toString())}</span>
                ${editionBadge}
            </div>
            <strong>${ratingDisplay}</strong>
        </div>
    `;
    card.querySelectorAll('.tags-compact-badge, .tag-overflow').forEach(el => {
        if (el.dataset.subjects) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                openTagsPopup(el);
            });
        }
    });
    return card;
};
const openDetailsDrawer = async (b, finalAALang) => {
    // Populate simple local metadata immediately
    DOM.detailsTitle.textContent = b.title;
    const author = b.author_name ? b.author_name[0] : 'Unknown Author';
    DOM.detailsAuthor.textContent = `by ${author}`;
    DOM.detailsYear.textContent = `Published: ${b.first_publish_year || 'N/A'}`;
    const ratingCount = b.ratings_count ? `(${b.ratings_count})` : '';
    DOM.detailsRating.textContent = b.ratings_average ? `★ ${parseFloat(b.ratings_average).toFixed(1)} ${ratingCount}` : 'No rating';
    // Configure Anna's Archive hyperlink with current default metadata
    const aaQuery = encodeURIComponent(`${b.title}${author !== 'Unknown Author' ? ' ' + author : ''}`);
    DOM.detailsDownloadLink.href = `${ANNA_ARCHIVE_URL}/search?index=&page=1&sort=&ext=epub&lang=${finalAALang}&display=&q=${aaQuery}`;
    // Configure OpenLibrary footer button detailsOlBtn
    const urlPath = b.cover_edition_key ? `/books/${b.cover_edition_key}` : b.key;
    const olUrl = `https://openlibrary.org${urlPath}`;
    const newOlBtn = DOM.detailsOlBtn.cloneNode(true);
    DOM.detailsOlBtn.parentNode.replaceChild(newOlBtn, DOM.detailsOlBtn);
    DOM.detailsOlBtn = newOlBtn;
    DOM.detailsOlBtn.addEventListener('click', () => {
        window.open(olUrl, '_blank', 'noopener,noreferrer');
    });
    const escapedKey = b.key ? b.key.replace(/'/g, "\\'") : '';
    const cardInGrid = escapedKey ? document.querySelector(`.book-card[data-key='${escapedKey}']`) : null;
    const cardImg = cardInGrid ? cardInGrid.querySelector('.book-cover') : null;
    if (cardImg) {
        DOM.detailsCoverContainer.innerHTML = '';
        const clonedImg = cardImg.cloneNode(true);
        clonedImg.className = ''; // remove card classes
        clonedImg.style.width = '100%';
        clonedImg.style.height = '140px';
        clonedImg.style.objectFit = 'cover';
        clonedImg.style.borderRadius = '4px';
        clonedImg.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
        DOM.detailsCoverContainer.appendChild(clonedImg);
    } else {
        const detailCoverUrl = b.cover_i
            ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg`
            : (b.cover_edition_key
                ? `https://covers.openlibrary.org/b/olid/${b.cover_edition_key}-M.jpg`
                : null);
        DOM.detailsCoverContainer.innerHTML = detailCoverUrl
            ? `<img src="${detailCoverUrl}" alt="Cover Image" style="width:100%; height:140px; object-fit:cover; border-radius:4px; box-shadow:0 4px 8px rgba(0,0,0,0.15);" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';">`
            : `<div class="no-cover">No Cover</div>`;
    }
    // Render subjects list
    DOM.detailsSubjects.innerHTML = '';
    const isCleanSubjects = (currentViewMode === 'library' && isCleanLibrarySubjectsEnabled());
    const drawerSubjects = isCleanSubjects
        ? (b.subject || []).map(toCleanSubjectTitleCase)
        : (b.subject || []);
    if (drawerSubjects.length > 0) {
        let visible = [];
        let extraTags = [];
        let currentChars = 0;
        const maxBudget = window.innerWidth <= 768 ? 110 : 180;

        for (let i = 0; i < drawerSubjects.length; i++) {
            let s = drawerSubjects[i];
            if (s.length > 40) { extraTags.push(s); continue; }
            if (currentChars + s.length + 10 <= maxBudget || visible.length === 0) {
                visible.push(s);
                currentChars += s.length + 10;
            } else {
                extraTags.push(s);
            }
        }

        visible.forEach(s => {
            const span = document.createElement('span');
            span.className = 'tag';
            span.textContent = s;
            span.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDetailsDrawer();
                if (currentViewMode === 'library') DOM.viewSavedBtn.click();
                watchInputs.forEach(input => { input.value = ''; });
                tagManagerExc.clear(); tagManagerInc.clear();
                DOM.sort.value = 'relevance';
                DOM.sortNote.style.display = 'none';
                tagManagerInc.addTag(s);
                checkInputs();
                performSearch(false);
            });
            DOM.detailsSubjects.appendChild(span);
        });

        if (extraTags.length > 0) {
            const overflowSpan = document.createElement('span');
            overflowSpan.className = 'tag-overflow';
            overflowSpan.dataset.subjects = JSON.stringify(extraTags);
            overflowSpan.title = 'Tap to see all tags';
            overflowSpan.textContent = `+${extraTags.length}`;
            overflowSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                openTagsPopup(overflowSpan);
            });
            DOM.detailsSubjects.appendChild(overflowSpan);
        }
    } else {
        DOM.detailsSubjects.innerHTML = '<span style="opacity: 0.6; font-style: italic; font-size: 0.85rem;">No subjects listed.</span>';
    }
    // Configure Library Toggle Button
    const updateDrawerLibraryBtn = () => {
        const isInLib = library.some(saved => saved.key === b.key);
        DOM.detailsLibraryBtn.textContent = isInLib ? 'Remove from Library' : 'Add to Library';
        DOM.detailsLibraryBtn.className = isInLib ? 'secondary-btn' : 'primary-btn';
    };
    updateDrawerLibraryBtn();
    const newLibBtn = DOM.detailsLibraryBtn.cloneNode(true);
    DOM.detailsLibraryBtn.parentNode.replaceChild(newLibBtn, DOM.detailsLibraryBtn);
    DOM.detailsLibraryBtn = newLibBtn;
    DOM.detailsLibraryBtn.addEventListener('click', () => {
        toggleLibrary(b);
        updateDrawerLibraryBtn();
        // Update the card inside result grid visually if it exists
        if (cardInGrid) {
            const btn = cardInGrid.querySelector('.library-btn');
            if (btn) {
                const isInLib = library.some(saved => saved.key === b.key);
                btn.classList.toggle('in-library', isInLib);
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isInLib ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
            }
        }
        updateToggleAllBtnState();
    });
    currentDrawerWorkKey = b.key;
    // Show loading spinner for description
    DOM.detailsDescription.innerHTML = '<div class="details-spinner"></div>';
    // Open drawer overlay visually
    DOM.detailsDrawer.style.display = 'flex';
    DOM.detailsDrawer.offsetHeight; // Force reflow
    DOM.detailsDrawer.classList.add('active');
    // Description already fetched before? Show it immediately and skip the work
    // JSON round-trip on re-open (title/AA-link are already canonical from the
    // first open).
    if (descriptionCache.has(b.key)) {
        renderSynopsis(descriptionCache.get(b.key));
        return;
    }
    const persistedSynopsis = await getCachedSynopsis(b.key);
    if (persistedSynopsis) {
        renderSynopsis(persistedSynopsis);
        return;
    }
    // Fetch details in parallel: Work details (for description) & Edition details (for original title restoration if enabled)
    const workUrl = getWorkApiUrl(b.key);
    // Drawer requests are user-initiated — they jump the queue AHEAD of
    // background traffic (title-translation lookups flood the shared,
    // throttled request queue in the first ~20-30s after a query, which used
    // to make synopses crawl).
    let fetchPromises = [workUrl ? fetchOpenLibrary(workUrl, { priority: 'high' }).then(r => r.ok ? r.json() : null) : Promise.resolve(null)];
    const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
    // Explicit language filter only: with no filter there is nothing to
    // translate towards, so the edition lookup is skipped entirely.
    const targetLang = getExplicitTargetLang();
    if (isTransEnabled && targetLang && b.cover_edition_key) {
        fetchPromises.push(fetchOpenLibrary(`https://openlibrary.org/books/${b.cover_edition_key}.json`, { priority: 'high' }).then(r => r.ok ? r.json() : null));
    }
    try {
        const results = await Promise.all(fetchPromises);
        const workData = results[0];
        const editionData = results[1]; // Will be undefined if translation is disabled
        const cacheKey = `${b.key}_${targetLang}`;
        let canonicalTitle = (workData && workData.title) ? workData.title : b.title;
        if (isTransEnabled && targetLang && translationCache.has(cacheKey)) {
            canonicalTitle = translationCache.get(cacheKey);
        } else if (isTransEnabled && targetLang && editionData && editionData.title) {
            const isEditionTarget = editionData.languages && editionData.languages.some(lang => {
                const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                return editionLangMatches(code, targetLang);
            });
            if (isEditionTarget || !workData || workData.title !== editionData.title) {
                const candidateTitle = editionData.title + (editionData.subtitle ? `: ${editionData.subtitle}` : '');
                // Quality gate: edition records are frequently bloated
                // ("Title: With Many Illustrations, Critical Essays, and an
                // Extended Introduction...") — never let one replace an
                // already-correct displayed title.
                if (shouldReplaceTitle(b.title, candidateTitle)) {
                    canonicalTitle = candidateTitle;
                }
            }
        }
        DOM.detailsTitle.textContent = canonicalTitle;
        if (canonicalTitle && canonicalTitle !== b.title) {
            if (cardInGrid) {
                const titleEl = cardInGrid.querySelector('.book-title');
                if (titleEl) {
                    titleEl.textContent = canonicalTitle;
                    titleEl.title = canonicalTitle;
                }
            }
            b.title = canonicalTitle;
        }
        // Update Anna's Archive hyperlink with the canonical English title
        const cleanAAQuery = encodeURIComponent(`${canonicalTitle}${author !== 'Unknown Author' ? ' ' + author : ''}`);
        DOM.detailsDownloadLink.href = `${ANNA_ARCHIVE_URL}/search?index=&page=1&sort=&ext=epub&lang=${finalAALang}&display=&q=${cleanAAQuery}`;

        let desc = '';
        if (workData) {
            if (workData.description) {
                desc = typeof workData.description === 'string' ? workData.description : (workData.description.value || '');
            }
            if (!desc && workData.notes) {
                desc = typeof workData.notes === 'string' ? workData.notes : (workData.notes.value || '');
            }
        }
        if (desc) {
            cacheSynopsis(b.key, desc);
            renderSynopsis(desc);
        } else if (workData && (workData.title || workData.key)) {
            const noDesc = 'No synopsis available for this work.';
            cacheSynopsis(b.key, noDesc);
            renderSynopsis(noDesc);
        } else {
            DOM.detailsDescription.innerHTML = '<span style="opacity: 0.6; font-style: italic;">Failed to load description. Please check your connection or try again.</span>';
        }
    } catch {
        DOM.detailsDescription.innerHTML = '<span style="opacity: 0.6; font-style: italic;">Failed to load description. Please visit OpenLibrary directly.</span>';
    }
};
const closeDetailsDrawer = () => {
    currentDrawerWorkKey = null;
    closeTagsPopup();
    DOM.detailsDrawer.classList.remove('active');
    setTimeout(() => {
        DOM.detailsDrawer.style.display = 'none';
    }, 300);
};
const needsTranslation = (b, targetLang) => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return false;
    if (!targetLang) return false;
    if (!b.key) return false;
    const cacheKey = `${b.key}_${targetLang}`;
    if (translationCache.has(cacheKey)) return false;
    if (translationPromiseCache.has(cacheKey)) return false;
    const cleanLangs = (b.language || []).map(l => String(l).replace('/languages/', '').toLowerCase());
    // English targets are the destructive default of the old system: nearly
    // every popular work has English editions, and swapping a correct title
    // for an alternate English edition only ever degraded it. Now we only
    // proceed when the work's language data PROVES it is not an English
    // work (i.e. English absent entirely). Unknown language data -> leave
    // the title alone; the quality gate philosophy is "when in doubt, keep
    // the original".
    if (targetLang === 'eng' || targetLang === 'en') {
        if (cleanLangs.length === 0) return false;
        const hasEnglish = cleanLangs.some(l => l === 'eng' || l === 'en');
        return !hasEnglish;
    }
    // Non-English targets: skip when the work provably has no edition in the
    // target language, or when it is single-language anything (nothing to
    // switch to). Unknown language data still allows a check — the quality
    // gate below protects against bad swaps.
    if (!b.language || b.language.length === 0) return true;
    const hasTarget = cleanLangs.includes(targetLang);
    if (!hasTarget) return false;
    if (cleanLangs.length === 1) return false;
    return true;
};
// Quality gate for accepting a translated/alternate-edition title. The
// search payload usually carries the canonical, best-titled edition, so a
// swap must never degrade it: reject empty/oversized/shouty-spam candidates
// and trivial variants of the displayed title.
function shouldReplaceTitle(currentTitle, candidateTitle) {
    const cand = String(candidateTitle || '').trim();
    const cur = String(currentTitle || '').trim();
    if (!cand || cand === cur) return false;
    if (cand.length > 150 || cand.length < 2) return false;
    // Subtitle-spam guard: library edition records love stacking subtitles
    // ("Title: With Critical Essays, Illustrations, and an Introduction").
    if ((cand.match(/:/g) || []).length > 2) return false;
    const letters = cand.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 8 && letters === letters.toUpperCase()) return false;
    const normCand = normalizeForCompare(cand);
    if (normCand && normCand === normalizeForCompare(cur)) return false;
    // Appended-junk guard: a candidate that merely CONTAINS the displayed
    // title followed by extra material is bloat, not a better title.
    const normCur = normalizeForCompare(cur);
    if (normCur && normCand.startsWith(normCur) && normCand.length - normCur.length > 12) return false;
    return true;
}
const updateCardTitleInGrid = (workKey, newTitle) => {
    // Escape single quotes in keys just in case
    const escapedKey = workKey.replace(/'/g, "\\'");
    const card = document.querySelector(`.book-card[data-key='${escapedKey}']`);
    if (card) {
        const titleEl = card.querySelector('.book-title');
        if (titleEl) {
            titleEl.textContent = newTitle;
            titleEl.title = newTitle;
        }
    }
};
const setCardTranslatingActive = (workKey) => {
    if (DOM.reduceAnimationsToggle && DOM.reduceAnimationsToggle.checked) return;
    const escapedKey = workKey.replace(/'/g, "\\'");
    const card = document.querySelector(`.book-card[data-key='${escapedKey}']`);
    if (card) card.classList.add('is-translating');
};
const clearCardTranslatingHighlight = (workKey) => {
    const escapedKey = workKey.replace(/'/g, "\\'");
    const card = document.querySelector(`.book-card[data-key='${escapedKey}']`);
    if (card) card.classList.remove('is-translating');
};
// ── Viewport-gated progressive translation ───────────────────────────────
// Instead of a flat per-pass cap, translation lookups queue only for books
// on/near the screen (plus a leeway band below the fold). A throttled scroll
// hook extends the queue as the user scrolls deeper. Each book is marked
// with its target language once queued, so scroll re-runs are free.
const TRANSLATE_LEEWAY_PX = 900;
let activeTitleSyncDocs = [];
const queueViewportTranslations = () => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return;
    if (DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked) return;
    const targetLang = getExplicitTargetLang();
    if (!targetLang || activeTitleSyncDocs.length === 0) return;
    const limitY = window.innerHeight + TRANSLATE_LEEWAY_PX;
    activeTitleSyncDocs.forEach((b) => {
        if (!b.key || b._tq === targetLang) return;
        if (!needsTranslation(b, targetLang)) return;
        const card = document.querySelector(`.book-card[data-key='${CSS.escape(b.key)}']`);
        // Not rendered (beyond the current chunk window) or too far below the
        // viewport + leeway: leave it for a future scroll tick.
        if (!card) return;
        if (card.getBoundingClientRect().top > limitY) return;
        b._tq = targetLang;
        const cacheKey = `${b.key}_${targetLang}`;
        translationQueue.add(cacheKey, async () => {
            try {
                // Check cache again in case it was resolved while waiting in queue
                if (translationCache.has(cacheKey)) {
                    const cachedTitle = translationCache.get(cacheKey);
                    if (cachedTitle !== b.title) {
                        b.title = cachedTitle;
                        updateCardTitleInGrid(b.key, cachedTitle);
                    }
                    return;
                }
                if (!translationPromiseCache.has(cacheKey)) {
                    // Highlight only when a real network fetch is actually
                    // starting — never on cache hits or no-op outcomes, which
                    // used to make the borders flash across whole result sets.
                    setCardTranslatingActive(b.key);
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
                    const fetchPromise = (async () => {
                        try {
                            const response = await fetchOpenLibrary(`https://openlibrary.org${b.key}/editions.json?limit=40`, { signal: controller.signal });
                            clearTimeout(timeoutId);
                            if (!response.ok) return null;
                            return await response.json();
                        } catch (e) {
                            clearTimeout(timeoutId);
                            return null;
                        }
                    })();
                    translationPromiseCache.set(cacheKey, fetchPromise);
                }
                const data = await translationPromiseCache.get(cacheKey);
                if (data && data.entries && data.entries.length > 0) {
                    const validEditions = data.entries.filter(entry => {
                        if (!entry.languages) return false;
                        if (!isValidEditionForWork(entry, b.key)) return false;
                        return entry.languages.some(lang => {
                            const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                            return editionLangMatches(code, targetLang);
                        });
                    });
                    const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title);
                    if (matchingEdition && matchingEdition.title) {
                        const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                        const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                        if (shouldReplaceTitle(b.title, fullTitle) && !isDuplicateTitle(fullTitle, b.key, targetLang)) {
                            resolvedTitlesInActivePass.add(fullTitle.trim().toLowerCase());
                            setTranslationCache(cacheKey, fullTitle);
                            saveTranslationCache();
                            if (fullTitle !== b.title) {
                                b.title = fullTitle;
                                updateCardTitleInGrid(b.key, fullTitle);
                            }
                        } else {
                            // Replacement rejected by the quality gate — keep
                            // the displayed title and remember that decision
                            // so it isn't re-litigated every render.
                            setTranslationCache(cacheKey, b.title);
                            saveTranslationCache();
                        }
                    } else {
                        setTranslationCache(cacheKey, b.title);
                        saveTranslationCache();
                    }
                } else {
                    setTranslationCache(cacheKey, b.title);
                    saveTranslationCache();
                }
            } catch {
                // Fail silently
            } finally {
                translationPromiseCache.delete(cacheKey);
                clearCardTranslatingHighlight(b.key);
            }
        });
    });
};
const syncCardTitles = (docs) => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return;
    if (DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked) return;
    resolvedTitlesInActivePass.clear();
    // GATE: no explicit language filter -> stand down entirely. The old
    // `|| 'eng'` default launched a mass "translate to English" pass over
    // every search/boot, fetching alternate English editions for titles that
    // were already correct and swapping them for degraded variants.
    const targetLang = getExplicitTargetLang();
    if (!targetLang) return;
    // Cache pre-apply for books that need no lookup.
    docs.forEach((b) => {
        if (!b.key) return;
        const cacheKey = `${b.key}_${targetLang}`;
        if (!needsTranslation(b, targetLang) && translationCache.has(cacheKey)) {
            const cachedTitle = translationCache.get(cacheKey);
            if (cachedTitle !== b.title) {
                b.title = cachedTitle;
                updateCardTitleInGrid(b.key, cachedTitle);
            }
        }
    });
    activeTitleSyncDocs = docs;
    queueViewportTranslations();
};
const renderResults = (rawFetchedCount, totalFoundOnAPI, isLoadMore, hiddenInBatch, newStartIdx, needsFullRerender) => {
    checkInputs();
    DOM.btn.textContent = 'Find Books';
    DOM.loadMoreBtn.disabled = false;
    DOM.loadMoreBtn.textContent = 'Find More Books';
    DOM.status.style.display = 'none';
    if (!isLoadMore && rawFetchedCount === 0) {
        DOM.grid.innerHTML = '';
        DOM.status.textContent = 'No results found on Open Library for that exact combination.';
        DOM.status.style.display = 'block';
        return;
    }
    DOM.totalCount.classList.add('total-count-hoverable');
    DOM.totalCount.textContent = `Showing ${allDisplayedDocs.length} of ${(totalFoundOnAPI || 0).toLocaleString()} results`;
    DOM.resultsMeta.style.display = 'flex';
    DOM.grid.style.display = 'grid';
    DOM.footer.style.display = 'block';
    const isEditionsSort = activeSort === 'editions';
    const rawIncLang = DOM.incLang.value.trim().toLowerCase();
    const filterLangAA = rawIncLang ? (langMapToAA[rawIncLang] || rawIncLang) : null;
    if (!isLoadMore || needsFullRerender) {
        DOM.grid.innerHTML = '';
        renderIndex = 0;
        renderNextChunk(isEditionsSort, filterLangAA);
    } else {
        const activeSkeletons = DOM.grid.querySelectorAll('.skeleton-card');
        activeSkeletons.forEach(skel => skel.remove());
        renderIndex = newStartIdx;
        renderNextChunk(isEditionsSort, filterLangAA);
    }
    if ((activeMinStar > 0 || activeMinRCount > 0) && currentTotalHidden > 0) {
        DOM.hiddenMsg.textContent = `${currentTotalHidden} books from the fetched batches were hidden for not meeting your minimum rating requirements.`;
        DOM.hiddenMsg.style.display = 'block';
    } else { DOM.hiddenMsg.style.display = 'none'; }
    const currentLimit = parseInt(DOM.customLimitToggle && DOM.customLimitToggle.checked ? DOM.fetchLimitSlider.value : 100);
    DOM.loadMoreBtn.style.display = ((currentPage * currentLimit) >= totalFoundOnAPI || rawFetchedCount < currentLimit) ? 'none' : 'inline-block';
    if (allDisplayedDocs.length === 0) {
        DOM.status.textContent = 'All books in this batch were hidden by your rating filters. Click "Find More Books" to query the next batch.';
        DOM.status.style.display = 'block';
        DOM.grid.style.display = 'none';
    }
};
const renderSavedCollection = (books = library) => {
    const scrollEl = document.querySelector('main.results');
    const prevScroll = scrollEl ? scrollEl.scrollTop : window.scrollY;

    DOM.grid.innerHTML = '';
    DOM.footer.style.display = 'none';
    const isEditionsSort = DOM.sort.value === 'editions';
    if (books.length === 0) {
        DOM.status.textContent = library.length === 0
            ? 'Your Library is currently empty. Add books from search results to build your collection.'
            : 'No books in your Library match the current filters.';
        DOM.status.style.display = 'block';
        DOM.resultsMeta.style.display = 'none';
        DOM.grid.style.display = 'none';
    } else {
        DOM.status.style.display = 'none';
        const isLibraryUnfiltered = library.length === books.length;
        DOM.querySpeedContainer.style.display = 'inline-flex';
        DOM.totalCount.classList.remove('total-count-hoverable');
        DOM.totalCount.style.cursor = 'default';
        if (DOM.querySpeedTooltip) DOM.querySpeedTooltip.innerHTML = '';
        const showLibraryCountInText = document.body.classList.contains('mobile-legacy-layout') && isMobileViewport();
        DOM.totalCount.textContent = isLibraryUnfiltered
            ? (showLibraryCountInText ? `Showing all ${library.length} books in your library` : "Showing all books in your library")
            : `Showing ${books.length} of ${library.length} books in your library (filtered)`;
        DOM.resultsMeta.style.display = 'flex';
        DOM.grid.style.display = 'grid';
        const rawIncLang = DOM.incLang.value.trim().toLowerCase();
        const filterLangAA = rawIncLang ? (langMapToAA[rawIncLang] || rawIncLang) : null;
        renderIndex = 0;
        renderNextChunk(isEditionsSort, filterLangAA);
        if (prevScroll > 0) {
            requestAnimationFrame(() => {
                if (scrollEl && prevScroll > 0) scrollEl.scrollTop = prevScroll;
                if (window.scrollY !== prevScroll && prevScroll > 0) window.scrollTo(0, prevScroll);
            });
        }
    }
    updateToggleAllBtnState();
};
const updateToggleAllBtnState = () => {
    const isDiscoverVisible = DOM.discoverDashboard.style.display !== 'none';
    if (!isDiscoverVisible && DOM.resultsMeta.style.display === 'none' && currentViewMode === 'search') {
        DOM.toggleAllBtn.style.display = 'none';
        return;
    }

    if (isDiscoverVisible && currentDiscoverTab === 'genres') {
        DOM.toggleAllBtn.style.display = 'flex';
        DOM.toggleAllBtn.classList.add('disabled');
        DOM.toggleAllBtn.classList.remove('active', 'confirming');
        DOM.toggleAllBtn.disabled = true;
        DOM.toggleAllBtn.style.opacity = '0.4';
        DOM.toggleAllBtn.title = 'No books to add in Genres view';
        DOM.toggleAllBtn.innerHTML = `<svg width="18" height="18" viewBox="-2 -2 28 28" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <g transform="translate(4, -3) scale(0.85)">
            <path stroke-width="2.5" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" opacity="0.6"/>
        </g>
        <g transform="translate(-2, 2) scale(0.95)">
            <path stroke-width="2.5" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="var(--main-bg)"/>
        </g>
    </svg>`;
        return;
    } else {
        DOM.toggleAllBtn.disabled = false;
        DOM.toggleAllBtn.style.opacity = '';
    }

    const currentList = isDiscoverVisible
        ? (cachedTrendingBooks || [])
        : (currentViewMode === 'library' ? getLocalFilteredBooks() : allDisplayedDocs);
    if (currentList.length === 0) {
        if (currentViewMode === 'library') {
            DOM.toggleAllBtn.style.display = 'flex';
            DOM.toggleAllBtn.classList.add('disabled');
            DOM.toggleAllBtn.classList.remove('active', 'confirming');
            DOM.toggleAllBtn.title = 'Your library is empty';
            DOM.toggleAllBtn.innerHTML = `<svg width="18" height="18" viewBox="-2 -2 28 28" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <g transform="translate(4, -3) scale(0.85)">
            <path stroke-width="2.5" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" opacity="0.6"/>
        </g>
        <g transform="translate(-2, 2) scale(0.95)">
            <path stroke-width="2.5" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="var(--main-bg)"/>
        </g>
    </svg>`;
        } else {
            DOM.toggleAllBtn.style.display = 'none';
        }
        return;
    }
    DOM.toggleAllBtn.classList.remove('disabled');
    DOM.toggleAllBtn.style.display = 'flex';
    const allInLibrary = currentList.every(b => library.some(s => s.key === b.key));
    // Custom Interlocked Hearts SVG 
    // viewBox expanded from 24x24 to 28x28 to zoom out slightly and prevent stroke clipping
    const interlockedHearts = `<svg width="18" height="18" viewBox="-2 -2 28 28" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <g transform="translate(4, -3) scale(0.85)">
            <path stroke-width="2.5" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" opacity="0.6"/>
        </g>
        <g transform="translate(-2, 2) scale(0.95)">
            <path stroke-width="2.5" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="${allInLibrary ? 'currentColor' : 'var(--main-bg)'}"/>
        </g>
    </svg>`;
    DOM.toggleAllBtn.title = allInLibrary ? "Remove All from Library" : "Add All to Library";
    DOM.toggleAllBtn.innerHTML = interlockedHearts;
    DOM.toggleAllBtn.classList.toggle('active', allInLibrary);
};
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
DOM.customLimitToggle.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
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
    }
});
const validateAndApplyInputLimit = () => {
    let val = parseInt(DOM.limitValueDisplay.value.replace(/[^0-9]/g, ''));
    if (isNaN(val)) val = 100;
    const isExt = DOM.extendedLimitToggle.checked;
    const maxAllowed = isExt ? 100000 : 1000;
    const minAllowed = isExt ? 100 : 10;
    const step = isExt ? 100 : 10;
    // Clamp limits and strictly snap to nearest step 
    let clampedVal = Math.max(minAllowed, Math.min(val, maxAllowed));
    clampedVal = Math.round(clampedVal / step) * step;
    DOM.fetchLimitSlider.value = clampedVal;
    DOM.limitValueDisplay.value = clampedVal.toLocaleString();
};
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
const forceCardsRelayout = () => {
    // .book-card uses content-visibility:auto with contain-intrinsic-size as a
    // placeholder for off-screen cards; switching views/layouts changes the
    // container width via a pure class swap, and some Chrome versions keep the
    // size cached from before that change until something forces a relayout.
    // Synchronously disable content-visibility and force a reflow so the
    // browser re-measures every card at its new container width RIGHT NOW,
    // before painting the next frame. This prevents off-screen overflow.
    const containers = [DOM.grid, document.getElementById('featuredClassicsGrid')];
    const cards = [];
    containers.forEach(g => {
        if (g) g.querySelectorAll('.book-card').forEach(c => cards.push(c));
    });
    if (!cards.length) return;
    cards.forEach(card => { card.style.contentVisibility = 'visible'; });
    void document.body.offsetHeight;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            cards.forEach(card => { card.style.contentVisibility = ''; });
        });
    });
};

const applyListView = (enabled) => {
    DOM.grid.classList.toggle('list-view', enabled);
    const fg = document.getElementById('featuredClassicsGrid');
    if (fg) fg.classList.toggle('list-view', enabled);
    // Re-measure on-screen cards after the container-width change (see
    // forceCardsRelayout) so `content-visibility:auto` doesn't keep stale sizes
    // after swapping between grid and list view.
    forceCardsRelayout();
};
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
    const allInLibrary = currentList.every(b => library.some(s => s.key === b.key));
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
// Initialize Database and Auto-Migrate legacy data
// ── Crash-proof boot ─────────────────────────────────────────────────────
// The UI boot used to live inside a single Promise.all().then() with a
// silent .catch(console.error): one rejected storage read (corrupted or
// blocked IndexedDB), one corrupt legacy-JSON migration, or ONE malformed
// saved book (e.g. subjects stored as a string) killed the whole chain
// before renderDiscoverDashboard() ever ran — leaving a permanently blank
// content area on every refresh (header/sidebar painted, nothing else).
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
                if (b.subject) b.subject = cleanSubjects(b.subject);
                cacheBookTokens(b);
            } catch { }
        });
    } catch {
        library = [];
    }
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
        if (parsed) cachedTrendingBooks = parsed.books;
    }
    if (!cachedTrendingBooks) {
        // IndexedDB unreadable/empty → localStorage mirror fallback
        const mirrored = parseTrendingPayload(safeStorage.getItem(TRENDING_LS_KEY));
        if (mirrored) cachedTrendingBooks = mirrored.books;
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
const setSettingsPanelOpen = (open) => {
    if (open) {
        closeAllRailPopovers();
        // Always reset to Preferences tab when opening
        const prefTab = document.querySelector('.settings-tab[data-tab="preferences"]');
        if (prefTab) {
            document.querySelectorAll('.settings-tab').forEach(t => {
                const isActive = t === prefTab;
                t.classList.toggle('active', isActive);
                t.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            const prefPane = document.getElementById('settingsTabPreferences');
            const advPane = document.getElementById('settingsTabAdvanced');
            if (prefPane && advPane) {
                prefPane.style.display = 'flex';
                advPane.style.display = 'none';
                prefPane.classList.add('active');
                advPane.classList.remove('active');
            }
        }
    }
    DOM.settingsPanel.style.display = open ? 'block' : 'none';
    document.body.classList.toggle('settings-open', open);
};
DOM.settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setSettingsPanelOpen(DOM.settingsPanel.style.display === 'none');
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

const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
if (mobileSettingsBtn) {
    mobileSettingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setSettingsPanelOpen(DOM.settingsPanel.style.display === 'none');
    });
}
window.addEventListener('click', (e) => {
    if (DOM.settingsPanel.style.display === 'block' && !DOM.settingsPanel.contains(e.target) && e.target !== DOM.settingsBtn && e.target !== mobileSettingsBtn && !mobileSettingsBtn?.contains(e.target)) {
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
const mobileSidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
// Measure actual header height and expose as CSS custom property so extended
let lastWasMobileViewport = window.innerWidth <= 768;
let cachedHeaderHeight = 0;

function updateMobileHeaderHeight() {
    if (window.innerWidth <= 768) {
        const hdr = document.querySelector('header');
        if (hdr) {
            const h = Math.min(Math.floor(hdr.getBoundingClientRect().height), 80);
            if (h !== cachedHeaderHeight) {
                cachedHeaderHeight = h;
                document.documentElement.style.setProperty('--mobile-header-height', h + 'px');
            }
        }
    }
}

function checkMobileSidebarState() {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        document.body.classList.remove('compact-header');
        if (typeof restoreHeaderElementsToTop === 'function' && !document.body.classList.contains('mobile-legacy-layout')) {
            restoreHeaderElementsToTop();
        }
    }
    updateMobileHeaderHeight();
    const container = document.querySelector('.app-container');
    if (isMobile && container) {
        if (!lastWasMobileViewport) {
            container.classList.add('sidebar-collapsed');
            if (mobileSidebarBackdrop) {
                mobileSidebarBackdrop.classList.remove('active');
            }
        }
    }
    lastWasMobileViewport = isMobile;
}

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
        }
    });
}
// Details drawer close event listeners
DOM.detailsCloseBtn.addEventListener('click', closeDetailsDrawer);
DOM.detailsBackdrop.addEventListener('click', closeDetailsDrawer);
// Sidebar collapse toggle listener
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const legacyCollapsedRail = document.getElementById('legacyCollapsedRail');
const railFilterBtn = document.getElementById('railFilterBtn');
const railSortBtn = document.getElementById('railSortBtn');

// Settings is a fifth collapsed-rail control. Keeping it inside the rail
// avoids the legacy sidebar's hide/fade rules for ordinary form content.
if (mobileSettingsBtn && legacyCollapsedRail) {
    legacyCollapsedRail.appendChild(mobileSettingsBtn);
}

let sidebarExpandRevealTimeoutId = null;
// Timer for the mobile-legacy sidebar content-reveal fade (see
// triggerMobileLegacyReveal). Module-scoped so the layout-mode teardown in
// applyMobileLegacyLayout can clear it.
let mobileLegacyRevealTimeoutId = null;
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
const railPopoverState = {}; // groupId -> { popoverEl, placeholderEl, group, btn, open }

// Filter must always stack above Sort, regardless of which the person
// happened to open first — Object.keys() order previously followed click
// order, so opening Sort before Filter put Sort on top and let it claim the
// full remaining viewport height, cutting off Filter underneath it.
const RAIL_POPOVER_ORDER = ['filterGroup', 'sortGroup'];

// Only two of these ever exist (Filter, Sort) — rather than generic code for
// an arbitrary number of stacked popovers with a lot of position-bouncing
// logic to keep them from overlapping, this handles the two known cases
// directly: Filter is always on top, Sort always below it, and the one rule
// that actually matters is that neither can render past the other's edge or
// off the bottom of the screen.
const positionRailPopovers = () => {
    if (!legacyCollapsedRail) return;
    const openIds = Object.keys(railPopoverState)
        .filter(id => railPopoverState[id].open)
        .sort((a, b) => RAIL_POPOVER_ORDER.indexOf(a) - RAIL_POPOVER_ORDER.indexOf(b));
    if (!openIds.length) return;
    const railRect = legacyCollapsedRail.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;
    const bottomLimit = window.innerHeight - 16;
    const gap = 10;
    const isSidebarRight = document.body.classList.contains('sidebar-right');

    let top = Math.max(10, railRect.top);
    if (isMobile) {
        const headerEl = document.querySelector('.results-header');
        const headerHeight = headerEl ? headerEl.offsetHeight : 48;
        top = Math.max(headerHeight + 6, railRect.top);
    }

    openIds.forEach((id) => {
        const { popoverEl } = railPopoverState[id];
        const maxAllowedWidth = isMobile
            ? Math.min(340, Math.max(220, window.innerWidth - (railRect.width || 42) - 20))
            : 340;
        popoverEl.style.maxWidth = `${maxAllowedWidth}px`;
        const width = Math.min(popoverEl.offsetWidth || maxAllowedWidth, maxAllowedWidth);
        const marginGap = isMobile ? 8 : 14;

        let left;
        if (isSidebarRight) {
            left = Math.max(10, railRect.left - width - marginGap);
        } else {
            left = Math.min(railRect.right + marginGap, window.innerWidth - width - 10);
            left = Math.max(10, left);
        }

        popoverEl.style.left = `${left}px`;
        popoverEl.style.top = `${top}px`;
        popoverEl.style.height = 'auto';
        const available = Math.max(bottomLimit - top, 80);
        popoverEl.style.maxHeight = `${available}px`;
        top += Math.min(popoverEl.offsetHeight, available) + gap;
    });
};

const closeRailPopover = (groupId) => {
    const state = railPopoverState[groupId];
    if (!state || !state.open) return;
    const { popoverEl, placeholderEl, group, btn } = state;
    if (placeholderEl && placeholderEl.parentNode) {
        placeholderEl.parentNode.replaceChild(group, placeholderEl);
    }
    popoverEl.classList.remove('open');
    if (btn) btn.classList.remove('rail-btn-active');
    state.open = false;
    setTimeout(() => {
        if (!state.open && popoverEl.parentNode) popoverEl.parentNode.removeChild(popoverEl);
    }, 200);
    positionRailPopovers();
    if (!Object.keys(railPopoverState).some(id => railPopoverState[id].open)) {
        document.body.classList.remove('rail-popover-open');
    }
};

const closeAllRailPopovers = () => {
    Object.keys(railPopoverState).forEach(closeRailPopover);
};

// ── Sidebar Position (Left / Right) ───────────────────────────────────────
// Persisted as `ole_sidebar_side` ('left' | 'right') and applied as a
// body.sidebar-right class that all four layouts' CSS mirror off. The class
// is also set pre-paint by a tiny inline script in index.html so a right-side
// preference never flashes left on reload; this function is the source of
// truth and re-applies + re-syncs it on boot and on setting changes. Lives
// here (after the rail-popover helpers) so it can call them directly.
const getSidebarSide = () => safeStorage.getItem('ole_sidebar_side') === 'right' ? 'right' : 'left';
const syncSidebarSideUI = () => {
    const isRight = document.body.classList.contains('sidebar-right');
    // Mirrors the sun/moon switch: unchecked (knob left, over L) = Left,
    // checked (knob right, over R) = Right.
    if (DOM.sidebarSideToggle) DOM.sidebarSideToggle.checked = isRight;
};
// The toggle's home differs per layout, and getting it wrong makes the button
// vanish: in DEFAULT mode a collapsed sidebar is width:0/opacity:0, so the
// toggle must live in the CONTENT header row (which is always visible); in
// LEGACY mode the collapsed sidebar keeps its visible 57px rail, and the
// toggle belongs in the sidebar sticky header at the top of that rail.
//   - Legacy (left OR right):  sidebar sticky header
//   - Default + left sidebar:  .results-header-left (content header)
//   - Default + right sidebar: .results-header-right (content header, adjacent
//                              to the right-hand sidebar)
// Re-running this at the end of applyLegacyLayout keeps boot order and mode
// switches from stranding the button in a container that gets hidden.
// Mobile is untouched — both mobile layouts keep the toggle in the sidebar
// sticky header.
const relocateSidebarToggleForSide = () => {
    if (window.innerWidth <= 768) return;
    if (!sidebarToggleBtn) return;
    const resultsHeaderLeft = document.querySelector('.results-header-left');
    const resultsHeaderRight = document.querySelector('.results-header-right');
    if (!resultsHeaderRight || !resultsHeaderLeft) return;
    if (document.body.classList.contains('legacy-layout')) {
        // Legacy (left or right): the toggle always lives at the top of the
        // sidebar header — the collapsed 57px rail keeps it visible there.
        if (DOM.legacySlotAnchor) {
            DOM.legacySlotAnchor.parentNode.insertBefore(sidebarToggleBtn, DOM.legacySlotAnchor);
        }
    } else if (document.body.classList.contains('sidebar-right')) {
        // Default + right sidebar: dock into the right content header.
        resultsHeaderRight.appendChild(sidebarToggleBtn);
        const settingsBtn = document.getElementById('settingsBtn');
        if (settingsBtn && document.body.classList.contains('compact-header')) {
            resultsHeaderRight.appendChild(settingsBtn);
        }
    } else {
        // Default + left sidebar: dock into the left content header.
        resultsHeaderLeft.insertBefore(sidebarToggleBtn, DOM.resultsMeta);
    }
};
const applySidebarSide = (side, save = false) => {
    const isRight = side === 'right';
    document.body.classList.toggle('sidebar-right', isRight);
    if (save) safeStorage.setItem('ole_sidebar_side', isRight ? 'right' : 'left');
    syncSidebarSideUI();
    // Clean up state that assumes a specific side before the geometry below
    // re-reads the new class: close floating rail popovers and collapse an
    // open mobile sidebar so nothing is left half-transitioned across sides.
    closeAllRailPopovers();
    collapseMobileSidebarIfOpen();
    relocateSidebarToggleForSide();
    updateSwipeHintState();
    updateSwipeHintVisibility();
    // Resize listener re-syncs ear offset, rail popover positions, card tag
    // budgets, and mobile-layout state off the new body class.
    window.dispatchEvent(new Event('resize'));
};
applySidebarSide(getSidebarSide());
if (DOM.sidebarSideToggle) {
    DOM.sidebarSideToggle.addEventListener('change', () => {
        applySidebarSide(DOM.sidebarSideToggle.checked ? 'right' : 'left', true);
    });
}

const openRailPopover = (btn, groupId) => {
    const group = document.getElementById(groupId);
    if (!group) return;

    // Side rail popovers are strictly mutually exclusive: opening one closes
    // the other so only a single popover is ever active at a time.
    Object.keys(railPopoverState).forEach((id) => {
        if (id !== groupId) closeRailPopover(id);
    });

    const placeholderEl = document.createComment(`rail-popover-placeholder-${groupId}`);
    group.parentNode.insertBefore(placeholderEl, group);

    const popoverEl = document.createElement('div');
    popoverEl.className = 'rail-popover';
    popoverEl.appendChild(group);
    document.body.appendChild(popoverEl);

    group.open = true;

    railPopoverState[groupId] = { popoverEl, placeholderEl, group, btn, open: true };
    btn.classList.add('rail-btn-active');
    document.body.classList.add('rail-popover-open');
    positionRailPopovers();
    requestAnimationFrame(() => {
        popoverEl.classList.add('open');
        positionRailPopovers();
    });
};

// Filter/Sort rail shortcuts.
const wireRailShortcut = (btn, groupId) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
        const container = document.querySelector('.app-container');
        const isCollapsedLegacy = container && container.classList.contains('sidebar-collapsed')
            && document.body.classList.contains('legacy-layout');
        if (!isCollapsedLegacy) {
            // Sidebar isn't in its collapsed rail state (e.g. Legacy Layout is
            // off), so fall back to the previous behavior: expand + scroll.
            const wasCollapsed = container && container.classList.contains('sidebar-collapsed');
            if (wasCollapsed && sidebarToggleBtn) sidebarToggleBtn.click();
            const group = document.getElementById(groupId);
            if (group) {
                group.open = true;
                setTimeout(() => group.scrollIntoView({ behavior: 'smooth', block: 'start' }), wasCollapsed ? 320 : 0);
            }
            return;
        }
        const state = railPopoverState[groupId];
        if (state && state.open) {
            closeRailPopover(groupId); // toggle off on a second click
        } else {
            openRailPopover(btn, groupId);
        }
    });
};
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
let openTagsPopupEl = null;
let activeTagsPopupAnchor = null;
let tagsPopupBackdropEl = null;
let _tagsPopupClosedAt = 0;

const closeTagsPopup = () => {
    if (activeTagsPopupAnchor) {
        activeTagsPopupAnchor.classList.remove('active');
        activeTagsPopupAnchor = null;
    }
    if (openTagsPopupEl && openTagsPopupEl.parentNode) {
        openTagsPopupEl.parentNode.removeChild(openTagsPopupEl);
    }
    if (tagsPopupBackdropEl && tagsPopupBackdropEl.parentNode) {
        tagsPopupBackdropEl.parentNode.removeChild(tagsPopupBackdropEl);
    }
    openTagsPopupEl = null;
    tagsPopupBackdropEl = null;
    _tagsPopupClosedAt = Date.now();
};

document.addEventListener('click', (e) => {
    if (!openTagsPopupEl) return;
    if (openTagsPopupEl.contains(e.target)) return;
    if (e.target.closest('.tags-compact-badge, .tag-overflow')) return;
    closeTagsPopup();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTagsPopup();
});

const openTagsPopup = (anchorEl) => {
    if (Date.now() - _tagsPopupClosedAt < 80) return;

    if (openTagsPopupEl) {
        const isSameAnchor = (activeTagsPopupAnchor === anchorEl);
        closeTagsPopup();
        if (isSameAnchor) return;
    }
    let subjects = [];
    try {
        subjects = JSON.parse(anchorEl.dataset.subjects || '[]');
    } catch {
        subjects = [];
    }
    if (!subjects.length) return;

    if (anchorEl) {
        activeTagsPopupAnchor = anchorEl;
        anchorEl.classList.add('active');
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'tags-popup-backdrop';
    backdrop.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeTagsPopup();
    });
    document.body.appendChild(backdrop);
    tagsPopupBackdropEl = backdrop;

    const popup = document.createElement('div');
    popup.className = 'tags-popup';
    popup.innerHTML = subjects.map((s) => `<span class="tag">${escapeHTML(s)}</span>`).join('');
    document.body.appendChild(popup);
    openTagsPopupEl = popup;

    const rect = anchorEl.getBoundingClientRect();
    const width = popup.offsetWidth || 280;
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    left = Math.max(left, 12);

    let top = rect.bottom + 6;
    const availableBelow = window.innerHeight - top - 12;
    if (availableBelow < 120) {
        const availableAbove = rect.top - 12;
        const height = Math.max(120, Math.min(280, availableAbove - 6));
        top = Math.max(12, rect.top - 6 - height);
        popup.style.maxHeight = `${height}px`;
    } else {
        popup.style.maxHeight = `${Math.min(280, Math.max(120, availableBelow))}px`;
    }
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    requestAnimationFrame(() => popup.classList.add('open'));
};


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
let scrollClassTimeout = null;
const resultsMainEl = document.querySelector('main.results');
const resultsHeaderEl = document.querySelector('.results-header');
let stickyHeaderHideTimeout = null;

const handleScrollState = () => {
    positionRailPopovers();
    if (!document.body.classList.contains('is-scrolling')) {
        document.body.classList.add('is-scrolling');
    }
    if (resultsMainEl && !resultsMainEl.classList.contains('is-scrolling')) {
        resultsMainEl.classList.add('is-scrolling');
    }

    // Desktop fully-collapsible sidebar mode: smooth progressive sticky header
    if (!document.body.classList.contains('legacy-layout') && window.innerWidth > 768 && resultsMainEl && resultsHeaderEl) {
        const st = resultsMainEl.scrollTop;

        if (st >= 70) {
            resultsHeaderEl.classList.add('desktop-sticky-active');
            if (st >= 130) {
                const progress = Math.min(1, Math.max(0, (st - 130) / 300));
                resultsHeaderEl.classList.add('desktop-sticky-extending');
                resultsHeaderEl.style.setProperty('--desktop-sticky-progress', progress.toFixed(3));
            } else {
                resultsHeaderEl.classList.remove('desktop-sticky-extending');
                resultsHeaderEl.style.setProperty('--desktop-sticky-progress', '0');
            }
        } else {
            resultsHeaderEl.classList.remove('desktop-sticky-active', 'desktop-sticky-extending');
            resultsHeaderEl.style.removeProperty('--desktop-sticky-progress');
        }
    } else if (resultsHeaderEl && resultsHeaderEl.classList.contains('desktop-sticky-active')) {
        resultsHeaderEl.classList.remove('desktop-sticky-active', 'desktop-sticky-extending');
        resultsHeaderEl.style.removeProperty('--desktop-sticky-progress');
    }

    clearTimeout(scrollClassTimeout);
    scrollClassTimeout = setTimeout(() => {
        document.body.classList.remove('is-scrolling');
        if (resultsMainEl) resultsMainEl.classList.remove('is-scrolling');
    }, 80);
};
if (resultsMainEl) {
    resultsMainEl.addEventListener('scroll', handleScrollState, { passive: true });
}
window.addEventListener('scroll', handleScrollState, { passive: true });
// Progressive title translations: as the user scrolls, keep extending the
// lookup queue to books approaching the viewport (see TRANSLATE_LEEWAY_PX).
let translateScrollPending = false;
const scheduleViewportTranslations = () => {
    if (translateScrollPending) return;
    translateScrollPending = true;
    setTimeout(() => {
        translateScrollPending = false;
        if (typeof queueViewportTranslations === 'function') queueViewportTranslations();
    }, 250);
};
if (resultsMainEl) {
    resultsMainEl.addEventListener('scroll', scheduleViewportTranslations, { passive: true });
}
window.addEventListener('scroll', scheduleViewportTranslations, { passive: true });
// Legacy Layout: relocate toggleAllBtn, viewSavedBtn, and sidebarToggleBtn into the
// sidebar sticky header (replacing Reset/Find Books visually) when enabled, and
// restore them to the results header when disabled.
const applyLegacyLayout = (enabled) => {
    closeAllRailPopovers();
    document.body.classList.toggle('legacy-layout', enabled);
    if (resultsHeaderEl) {
        resultsHeaderEl.classList.remove('desktop-sticky-active', 'desktop-sticky-extending');
        resultsHeaderEl.style.removeProperty('--desktop-sticky-progress');
    }
    if (!DOM.sidebarStickyHeader || !DOM.legacySlotAnchor) return;
    const container = document.querySelector('.app-container');
    const isCollapsed = container && container.classList.contains('sidebar-collapsed');
    // Both mobile layouts share the same sidebar header — Library +
    // Add/Remove All, plus the toggle button in the default rail mode — so
    // the relocations below always apply on mobile, regardless of the
    // (desktop-only) Legacy Layout setting.
    const isMobile = window.innerWidth <= 768;
    // In Mobile Legacy Layout the rail doesn't exist (it's hidden by CSS) —
    // the Library / Add-Remove-All buttons must always sit in the sidebar
    // sticky header there, even while the sidebar is collapsed off-screen.
    const inMobileLegacy = document.body.classList.contains('mobile-legacy-layout');
    if (enabled || isMobile) {
        if (isMobile) DOM.sidebarStickyHeader.insertBefore(sidebarToggleBtn, DOM.legacySlotAnchor);
        if (isCollapsed && (enabled || isMobile) && !inMobileLegacy && legacyCollapsedRail && railFilterBtn) {
            legacyCollapsedRail.insertBefore(DOM.viewSavedBtn, railFilterBtn);
            legacyCollapsedRail.insertBefore(DOM.toggleAllBtn, railFilterBtn);
        } else if (inMobileLegacy) {
            if (DOM.homeBtn && DOM.homeBtn.parentNode) {
                DOM.homeBtn.parentNode.insertBefore(DOM.viewSavedBtn, DOM.homeBtn);
            }
            DOM.sidebarStickyHeader.insertBefore(DOM.toggleAllBtn, DOM.legacySlotAnchor);
        } else {
            DOM.sidebarStickyHeader.insertBefore(DOM.viewSavedBtn, DOM.legacySlotAnchor);
            DOM.sidebarStickyHeader.insertBefore(DOM.toggleAllBtn, DOM.legacySlotAnchor);
        }
    } else {
        const resultsHeaderLeft = document.querySelector('.results-header-left');
        const resultsHeaderRight = document.querySelector('.results-header-right');
        if (resultsHeaderRight) {
            resultsHeaderRight.appendChild(DOM.toggleAllBtn);
            resultsHeaderRight.appendChild(DOM.viewSavedBtn);
            const settingsBtn = document.getElementById('settingsBtn');
            if (settingsBtn && document.body.classList.contains('compact-header')) {
                resultsHeaderRight.appendChild(settingsBtn);
            }
        }
    }
    // Compact header application MUST run before the toggle relocation:
    // applyCompactHeader re-docks the settings button at the end of
    // .results-header-right, and relocateSidebarToggleForSide then appends
    // the sidebar toggle AFTER it — so with Sidebar Position = Right +
    // Compact Mode, the toggle hugs the sidebar-facing corner instead of
    // getting stranded to the left of the settings icon.
    if (DOM.compactHeaderToggle && DOM.compactHeaderToggle.checked) {
        applyCompactHeader(true);
    }
    // Re-run the side-based relocation after any layout-mode change so boot
    // order and mode switches can't leave the toggle stranded in a container
    // that gets hidden when the sidebar collapses (default mode collapses the
    // whole sidebar, so the toggle must sit in the content header there;
    // legacy keeps its 57px rail, so the toggle stays in the sidebar header).
    relocateSidebarToggleForSide();
    // Overlay engagement tracks the Legacy Layout state — switching layouts
    // must disengage/re-engage the floating sidebar + backdrop cleanly.
    applyOverlayedSidebar();
};
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
function restoreHeaderElementsToTop() {
    const headerSearchContainer = document.querySelector('.header-search-container');
    const settingsBtn = document.getElementById('settingsBtn');
    const headerControls = document.querySelector('.header-controls');
    const topHeader = document.querySelector('header');

    if (topHeader && headerSearchContainer) {
        if (headerControls && headerControls.parentNode === topHeader) {
            topHeader.insertBefore(headerSearchContainer, headerControls);
        } else if (topHeader.lastChild !== headerSearchContainer) {
            topHeader.appendChild(headerSearchContainer);
        }
    }
    if (headerControls && settingsBtn) {
        headerControls.appendChild(settingsBtn);
    }
}

const applyCompactHeader = (enabled) => {
    const isDesktop = window.innerWidth > 768;
    const shouldBeActive = !!(enabled && isDesktop);

    document.body.classList.toggle('compact-header', shouldBeActive);

    const headerSearchContainer = document.querySelector('.header-search-container');
    const settingsBtn = document.getElementById('settingsBtn');
    const resultsHeader = document.getElementById('resultsHeader');
    const resultsHeaderRight = document.querySelector('.results-header-right');

    if (shouldBeActive) {
        if (resultsHeader && headerSearchContainer && resultsHeaderRight) {
            if (headerSearchContainer.parentNode !== resultsHeader) {
                resultsHeader.insertBefore(headerSearchContainer, resultsHeaderRight);
            }
        }
        if (resultsHeaderRight && settingsBtn) {
            if (settingsBtn.parentNode !== resultsHeaderRight) {
                resultsHeaderRight.appendChild(settingsBtn);
            }
        }
    } else {
        restoreHeaderElementsToTop();
    }
};

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
// ── Right-side overlay: exact header-group clearance ────────────────────
// Static margins can't be right across scrollbar widths and mode paddings.
// This measures the REAL panel edge and slides the results-header-right
// group so its right edge sits exactly one half-button (18px) clear of the
// floating panel. Self-correcting: it reads the currently rendered
// position, so one pass is enough regardless of environment. Runs on
// resize, mode changes, and after each sidebar open/close settles.
function syncRightGroupGap() {
    var rh = document.querySelector('.results-header-right');
    var aside = document.querySelector('aside.filters');
    var container = document.querySelector('.app-container');
    if (!rh || !aside || !container) return;
    var active = document.body.classList.contains('overlayed-sidebar')
        && document.body.classList.contains('sidebar-right')
        && window.innerWidth > 768
        && !container.classList.contains('sidebar-collapsed');
    if (!active) { rh.style.removeProperty('--ole-rhdr-gap'); rh.style.marginRight = ''; return; }
        // Deterministic: the shift depends only on the main column scrollbar
    // reservation, NOT on live animation geometry. Identical result at any
    // point of the open/close cycle.
    var main = document.querySelector('main.results');
    var sbTotal = main ? (main.offsetWidth - main.clientWidth) : 0; // scrollbar (+borders)
    var railOffset = document.body.classList.contains('legacy-layout') ? 57 : 0;
    var shift = Math.max(0, Math.round(340 - railOffset - sbTotal));
    rh.style.setProperty('--ole-rhdr-gap', shift + 'px');
    rh.style.marginRight = shift + 'px'; // direct inline: no selector/var dependencies
}

function scheduleRightGroupSync() {
    if (rightGroupSyncTimer) clearTimeout(rightGroupSyncTimer);
    rightGroupSyncTimer = setTimeout(syncRightGroupGap, 60);
}

function applyOverlayedSidebar() {
    const toggle = document.getElementById('overlayedSidebarToggle');
    // Engages on BOTH desktop layout modes now (Legacy switch ON or OFF).
    // Desktop-only: mobile keeps its native swipe drawer.
    const effective = !!(toggle && toggle.checked && window.innerWidth > 768);
    const changed = document.body.classList.contains('overlayed-sidebar') !== effective;
    document.body.classList.toggle('overlayed-sidebar', effective);
    if (changed && typeof refreshGridCardTags === 'function') {
        // Engagement flips real card widths (grid stops/starts being
        // squeezed) — force one recalc now. Subsequent sidebar open/close
        // cycles under the overlay are suppressed inside refreshGridCardTags.
        refreshGridCardTags();
    }
    return changed;
}

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


// ── Mobile Legacy Layout (experimental) ─────────────────────────────────
// A second, independent mobile sidebar mode, entirely separate from the
// desktop Legacy Layout above. It never runs on desktop and never runs
// unless explicitly enabled, so the existing mobile rail behaviour is
// completely unaffected by default. When on, the sidebar has just two
// states — fully hidden or fully shown — controlled by left/right swipes
// instead of a toggle button, and the Settings icon relocates into the
// main results header (the toggle button's old spot) since there's no
// collapsed rail left to host it.
const mobileLayoutToggle = document.getElementById('mobileLayoutToggle');
const isMobileViewport = () => window.innerWidth <= 768;

// Remembers whether the desktop Legacy Layout was enabled before Mobile Legacy
// Layout took over, so disabling this mode can restore it (toggle + storage +
// actual layout) instead of silently dropping the user's earlier preference.
let desktopLegacyWasEnabled = false;

const applyMobileLegacyLayout = (enabled) => {
    document.body.classList.toggle('mobile-legacy-layout', enabled);
    // If the Alternative layout is being turned off (or is only usable on
    // mobile and the viewport left it), exit selection mode so no stale bar
    // or selection state lingers.
    if (!enabled && selectionMode) setSelectionMode(false);
    const container = document.querySelector('.app-container');
    const headerSearchContainer = document.querySelector('.header-search-container');

    // The desktop Legacy Layout (body.legacy-layout) is an independent,
    // entirely separate system. If it's still active while this mode runs,
    // its sidebar-sticky-header button relocations AND its
    // `body.legacy-layout .sidebar-collapsed aside.filters>* { opacity:0 !important }`
    // rule fight this mode: the relocated buttons end up in the wrong place
    // (issue: mobile legacy header showing desktop legacy's content), and the
    // swipe hint gets hidden under the opacity:0 rule (issue: hint invisible).
    // Only one layout mode can be active at a time on mobile, so enabling this
    // mode always resets the desktop legacy layout first, and disabling it
    // restores the desktop legacy layout if it was on before.
    if (enabled) {
        desktopLegacyWasEnabled = !!(DOM.legacyLayoutToggle && DOM.legacyLayoutToggle.checked);
        if (desktopLegacyWasEnabled) {
            // Undo the desktop legacy layout's button relocations and body class.
            applyLegacyLayout(false);
            // Keep the toggle + persisted value consistent with reality.
            DOM.legacyLayoutToggle.checked = false;
            safeStorage.setItem('ole_classic_layout', 'false');
        }
    } else {
        if (applyLegacyLayout && DOM.legacyLayoutToggle) {
            // If Mobile Legacy Layout was on, and the user didn't manually
            // re-enable desktop Legacy Layout in the meantime, put it back
            // exactly how it was before this mode took over.
            if (desktopLegacyWasEnabled && !DOM.legacyLayoutToggle.checked) {
                DOM.legacyLayoutToggle.checked = true;
                safeStorage.setItem('ole_classic_layout', 'true');
            }
            applyLegacyLayout(!DOM.legacyLayoutToggle.checked); scheduleRightGroupSync();
        }
    }

    if (mobileSettingsBtn) {
        if (enabled && headerSearchContainer) {
            // Top header row (logo | home | search | search button) stays
            // identically laid out across every view (Discover, Search,
            // Library), unlike the results header below it — which is why
            // the gear ended up looking stranded there instead of docking
            // in cleanly. It goes at the very end of this row (after the
            // search button) — the rightmost slot, not counting the site
            // logo which sits in its own separate block to the left.
            headerSearchContainer.appendChild(mobileSettingsBtn);
        } else if (!enabled && legacyCollapsedRail) {
            // Restore the default mobile rail's home for the settings button.
            legacyCollapsedRail.appendChild(mobileSettingsBtn);
        }
    }

    // Switching modes always resets to a clean collapsed state so nothing
    // is left half-transitioned (a stray inline transform, a rail icon
    // frozen mid-fade, etc.) between the two very different sidebar
    // mechanics.
    if (container) {
        container.classList.add('sidebar-collapsed');
        if (mobileSidebarBackdrop) mobileSidebarBackdrop.classList.remove('active');
        // Clear any leftover mid-drag state (dragging class, inline
        // transform/backdrop overrides) from the previous mode's gestures.
        const asideEl = container.querySelector('aside.filters');
        if (asideEl) {
            asideEl.classList.remove('dragging');
            asideEl.classList.remove('drag-pulling');
            asideEl.style.setProperty('--drag-transform', '');
        }
        // Clear any leftover content-reveal state from the mobile-legacy fade
        // so it can't linger half-applied when switching layouts.
        document.body.classList.remove('mobile-legacy-sidebar-revealing');
        clearTimeout(mobileLegacyRevealTimeoutId);
        if (mobileSidebarBackdrop) {
            mobileSidebarBackdrop.style.transition = '';
            mobileSidebarBackdrop.style.opacity = '';
        }
    }

    if (enabled && applyLegacyLayout) {
        // Enable-time relocation fix: applyLegacyLayout ran during initial
        // setup BEFORE this mode's body class existed, so its inMobileLegacy
        // branch was never taken — Library/Add-Remove-All ended up in the
        // collapsed rail, which this mode hides, leaving the shared sidebar
        // header empty. Now that the class is set, re-run it (always with
        // desktop legacy disabled so the two modes can't stack) so the
        // buttons land in the sticky header where they belong.
        applyLegacyLayout(false);
    }
    syncMobileEarOffset();
    updateSwipeHintState();

    // Re-measure on-screen cards after the container-width change (see
    // forceCardsRelayout) so `content-visibility:auto` doesn't keep stale sizes,
    // including the discover/trending grid shown on first load.
    forceCardsRelayout();
};

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
let lastDragEndTime = 0;

// Keep the hint's tooltip honest about which direction works right now.
// (Function declaration so applyMobileLegacyLayout — which runs earlier in
// this file — can call it during initial setup.)
function updateSwipeHintState() {
    const hint = document.getElementById('mobileSidebarSwipeHint');
    if (!hint) return;
    const container = document.querySelector('.app-container');
    const collapsed = !container || container.classList.contains('sidebar-collapsed');
    // Right-side sidebar: the off-canvas panel sits on the right, so you
    // swipe LEFT to pull it out and RIGHT to push it back.
    const isSidebarRight = document.body.classList.contains('sidebar-right');
    hint.title = collapsed
        ? (isSidebarRight ? 'Swipe left to open' : 'Swipe right to open')
        : (isSidebarRight ? 'Swipe right to close' : 'Swipe left to close');
}

function updateSwipeHintVisibility() {
    const isDiscoverVisible = DOM.discoverDashboard && DOM.discoverDashboard.style.display !== 'none';
    const isGenresTab = isDiscoverVisible && currentDiscoverTab === 'genres';
    document.body.classList.toggle('hide-swipe-hint', isGenresTab);
}

// The swipe hint lives OUTSIDE the sidebar (as a sibling of aside.filters)
// because the sidebar clips horizontal overflow while open — a tab poking
// out of its right edge would be cut off there. It's anchored to the
// app-container and slid to the sidebar's right edge via --ear-open-offset,
// which must track the aside's real layout width (330px, or 90vw on narrow
// phones). Function declaration so applyMobileLegacyLayout can call it.
function syncMobileEarOffset() {
    const container = document.querySelector('.app-container');
    if (!container) return;
    const asideEl = container.querySelector('aside.filters');
    const w = asideEl
        ? Math.round(asideEl.getBoundingClientRect().width)
        : Math.min(330, Math.round(window.innerWidth * 0.9));
    container.style.setProperty('--ear-open-offset', w + 'px');
}

// Drive the mobile-legacy sidebar content fade: while a slide transition
// (drag-release or ear-tap) is in flight, <body> gets this class so the CSS
// keeps the inner content hidden until the panel is fully extended, then
// fades it in. Mirrors the desktop legacy content-fade idea but scoped to
// the transform-based mobile-legacy slide.
function triggerMobileLegacyReveal() {
    clearTimeout(mobileLegacyRevealTimeoutId);
    document.body.classList.add('mobile-legacy-sidebar-revealing');
    mobileLegacyRevealTimeoutId = setTimeout(() => {
        document.body.classList.remove('mobile-legacy-sidebar-revealing');
    }, 340);
}

// Discoverability hint tab: a visible stand-in for the removed toggle
// button, doubling as a tap target so the swipe gesture isn't the only way
// in for anyone who doesn't try swiping. Toggles both directions, matching
// its open-arrow/close-arrow dual role.
const mobileSidebarSwipeHint = document.getElementById('mobileSidebarSwipeHint');
if (mobileSidebarSwipeHint) {
    mobileSidebarSwipeHint.addEventListener('click', (e) => {
        e.stopPropagation();
        if (Date.now() - lastDragEndTime < 350) return;
        const container = document.querySelector('.app-container');
        if (!container) return;
        const isCollapsed = container.classList.contains('sidebar-collapsed');
        container.classList.toggle('sidebar-collapsed', !isCollapsed);
        if (mobileSidebarBackdrop) mobileSidebarBackdrop.classList.toggle('active', isCollapsed);
        // Hide sidebar content during the open/close slide, fade it in once settled.
        triggerMobileLegacyReveal();
        updateSwipeHintState();
        window.dispatchEvent(new Event('resize'));
    });
}

// Re-evaluate on viewport crossing the mobile breakpoint, so e.g. rotating
// a tablet or resizing a desktop window past 768px cleanly drops back to
// the (unaffected) desktop layout without needing a manual toggle (coordinated in main resize listener).

// Drag-to-open/close: hold anywhere on screen, then drag right to pull the
// sidebar open (or left to push it closed). The sidebar tracks the finger
// 1:1 while dragging — no release-only detection — and on release it snaps
// fully open or fully collapsed depending on which side of the midpoint
// threshold it was left at. The swipe hint doubles as a grabbable ear:
// grabbing it and dragging works the same as dragging anywhere else.
// Only active while Mobile Legacy Layout is on and the viewport is mobile.
(() => {
    const container = document.querySelector('.app-container');
    const aside = container ? container.querySelector('aside.filters') : null;
    if (!container || !aside) return;

    const DRAG_ACTIVATE_DISTANCE = 12;   // horizontal px of intent before the drag takes over
    const DRAG_MAX_OFF_AXIS_RATIO = 0.6; // vertical drift allowed vs horizontal travel
    const SNAP_THRESHOLD = 0.5;          // release past 50% open → open; below → collapse

    // Right-side sidebar mirrors the whole gesture: the panel lives at
    // +100% instead of -100% and opens with a leftward swipe.
    const isSidebarRight = () => document.body.classList.contains('sidebar-right');

    let drag = null; // { startX, startY, wasCollapsed, active }

    const dragEligible = (target) => {
        if (!document.body.classList.contains('mobile-legacy-layout')) return false;
        if (!isMobileViewport()) return false;
        if (document.body.classList.contains('hide-swipe-hint')) return false;
        // Don't hijack touches on interactive controls. Every exclusion here
        // matters: mutating the sidebar's transform mid-tap (the old behavior
        // pinned --drag-transform/--ear-open-offset on EVERY touchstart)
        // cancels in-flight taps/focus under the finger — reads as "can't
        // click the search field / filter inputs" — and nudges the ear on
        // every single tap anywhere.
        if (target.closest('button, a, input, select, textarea, label, header, .results-header, .filters, .selection-bar, .rail-popover, .settings-dropdown, .details-drawer-overlay, input[type="range"], .tags-compact-badge, .tag-overflow, .tags-popup, .tags-popup-backdrop, .autocomplete-list, .ui-tags-wrap')) return false;
        return true;
    };

    // Progress 0 = fully collapsed, 1 = fully open. The transform is driven
    // through a CSS custom property (--drag-transform) because the collapsed/
    // expanded state rules mark their transforms !important, and !important
    // stylesheet rules beat inline styles — a plain inline transform would
    // be ignored. The .dragging rule (see style.css) reads the variable.
    // Positions are rounded to whole CSS pixels: slow drags land on
    // fractional offsets (the %-based translate of width×progress), and
    // rasterizing a moving layer at fractional offsets makes text and edges
    // look soft/wrong on phones until the layer settles on a whole pixel
    // (the "content only looks right once fully open and released"
    // symptom). Rounding keeps the aside and the ear integer-aligned on
    // every frame (aside x = -width + round(clamped×width), ear x =
    // round(clamped×width), so they stay exactly edge-to-edge).
    const setDragProgress = (progress, width) => {
        const clamped = Math.max(0, Math.min(1, progress));
        // Left side: collapsed = -100% (off-canvas left), so the offset is
        // (-1 + clamped) × width. Right side: collapsed = +100%, so it's
        // (1 - clamped) × width.
        const px = Math.round((isSidebarRight() ? 1 - clamped : -1 + clamped) * width);
        aside.style.setProperty('--drag-transform', `translateX(${px}px)`);
        if (mobileSidebarBackdrop) mobileSidebarBackdrop.style.opacity = String(clamped);
        // The ear is a sibling of the aside, so it can't inherit the aside's
        // transform; it slides via --ear-open-offset instead. Driving it from
        // the same progress keeps it glued to the sidebar's right edge
        // mid-drag instead of staying frozen at its open/closed resting spot.
        container.style.setProperty('--ear-open-offset', `${Math.round(width * clamped)}px`);
    };

    document.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        if (!dragEligible(e.target)) return;
        // RECORD-ONLY: do NOT mutate any DOM here (no .dragging class, no
        // --drag-transform/--ear-open-offset writes). The old behavior pinned
        // those on every touchstart, which (a) visibly nudged the ear on
        // every tap anywhere and (b) cancelled in-flight taps/focus on
        // interactive elements — the "locked out of everything outside main"
        // bug. Mutations happen once real horizontal drag intent is detected,
        // in the touchmove handler below.
        drag = {
            startX: e.touches[0].clientX,
            startY: e.touches[0].clientY,
            wasCollapsed: container.classList.contains('sidebar-collapsed'),
            // Capture the aside's real layout width at grab time (330px, or
            // 90vw on narrow phones) so the ear tracks the same units as the
            // aside's translateX percentages even if the viewport changes.
            asideWidth: aside.getBoundingClientRect().width || 300,
            active: false
        };
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!drag) return;
        const t = e.touches[0];
        const dx = t.clientX - drag.startX;
        const dy = t.clientY - drag.startY;
        if (!drag.active) {
            // A hold becomes a drag only once the horizontal intent is
            // clear (enough sideways travel, not actually a vertical scroll).
            if (Math.abs(dx) < DRAG_ACTIVATE_DISTANCE) return;
            if (Math.abs(dy) > Math.abs(dx) * DRAG_MAX_OFF_AXIS_RATIO) return;
            // Only drag in the direction matching the sidebar's state:
            // right to open when collapsed, left to close when open — and
            // mirrored for a right-side sidebar (left to open, right to
            // close).
            const wantsOpen = isSidebarRight() ? dx < 0 : dx > 0;
            if (wantsOpen === !drag.wasCollapsed) return;
            drag.active = true;
            // ── Deferred mutations: only now that a REAL drag has begun do we
            // touch the DOM. Kill the CSS transition so the sidebar tracks the
            // finger 1:1 instead of lagging behind it.
            aside.classList.add('dragging');
            // The .dragging rule reads --drag-transform with a translateX(-100%)
            // fallback — pin it to the sidebar's current position so the grab
            // doesn't snap it fully closed for the duration of the drag.
            aside.style.setProperty('--drag-transform', drag.wasCollapsed
                ? (isSidebarRight() ? 'translateX(100%)' : 'translateX(-100%)')
                : 'translateX(0)');
            // Pin the ear to the sidebar's resting edge too, so adding the
            // .dragging transform rule (which reads the offset var) doesn't jump
            // the ear from wherever syncMobileEarOffset last left it.
            container.style.setProperty('--ear-open-offset', `${drag.asideWidth * (drag.wasCollapsed ? 0 : 1)}px`);
            if (mobileSidebarBackdrop) mobileSidebarBackdrop.style.transition = 'none';
            // Mark that the sidebar is actually being pulled so the content-fade
            // CSS hides it only during a real drag, not on a plain tap/press.
            aside.classList.add('drag-pulling');
        }
        // Use the width captured at grab time instead of re-measuring: a
        // getBoundingClientRect() per touchmove forces a synchronous layout
        // pass on every frame, which on real phones is what turned slow
        // drags into choppy, lag-spiking slides.
        const width = drag.asideWidth;
        // Opening travels TOWARD the sidebar's side: rightward on a left-side
        // sidebar, leftward on a right-side one. Multiplying dx by the
        // direction keeps the progress math side-agnostic below.
        const dir = isSidebarRight() ? -1 : 1;
        const travel = dir * dx;
        if (drag.wasCollapsed) {
            setDragProgress(travel / width, width);
        } else {
            setDragProgress(1 + travel / width, width);
        }
    }, { passive: true });

    const endDrag = (e) => {
        if (!drag) return;
        // Plain taps (no drag intent detected) never mutated any DOM, so they
        // get a zero-cost exit — no snap math, no resize dispatch, no reveal
        // flash. Only real drags run the release logic below.
        if (!drag.active) { drag = null; return; }
        const t = e.changedTouches && e.changedTouches[0];
        const dx = t ? t.clientX - drag.startX : 0;
        const width = aside.getBoundingClientRect().width || 300;
        const dir = isSidebarRight() ? -1 : 1;
        const travel = dir * dx;
        const progress = drag.wasCollapsed
            ? Math.max(0, Math.min(1, travel / width))
            : Math.max(0, Math.min(1, 1 + travel / width));
        const shouldOpen = progress >= SNAP_THRESHOLD;

        aside.classList.remove('dragging');
        aside.classList.remove('drag-pulling');
        aside.style.setProperty('--drag-transform', '');
        if (mobileSidebarBackdrop) {
            mobileSidebarBackdrop.style.transition = '';
            mobileSidebarBackdrop.style.opacity = '';
        }
        container.classList.toggle('sidebar-collapsed', !shouldOpen);
        if (mobileSidebarBackdrop) mobileSidebarBackdrop.classList.toggle('active', shouldOpen);
        if (drag.active) {
            // The release that just dragged the sidebar can also surface as a
            // click on the hint — mark it so the hint's tap handler ignores it.
            lastDragEndTime = Date.now();
            // Hide sidebar content during the snap slide, fade it in once settled.
            triggerMobileLegacyReveal();
        }
        drag = null;
        // Re-derive the settled ear offset from the aside's real width now
        // that the .dragging transform rule no longer applies (the CSS open/
        // collapsed state rules take over from here with their own transition).
        syncMobileEarOffset();
        updateSwipeHintState();
        window.dispatchEvent(new Event('resize'));
    };

    document.addEventListener('touchend', endDrag, { passive: true });
    document.addEventListener('touchcancel', endDrag, { passive: true });
})();

// Reduce Animations: persist the setting and expose it as a body class so
// CSS-driven decorative animations (the swipe hint's nudge, etc.) respect it
// too — previously this only gated the translation-highlight animation
// directly in JS and had no saved state or CSS hook at all.
if (DOM.reduceAnimationsToggle) {
    DOM.reduceAnimationsToggle.checked = safeStorage.getItem('ole_reduce_animations') === 'true';
    const syncReduceAnimations = () => {
        document.body.classList.toggle('reduce-animations', DOM.reduceAnimationsToggle.checked);
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
if (DOM.translateToggle && DOM.completeTranslationRow) {
    const syncRow = () => {
        DOM.completeTranslationRow.style.display = DOM.translateToggle.checked ? 'flex' : 'none';
        if (currentViewMode === 'library') applyLocalFilters();
    };
    DOM.translateToggle.addEventListener('change', syncRow);
    syncRow();
}
if (DOM.completeTranslateToggle) {
    DOM.completeTranslateToggle.addEventListener('change', () => {
        if (currentViewMode === 'library') applyLocalFilters();
    });
}

// ── Reset All Settings to Default ───────────────────────────────────────
const resetAllSettingsToDefault = () => {
    // 1. Clear all preference & advanced settings keys from storage (keeps bookmarks intact)
    const settingKeys = [
        'ole_theme',
        'ole_list_view',
        'ole_sidebar_side',
        'ole_compact_header',
        'ole_classic_layout',
        'ole_mobile_legacy_layout',
        'ole_reduce_animations',
        'ole_clean_synopsis',
        'ole_clean_library_subjects',
        'ole_translate',
        'ole_complete_translation',
        'ole_persist_url',
        'ole_enhanced_autofill',
        'ole_custom_limit',
        'ole_fetch_limit',
        'ole_extended_limit'
    ];
    settingKeys.forEach(k => safeStorage.removeItem(k));

    // 2. Reset Theme to default (system preference or dark)
    const isDarkDefault = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    syncThemeCheckboxes(isDarkDefault, false);

    // 3. Reset List View to default (mobile: list, desktop: grid)
    const defaultListView = window.innerWidth <= 768;
    if (DOM.listViewToggle) {
        DOM.listViewToggle.checked = defaultListView;
    }
    if (typeof applyListView === 'function') {
        applyListView(defaultListView);
    }

    // 4. Reset Compact Mode to ON
    if (DOM.compactHeaderToggle) {
        DOM.compactHeaderToggle.checked = true;
    }
    if (typeof applyCompactHeader === 'function') {
        applyCompactHeader(false);
    }

    // 5. Reset Legacy Layout to Modern (OFF)
    if (DOM.legacyLayoutToggle) {
        DOM.legacyLayoutToggle.checked = false;
    }
    if (typeof applyLegacyLayout === 'function') {
        applyLegacyLayout(true);
    }

    // 5b. Reset Overlayed Sidebar to OFF
    const overlayedSidebarToggleReset = document.getElementById('overlayedSidebarToggle');
    if (overlayedSidebarToggleReset) {
        overlayedSidebarToggleReset.checked = true;
        safeStorage.setItem('ole_overlayed_sidebar', 'true');
    }
    if (typeof applyOverlayedSidebar === 'function') {
        applyOverlayedSidebar();
    }

    // 6. Reset Sidebar Position to Left
    if (typeof applySidebarSide === 'function') {
        applySidebarSide('left', true);
    }
    if (DOM.sidebarSideToggle) {
        DOM.sidebarSideToggle.checked = false;
    }

    // 7. Reset Mobile Alternative Layout to OFF
    const mobileLayoutToggle = document.getElementById('mobileLayoutToggle');
    if (mobileLayoutToggle) {
        mobileLayoutToggle.checked = false;
    }
    if (typeof applyMobileLegacyLayout === 'function') {
        applyMobileLegacyLayout(false);
    }

    // 8. Reset Reduce Animations to OFF
    if (DOM.reduceAnimationsToggle) {
        DOM.reduceAnimationsToggle.checked = false;
    }
    document.body.classList.remove('reduce-animations');

    // 9. Reset Clean Synopses & Clean Subjects to ON (default)
    const cleanSynopsisToggle = document.getElementById('cleanSynopsisToggle');
    if (cleanSynopsisToggle) {
        cleanSynopsisToggle.checked = true;
    }
    if (DOM.cleanLibrarySubjectsToggle) {
        DOM.cleanLibrarySubjectsToggle.checked = true;
    }
    if (currentDrawerWorkKey && descriptionCache.has(currentDrawerWorkKey)) {
        if (typeof renderCurrentSynopsis === 'function') {
            renderCurrentSynopsis();
        }
    }

    // 10. Reset Title Translation to ON & Complete Translation to OFF
    if (DOM.translateToggle) {
        DOM.translateToggle.checked = true;
    }
    if (DOM.completeTranslateToggle) {
        DOM.completeTranslateToggle.checked = false;
    }
    if (DOM.completeTranslationRow) {
        DOM.completeTranslationRow.style.display = 'flex';
    }

    // 11. Reset URL Sync to ON
    if (DOM.persistToggle) {
        DOM.persistToggle.checked = true;
    }

    // 12. Reset Enhanced Autocomplete to ON
    if (DOM.enhancedAutofillToggle) {
        DOM.enhancedAutofillToggle.checked = true;
    }

    // 13. Reset Custom Fetch Limit to OFF (100)
    if (DOM.customLimitToggle) {
        DOM.customLimitToggle.checked = false;
    }
    if (DOM.customLimitContainer) {
        DOM.customLimitContainer.style.display = 'none';
    }
    if (DOM.fetchLimitSlider) {
        DOM.fetchLimitSlider.value = 100;
        DOM.fetchLimitSlider.max = 1000;
    }
    if (DOM.limitValueDisplay) {
        DOM.limitValueDisplay.value = '100';
    }
    if (DOM.extendedLimitToggle) {
        DOM.extendedLimitToggle.checked = false;
        DOM.extendedLimitToggle.disabled = true;
    }
    if (DOM.extendedLimitWrapper) {
        DOM.extendedLimitWrapper.style.opacity = '0.5';
        DOM.extendedLimitWrapper.style.pointerEvents = 'none';
    }
    if (DOM.extendedWarning) {
        DOM.extendedWarning.style.display = 'none';
    }
    if (typeof state !== 'undefined' && state) {
        state.customLimit = 100;
    }

    // 14. Button feedback
    const resetBtn = DOM.resetSettingsBtn || document.getElementById('resetSettingsBtn');
    if (resetBtn) {
        const origText = resetBtn.textContent;
        resetBtn.textContent = '✓ Reset to Default!';
        resetBtn.style.color = '#10b981';
        resetBtn.style.borderColor = '#10b981';
        setTimeout(() => {
            resetBtn.textContent = origText;
            resetBtn.style.color = '';
            resetBtn.style.borderColor = '';
        }, 1500);
    }
};

if (DOM.resetSettingsBtn) {
    DOM.resetSettingsBtn.addEventListener('click', resetAllSettingsToDefault);
}

// ── Mobile Alternative Layout: selection mode ─────────────────────────────
// Hold-to-select on book cards, gated to the Alternative mobile layout
// (body.mobile-legacy-layout) + ≤768px. Long-pressing a card enters
// selection mode; tapping cards then toggles their selection; the pinned
// selection bar below the header provides select-all + bulk add/remove.
const mainResultsEl = document.querySelector('main.results');
const isSelectionEligible = () => {
    return document.body.classList.contains('mobile-legacy-layout') && window.innerWidth <= 768;
};

// Current visible book list for select-all / bulk actions.
const getCurrentSelectionList = () => {
    if (DOM.discoverDashboard.style.display !== 'none') {
        return currentDiscoverTab === 'trending' ? (cachedTrendingBooks || []) : [];
    }
    return currentViewMode === 'library' ? getLocalFilteredBooks() : allDisplayedDocs;
};

const updateSelectionBar = () => {
    if (!DOM.selectionBar) return;
    const count = selectedKeys.size;
    DOM.selectionCount.textContent = `${count} selected`;
    const list = getCurrentSelectionList();
    const allSelected = list.length > 0 && list.every(b => selectedKeys.has(b.key));
    DOM.selectionSelectAllBtn.textContent = allSelected ? 'Deselect all' : 'Select all';
    // Smart label: if every selected book is already in the library → Remove,
    // otherwise → Add. Mixed selections get "Add to Library" (adds the missing).
    let nonLibraryCount = 0;
    selectedKeys.forEach(key => {
        if (!library.some(s => s.key === key)) nonLibraryCount++;
    });
    const removing = selectedKeys.size > 0 && nonLibraryCount === 0;
    // Heart icon matching the site's library-button visual language.
    const heartSVG = `<svg class="bulk-heart" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    DOM.selectionBulkBtn.innerHTML = `${heartSVG}<span>${removing ? `Remove ${count}` : `Add ${count}`}</span>`;
};

const setSelectionMode = (active) => {
    selectionMode = active;
    lastSelectionModeChange = Date.now();
    // The bar's visibility is driven entirely by the body class + CSS
    // (transform slide + pointer-events), so no inline display toggling —
    // that would bypass the transition and snap the bar in/out instantly.
    document.body.classList.toggle('mobile-selection-active', active);
    if (!active) {
        selectedKeys.clear();
        document.querySelectorAll('.book-card.selected').forEach(card => card.classList.remove('selected'));
    }
    updateSelectionBar();
};

const toggleCardSelection = (workKey) => {
    if (!workKey) return;
    if (selectedKeys.has(workKey)) selectedKeys.delete(workKey);
    else selectedKeys.add(workKey);
    const escapedKey = workKey.replace(/'/g, "\\'");
    const card = document.querySelector(`.book-card[data-key='${escapedKey}']`);
    if (card) card.classList.toggle('selected', selectedKeys.has(workKey));
    updateSelectionBar();
    // Exit when the last card is deselected.
    if (selectedKeys.size === 0) setSelectionMode(false);
};

const clearHoldTimer = () => {
    if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
    }
};

// Hold gesture on cards. Uses pointer events so it works for both touch and
// mouse, gated to the alternative layout + mobile viewport.
mainResultsEl.addEventListener('pointerdown', (e) => {
    if (!isSelectionEligible()) return;
    if (e.target.closest('.tags-compact-badge, .tag-overflow')) return;
    clearHoldTimer();
    holdSuppressClick = false;
    holdStart = null;
    const card = e.target.closest('.book-card');
    if (!card) return;
    // Holds can start anywhere on the card (cover, author, tags, heart). A
    // quick tap still works: pointerup cancels the 450ms timer before it
    // fires, so the click reaches handleGridClick normally; and when a hold
    // does fire, holdSuppressClick (checked in handleGridClick) swallows the
    // trailing click so the card's single-tap action doesn't also fire.
    holdStart = { x: e.clientX, y: e.clientY, card };
    holdTimer = setTimeout(() => {
        if (!holdStart) return;
        const workKey = holdStart.card.getAttribute('data-key');
        if (!workKey) return;
        holdSuppressClick = true;
        if (!selectionMode) {
            setSelectionMode(true);
            selectedKeys.add(workKey);
            const escapedKey = workKey.replace(/'/g, "\\'");
            const cardEl = document.querySelector(`.book-card[data-key='${escapedKey}']`);
            if (cardEl) cardEl.classList.add('selected');
            updateSelectionBar();
        }
        if (navigator.vibrate) navigator.vibrate(10);
    }, SELECTION_HOLD_MS);
});

mainResultsEl.addEventListener('pointermove', (e) => {
    if (!holdStart || holdTimer === null) return;
    const dx = e.clientX - holdStart.x;
    const dy = e.clientY - holdStart.y;
    if (Math.hypot(dx, dy) > SELECTION_MOVE_TOLERANCE) {
        clearHoldTimer();
        holdStart = null;
    }
});

const cancelHold = () => {
    clearHoldTimer();
    holdStart = null;
};

mainResultsEl.addEventListener('pointerup', cancelHold);
mainResultsEl.addEventListener('pointercancel', cancelHold);
mainResultsEl.addEventListener('pointerleave', cancelHold);

// Block the browser's native long-press context menu (back/forward/copy
// etc.) on cards while the Alternative mobile layout is active — a 450ms
// hold is exactly when those menus pop up, fighting the selection gesture.
// Only gated to the Alternative layout, so desktop and the default mobile
// layout keep their normal long-press behavior.
mainResultsEl.addEventListener('contextmenu', (e) => {
    if (isSelectionEligible() && e.target.closest('.book-card')) {
        e.preventDefault();
    }
});

// Selection bar buttons.
if (DOM.selectionCloseBtn) {
    DOM.selectionCloseBtn.addEventListener('click', () => setSelectionMode(false));
}
if (DOM.selectionSelectAllBtn) {
    DOM.selectionSelectAllBtn.addEventListener('click', () => {
        const list = getCurrentSelectionList();
        if (list.length === 0) return;
        const allSelected = list.every(b => selectedKeys.has(b.key));
        if (allSelected) {
            list.forEach(b => {
                selectedKeys.delete(b.key);
                const escapedKey = b.key.replace(/'/g, "\\'");
                const card = document.querySelector(`.book-card[data-key='${escapedKey}']`);
                if (card) card.classList.remove('selected');
            });
        } else {
            list.forEach(b => {
                selectedKeys.add(b.key);
                const escapedKey = b.key.replace(/'/g, "\\'");
                const card = document.querySelector(`.book-card[data-key='${escapedKey}']`);
                if (card) card.classList.add('selected');
            });
        }
        updateSelectionBar();
    });
}
if (DOM.selectionBulkBtn) {
    DOM.selectionBulkBtn.addEventListener('click', () => {
        const keys = Array.from(selectedKeys);
        if (keys.length === 0) return;
        // Determine add vs. remove by checking if all selected are in library.
        const allInLibrary = keys.every(key => library.some(s => s.key === key));
        const currentList = getCurrentSelectionList();
        const bookByKey = (key) => currentList.find(b => b.key === key) ||
            library.find(b => b.key === key);
        let changed = false;
        keys.forEach(key => {
            const idx = library.findIndex(s => s.key === key);
            if (!allInLibrary && idx === -1) {
                const b = bookByKey(key);
                if (b) {
                    library.push(createLibraryDoc(b));
                    changed = true;
                }
            } else if (allInLibrary && idx > -1) {
                library.splice(idx, 1);
                changed = true;
            }
        });
        if (changed) {
            cachedSubjectCounts = null;
            cachedLocalFilteredBooks = null;
            localforage.setItem('ole_bookmarks', library).catch(console.error);
            updateLibraryBadge();
            // Refresh heart state on all visible cards at once.
            document.querySelectorAll('.book-card').forEach(card => {
                const key = card.getAttribute('data-key');
                const btn = card.querySelector('.library-btn');
                if (!key || !btn) return;
                const isInLib = library.some(s => s.key === key);
                btn.classList.toggle('in-library', isInLib);
                btn.title = isInLib ? 'Remove from Library' : 'Add to Library';
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isInLib ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
            });
            if (currentViewMode === 'library') {
                // Removed items vanish from the library view → exit selection.
                setSelectionMode(false);
                applyLocalFilters();
            }
        }
        updateToggleAllBtnState();
        if (selectionMode) updateSelectionBar();
    });
}

// Escape selection mode when the grid / view changes, the layout toggles off,
// or the viewport crosses the mobile breakpoint.
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectionMode) setSelectionMode(false);
});
const handleGridClick = (e, getBookFn) => {
    // A long-press that just entered selection mode is immediately followed by
    // a synthetic click on the same card. Swallow it once so it doesn't toggle
    // the just-selected card back off (which would exit selection mode right as
    // the bar finishes sliding in). holdSuppressClick is only ever set true
    // inside the mobile-legacy hold gesture, so this is a no-op on desktop and
    // the default mobile rail layout.
    if (holdSuppressClick) {
        holdSuppressClick = false;
        return;
    }
    const card = e.target.closest('.book-card');
    if (!card) return;
    // While selection mode is active (Alternative mobile layout only), a tap
    // on a card toggles its selection — nothing else (tags, author, details
    // drawer) should fire. The heart button is the one exception: it stays
    // interactive so the user can still toggle a single book's library state
    // while selecting. This must be the very first check because DOM.grid /
    // DOM.discoverDashboard are lower in the DOM than document, so their
    // handlers fire before any document-level listener could stopPropagation.
    if (isSelectionEligible() && selectionMode) {
        const libraryBtn = e.target.closest('.library-btn');
        if (libraryBtn) {
            // Per-card library toggle while in selection mode.
            e.stopPropagation();
            const workKey = card.getAttribute('data-key');
            const b = workKey ? getBookFn(workKey) : null;
            if (b) {
                toggleLibrary(b);
                const isNowInLibrary = libraryBtn.classList.toggle('in-library');
                libraryBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isNowInLibrary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
                updateToggleAllBtnState();
            }
            return;
        }
        // Otherwise toggle selection.
        e.stopPropagation();
        e.preventDefault();
        const workKey = card.getAttribute('data-key');
        if (workKey) {
            if (selectedKeys.has(workKey)) {
                selectedKeys.delete(workKey);
                card.classList.remove('selected');
                if (selectedKeys.size === 0) setSelectionMode(false);
            } else {
                selectedKeys.add(workKey);
                card.classList.add('selected');
            }
            updateSelectionBar();
        }
        return;
    }
    const workKey = card.getAttribute('data-key');
    if (!workKey) return;
    const b = getBookFn(workKey);
    if (!b) return;
    // 0. Tag-count badge (list view) or "+N" overflow badge (grid view)
    // clicked — show the full tag list, and stop it from falling through to
    // "open details drawer" below.
    const tagsPopupAnchor = e.target.closest('.tags-compact-badge, .tag-overflow');
    if (tagsPopupAnchor) {
        e.stopPropagation();
        if (tagsPopupAnchor.dataset.subjects) openTagsPopup(tagsPopupAnchor);
        return;
    }
    // 1. Tag clicked
    const tagEl = e.target.closest('.tag');
    if (tagEl) {
        if (window.innerWidth <= 768) return;
        e.stopPropagation();
        const value = tagEl.textContent;
        if (e.shiftKey) {
            const wasAdded = modifyTagFilter(value, tagManagerInc);
            showStageToast('include', value, wasAdded);
        } else if (e.ctrlKey || e.metaKey) {
            const wasAdded = modifyTagFilter(value, tagManagerExc);
            showStageToast('exclude', value, wasAdded);
        } else {
            if (currentViewMode === 'library') DOM.viewSavedBtn.click();
            watchInputs.forEach(input => { input.value = ''; });
            tagManagerExc.clear(); tagManagerInc.clear();
            DOM.sort.value = 'relevance';
            DOM.sortNote.style.display = 'none';
            tagManagerInc.addTag(value);
            checkInputs();
            performSearch(false);
        }
        return;
    }
    // 2. Author span clicked
    const authorSpan = e.target.closest('.book-author span');
    if (authorSpan) {
        e.stopPropagation();
        const author = b.author_name ? b.author_name[0] : 'Unknown Author';
        if (author !== 'Unknown Author') {
            window.open(`https://openlibrary.org/search?author=${encodeURIComponent(author)}`, '_blank', 'noopener,noreferrer');
        }
        return;
    }
    // 3. Library button clicked
    const libraryBtn = e.target.closest('.library-btn');
    if (libraryBtn) {
        e.stopPropagation();
        toggleLibrary(b);
        const isNowInLibrary = libraryBtn.classList.toggle('in-library');
        libraryBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isNowInLibrary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
        updateToggleAllBtnState();
        return;
    }
    // 4. Clicked elsewhere on card: Open details drawer
    let bookLangAA = 'en';
    if (b.language && b.language.length > 0) {
        const cleanLangs = b.language.map(l => l.replace('/languages/', '').toLowerCase());
        const olLang = cleanLangs[0];
        bookLangAA = langMapToAA[olLang] || olLang;
    }
    const targetLang = DOM.incLang.value.trim().toLowerCase();
    const filterLangAA = langMapToAA[targetLang] || targetLang;
    const finalAALang = filterLangAA || bookLangAA;
    openDetailsDrawer(b, finalAALang);
};
DOM.grid.addEventListener('click', (e) => {
    handleGridClick(e, (key) => {
        return currentViewMode === 'library' ? library.find(item => item.key === key) : allDisplayedDocs.find(item => item.key === key);
    });
});
DOM.discoverDashboard.addEventListener('click', (e) => {
    const featuredGrid = document.getElementById('featuredClassicsGrid');
    if (!featuredGrid || !featuredGrid.contains(e.target)) return;
    handleGridClick(e, (key) => {
        return cachedTrendingBooks ? cachedTrendingBooks.find(item => item.key === key) : null;
    });
});

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

// Mobile: shorten inactive discover tab labels so flex-shrink can compress them
// Active:   "Trending Books" / "Popular Genres"
// Inactive: "Books"          / "Genres"
function updateDiscoverToggleLabels() {
    if (!DOM.toggleTrendingBtn || !DOM.toggleGenresBtn) return;
    if (window.innerWidth > 768) {
        // Always restore full labels on desktop with extra-word and icon spans for CSS container-query shortening
        if (!DOM.toggleTrendingBtn.querySelector('.btn-word-extra')) {
            DOM.toggleTrendingBtn.innerHTML = '<svg class="discover-btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: none;"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg><span class="btn-word-extra">Trending </span><span class="btn-word-core">Books</span>';
        }
        if (!DOM.toggleGenresBtn.querySelector('.btn-word-extra')) {
            DOM.toggleGenresBtn.innerHTML = '<svg class="discover-btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: none;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg><span class="btn-word-extra">Popular </span><span class="btn-word-core">Genres</span>';
        }
        return;
    }
    if (DOM.toggleTrendingBtn.classList.contains('active')) {
        DOM.toggleTrendingBtn.textContent = 'Trending Books';
        DOM.toggleGenresBtn.textContent = 'Genres';
    } else {
        DOM.toggleTrendingBtn.textContent = 'Books';
        DOM.toggleGenresBtn.textContent = 'Popular Genres';
    }
}

// Observe active class changes on the toggle buttons to update labels reactively
if (DOM.toggleTrendingBtn && DOM.toggleGenresBtn) {
    new MutationObserver(updateDiscoverToggleLabels).observe(DOM.toggleTrendingBtn, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(updateDiscoverToggleLabels).observe(DOM.toggleGenresBtn, { attributes: true, attributeFilter: ['class'] });
}
updateDiscoverToggleLabels();

// ── Library Export & Import ──────────────────────────────────────────
const cleanLibraryForExport = (books) => {
    return books.map(b => ({
        key: b.key,
        title: b.title,
        original_title: b.original_title || b.title,
        author_name: Array.isArray(b.author_name) ? b.author_name : [b.author_name || 'Unknown Author'],
        cover_i: b.cover_i || null,
        cover_edition_key: b.cover_edition_key || null,
        first_publish_year: b.first_publish_year || 'N/A',
        subject: Array.isArray(b.subject) ? b.subject : [],
        place: Array.isArray(b.place) ? b.place : [],
        person: Array.isArray(b.person) ? b.person : [],
        language: Array.isArray(b.language) ? b.language : [],
        ratings_average: b.ratings_average != null ? b.ratings_average : null,
        ratings_count: b.ratings_count || 0,
        edition_count: b.edition_count || 1,
        savedAt: b.savedAt || Date.now()
    }));
};

const downloadFile = (content, filename, mimeType) => {
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

const showImportStatus = (msg, isError = false) => {
    if (!DOM.importStatusMsg) return;
    DOM.importStatusMsg.textContent = msg;
    DOM.importStatusMsg.style.display = 'block';
    DOM.importStatusMsg.style.background = isError ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)';
    DOM.importStatusMsg.style.color = isError ? '#ef4444' : 'var(--text)';
    setTimeout(() => {
        if (DOM.importStatusMsg) DOM.importStatusMsg.style.display = 'none';
    }, 4000);
};

const exportLibraryJSON = () => {
    if (library.length === 0) {
        showImportStatus("Your library is currently empty.", true);
        return;
    }
    const exportData = {
        app: "OpenLibrary Explorer",
        version: "1.0",
        exportedAt: new Date().toISOString(),
        count: library.length,
        library: cleanLibraryForExport(library)
    };
    downloadFile(JSON.stringify(exportData, null, 2), `openlibrary_backup_${new Date().toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8');
};

const exportLibraryCSV = () => {
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
        rows.push([
            escapeCSV(b.key),
            escapeCSV(b.title),
            escapeCSV(b.original_title),
            escapeCSV(b.author_name),
            escapeCSV(b.cover_i),
            escapeCSV(b.cover_edition_key),
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

const parseImportCSV = (csvText) => {
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
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const result = [];

    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const obj = {};
        headers.forEach((h, idx) => {
            obj[h] = row[idx] !== undefined ? row[idx] : '';
        });
        if (obj.key || obj.title) {
            result.push({
                key: obj.key || '',
                title: obj.title || '',
                original_title: obj.original_title || obj.title || '',
                author_name: obj.author_name ? obj.author_name.split(';').map(s => s.trim()).filter(Boolean) : ['Unknown Author'],
                cover_i: obj.cover_i ? (parseInt(obj.cover_i) || obj.cover_i) : null,
                cover_edition_key: obj.cover_edition_key || null,
                first_publish_year: parseInt(obj.first_publish_year) || 'N/A',
                ratings_average: parseFloat(obj.ratings_average) || null,
                ratings_count: parseInt(obj.ratings_count) || 0,
                edition_count: parseInt(obj.edition_count) || 1,
                subject: obj.subject ? obj.subject.split(';').map(s => s.trim()).filter(Boolean) : [],
                place: obj.place ? obj.place.split(';').map(s => s.trim()).filter(Boolean) : [],
                person: obj.person ? obj.person.split(';').map(s => s.trim()).filter(Boolean) : [],
                language: obj.language ? obj.language.split(';').map(s => s.trim()).filter(Boolean) : [],
                savedAt: parseInt(obj.savedat) || Date.now()
            });
        }
    }
    return result;
};

const handleImportFile = async (file) => {
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
            const existingIdx = library.findIndex(b => b.key === validDoc.key);
            if (existingIdx > -1) {
                library[existingIdx] = validDoc;
                updatedCount++;
            } else {
                library.push(validDoc);
                addedCount++;
            }
        });

        cachedSubjectCounts = null;
        cachedLocalFilteredBooks = null;
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

if (DOM.exportLibraryBtn) DOM.exportLibraryBtn.addEventListener('click', exportLibraryJSON);
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
