const escapeHTML = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
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
const ANNA_ARCHIVE_URL = 'https://annas-archive.gl';
const API_BASE = 'https://openlibrary.org/search.json';
const API_CONTACT_EMAIL = 'infinitestoragespaceheckyeah@gmail.com';
let apiBlockResumeTime = parseInt(localStorage.getItem('ole_api_block_resume_time') || '0');
let isApiBlocked = Date.now() < apiBlockResumeTime;
const fetchOpenLibrary = (() => {
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
        const { url, options, resolve, reject } = queue.shift();
        // Check block state before execution
        if (isApiBlocked) {
            if (Date.now() < apiBlockResumeTime) {
                activeConnections--;
                reject(new Error("OpenLibrary API is in a cooldown period."));
                processQueue();
                return;
            } else {
                isApiBlocked = false;
                localStorage.removeItem('ole_api_block_resume_time');
                if (DOM.status) DOM.status.style.display = 'none';
            }
        }
        // Add contact query param safely
        let finalUrl = url;
        try {
            const urlObj = new URL(url.startsWith('http') ? url : `https://openlibrary.org${url}`);
            if (!urlObj.searchParams.has('contact')) {
                urlObj.searchParams.set('contact', API_CONTACT_EMAIL);
            }
            finalUrl = urlObj.toString();
        } catch (e) { }
        fetch(finalUrl, options)
            .then(async res => {
                if (res.status === 429 || res.status === 403) {
                    throw new Error(`API Blocked: ${res.status}`);
                }
                // Preemptively catch non-JSON HTML error pages
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") === -1) {
                    throw new Error(`API Error: non-JSON response`);
                }
                resolve(res);
            })
            .catch(err => {
                const msg = err.message || '';
                if (msg.includes('API Blocked') || msg.includes('non-JSON') || msg.includes('Failed to fetch')) {
                    if (!isApiBlocked) {
                        isApiBlocked = true;
                        apiBlockResumeTime = Date.now() + (5 * 60 * 1000); // 5 mins
                        localStorage.setItem('ole_api_block_resume_time', apiBlockResumeTime.toString());
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
                setTimeout(processQueue, minDelayMs); // Ensure min gap before triggering next
            });
    };
    return (url, options = {}) => {
        return new Promise((resolve, reject) => {
            const resumeTime = parseInt(localStorage.getItem('ole_api_block_resume_time') || '0');
            if (Date.now() < resumeTime) {
                isApiBlocked = true;
                apiBlockResumeTime = resumeTime;
                return reject(new Error("OpenLibrary API is in a cooldown period."));
            }
            queue.push({ url, options, resolve, reject });
            processQueue();
        });
    };
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
    legacyLayoutToggle: document.getElementById('legacyLayoutToggle'),
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
    detailsOlBtn: document.getElementById('detailsOlBtn')
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
let sortDirection = 'desc';
let renderIndex = 0;
let cachedSubjectCounts = null;
let cachedLocalFilteredBooks = null;
let cachedTrendingBooks = null;
let cachedGenreShelves = null;
let currentDiscoverTab = 'trending';
let fetchTimerInterval = null;
const RENDER_CHUNK = 50;
// Global Translation Cache to prevent duplicate and rapid CDNs IP-blocking API requests
const translationCache = new Map();
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
        const cached = await localforage.getItem('ole_translation_cache_v7');
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
const saveTranslationCache = async () => {
    try {
        const obj = {};
        for (const [k, v] of translationCache.entries()) {
            obj[k] = v;
        }
        await localforage.setItem('ole_translation_cache_v7', obj);
    } catch (e) {
        console.error('Failed to save translation cache:', e);
    }
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
    renderIndex = endIdx;
    if (currentViewMode === 'search') {
        const currentLimit = parseInt(DOM.customLimitToggle.checked ? DOM.fetchLimitSlider.value : 100);
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
    if (idx > -1) {
        library.splice(idx, 1);
    } else {
        const slim = {
            key: bookData.key,
            title: bookData.title,
            original_title: bookData.original_title || bookData.title,
            author_name: bookData.author_name,
            cover_i: bookData.cover_i,
            cover_edition_key: bookData.cover_edition_key,
            first_publish_year: bookData.first_publish_year,
            subject: cleanSubjects(bookData.subject),
            place: bookData.place,
            person: bookData.person,
            language: bookData.language,
            ratings_average: bookData.ratings_average,
            ratings_count: bookData.ratings_count,
            edition_count: bookData.edition_count,
            savedAt: Date.now()
        };
        cacheBookTokens(slim);
        library.push(slim);
    }
    localforage.setItem('ole_bookmarks', library).catch(console.error);
    updateLibraryBadge();
    if (currentViewMode === 'library') applyLocalFilters();
};
document.querySelector('.theme-switch input[id="checkbox"]').addEventListener('change', (e) => {
    document.body.setAttribute('data-theme', e.target.checked ? 'dark' : 'light');
});
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.getElementById('checkbox').checked = true;
    document.body.setAttribute('data-theme', 'dark');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    document.getElementById('checkbox').checked = e.matches;
    document.body.setAttribute('data-theme', e.matches ? 'dark' : 'light');
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
const updateSortDirBtn = () => {
    const btn = document.getElementById('sortDirBtn');
    const isApiMode = currentViewMode === 'search';
    const val = DOM.sort.value;
    const supportsApiDirection = (val === 'new');
    const descIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10M11 9h7M11 13h4M3 17l4 4 4-4M7 5v16"/></svg>`;
    const ascIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17h10M11 13h7M11 9h4M3 7l4-4 4 4M7 21V5"/></svg>`;
    if (val === 'random' || (isApiMode && !supportsApiDirection)) {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.title = "Toggle sort direction (Unavailable with this sort option due to API limitations)";
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
    // Search-only settings category: hide the whole category (title + rows), not just the rows.
    if (DOM.searchOptionsCategory) DOM.searchOptionsCategory.style.display = mode === 'library' ? 'none' : 'flex';
};
const checkInputs = () => {
    if (DOM.globalSearchClearBtn && DOM.globalSearchInput) {
        DOM.globalSearchClearBtn.style.display = DOM.globalSearchInput.value ? 'block' : 'none';
    }
    // Explicitly ignore the sort dropdown when checking for active filters
    const textInputs = Array.from(watchInputs).filter(el =>
        (el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.id !== 'sortSelect'
    );
    const hasValue = textInputs.some(input => input.value.trim() !== '') || tagManagerInc.getTags().length > 0 || tagManagerExc.getTags().length > 0;
    if (currentViewMode === 'library') {
        // Library results filter live as the user types, so this button never
        // has anything to "do" - keep it permanently disabled/greyed out.
        DOM.btn.disabled = true;
        DOM.btn.textContent = 'Filter Library';
        return;
    }
    DOM.btn.textContent = 'Find Books';
    DOM.btn.disabled = !hasValue;
};
const appendKeyboardListeners = () => {
    // globalSearchInput has its own dedicated Enter handler below; skip it here
    // to avoid firing performSearch() twice on the same keypress (was causing
    // duplicated results when searching from the header bar).
    document.querySelectorAll('input:not(.watch-input-tag):not(#globalSearchInput), select').forEach(element => {
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (currentViewMode === 'library') applyLocalFilters();
                else if (!DOM.btn.disabled) DOM.btn.click();
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
    DOM.sortNote.style.display = (v === 'reviews') && currentViewMode !== 'library' ? 'block' : 'none';
    sortDirection = SORT_DEFAULTS[v] || 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'library') applyLocalFilters();
});
document.getElementById('sortDirBtn').addEventListener('click', () => {
    const isApiMode = currentViewMode === 'search';
    const val = DOM.sort.value;
    if (val === 'random' || (isApiMode && val !== 'new')) return;
    sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'library') applyLocalFilters();
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
    DOM.sortNote.style.display = 'none';
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
        DOM.sortNote.style.display = 'none';
        checkInputs();
        applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash(true);
        return;
    }
    DOM.sort.value = 'relevance';
    DOM.sortNote.style.display = 'none';
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
const tokenize = (val) => val.split(',').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
// Helper to rip formatting out and return an array of clean, pure words
const getBookTokens = (arr) => {
    if (!arr || arr.length === 0) return [];
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
    const renderGhost = () => {
        const val = input.value;
        if (!val || currentMatches.length === 0) {
            ghost.innerHTML = '';
            return;
        }
        const matchName = currentMatches[activeIndex].name || currentMatches[activeIndex];
        if (matchName.toLowerCase().startsWith(val.toLowerCase())) {
            const invisiblePart = matchName.substring(0, val.length);
            const visiblePart = matchName.substring(val.length);
            ghost.innerHTML = `<span style="opacity: 0;">${escapeHTML(invisiblePart)}</span><span>${escapeHTML(visiblePart)}</span>`;
        } else {
            ghost.innerHTML = '';
        }
    };
    const renderList = () => {
        list.innerHTML = '';
        indicator.style.display = 'none';
        if (currentMatches.length > 0) {
            currentMatches.forEach((subj, idx) => {
                const li = document.createElement('li');
                li.className = 'autocomplete-item' + (idx === activeIndex ? ' active' : '');
                const name = subj.name || subj;
                const count = subj.work_count || subj.count;
                li.innerHTML = `<span>${escapeHTML(name)}</span> ${count ? `<span class="ac-count">(${count})</span>` : ''}`;
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
        renderGhost();
    };
    const renderLocalSuggestions = (query) => {
        if (!cachedSubjectCounts) {
            cachedSubjectCounts = getFilteredSubjectCounts();
        }
        activeIndex = 0;
        currentMatches = query.length === 0
            ? cachedSubjectCounts.slice(0, 10)
            : cachedSubjectCounts.filter(s => s.name.toLowerCase().includes(query)).slice(0, 10);
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
        setTimeout(() => { list.style.display = 'none'; indicator.style.display = 'none'; ghost.innerHTML = ''; input.placeholder = managerRef.getTags().length ? '' : 'e.g., Fantasy'; }, 250);
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
                const name = currentMatches[activeIndex].name || currentMatches[activeIndex];
                managerRef.addTag(name);
                list.style.display = 'none';
                ghost.innerHTML = '';
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const name = currentMatches[activeIndex].name || currentMatches[activeIndex];
                managerRef.addTag(name);
                list.style.display = 'none';
                ghost.innerHTML = '';
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
        timeout = setTimeout(async () => {
            if (!isFocused) return;
            try {
                const resWild = await fetchOpenLibrary(`https://openlibrary.org/search/subjects.json?q=${encodeURIComponent(query + '*')}&limit=20`);
                if (!resWild.ok) throw new Error();
                const dataWild = await resWild.json();
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
                let viableCandidates = processDocs(dataWild.docs || []);
                if (viableCandidates.length === 0) {
                    const resExact = await fetchOpenLibrary(`https://openlibrary.org/search/subjects.json?q=${encodeURIComponent(query)}&limit=20`);
                    if (resExact.ok) {
                        const dataExact = await resExact.json();
                        viableCandidates = processDocs(dataExact.docs || []);
                    }
                }
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
                currentMatches = viableCandidates
                    .sort((a, b) => b.work_count - a.work_count)
                    .slice(0, 10);
                activeIndex = 0;
                renderList();
            } catch {
                list.style.display = 'none';
                indicator.style.display = 'none';
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
const applyLocalFilters = async () => {
    resolvedTitlesInActivePass.clear();
    cachedSubjectCounts = null; // Invalidate cache when filters change
    cachedLocalFilteredBooks = null;
    const filtered = getLocalFilteredBooks();
    const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
    const isSyncMode = DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked;
    const targetLang = DOM.incLang.value.trim().toLowerCase() || 'eng';
    if (isTransEnabled) {
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
                                    return code.includes(targetLang) || (targetLang === 'eng' && (code === 'eng' || code === 'en'));
                                });
                            });
                            const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title);
                            if (matchingEdition && matchingEdition.title) {
                                const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                                const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                                if (!isDuplicateTitle(fullTitle, b.key, targetLang)) {
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
const DISCOVER_GENRES = ['Fantasy', 'Science Fiction', 'Mystery', 'Romance', 'History', 'Biography', 'Thriller', 'Classics', 'Horror', 'Poetry', 'Adventure', 'Self-Help', 'Young Adult', 'Graphic Novels'];

const fetchGenreShelves = async () => {
    const GENRES_KEY = 'ole_genre_shelves_cache_v2';
    const GENRES_TTL = 24 * 60 * 60 * 1000;
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
                    const res = await fetch(`${API_BASE}?q=subject:"${encodeURIComponent(genre.toLowerCase())}"+AND+ratings_count:[10+TO+*]&limit=5&sort=editions`);
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

const renderDiscoverDashboard = async () => {
    DOM.grid.style.display = 'none';
    DOM.status.style.display = 'none';
    DOM.footer.style.display = 'none';
    DOM.resultsMeta.style.display = 'none';
    DOM.discoverDashboardToggles.style.display = 'flex';
    DOM.discoverDashboard.style.display = 'block';

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
                    coversHtml += `<img class="shelf-book-cover" src="https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg" alt="Cover" />`;
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
        updateToggleAllBtnState();
        return;
    }


    // Render featured books — check if the cache is expired even if stored in-memory
    const featuredGrid = document.getElementById('featuredClassicsGrid');
    featuredGrid.style.display = 'grid';
    // Apply current list/grid view mode
    if (DOM.grid.classList.contains('list-view')) featuredGrid.classList.add('list-view');
    else featuredGrid.classList.remove('list-view');
    const TRENDING_KEY = 'ole_trending_cache_v2';
    const TRENDING_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms
    const TRENDING_COUNT = 24;
    let isStale = false;
    let stored = null;
    try {
        const storedStr = localStorage.getItem(TRENDING_KEY);
        if (storedStr) {
            stored = JSON.parse(storedStr);
            if (stored && stored.ts && (Date.now() - stored.ts) >= TRENDING_TTL) {
                isStale = true;
            }
        }
    } catch { }
    if (isStale || !stored) {
        cachedTrendingBooks = null;
        localStorage.removeItem(TRENDING_KEY);
    } else if (stored && (!cachedTrendingBooks || cachedTrendingBooks.length === 0)) {
        cachedTrendingBooks = stored.books;
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
        // Background sync trending titles if needed
        syncCardTitles(cachedTrendingBooks);
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
            fetchOpenLibrary(`${API_BASE}?q=ratings_count:[100+TO+*]&limit=16&sort=editions&fields=${sharedFields}&contact=${API_CONTACT_EMAIL}`),
            fetchOpenLibrary(`${API_BASE}?q=first_publish_year:[${recentSince}+TO+${currentYear}]+AND+ratings_count:[20+TO+*]&limit=16&sort=rating&fields=${sharedFields}&contact=${API_CONTACT_EMAIL}`)
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
        // Persist to localStorage with timestamp (24h TTL)
        try { localStorage.setItem(TRENDING_KEY, JSON.stringify({ ts: Date.now(), books: cachedTrendingBooks })); } catch { /* quota exceeded — ignore */ }

        const booksFragment = document.createDocumentFragment();
        cachedTrendingBooks.forEach((b, idx) => {
            const card = buildCard(b, false, null);
            card.style.setProperty('--card-index', idx);
            booksFragment.appendChild(card);
        });
        featuredGrid.appendChild(booksFragment);
        // Background sync trending titles if needed
        syncCardTitles(cachedTrendingBooks);
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
    resolvedTitlesInActivePass.clear();
    if (currentViewMode === 'library') return;
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
    injectSkeletonScreen(isLoadMore);
    const currentSortDir = sortDirection;
    // Fetch feedback: start elapsed timer
    clearInterval(fetchTimerInterval);
    const fetchStartTime = performance.now();
    DOM.resultsMeta.style.display = 'flex';
    DOM.querySpeedContainer.style.display = 'inline-flex'; // Always show the count during query
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
        const targetLang = DOM.incLang.value.trim().toLowerCase() || 'eng';
        const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
        if (isTransEnabled) {
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
                                        return code.includes(targetLang) || (targetLang === 'eng' && (code === 'eng' || code === 'en'));
                                    });
                                });
                                const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title);
                                if (matchingEdition && matchingEdition.title) {
                                    const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                                    const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                                    if (!isDuplicateTitle(fullTitle, b.key, targetLang)) {
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
                // Keep tooltip populated but don't change container visibility (it's already shown)
                // Disappearing progress status message
                DOM.fetchStatus.textContent = `Search completed in ${totalTime.toFixed(1)}s`;
                // Clear fetch status after a brief moment with a smooth CSS fade-out transition, then collapse into hoverable icon
                setTimeout(() => {
                    DOM.fetchStatus.style.opacity = '0';
                    setTimeout(() => {
                        DOM.fetchStatus.textContent = '';
                        DOM.fetchStatus.style.opacity = ''; // Reset opacity state for next search
                        DOM.totalCount.style.cursor = 'help'; // Now tooltip is ready
                    }, 1000); // Match CSS opacity transition duration
                }, 3000);
            });
        });
    } catch (error) {
        clearInterval(fetchTimerInterval);
        DOM.fetchStatus.textContent = '';
        DOM.fetchStatus.style.opacity = ''; // Reset opacity state on error
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
const renderTagsHTML = (subjects, maxChars) => {
    if (!subjects || subjects.length === 0) return '';
    let visible = [];
    let extraTags = [];
    let currentChars = 0;
    for (let i = 0; i < subjects.length; i++) {
        let s = subjects[i];
        if (s.length > 26) { extraTags.push(s); continue; }
        if (currentChars + s.length + 15 <= maxChars || visible.length === 0) {
            visible.push(s);
            currentChars += s.length + 15;
        } else {
            extraTags.push(s);
        }
    }
    const tagHtml = visible.map(s => `<span class="tag" title="${escapeHTML(s)}">${escapeHTML(s)}</span>`).join('');
    const overflowHtml = extraTags.length > 0 ? `<span class="tag-overflow" title="${escapeHTML(extraTags.join(', '))} ">+${extraTags.length}</span>` : '';
    return tagHtml + overflowHtml;
};
const buildCard = (b, isEditionsSort, filterLangAA) => {
    const card = document.createElement('div');
    card.className = 'book-card';
    if (b.key) card.setAttribute('data-key', b.key);
    const cover = b.cover_i
        ? `<img src="https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg" class="book-cover" alt="Cover Image" loading="lazy">`
        : `<div class="no-cover">No Cover</div>`;
    const author = b.author_name ? b.author_name[0] : 'Unknown Author';
    const year = b.first_publish_year || 'N/A';
    const ratingCount = b.ratings_count ? `(${b.ratings_count})` : '';
    const ratingDisplay = b.ratings_average ? `★ ${parseFloat(b.ratings_average).toFixed(1)} ${ratingCount}` : 'No rating';
    const editionBadge = (isEditionsSort && b.edition_count) ? `<span class="edition-badge">${b.edition_count} Editions</span>` : '';
    const isInLibrary = library.some(saved => saved.key === b.key);
    let bookLangAA = 'en';
    if (b.language && b.language.length > 0) {
        const cleanLangs = b.language.map(l => l.replace('/languages/', ''));
        const hasEnglish = cleanLangs.includes('eng') || cleanLangs.includes('en');
        const olLang = hasEnglish ? 'eng' : cleanLangs[0];
        bookLangAA = langMapToAA[olLang] || olLang;
    }
    const heartSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isInLibrary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    card.innerHTML = `
        <div class="card-main">
            <div class="cover-container">${cover}</div>
            <div class="card-details">
                <div class="book-title" title="${escapeHTML(b.title)}">${escapeHTML(b.title)}</div>
                <div class="book-author">by <span title="Search other books by ${escapeHTML(author)}">${escapeHTML(author)}</span></div>
                <div class="action-buttons">
                    <button class="library-btn ${isInLibrary ? 'in-library' : ''}" title="${isInLibrary ? 'Remove from Library' : 'Add to Library'}">${heartSVG}</button>
                </div>
                <div class="tags-list grid-tags">${renderTagsHTML(b.subject, 90)}</div>
                <div class="tags-list list-tags">${renderTagsHTML(b.subject, 65)}</div>
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
        DOM.detailsCoverContainer.innerHTML = b.cover_i
            ? `<img src="https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg" alt="Cover Image" style="width:100%; height:140px; object-fit:cover; border-radius:4px; box-shadow:0 4px 8px rgba(0,0,0,0.15);">`
            : `<div class="no-cover">No Cover</div>`;
    }
    // Render subjects list
    DOM.detailsSubjects.innerHTML = '';
    if (b.subject && b.subject.length > 0) {
        b.subject.slice(0, 12).forEach(s => {
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
    // Show loading spinner for description
    DOM.detailsDescription.innerHTML = '<div class="details-spinner"></div>';
    // Open drawer overlay visually
    DOM.detailsDrawer.style.display = 'flex';
    DOM.detailsDrawer.offsetHeight; // Force reflow
    DOM.detailsDrawer.classList.add('active');
    // Fetch details in parallel: Work details (for description) & Edition details (for original title restoration if enabled)
    let fetchPromises = [fetchOpenLibrary(`https://openlibrary.org${b.key}.json`).then(r => r.ok ? r.json() : null)];
    const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
    if (isTransEnabled && b.cover_edition_key) {
        fetchPromises.push(fetchOpenLibrary(`https://openlibrary.org/books/${b.cover_edition_key}.json`).then(r => r.ok ? r.json() : null));
    }
    try {
        const results = await Promise.all(fetchPromises);
        const workData = results[0];
        const editionData = results[1]; // Will be undefined if translation is disabled
        const targetLang = DOM.incLang.value.trim().toLowerCase() || 'eng';
        const cacheKey = `${b.key}_${targetLang}`;
        let canonicalTitle = (workData && workData.title) ? workData.title : b.title;
        if (isTransEnabled && translationCache.has(cacheKey)) {
            canonicalTitle = translationCache.get(cacheKey);
        } else if (isTransEnabled && editionData && editionData.title) {
            const isEditionTarget = editionData.languages && editionData.languages.some(lang => {
                const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                return code.includes(targetLang) || (targetLang === 'eng' && (code === 'eng' || code === 'en'));
            });
            if (isEditionTarget || !workData || workData.title !== editionData.title) {
                canonicalTitle = editionData.title + (editionData.subtitle ? `: ${editionData.subtitle}` : '');
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
        let desc = 'No synopsis available for this work.';
        if (workData && workData.description) {
            desc = typeof workData.description === 'string' ? workData.description : (workData.description.value || desc);
        }
        DOM.detailsDescription.textContent = desc;
    } catch {
        DOM.detailsDescription.innerHTML = '<span style="opacity: 0.6; font-style: italic;">Failed to load description. Please visit OpenLibrary directly.</span>';
    }
};
const closeDetailsDrawer = () => {
    DOM.detailsDrawer.classList.remove('active');
    setTimeout(() => {
        DOM.detailsDrawer.style.display = 'none';
    }, 300);
};
const needsTranslation = (b, targetLang) => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return false;
    if (!b.key) return false;
    const cacheKey = `${b.key}_${targetLang}`;
    if (translationCache.has(cacheKey)) return false;
    if (translationPromiseCache.has(cacheKey)) return false;
    // For English targets, only skip the fetch when the work's language data
    // explicitly and unambiguously confirms it's English-only. If the language
    // field is missing or lists more than one language, we still can't trust
    // the base title, so fall through to the normal fetch-and-check below.
    if (targetLang === 'eng' || targetLang === 'en' || targetLang === '') {
        if (b.language && b.language.length === 1) {
            const onlyLang = b.language[0].replace('/languages/', '').toLowerCase();
            if (onlyLang === 'eng' || onlyLang === 'en') return false;
        }
        return true;
    }
    // If work has no languages listed, we cannot skip checking it
    if (!b.language || b.language.length === 0) return true;
    const cleanLangs = b.language.map(l => l.replace('/languages/', '').toLowerCase());
    const hasTarget = cleanLangs.includes(targetLang);
    if (!hasTarget) return false;
    if (cleanLangs.length === 1) return false;
    return true;
};
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
const syncCardTitles = (docs) => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return;
    if (DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked) return;
    resolvedTitlesInActivePass.clear();
    const targetLang = DOM.incLang.value.trim().toLowerCase() || 'eng';
    docs.forEach(async (b) => {
        if (!b.key) return;
        const cacheKey = `${b.key}_${targetLang}`;
        // If not in cache and doesn't need translation, check if it's already cached from before
        if (!needsTranslation(b, targetLang)) {
            if (translationCache.has(cacheKey)) {
                const cachedTitle = translationCache.get(cacheKey);
                if (cachedTitle !== b.title) {
                    b.title = cachedTitle;
                    updateCardTitleInGrid(b.key, cachedTitle);
                }
            }
            return;
        }
        translationQueue.add(cacheKey, async () => {
            setCardTranslatingActive(b.key);
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
                            return code.includes(targetLang) || (targetLang === 'eng' && (code === 'eng' || code === 'en'));
                        });
                    });
                    const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title);
                    if (matchingEdition && matchingEdition.title) {
                        const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                        const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                        if (!isDuplicateTitle(fullTitle, b.key, targetLang)) {
                            resolvedTitlesInActivePass.add(fullTitle.trim().toLowerCase());
                            setTranslationCache(cacheKey, fullTitle);
                            saveTranslationCache();
                            if (fullTitle !== b.title) {
                                b.title = fullTitle;
                                updateCardTitleInGrid(b.key, fullTitle);
                            }
                        } else {
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
    DOM.loadMoreBtn.style.display = ((currentPage * 100) >= totalFoundOnAPI || rawFetchedCount < 100) ? 'none' : 'inline-block';
    if (allDisplayedDocs.length === 0) {
        DOM.status.textContent = 'All books in this batch were hidden by your rating filters. Click "Find More Books" to query the next batch.';
        DOM.status.style.display = 'block';
        DOM.grid.style.display = 'none';
    }
};
const renderSavedCollection = (books = library) => {
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
        DOM.totalCount.textContent = isLibraryUnfiltered
            ? "Showing all books in your library"
            : `Showing ${books.length} of ${library.length} books in your library (filtered)`;
        DOM.resultsMeta.style.display = 'flex';
        DOM.grid.style.display = 'grid';
        const rawIncLang = DOM.incLang.value.trim().toLowerCase();
        const filterLangAA = rawIncLang ? (langMapToAA[rawIncLang] || rawIncLang) : null;
        renderIndex = 0;
        renderNextChunk(isEditionsSort, filterLangAA);
    }
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
        DOM.settingsPanel.style.display = 'none';
        restoreModeState('library');
        applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash(true);
        syncSettingsCategoriesForMode('library');
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
        if (allDisplayedDocs.length > 0) {
            renderResults(allDisplayedDocs.length, lastSearchTotalFound, false, 0, 0, false);
            if (DOM.querySpeedTooltip.innerHTML.trim() !== '') {
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
const applyListView = (enabled) => {
    DOM.grid.classList.toggle('list-view', enabled);
    const fg = document.getElementById('featuredClassicsGrid');
    if (fg) fg.classList.toggle('list-view', enabled);
};
if (DOM.listViewToggle) {
    DOM.listViewToggle.checked = localStorage.getItem('ole_list_view') === 'true';
    applyListView(DOM.listViewToggle.checked);
    DOM.listViewToggle.addEventListener('change', () => {
        localStorage.setItem('ole_list_view', DOM.listViewToggle.checked);
        applyListView(DOM.listViewToggle.checked);
    });
}
DOM.btn.addEventListener('click', () => {
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
            const slim = {
                key: b.key, title: b.title, author_name: b.author_name, cover_i: b.cover_i,
                cover_edition_key: b.cover_edition_key, first_publish_year: b.first_publish_year,
                subject: cleanSubjects(b.subject), place: b.place, person: b.person,
                language: b.language, ratings_average: b.ratings_average, ratings_count: b.ratings_count,
                edition_count: b.edition_count, savedAt: Date.now()
            };
            cacheBookTokens(slim);
            library.push(slim);
            changed = true;
        } else if (allInLibrary && idx > -1) {
            library.splice(idx, 1);
            changed = true;
        }
    });
    if (changed) {
        cachedSubjectCounts = null; // Invalidate cache
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
Promise.all([
    localforage.getItem('ole_bookmarks'),
    loadTranslationCache()
]).then(([data]) => {
    // If IndexedDB is empty, check if they have old LocalStorage data to rescue
    if (!data && localStorage.getItem('ole_bookmarks')) {
        data = JSON.parse(localStorage.getItem('ole_bookmarks'));
        localforage.setItem('ole_bookmarks', data);
        localStorage.removeItem('ole_bookmarks'); // Clean up the old storage
    }
    library = data || [];
    library.forEach(b => {
        if (b.subject) b.subject = cleanSubjects(b.subject);
        cacheBookTokens(b);
    });
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
    if (loadStateFromHash()) {
        DOM.persistToggle.checked = true;
        const v = DOM.sort.value;
        DOM.sortNote.style.display = (v === 'reviews') ? 'block' : 'none';
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
        if (currentViewMode === 'library') applyLocalFilters();
        else renderDiscoverDashboard();
    }
    updateSortDirBtn();
}).catch(console.error);
// Global Search Box Event Listeners
DOM.globalSearchInput.addEventListener('input', () => {
    DOM.globalSearchClearBtn.style.display = DOM.globalSearchInput.value ? 'block' : 'none';
    if (currentViewMode === 'library') {
        applyLocalFilters();
    }
});
DOM.globalSearchClearBtn.addEventListener('click', () => {
    DOM.globalSearchInput.value = '';
    DOM.globalSearchClearBtn.style.display = 'none';
    if (currentViewMode === 'library') {
        applyLocalFilters();
    } else {
        renderDiscoverDashboard();
    }
    if (currentViewMode === 'search') {
        saveStateToHash(true);
    }
});
if (DOM.homeBtn) {
    DOM.homeBtn.addEventListener('click', () => {
        if (DOM.resetBtn) DOM.resetBtn.click();
        DOM.globalSearchInput.value = '';
        DOM.globalSearchClearBtn.style.display = 'none';
        if (currentViewMode === 'library') {
            DOM.viewSavedBtn.click();
        }
        currentDiscoverTab = 'trending';
        renderDiscoverDashboard();
        saveStateToHash(true);
    });
}
DOM.globalSearchBtn.addEventListener('click', () => {
    if (currentViewMode === 'library') {
        applyLocalFilters();
    } else {
        performSearch(false);
    }
});
DOM.globalSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (currentViewMode === 'library') {
            applyLocalFilters();
        } else {
            performSearch(false);
        }
    }
});
// Settings dropdown floating panel listeners
DOM.settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = DOM.settingsPanel.style.display === 'none';
    DOM.settingsPanel.style.display = isHidden ? 'block' : 'none';
});
// Initialize settings category visibility for the starting view mode
syncSettingsCategoriesForMode(currentViewMode);
DOM.settingsCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    DOM.settingsPanel.style.display = 'none';
});
window.addEventListener('click', (e) => {
    if (DOM.settingsPanel.style.display === 'block' && !DOM.settingsPanel.contains(e.target) && e.target !== DOM.settingsBtn) {
        DOM.settingsPanel.style.display = 'none';
    }
});
// Details drawer close event listeners
DOM.detailsCloseBtn.addEventListener('click', closeDetailsDrawer);
DOM.detailsBackdrop.addEventListener('click', closeDetailsDrawer);
// Sidebar collapse toggle listener
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const legacyCollapsedRail = document.getElementById('legacyCollapsedRail');
const railFilterBtn = document.getElementById('railFilterBtn');
const railSortBtn = document.getElementById('railSortBtn');
let sidebarExpandRevealTimeoutId = null;
if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', () => {
        closeAllRailPopovers();
        const container = document.querySelector('.app-container');
        if (container) {
            const collapsing = !container.classList.contains('sidebar-collapsed');
            container.classList.toggle('sidebar-collapsed');
            clearTimeout(sidebarExpandRevealTimeoutId);
            if (document.body.classList.contains('legacy-layout')) {
                document.body.classList.add('legacy-sidebar-transitioning');
                if (collapsing) {
                    // Relocate the library/add-all buttons into the collapsed icon
                    // rail immediately; they're already hidden via the
                    // legacy-sidebar-transitioning class, so this reparenting is invisible.
                    if (legacyCollapsedRail && railFilterBtn) {
                        legacyCollapsedRail.insertBefore(DOM.viewSavedBtn, railFilterBtn);
                        legacyCollapsedRail.insertBefore(DOM.toggleAllBtn, railFilterBtn);
                    }
                } else {
                    // Moving back into the sticky header, still hidden until the
                    // width transition finishes below.
                    if (DOM.sidebarStickyHeader && DOM.legacySlotAnchor) {
                        DOM.sidebarStickyHeader.insertBefore(DOM.viewSavedBtn, DOM.legacySlotAnchor);
                        DOM.sidebarStickyHeader.insertBefore(DOM.toggleAllBtn, DOM.legacySlotAnchor);
                    }
                }
                sidebarExpandRevealTimeoutId = setTimeout(() => {
                    document.body.classList.remove('legacy-sidebar-transitioning');
                }, collapsing ? 300 : 200);
            }
            window.dispatchEvent(new Event('resize'));
        }
    });
}
// Filter/Sort rail shortcuts: when the sidebar is collapsed, open the
// corresponding group in a floating popover instead of expanding the
// sidebar. The real <details> node is reparented into the popover (not
// cloned), so every existing id/listener on its inputs keeps working, then
// moved back to its original spot in the sidebar when the popover closes.
// A comment node marks that original spot so it can be restored precisely.
const railPopoverState = {}; // groupId -> { popoverEl, placeholderEl, group, btn, open }

const positionRailPopovers = () => {
    if (!legacyCollapsedRail) return;
    const openIds = Object.keys(railPopoverState).filter(id => railPopoverState[id].open);
    if (!openIds.length) return;
    const railRect = legacyCollapsedRail.getBoundingClientRect();
    let top = railRect.top;
    openIds.forEach((id) => {
        const { popoverEl } = railPopoverState[id];
        const width = popoverEl.offsetWidth || 340;
        const left = Math.min(railRect.right + 10, window.innerWidth - width - 12);
        popoverEl.style.left = `${Math.max(left, 12)}px`;
        popoverEl.style.top = `${top}px`;
        const availableHeight = Math.max(window.innerHeight - 12 - top, 160);
        popoverEl.style.maxHeight = `${availableHeight}px`;
        top += Math.min(popoverEl.offsetHeight, availableHeight) + 10;
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
};

const closeAllRailPopovers = () => {
    Object.keys(railPopoverState).forEach(closeRailPopover);
};

const openRailPopover = (btn, groupId) => {
    const group = document.getElementById(groupId);
    if (!group) return;

    const placeholderEl = document.createComment(`rail-popover-placeholder-${groupId}`);
    group.parentNode.insertBefore(placeholderEl, group);

    const popoverEl = document.createElement('div');
    popoverEl.className = 'rail-popover';
    popoverEl.appendChild(group);
    document.body.appendChild(popoverEl);
    group.open = true;

    railPopoverState[groupId] = { popoverEl, placeholderEl, group, btn, open: true };
    btn.classList.add('rail-btn-active');
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

// Close on outside click / Escape, and keep popovers positioned correctly.
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
window.addEventListener('resize', positionRailPopovers);
document.querySelector('main.results')?.addEventListener('scroll', positionRailPopovers);
// Legacy Layout: relocate toggleAllBtn, viewSavedBtn, and sidebarToggleBtn into the
// sidebar sticky header (replacing Reset/Find Books visually) when enabled, and
// restore them to the results header when disabled.
const applyLegacyLayout = (enabled) => {
    closeAllRailPopovers();
    document.body.classList.toggle('legacy-layout', enabled);
    if (!DOM.sidebarStickyHeader || !DOM.legacySlotAnchor) return;
    const container = document.querySelector('.app-container');
    const isCollapsed = container && container.classList.contains('sidebar-collapsed');
    if (enabled) {
        DOM.sidebarStickyHeader.insertBefore(sidebarToggleBtn, DOM.legacySlotAnchor);
        if (isCollapsed && legacyCollapsedRail && railFilterBtn) {
            legacyCollapsedRail.insertBefore(DOM.viewSavedBtn, railFilterBtn);
            legacyCollapsedRail.insertBefore(DOM.toggleAllBtn, railFilterBtn);
        } else {
            DOM.sidebarStickyHeader.insertBefore(DOM.viewSavedBtn, DOM.legacySlotAnchor);
            DOM.sidebarStickyHeader.insertBefore(DOM.toggleAllBtn, DOM.legacySlotAnchor);
        }
    } else {
        const resultsHeaderLeft = document.querySelector('.results-header-left');
        const resultsHeaderRight = document.querySelector('.results-header-right');
        if (resultsHeaderLeft) resultsHeaderLeft.insertBefore(sidebarToggleBtn, DOM.resultsMeta);
        if (resultsHeaderRight) {
            resultsHeaderRight.insertBefore(DOM.toggleAllBtn, resultsHeaderRight.firstChild);
            resultsHeaderRight.appendChild(DOM.viewSavedBtn);
        }
    }
    window.dispatchEvent(new Event('resize'));
};
if (DOM.legacyLayoutToggle) {
    DOM.legacyLayoutToggle.checked = localStorage.getItem('ole_classic_layout') === 'true';
    DOM.legacyLayoutToggle.addEventListener('change', () => {
        localStorage.setItem('ole_classic_layout', DOM.legacyLayoutToggle.checked);
        applyLegacyLayout(!DOM.legacyLayoutToggle.checked);
    });
    applyLegacyLayout(!DOM.legacyLayoutToggle.checked);
}
// Title translation sub-toggle visibility sync and library translation triggers
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
const handleGridClick = (e, getBookFn) => {
    const card = e.target.closest('.book-card');
    if (!card) return;
    const workKey = card.getAttribute('data-key');
    if (!workKey) return;
    const b = getBookFn(workKey);
    if (!b) return;
    // 1. Tag clicked
    const tagEl = e.target.closest('.tag');
    if (tagEl) {
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