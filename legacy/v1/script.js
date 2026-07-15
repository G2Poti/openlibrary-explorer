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
    savedAdvancedSettings: document.getElementById('savedAdvancedSettings'),
	gridToggle: document.getElementById('gridToggle'), listToggle: document.getElementById('listToggle'),
	toggleAllBtn: document.getElementById('toggleAllBtn'), viewSavedBtn: document.getElementById('viewSavedBtn')
};

const watchInputs = document.querySelectorAll('.watch-input');
const INPUT_IDS = ['incLang', 'incTitle', 'incAuthor', 'incPlace', 'incPerson', 'excLang', 'excPlace', 'excPerson', 'minYear', 'maxYear', 'minStarRating', 'minRatings'];

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

const RENDER_CHUNK = 50;

const appStates = {
    search: { tagsInc: [], tagsExc: [], inputs: {}, sort: 'relevance', sortDir: 'desc' },
    saved: { tagsInc: [], tagsExc: [], inputs: {}, sort: 'date', sortDir: 'desc' }
};

const SORT_DEFAULTS = { relevance: 'desc', rating: 'desc', reviews: 'desc', editions: 'desc', new: 'desc', date: 'desc', random: 'desc' };

let savedBookmarks = []; 
// We no longer load from localStorage here because IndexedDB is asynchronous

const updateSavedBadge = () => { DOM.savedCount.textContent = savedBookmarks.length; };
updateSavedBadge();

const renderNextChunk = (isEditionsSort, filterLangAA) => {
    const listToRender = currentViewMode === 'saved' ? getLocalFilteredBooks() : allDisplayedDocs;
    const fragment = document.createDocumentFragment();
    const endIdx = Math.min(renderIndex + RENDER_CHUNK, listToRender.length);
    
    for (let i = renderIndex; i < endIdx; i++) {
        fragment.appendChild(buildCard(listToRender[i], isEditionsSort, filterLangAA));
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
    }
    
    updateToggleAllBtnState();
};

const toggleBookmark = (bookData) => {
    const idx = savedBookmarks.findIndex(b => b.key === bookData.key);
    if (idx > -1) {
        savedBookmarks.splice(idx, 1);
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
        savedBookmarks.push(slim);
    }
    localforage.setItem('ole_bookmarks', savedBookmarks).catch(console.error);
    updateSavedBadge();
    if (currentViewMode === 'saved') applyLocalFilters();
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
                    if (currentViewMode === 'saved') applyLocalFilters();
                }
            };

    const removeTag = (idx) => {
        tags.splice(idx, 1);
        input.placeholder = tags.length ? '' : 'e.g., Fantasy';
        render();
        checkInputs();
        if (currentViewMode === 'saved') applyLocalFilters();
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
            if (currentViewMode === 'saved') applyLocalFilters();
        } else if (e.key === 'Delete' && input.value === '' && tags.length > 0) {
            e.preventDefault();
            tags.pop();
            input.placeholder = tags.length ? '' : 'e.g., Fantasy';
            render();
            checkInputs();
            if (currentViewMode === 'saved') applyLocalFilters();
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
    if (currentViewMode === 'saved') state.view = 'saved';
    return state;
};

const saveStateToHash = () => {
    if (!DOM.persistToggle.checked) return;
    history.replaceState(null, '', window.location.pathname + window.location.search + '#' + encodeURIComponent(JSON.stringify(getHashStateObj())));
};

const loadStateFromHash = () => {
    if (!window.location.hash || window.location.hash === '#') return false;
    try {
        const state = JSON.parse(decodeURIComponent(window.location.hash.slice(1)));
        
        const targetState = state.view === 'saved' ? appStates.saved : appStates.search;
        
        INPUT_IDS.forEach(id => { if (state[id] != null) targetState.inputs[id] = state[id]; });
        if (state['incSubject']) targetState.tagsInc = state['incSubject'].split(',');
        if (state['excSubject']) targetState.tagsExc = state['excSubject'].split(',');
        if (state.sort) targetState.sort = state.sort;
        
        if (state.view === 'saved') {
            currentViewMode = 'saved';
            DOM.viewSavedBtn.classList.add('active');
            DOM.sortDateOpt.style.display = 'block';
            DOM.sortRelevanceOpt.style.display = 'none';
            if (!state.sort) targetState.sort = 'date';
        }
        restoreModeState(currentViewMode);
        return true;
    } catch { return false; }
};

DOM.persistToggle.addEventListener('change', () => {
    if (DOM.persistToggle.checked) saveStateToHash();
    else history.replaceState(null, '', window.location.pathname + window.location.search);
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
    // Explicitly ignore the sort dropdown when checking for active filters
    const textInputs = Array.from(watchInputs).filter(el => 
        (el.tagName === 'INPUT' || el.tagName === 'SELECT') && el.id !== 'sortSelect'
    );
    const hasValue = textInputs.some(input => input.value.trim() !== '') || tagManagerInc.getTags().length > 0 || tagManagerExc.getTags().length > 0;

    if (currentViewMode === 'saved') {
        DOM.btn.disabled = !hasValue;
        DOM.btn.textContent = 'Filter Favourites';
        return;
    }
    DOM.btn.textContent = 'Find Books';
    DOM.btn.disabled = !hasValue;
    
    if (hasValue && DOM.status.textContent === 'Please enter at least one filter to begin.') {
        DOM.status.textContent = 'Filters configured. Click Find Books to begin.';
    } else if (!hasValue && DOM.grid.children.length === 0) {
        DOM.status.textContent = 'Please enter at least one filter to begin.';
        DOM.status.style.display = 'block';
    }
};

const appendKeyboardListeners = () => {
    document.querySelectorAll('input:not(.watch-input-tag), select').forEach(element => {
        element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (currentViewMode === 'saved') applyLocalFilters();
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
        if (currentViewMode === 'saved') {
            clearTimeout(localFilterTimer);
            localFilterTimer = setTimeout(applyLocalFilters, 150);
        }
    });
    input.addEventListener('change', checkInputs);
});

DOM.sort.addEventListener('change', () => {
    const v = DOM.sort.value;
    DOM.sortNote.style.display = (v === 'rating' || v === 'reviews') && currentViewMode !== 'saved' ? 'block' : 'none';
    sortDirection = SORT_DEFAULTS[v] || 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'saved') applyLocalFilters();
});

document.getElementById('sortDirBtn').addEventListener('click', () => {
    const isApiMode = currentViewMode === 'search';
    const val = DOM.sort.value;
    if (val === 'random' || (isApiMode && val !== 'new')) return;
    sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'saved') applyLocalFilters();
});

document.getElementById('sortResetBtn').addEventListener('click', () => {
    if (currentViewMode === 'saved') DOM.sort.value = 'date';
    else DOM.sort.value = 'relevance';
    DOM.sortNote.style.display = 'none';
    sortDirection = SORT_DEFAULTS[DOM.sort.value] || 'desc';
    updateSortDirBtn();
    if (currentViewMode === 'saved') applyLocalFilters();
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
        if (currentViewMode === 'saved') applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash();
    });
});

DOM.resetBtn.addEventListener('click', () => {
    watchInputs.forEach(input => { input.value = ''; });
    tagManagerInc.clear(); tagManagerExc.clear();

    if (currentViewMode === 'saved') {
        DOM.sort.value = 'date';
        DOM.sortNote.style.display = 'none';
        checkInputs();
        applyLocalFilters();
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
    if (DOM.persistToggle.checked) history.replaceState(null, '', window.location.pathname + window.location.search);
    checkInputs();
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
    let filtered = [...savedBookmarks];
    
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
        if (isLocalMode && isLocalMode() && savedBookmarks.length > 0) {
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

setupAutocomplete('incSubject', 'incSubjectList', 'incSubjectLoading', 'incSubjectGhost', () => currentViewMode === 'saved', tagManagerInc);
setupAutocomplete('excSubject', 'excSubjectList', 'excSubjectLoading', 'excSubjectGhost', () => currentViewMode === 'saved', tagManagerExc);

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
    if (currentViewMode === 'saved') return;
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

        saveStateToHash();
    } else {
        currentPage++;
    }

    activeQueryParams.set('page', currentPage);
    injectSkeletonScreen(isLoadMore);
    const currentSortDir = sortDirection; 

    if (isLoadMore) {
        DOM.loadMoreBtn.disabled = true;
        DOM.loadMoreBtn.textContent = 'Loading...';
    } else {
        DOM.btn.disabled = true;
        DOM.btn.textContent = 'Searching...';
    }

    try {
        const response = await fetch(`${API_BASE}?${activeQueryParams.toString()}`);
        if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
        const data = await response.json();
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

        const newStartIdx = allDisplayedDocs.length;
        allDisplayedDocs = allDisplayedDocs.concat(filteredDocs);

        const needsFullRerender = (activeSort === 'rating' || activeSort === 'reviews');

        if (activeSort === 'rating') {
            allDisplayedDocs.sort((a, b) => (currentSortDir === 'desc' ? 1 : -1) * ((b.ratings_average || 0) - (a.ratings_average || 0)));
        } else if (activeSort === 'reviews') {
            allDisplayedDocs.sort((a, b) => (currentSortDir === 'desc' ? 1 : -1) * ((b.ratings_count || 0) - (a.ratings_count || 0)));
        }

        renderResults(docs.length, lastSearchTotalFound, isLoadMore, hiddenInBatch, newStartIdx, needsFullRerender);
        
    } catch (error) {
        // Clean up any hanging skeletons first
        const activeSkeletons = DOM.grid.querySelectorAll('.skeleton-card');
        activeSkeletons.forEach(skel => skel.remove());

        if (!isLoadMore) {
            DOM.grid.innerHTML = '';
            DOM.status.innerHTML = `<strong>Error:</strong> API request failed.<br><small>${error.message}</small>`;
            DOM.status.style.display = 'block';
        } else {
            DOM.hiddenMsg.innerHTML = `<strong>Error loading more books:</strong> ${error.message}`;
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
        const urlPath = b.cover_edition_key ? `/books/${b.cover_edition_key}` : b.key;
        window.open(`https://openlibrary.org${urlPath}`, '_blank', 'noopener,noreferrer');
    });
    
    const cover = b.cover_i 
        ? `<img src="https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg" class="book-cover" alt="Cover Image" loading="lazy">` 
        : `<div class="no-cover">No Cover</div>`;

    const author = b.author_name ? b.author_name[0] : 'Unknown Author';
    const year = b.first_publish_year || 'N/A';
    
    const ratingCount = b.ratings_count ? `(${b.ratings_count})` : '';
    const ratingDisplay = b.ratings_average ? `★ ${parseFloat(b.ratings_average).toFixed(1)} ${ratingCount}` : 'No rating';
    const editionBadge = (isEditionsSort && b.edition_count) ? `<span class="edition-badge">${b.edition_count} Editions</span>` : '';
    const isBookmarked = savedBookmarks.some(saved => saved.key === b.key);

    let bookLangAA = 'en';
    if (b.language && b.language.length > 0) {
        let olLang = b.language[0].replace('/languages/', '');
        bookLangAA = langMapToAA[olLang] || olLang;
    }
    const finalAALang = filterLangAA || bookLangAA;

    const heartSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;

    card.innerHTML = `
        <div class="card-main">
            <div class="cover-container">${cover}</div>
            <div class="card-details">
                <div class="book-title" title="${escapeHTML(b.title)}">${escapeHTML(b.title)}</div>
                <div class="book-author">by <span title="Search other books by ${escapeHTML(author)}">${escapeHTML(author)}</span></div>
                <div class="action-buttons">
                    <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" title="${isBookmarked ? 'Remove from Favourites' : 'Save to Favourites'}">${heartSVG}</button>
                    <button class="aa-btn" title="Search EPUB mirror archives on Anna's Archive">🔍</button>
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
                if (currentViewMode === 'saved') DOM.viewSavedBtn.click();
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

    const aaBtn = card.querySelector('.aa-btn');
    aaBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        const aaQuery = encodeURIComponent(`${b.title} ${author !== 'Unknown Author' ? 'by ' + author : ''}`);
        const aaUrl = `${ANNA_ARCHIVE_URL}/search?index=&page=1&sort=&ext=epub&lang=${finalAALang}&display=&q=${aaQuery}`;
        window.open(aaUrl, '_blank', 'noopener,noreferrer');
    });

    const bookmarkBtn = card.querySelector('.bookmark-btn');
    bookmarkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBookmark(b);
        const isNowBookmarked = bookmarkBtn.classList.toggle('bookmarked');
        bookmarkBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${isNowBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
		updateToggleAllBtnState();
	});

    return card;
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

const renderSavedCollection = (books = savedBookmarks) => {
    DOM.grid.innerHTML = '';
    DOM.footer.style.display = 'none';
    const isEditionsSort = DOM.sort.value === 'editions';
    
    if (books.length === 0) {
        DOM.status.textContent = savedBookmarks.length === 0
            ? 'Your Favourites Collection is currently empty. Favourite books from search queries to populate this list.'
            : 'No saved books match your current filters.';
        DOM.status.style.display = 'block';
        DOM.resultsMeta.style.display = 'none';
        DOM.grid.style.display = 'none';
    } else {
        DOM.status.style.display = 'none';
        DOM.totalCount.textContent = savedBookmarks.length === books.length
            ? `Displaying ${books.length} saved bookmarks`
            : `Displaying ${books.length} of ${savedBookmarks.length} saved bookmarks`;
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
    
    const currentList = currentViewMode === 'saved' ? getLocalFilteredBooks() : allDisplayedDocs;
    if (currentList.length === 0) {
        DOM.toggleAllBtn.style.display = 'none';
        return;
    }
    DOM.toggleAllBtn.style.display = 'flex';
    
    const allSaved = currentList.every(b => savedBookmarks.some(s => s.key === b.key));
    
    // Custom Interlocked Hearts SVG 
    // viewBox expanded from 24x24 to 28x28 to zoom out slightly and prevent stroke clipping
    const interlockedHearts = `<svg width="18" height="18" viewBox="-2 -2 28 28" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <g transform="translate(4, -3) scale(0.85)">
            <path stroke-width="2.5" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" opacity="0.6"/>
        </g>
        <g transform="translate(-2, 2) scale(0.95)">
            <path stroke-width="2.5" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="${allSaved ? 'currentColor' : 'var(--main-bg)'}"/>
        </g>
    </svg>`;
    
	DOM.toggleAllBtn.title = allSaved ? "Unfavourite All Displayed" : "Favourite All Displayed";
    DOM.toggleAllBtn.innerHTML = interlockedHearts;
    DOM.toggleAllBtn.classList.toggle('active', allSaved);
};

// Event
// Listener
// Section

document.querySelector('main.results').addEventListener('scroll', (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight < 600) {
        const listLen = currentViewMode === 'saved' ? getLocalFilteredBooks().length : allDisplayedDocs.length;
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
        currentViewMode = 'saved';
        DOM.viewSavedBtn.classList.add('active');
        DOM.sortDateOpt.style.display = 'block';
        DOM.sortRelevanceOpt.style.display = 'none'; 
		DOM.apiAdvancedSettings.style.display = 'none';
        DOM.savedAdvancedSettings.style.display = 'block';
        restoreModeState('saved');
        applyLocalFilters();
        if (DOM.persistToggle.checked) saveStateToHash();
    } else {
        currentViewMode = 'search';
        DOM.viewSavedBtn.classList.remove('active');
        DOM.sortDateOpt.style.display = 'none';
        DOM.sortRelevanceOpt.style.display = 'block';
		DOM.apiAdvancedSettings.style.display = 'block';
        DOM.savedAdvancedSettings.style.display = 'none';
        restoreModeState('search');
        DOM.grid.innerHTML = '';
        if (DOM.persistToggle.checked) saveStateToHash();
        
        if (allDisplayedDocs.length > 0) {
            renderResults(allDisplayedDocs.length, lastSearchTotalFound, false, 0, 0, false);
        } else {
            DOM.resultsMeta.style.display = 'none';
            if(!DOM.btn.disabled) DOM.status.style.display = 'block';
        }
    }
    
    // Guarantee the UI state updates the Favourite All button when switching to an empty screen
    updateToggleAllBtnState();
});

DOM.gridToggle.addEventListener('click', () => { DOM.gridToggle.classList.add('active'); DOM.listToggle.classList.remove('active'); DOM.grid.classList.remove('list-view'); });
DOM.listToggle.addEventListener('click', () => { DOM.listToggle.classList.add('active'); DOM.gridToggle.classList.remove('active'); DOM.grid.classList.add('list-view'); });

DOM.btn.addEventListener('click', () => { 
    if (DOM.incSub.value.trim()) tagManagerInc.addTag(DOM.incSub.value);
    if (DOM.excSub.value.trim()) tagManagerExc.addTag(DOM.excSub.value);
    if (currentViewMode === 'saved') applyLocalFilters(); 
    else performSearch(false); 
});

DOM.toggleAllBtn.addEventListener('click', () => {
    const currentList = currentViewMode === 'saved' ? getLocalFilteredBooks() : allDisplayedDocs;
    const allSaved = currentList.every(b => savedBookmarks.some(s => s.key === b.key));
    
    if (allSaved && currentViewMode === 'saved' && !DOM.toggleAllBtn.classList.contains('confirming')) {
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
        const idx = savedBookmarks.findIndex(s => s.key === b.key);
        if (!allSaved && idx === -1) {
            savedBookmarks.push({
                key: b.key, title: b.title, author_name: b.author_name, cover_i: b.cover_i,
                cover_edition_key: b.cover_edition_key, first_publish_year: b.first_publish_year,
                subject: cleanSubjects(b.subject), place: b.place, person: b.person,
                language: b.language, ratings_average: b.ratings_average, ratings_count: b.ratings_count,
                edition_count: b.edition_count, savedAt: Date.now()
            });
            changed = true;
        } else if (allSaved && idx > -1) {
            savedBookmarks.splice(idx, 1);
            changed = true;
        }
    });
    
    if (changed) {
        cachedSubjectCounts = null; // Invalidate cache
		localforage.setItem('ole_bookmarks', savedBookmarks).catch(console.error);
        updateSavedBadge();
        if (currentViewMode === 'search') {
            DOM.grid.querySelectorAll('.bookmark-btn').forEach(btn => {
                btn.classList.toggle('bookmarked', !allSaved);
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="${!allSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
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
    
    savedBookmarks = data || [];
	savedBookmarks.forEach(b => { 
		if(b.subject) b.subject = cleanSubjects(b.subject); 
		cacheBookTokens(b); 
	});
	updateSavedBadge();
    
    // Boot the app UI once the data is loaded
    if (loadStateFromHash()) {
        DOM.persistToggle.checked = true;
        const v = DOM.sort.value;
        DOM.sortNote.style.display = (v === 'rating' || v === 'reviews') ? 'block' : 'none';
        checkInputs();
        if (currentViewMode === 'saved') applyLocalFilters();
    } else {
        if (currentViewMode === 'saved') applyLocalFilters();
    }
    
    updateSortDirBtn();
}).catch(console.error);
