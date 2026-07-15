const escapeHTML = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
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

const langMapToOL = {
    'en':'eng', 'nl':'dut', 'es':'spa', 'ar':'ara', 'it':'ita', 'zh':'chi', 'ru':'rus',
    'fr':'fre', 'de':'ger', 'pt':'por', 'ja':'jpn', 'bg':'bul', 'pl':'pol', 'la':'lat',
    'he':'heb', 'zh-hant':'chi', 'tr':'tur', 'hu':'hun', 'cs':'cze', 'sv':'swe', 'da':'dan',
    'ko':'kor', 'uk':'ukr', 'id':'ind', 'el':'gre', 'ro':'rum', 'lt':'lit', 'bn':'ben',
    'ca':'cat', 'no':'nor', 'af':'afr', 'fi':'fin', 'hr':'hrv', 'sr':'srp', 'th':'tha',
    'hi':'hin', 'ga':'gle', 'lv':'lav', 'fa':'per', 'vi':'vie', 'sk':'slo', 'kn':'kan',
    'bo':'tib', 'cy':'wel', 'jv':'jav', 'ur':'urd', 'yi':'yid', 'hy':'arm', 'be':'bel',
    'rw':'kin', 'ta':'tam', 'kk':'kaz', 'sl':'slv', 'ml':'mal', 'shn':'shn', 'mn':'mon',
    'ka':'geo', 'mr':'mar', 'eo':'epo', 'et':'est', 'te':'tel', 'fil':'fil', 'gu':'guj',
    'gl':'glg', 'ky':'kir', 'ms':'may', 'az':'aze', 'sw':'swa', 'qu':'que', 'pa':'pan',
    'ba':'bak', 'sq':'alb', 'uz':'uzb', 'bs':'bos', 'eu':'baq', 'my':'bur', 'am':'amh',
    'ku':'kur', 'fy':'fry', 'zu':'zul', 'ps':'pus', 'ne':'nep', 'so':'som', 'ug':'uig',
    'om':'orm', 'mk':'mac', 'ht':'hat', 'lo':'lao', 'tt':'tat', 'si':'sin', 'ckb':'kur',
    'tg':'tgk', 'sn':'sna', 'su':'sun', 'nb':'nob', 'mg':'mlg', 'xh':'xho', 'ha':'hau',
    'sd':'snd', 'ny':'nya'
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
    shareLink: document.getElementById('shareLink'), persistToggle: document.getElementById('persistToggle'),
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
    querySpeedContainer: document.getElementById('querySpeedContainer'),
    querySpeedTooltip: document.getElementById('querySpeedTooltip'),
	gridToggle: document.getElementById('gridToggle'), listToggle: document.getElementById('listToggle'),
	toggleAllBtn: document.getElementById('toggleAllBtn'),
    globalSearchInput: document.getElementById('globalSearchInput'),
    globalSearchClearBtn: document.getElementById('globalSearchClearBtn'),
    globalSearchBtn: document.getElementById('globalSearchBtn'),
    discoverDashboard: document.getElementById('discoverDashboard'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    settingsCloseBtn: document.getElementById('settingsCloseBtn'),
    translateToggle: document.getElementById('translateToggle'),
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
let lastSearchTotalFound = 0; 
let sortDirection = 'desc';
let renderIndex = 0;
let cachedSubjectCounts = null;
let fetchTimerInterval = null;

const RENDER_CHUNK = 50;

// Global Translation Cache to prevent duplicate and rapid CDNs IP-blocking API requests
const translationCache = new Map();
const translationPending = new Set();

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

    const render = () => {
        container.querySelectorAll('.ui-tag').forEach(e => e.remove());
        tags.forEach((tag, idx) => {
            const tagEl = document.createElement('div');
            tagEl.className = 'ui-tag';
            tagEl.innerHTML = `<span>${escapeHTML(tag)}</span><span class="ui-tag-close" data-idx="${idx}">&times;</span>`;
            container.insertBefore(tagEl, input.parentElement);
        });
        container.querySelectorAll('.ui-tag-close').forEach(btn => {
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
            if (input.value.trim()) addTag(input.value);
            if (!DOM.btn.disabled) DOM.btn.click();
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
    return { getTags: () => tags, addTag, removeTag, clear: () => { tags = []; render(); input.value = ''; input.placeholder = 'e.g., Fantasy'; if(onInputCleared) onInputCleared(); }, setTags: (newTags) => { tags = [...newTags]; render(); input.value = ''; input.placeholder = tags.length ? '' : 'e.g., Fantasy'; if(onInputCleared) onInputCleared(); } };
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
    state.sortDir = sortDirection;
    if (currentViewMode === 'library') state.view = 'library';
    return state;
};

const saveStateToHash = (isPush = false) => {
    if (!DOM.persistToggle.checked) return;
    const hash = encodeURIComponent(JSON.stringify(getHashStateObj()));
    if (isPush) {
        if (window.location.hash !== '#' + hash) {
            history.pushState(null, '', window.location.pathname + window.location.search + '#' + hash);
        }
    } else {
        history.replaceState(null, '', window.location.pathname + window.location.search + '#' + hash);
    }
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
            DOM.apiAdvancedSettings.style.display = 'none';
        } else {
            currentViewMode = 'search';
            DOM.viewSavedBtn.classList.remove('active');
            DOM.sortDateOpt.style.display = 'none';
            DOM.sortRelevanceOpt.style.display = 'block';
            DOM.apiAdvancedSettings.style.display = 'flex';
        }
        
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
                performSearch(false);
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
            DOM.apiAdvancedSettings.style.display = 'flex';
            
            checkInputs();
            renderDiscoverDashboard();
        }
    }
});

DOM.shareLink.addEventListener('click', e => {
    e.preventDefault();
    const state = getHashStateObj();
    const url = window.location.origin + window.location.pathname + window.location.search + '#' + encodeURIComponent(JSON.stringify(state));
    navigator.clipboard.writeText(url).then(() => {
        const orig = DOM.shareLink.innerHTML;
        DOM.shareLink.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => { DOM.shareLink.innerHTML = orig; }, 2000);
    });
});

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
        DOM.btn.disabled = !hasValue;
        DOM.btn.textContent = 'Filter Library';
        return;
    }
    DOM.btn.textContent = 'Find Books';
    DOM.btn.disabled = !hasValue;
};

const appendKeyboardListeners = () => {
    document.querySelectorAll('input:not(.watch-input-tag), select').forEach(element => {
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
    DOM.sortNote.style.display = (v === 'rating' || v === 'reviews') && currentViewMode !== 'library' ? 'block' : 'none';
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

document.getElementById('sortResetBtn').addEventListener('click', () => {
    if (currentViewMode === 'library') DOM.sort.value = 'date';
    else DOM.sort.value = 'relevance';
    DOM.sortNote.style.display = 'none';
    sortDirection = SORT_DEFAULTS[DOM.sort.value] || 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'library') applyLocalFilters();
});

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
                const [resExact, resWild] = await Promise.all([
                    fetch(`https://openlibrary.org/search/subjects.json?q=${encodeURIComponent(query)}&limit=10`),
                    fetch(`https://openlibrary.org/search/subjects.json?q=${encodeURIComponent(query + '*')}&limit=10`)
                ]);
                
                if (!resExact.ok || !resWild.ok) throw new Error();
                const dataExact = await resExact.json();
                const dataWild = await resWild.json();
                
                const mergedMap = new Map();
                [...(dataExact.docs || []), ...(dataWild.docs || [])].forEach(d => {
                    if (!mergedMap.has(d.name.toLowerCase())) mergedMap.set(d.name.toLowerCase(), d);
                });
                
                // 1. Filter and pre-compute tokens to save CPU inside the nested loop
                const viableCandidates = Array.from(mergedMap.values())
                    .filter(d => (d.work_count || 0) >= 10)
                    .map(d => {
                        // Strip punctuation and split into an array of raw lowercase words
                        const tokens = d.name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
                        return { ...d, tokens };
                    });

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

const applyLocalFilters = () => {
    cachedSubjectCounts = null; // Invalidate cache when filters change
    const filtered = getLocalFilteredBooks();
    renderSavedCollection(filtered);
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
    if(!tagArray || tagArray.length === 0) return;
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

const renderDiscoverDashboard = async () => {
    DOM.grid.style.display = 'none';
    DOM.status.style.display = 'none';
    DOM.footer.style.display = 'none';
    DOM.resultsMeta.style.display = 'none';
    DOM.discoverDashboard.style.display = 'block';
    
    DOM.discoverDashboard.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
            <h3 class="discover-section-title">Popular Genres</h3>
            <div class="genre-grid">
                <div class="genre-card" data-genre="Fantasy">
                    <span class="genre-name">Fantasy</span>
                </div>
                <div class="genre-card" data-genre="Science Fiction">
                    <span class="genre-name">Sci-Fi</span>
                </div>
                <div class="genre-card" data-genre="Mystery">
                    <span class="genre-name">Mystery</span>
                </div>
                <div class="genre-card" data-genre="Romance">
                    <span class="genre-name">Romance</span>
                </div>
                <div class="genre-card" data-genre="History">
                    <span class="genre-name">History</span>
                </div>
                <div class="genre-card" data-genre="Biography">
                    <span class="genre-name">Biography</span>
                </div>
                <div class="genre-card" data-genre="Thriller">
                    <span class="genre-name">Thriller</span>
                </div>
                <div class="genre-card" data-genre="Classics">
                    <span class="genre-name">Classics</span>
                </div>
            </div>
        </div>
        
        <div>
            <h3 class="discover-section-title">Popular Books</h3>
            <div id="featuredClassicsGrid" class="book-grid">
                <!-- Skeletons will show here first -->
            </div>
        </div>
    `;
    
    // Add genre card click listeners
    DOM.discoverDashboard.querySelectorAll('.genre-card').forEach(card => {
        card.addEventListener('click', () => {
            const genre = card.getAttribute('data-genre');
            tagManagerInc.clear();
            tagManagerInc.addTag(genre);
            if (currentViewMode === 'library') {
                DOM.viewSavedBtn.click(); // switch back to search mode
            }
            performSearch(false);
        });
    });

    // Render featured books skeletons
    const featuredGrid = document.getElementById('featuredClassicsGrid');
    featuredGrid.style.display = 'grid';
    for (let i = 0; i < 4; i++) {
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
        featuredGrid.appendChild(s);
    }
    
    try {
        // Query popular classics with a sneaky accessible filter via the Search API so ratings load
        const response = await fetch(`${API_BASE}?q=ratings_count:[100+TO+*]&limit=8&sort=editions&fields=key,title,author_name,cover_i,first_publish_year,subject,place,edition_count,ratings_average,ratings_count,cover_edition_key,language,person&contact=${API_CONTACT_EMAIL}`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        const docs = data.docs || [];
        featuredGrid.innerHTML = '';
        
        if (docs.length === 0) {
            featuredGrid.innerHTML = '<div style="opacity: 0.6; font-style: italic; padding: 1rem 0;">No Popular Books available at the moment.</div>';
            return;
        }
        
        docs.slice(0, 8).forEach((b, idx) => {
            if(b.subject) b.subject = cleanSubjects(b.subject);
            const card = buildCard(b, false, null);
            card.style.setProperty('--card-index', idx);
            featuredGrid.appendChild(card);
        });
        
        // Background sync trending titles if needed
        syncCardTitles(docs.slice(0, 8));
    } catch {
        featuredGrid.innerHTML = '<div style="opacity: 0.6; font-style: italic; padding: 1rem 0;">Failed to load Popular Books. Check your connection.</div>';
    }
};

const injectSkeletonScreen = (isLoadMore = false) => {
    if (!isLoadMore) DOM.grid.innerHTML = ''; // Only wipe the grid on a fresh search
    DOM.status.style.display = 'none';
    DOM.grid.style.display = 'grid';
    
    const skeletonsCount = DOM.grid.classList.contains('list-view') ? 10 : 8;
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
        DOM.grid.appendChild(s);
    }
};

const performSearch = async (isLoadMore = false) => {
    if (currentViewMode === 'library') return;
    if (!isLoadMore) {
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

        const min = DOM.minY.value.trim() || '*';
        const max = DOM.maxY.value.trim() || '*';
        if (min !== '*' || max !== '*') qParts.push(`+first_publish_year:[${min} TO ${max}]`);

        activeMinStar = parseFloat(DOM.minStarRating.value) || 0;
        activeMinRCount = parseInt(DOM.minRatings.value) || 0;

        activeQueryParams = new URLSearchParams();
        // Join with spaces. The + and - prefixes natively enforce the strict Boolean logic.
        activeQueryParams.append('q', qParts.length > 0 ? qParts.join(' ') : '*');
        
        let apiSort = activeSort;
        if (apiSort === 'rating' || apiSort === 'reviews') apiSort = 'editions';
        else if (apiSort === 'new') apiSort = sortDirection === 'desc' ? 'new' : 'old';

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
    DOM.querySpeedContainer.style.display = 'none'; // Hide info tooltip while query is active
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
        const response = await fetch(`${API_BASE}?${activeQueryParams.toString()}`);
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
        docs.forEach(d => { if(d.subject) d.subject = cleanSubjects(d.subject); });

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
            const docsToTranslate = filteredDocs.slice(0, 20).filter(b => needsTranslation(b, targetLang));
            
            if (docsToTranslate.length > 0) {
                const fetchTask = async (b) => {
                    const cacheKey = `${b.key}_${targetLang}`;
                    translationPending.add(cacheKey);
                    try {
                        const res = await fetch(`https://openlibrary.org${b.key}/editions.json?limit=40`);
                        if (!res.ok) return;
                        const edData = await res.json();
                        if (edData && edData.entries && edData.entries.length > 0) {
                            const matchingEdition = edData.entries.find(entry => {
                                if (!entry.languages) return false;
                                return entry.languages.some(lang => {
                                    const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                                    return code.includes(targetLang) || (targetLang === 'eng' && (code === 'eng' || code === 'en'));
                                });
                            });
                            
                            if (matchingEdition && matchingEdition.title) {
                                translationCache.set(cacheKey, matchingEdition.title);
                                if (matchingEdition.title !== b.title) {
                                    b.title = matchingEdition.title;
                                }
                            } else {
                                translationCache.set(cacheKey, b.title);
                            }
                        }
                    } catch {} finally {
                        translationPending.delete(cacheKey);
                    }
                };
                
                const batchSize = 5;
                for (let i = 0; i < docsToTranslate.length; i += batchSize) {
                    const batch = docsToTranslate.slice(i, i + batchSize);
                    await Promise.all(batch.map(fetchTask));
                }
            } else {
                // Apply cached title updates if they exist in memory
                filteredDocs.slice(0, 20).forEach(b => {
                    const cacheKey = `${b.key}_${targetLang}`;
                    if (translationCache.has(cacheKey)) {
                        b.title = translationCache.get(cacheKey);
                    }
                });
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
                DOM.querySpeedContainer.style.display = 'none'; // Keep hidden while text is showing
                
                // Disappearing progress status message
                DOM.fetchStatus.textContent = `Search completed in ${totalTime.toFixed(1)}s`;
                
                // Clear fetch status after a brief moment with a smooth CSS fade-out transition, then collapse into hoverable icon
                setTimeout(() => {
                    DOM.fetchStatus.style.opacity = '0';
                    setTimeout(() => {
                        DOM.fetchStatus.textContent = '';
                        DOM.fetchStatus.style.opacity = ''; // Reset opacity state for next search
                        DOM.querySpeedContainer.style.display = 'inline-flex'; // Show hoverable stats icon
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

        const helpfulError = `OpenLibrary request failed. This often happens if the query matches too many books (e.g., broad search criteria like a simple year filter) or if the API is timing out. Try adding more specific filters (like Author or specific Subject tags) to narrow your search. <br><small>Original Error: ${error.message}</small>`;

        if (!isLoadMore) {
            DOM.grid.innerHTML = '';
            DOM.status.innerHTML = `<strong>Search Error:</strong> ${helpfulError}`;
            DOM.status.style.display = 'block';
        } else {
            DOM.hiddenMsg.innerHTML = `<strong>Error loading more books:</strong> ${helpfulError}`;
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
    
    card.addEventListener('click', (e) => {
        if (e.target.closest('.tag') || e.target.closest('.action-buttons') || e.target.closest('.book-author span')) return;
        openDetailsDrawer(b, finalAALang);
    });
    
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
    const finalAALang = filterLangAA || bookLangAA;

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
    
    const authorSpan = card.querySelector('.book-author span');
    authorSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        if (author !== 'Unknown Author') {
            window.open(`https://openlibrary.org/search?author=${encodeURIComponent(author)}`, '_blank', 'noopener,noreferrer');
        }
    });

    card.querySelectorAll('.tag').forEach(tagElement => {
        tagElement.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = tagElement.textContent;
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
        });
    });

    const libraryBtn = card.querySelector('.library-btn');
    libraryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLibrary(b);
        const isNowInLibrary = libraryBtn.classList.toggle('in-library');
        libraryBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isNowInLibrary ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
		updateToggleAllBtnState();
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
    const aaQuery = encodeURIComponent(`${b.title} ${author !== 'Unknown Author' ? 'by ' + author : ''}`);
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
    
    // Cover image - clone from card to prevent delay, fallback to M image query
    const cardInGrid = Array.from(document.querySelectorAll('.book-card')).find(c => {
        const titleEl = c.querySelector('.book-title');
        return titleEl && titleEl.textContent === b.title;
    });
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
        const card = Array.from(document.querySelectorAll('.book-card')).find(c => {
            const titleEl = c.querySelector('.book-title');
            return titleEl && titleEl.textContent === b.title;
        });
        if (card) {
            const btn = card.querySelector('.library-btn');
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
    let fetchPromises = [fetch(`https://openlibrary.org${b.key}.json`).then(r => r.ok ? r.json() : null)];
    const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
    if (isTransEnabled && b.cover_edition_key) {
        fetchPromises.push(fetch(`https://openlibrary.org/books/${b.cover_edition_key}.json`).then(r => r.ok ? r.json() : null));
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
                canonicalTitle = editionData.title;
            }
        }
        DOM.detailsTitle.textContent = canonicalTitle;
        
        if (canonicalTitle && canonicalTitle !== b.title) {
            const card = Array.from(document.querySelectorAll('.book-card')).find(c => {
                const titleEl = c.querySelector('.book-title');
                return titleEl && titleEl.textContent === b.title;
            });
            if (card) {
                const titleEl = card.querySelector('.book-title');
                if (titleEl) {
                    titleEl.textContent = canonicalTitle;
                    titleEl.title = canonicalTitle;
                }
            }
            b.title = canonicalTitle;
        }
        
        // Update Anna's Archive hyperlink with the canonical English title
        const cleanAAQuery = encodeURIComponent(`${canonicalTitle} ${author !== 'Unknown Author' ? 'by ' + author : ''}`);
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
    if (translationPending.has(cacheKey)) return false;
    
    // If work has no languages listed, we cannot skip checking it
    if (!b.language || b.language.length === 0) return true;
    
    const cleanLangs = b.language.map(l => l.replace('/languages/', '').toLowerCase());
    const hasTarget = cleanLangs.includes(targetLang) || (targetLang === 'eng' && (cleanLangs.includes('eng') || cleanLangs.includes('en')));
    
    // If the target language is not even listed in the work languages, we skip fetching
    if (!hasTarget) return false;
    
    // If the target language is listed but it is the ONLY language, the title is already in target language!
    if (cleanLangs.length === 1) return false;
    
    return true;
};

const updateCardTitleInGrid = (oldTitle, newTitle) => {
    const cards = Array.from(document.querySelectorAll('.book-card'));
    const card = cards.find(c => {
        const titleEl = c.querySelector('.book-title');
        return titleEl && (titleEl.textContent === oldTitle || titleEl.title === oldTitle);
    });
    if (card) {
        const titleEl = card.querySelector('.book-title');
        if (titleEl) {
            titleEl.textContent = newTitle;
            titleEl.title = newTitle;
        }
    }
};

const syncCardTitles = (docs) => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return;
    
    const targetLang = DOM.incLang.value.trim().toLowerCase() || 'eng';
    
    docs.forEach(async (b) => {
        if (!b.key) return;
        const cacheKey = `${b.key}_${targetLang}`;
        
        // If not in cache and doesn't need translation, check if it's already cached from before
        if (!needsTranslation(b, targetLang)) {
            if (translationCache.has(cacheKey)) {
                const cachedTitle = translationCache.get(cacheKey);
                if (cachedTitle !== b.title) {
                    const oldTitle = b.title;
                    b.title = cachedTitle;
                    updateCardTitleInGrid(oldTitle, cachedTitle);
                }
            }
            return;
        }
        
        translationPending.add(cacheKey);
        
        try {
            const response = await fetch(`https://openlibrary.org${b.key}/editions.json?limit=40`);
            if (!response.ok) return;
            const data = await response.json();
            
            if (data && data.entries && data.entries.length > 0) {
                // Find an edition that matches targetLang
                const matchingEdition = data.entries.find(entry => {
                    if (!entry.languages) return false;
                    return entry.languages.some(lang => {
                        const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                        return code.includes(targetLang) || (targetLang === 'eng' && (code === 'eng' || code === 'en'));
                    });
                });
                
                if (matchingEdition && matchingEdition.title) {
                    translationCache.set(cacheKey, matchingEdition.title);
                    if (matchingEdition.title !== b.title) {
                        const oldTitle = b.title;
                        b.title = matchingEdition.title;
                        updateCardTitleInGrid(oldTitle, matchingEdition.title);
                    }
                } else {
                    // Cache the original title so we don't query again
                    translationCache.set(cacheKey, b.title);
                }
            }
        } catch {
            // Fail silently
        } finally {
            translationPending.delete(cacheKey);
        }
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
        DOM.totalCount.textContent = library.length === books.length
            ? `Displaying ${books.length} books in Library`
            : `Displaying ${books.length} of ${library.length} books in Library`;
        DOM.resultsMeta.style.display = 'flex';
        DOM.grid.style.display = 'grid';
        
        const rawIncLang = DOM.incLang.value.trim().toLowerCase();
        const filterLangAA = rawIncLang ? (langMapToAA[rawIncLang] || rawIncLang) : null;
        
        renderIndex = 0;
        renderNextChunk(isEditionsSort, filterLangAA);
    }
};

const updateToggleAllBtnState = () => {
    if (DOM.resultsMeta.style.display === 'none' && currentViewMode === 'search') {
        DOM.toggleAllBtn.style.display = 'none';
        return;
    }
    
    const currentList = currentViewMode === 'library' ? getLocalFilteredBooks() : allDisplayedDocs;
    if (currentList.length === 0) {
        DOM.toggleAllBtn.style.display = 'none';
        return;
    }
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

document.querySelector('main.results').addEventListener('scroll', (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight < 600) {
        const listLen = currentViewMode === 'library' ? getLocalFilteredBooks().length : allDisplayedDocs.length;
        if (renderIndex < listLen) {
            const isEditionsSort = DOM.sort.value === 'editions';
            const rawIncLang = DOM.incLang.value.trim().toLowerCase();
            const filterLangAA = rawIncLang ? (langMapToAA[rawIncLang] || rawIncLang) : null;
            renderNextChunk(isEditionsSort, filterLangAA);
        }
    }
});

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
        DOM.apiAdvancedSettings.style.display = 'none';
        DOM.discoverDashboard.style.display = 'none';
        DOM.settingsPanel.style.display = 'none';
        DOM.querySpeedContainer.style.display = 'none';
        restoreModeState('library');
        applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash(true);
    } else {
        currentViewMode = 'search';
        DOM.viewSavedBtn.classList.remove('active');
        DOM.sortDateOpt.style.display = 'none';
        DOM.sortRelevanceOpt.style.display = 'block';
		DOM.apiAdvancedSettings.style.display = 'flex';
        restoreModeState('search');
        DOM.grid.innerHTML = '';
        if (DOM.persistToggle.checked) saveStateToHash(true);
        
        if (allDisplayedDocs.length > 0) {
            renderResults(allDisplayedDocs.length, lastSearchTotalFound, false, 0, 0, false);
            if (DOM.querySpeedTooltip.innerHTML.trim() !== '') {
                DOM.querySpeedContainer.style.display = 'inline-flex';
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

DOM.gridToggle.addEventListener('click', () => { DOM.gridToggle.classList.add('active'); DOM.listToggle.classList.remove('active'); DOM.grid.classList.remove('list-view'); });
DOM.listToggle.addEventListener('click', () => { DOM.listToggle.classList.add('active'); DOM.gridToggle.classList.remove('active'); DOM.grid.classList.add('list-view'); });

DOM.btn.addEventListener('click', () => { 
    if (DOM.incSub.value.trim()) tagManagerInc.addTag(DOM.incSub.value);
    if (DOM.excSub.value.trim()) tagManagerExc.addTag(DOM.excSub.value);
    if (currentViewMode === 'library') applyLocalFilters(); 
    else performSearch(false); 
});

DOM.toggleAllBtn.addEventListener('click', () => {
    const currentList = currentViewMode === 'library' ? getLocalFilteredBooks() : allDisplayedDocs;
    const allInLibrary = currentList.every(b => library.some(s => s.key === b.key));
    
    if (allInLibrary && currentViewMode === 'library' && !DOM.toggleAllBtn.classList.contains('confirming')) {
        DOM.toggleAllBtn.classList.add('confirming');
        DOM.toggleAllBtn.innerHTML = `<span style="font-size: 0.8rem; font-weight: bold;">Remove All?</span>`;
        setTimeout(() => {
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
            library.push({
                key: b.key, title: b.title, author_name: b.author_name, cover_i: b.cover_i,
                cover_edition_key: b.cover_edition_key, first_publish_year: b.first_publish_year,
                subject: cleanSubjects(b.subject), place: b.place, person: b.person,
                language: b.language, ratings_average: b.ratings_average, ratings_count: b.ratings_count,
                edition_count: b.edition_count, savedAt: Date.now()
            });
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
        } else applyLocalFilters();
    }
    DOM.toggleAllBtn.classList.remove('confirming');
    updateToggleAllBtnState();
});

DOM.loadMoreBtn.addEventListener('click', () => performSearch(true));

// Initialize Database and Auto-Migrate legacy data
localforage.getItem('ole_bookmarks').then(data => {
    // If IndexedDB is empty, check if they have old LocalStorage data to rescue
    if (!data && localStorage.getItem('ole_bookmarks')) {
        data = JSON.parse(localStorage.getItem('ole_bookmarks'));
        localforage.setItem('ole_bookmarks', data);
        localStorage.removeItem('ole_bookmarks'); // Clean up the old storage
    }
    
    library = data || [];
	library.forEach(b => { 
		if(b.subject) b.subject = cleanSubjects(b.subject); 
		cacheBookTokens(b); 
	});
	updateLibraryBadge();
    
    // Boot the app UI once the data is loaded
    if (loadStateFromHash()) {
        DOM.persistToggle.checked = true;
        const v = DOM.sort.value;
        DOM.sortNote.style.display = (v === 'rating' || v === 'reviews') ? 'block' : 'none';
        checkInputs();
        if (currentViewMode === 'library') applyLocalFilters();
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
});

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
