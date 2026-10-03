// app-ui.js — presentation: cards/grid rendering, details drawer, settings
// UI, layouts/gestures, telemetry HUD, selection mode. Domain logic lives in
// book-features.js; shared mutable state lives in the hub (main.js) and is
// imported read-only, with setter functions for the few
// cross-module writes. All cross-module uses are deferred (inside function
// bodies), so hub↔features↔ui cycles are evaluation-safe.
import localforage from 'localforage';
import { DOM, watchInputs } from './dom.js';
import { escapeHTML, langMapToAA, normalizeLanguageCode, ANNA_ARCHIVE_URL, editionLangMatches, getCleanProxyBase, cleanSubjects, isScrollActive } from './utils.js';
import {
    library, currentViewMode,
    currentPage, lastSearchTotalFound, renderIndex, cachedTrendingBooks, currentDiscoverTab,
    tagManagerInc, tagManagerExc, setRenderIndex, allDisplayedDocs,
    mobileSettingsBtn, customProxyUrl, DEFAULT_PROXY_URL,
    schedulerMode, schedulerMinDelayMs, schedulerMaxConnections,
    schedulerBurstCapacity, setCachedSubjectCounts, setCachedLocalFilteredBooks,
    setSchedulerMode, setSchedulerMinDelayMs, setSchedulerMaxConnections,
    setSchedulerBurstCapacity, setCustomProxyUrl
} from './main.js';
import {
    getExplicitTargetLang, isTranslateCoversEnabled, checkInputs,
    performSearch, toggleLibrary, getLocalFilteredBooks, renderNextChunk, applyLocalFilters,
    fetchWorkEditions, pickBestEdition, isValidEditionForWork, isValidSubtitle, isDuplicateTitle,
    resolvedTitlesInActivePass, activeSort, activeMinStar, activeMinRCount, currentTotalHidden,
    modifyTagFilter, showStageToast, createLibraryDoc, updateLibraryBadge, normalizeForCompare,
    lastFetchLimit
} from './book-features.js';
import {
    translationCoverCache, getCoverUrl, getCoverFromMemory, isCleanLibrarySubjectsEnabled,
    toCleanSubjectTitleCase, descriptionCache,
    getCachedSynopsis, cacheSynopsis, getWorkApiUrl, translationCache, translationPromiseCache,
    setTranslationCache, saveTranslationCache, translationGenerationToken, isSynopsisCleanupEnabled,
    cleanSynopsis, rememberCoverInMemory, rememberCoverNegative, cacheCoverInBackground,
    isLibraryWork, safeStorage, syncLibraryKeySet, translationQueue
} from './storage-cache.js';
import { fetchOpenLibrary, apiTelemetry, isApiBlocked } from './network-engine.js';
export const getGridRowCapacity = (cardWidth) => {
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

export const packTagsIntoOneRow = (subjects, rowCapacity = 80) => {
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

export const packTagsIntoTwoRows = (subjects, rowCapacity = 44) => {
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

export const renderTagsHTML = (subjects, maxCharsOrCapacity = 44) => {
    if (!subjects || subjects.length === 0) return '';
    return packTagsIntoTwoRows(subjects, maxCharsOrCapacity);
};

// The first rendered card's width is identical for every card in the same
// grid, and reading offsetWidth forces a synchronous layout pass. buildCard
// runs once per card (50 per chunk), so memoize the measurement per grid
// element instead of re-reading it for every single card. refreshGridCardTags
// below re-measures and refreshes the memo whenever the layout actually
// changes (resize, sidebar settle), so it can't go stale.
export let lastMeasuredGridEl = null;
export let lastMeasuredCardWidth = 0;
export const getGridCardWidth = (gridEl) => {
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
export let lastTagReflowWidth = 0;
export const refreshGridCardTags = () => {
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
export const resolvingCoverKeys = new Set();
export const resolveMissingCover = async (b, cardEl) => {
    if (!b || (!b.key && !b.title) || b.cover_i || b.cover_edition_key) return;
    const targetLang = getExplicitTargetLang();
    if (targetLang && isTranslateCoversEnabled() && b.key) {
        const cacheKey = `${b.key}_${targetLang}`;
        if (translationCoverCache.has(cacheKey)) {
            apiTelemetry.recordCacheHit('ram', 'cover');
            const cov = translationCoverCache.get(cacheKey);
            if (cov && cov.cover_i && cov.cover_i > 0) return;
        }
    }
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

        const res = await fetchOpenLibrary(workUrl, { passType: 'work_detail' });
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

            const cleanEd = foundEditionKey ? String(foundEditionKey).replace(/^\/books\//, '') : null;
            const targetCoverId = foundCoverId || cleanEd;
            const targetCoverUrl = getCoverUrl(targetCoverId, 'M', false);

            const containerEl = cardEl ? cardEl.querySelector('.cover-container') : document.querySelector(`.book-card[data-key="${CSS.escape(key)}"] .cover-container`);
            if (containerEl && targetCoverUrl) {
                containerEl.innerHTML = `<img src="${targetCoverUrl}" data-cover-id="${targetCoverId}" class="book-cover" alt="Cover Image" loading="lazy" decoding="async" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';" onload="if(this.naturalWidth<=1){this.onerror=null;this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';}else{this.classList.add('cover-fresh')}">`;
            }
        }
    } catch (err) {
        console.warn('Could not resolve cover for', key, err);
    } finally {
        resolvingCoverKeys.delete(key);
    }
};
export const buildCard = (b, isEditionsSort, filterLangAA) => {
    const card = document.createElement('div');
    card.className = 'book-card';
    if (b.key) card.setAttribute('data-key', b.key);
    const targetLang = getExplicitTargetLang();
    const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
    let coverId = b.cover_i || b.cover_edition_key;
    if (isTransEnabled && targetLang && isTranslateCoversEnabled() && b.key) {
        const cacheKey = `${b.key}_${targetLang}`;
        if (translationCoverCache.has(cacheKey)) {
            apiTelemetry.recordCacheHit('ram', 'cover');
            const cov = translationCoverCache.get(cacheKey);
            if (cov && cov.cover_i && cov.cover_i > 0) {
                coverId = cov.cover_i;
            }
        }
    }
    const cachedCover = coverId ? getCoverFromMemory(coverId) : null;
    let cover;
    if (cachedCover) {
        // Memory hit: instant, no sequencer needed.
        cover = `<img src="${cachedCover}" data-cover-id="${coverId}" class="book-cover" alt="Cover Image" loading="lazy" decoding="async" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';">`;
    } else if (coverId) {
        // No src yet — the ordered loader (hydrateCachedCovers) assigns
        // network covers strictly in reading order, one at a time.
        cover = `<img class="book-cover cover-pending" data-cover-id="${coverId}" alt="Cover Image" decoding="async">`;
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
    const normalizedSubjects = cleanSubjects(b.subject);
    const displayedSubjects = isCleanSubjects
        ? normalizedSubjects.map(toCleanSubjectTitleCase)
        : normalizedSubjects;
    const subjectCount = displayedSubjects.length;
    const tagsCompactHtml = subjectCount > 0
        ? `<span class="tags-compact-badge" data-subjects="${escapeHTML(JSON.stringify(displayedSubjects))}" title="Tap to see all tags">${subjectCount} tag${subjectCount === 1 ? '' : 's'}</span>`
        : '';
    const isInLibrary = isLibraryWork(b.key);
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
export const injectSkeletonScreen = (isLoadMore = false, count = null) => {
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
export const renderSynopsis = (rawDesc) => {
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

export const prefetchTrendingSynopses = async (books) => {
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
                const res = await fetchOpenLibrary(workUrl, { passType: 'work_detail' });
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
export let currentDrawerWorkKey = null;
export const openDetailsDrawer = async (b, finalAALang) => {
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
    const escapedKey = b.key ? CSS.escape(b.key) : '';
    const cardInGrid = escapedKey ? document.querySelector(`.book-card[data-key="${escapedKey}"]`) : null;
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
        const targetLang = getExplicitTargetLang();
        const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
        let drawerCoverId = b.cover_i;
        let drawerCoverEdition = b.cover_edition_key;
        if (isTransEnabled && targetLang && isTranslateCoversEnabled() && b.key) {
            const cacheKey = `${b.key}_${targetLang}`;
            if (translationCoverCache.has(cacheKey)) {
                apiTelemetry.recordCacheHit('ram', 'cover');
                const cov = translationCoverCache.get(cacheKey);
                if (cov && cov.cover_i && cov.cover_i > 0) drawerCoverId = cov.cover_i;
            }
        }
        const cleanEdition = drawerCoverEdition ? String(drawerCoverEdition).replace(/^\/books\//, '') : null;
        const targetDrawerCoverId = drawerCoverId || cleanEdition;
        const detailCoverUrl = getCoverUrl(targetDrawerCoverId, 'M', false);
        DOM.detailsCoverContainer.innerHTML = detailCoverUrl
            ? `<img src="${detailCoverUrl}" alt="Cover Image" decoding="async" style="width:100%; height:140px; object-fit:cover; border-radius:4px; box-shadow:0 4px 8px rgba(0,0,0,0.15);" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';" onload="if(this.naturalWidth<=1){this.onerror=null;this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';}">`
            : `<div class="no-cover">No Cover</div>`;
    }
    // Render subjects list
    DOM.detailsSubjects.innerHTML = '';
    const isCleanSubjects = (currentViewMode === 'library' && isCleanLibrarySubjectsEnabled());
    const normalizedSubjects = cleanSubjects(b.subject);
    const drawerSubjects = isCleanSubjects
        ? normalizedSubjects.map(toCleanSubjectTitleCase)
        : normalizedSubjects;
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
        const isInLib = isLibraryWork(b.key);
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
                const isInLib = isLibraryWork(b.key);
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
    let fetchPromises = [workUrl ? fetchOpenLibrary(workUrl, { priority: 'high', passType: 'work_detail' }).then(r => r.ok ? r.json() : null) : Promise.resolve(null)];
    const isTransEnabled = DOM.translateToggle && DOM.translateToggle.checked;
    // Explicit language filter only: with no filter there is nothing to
    // translate towards, so the edition lookup is skipped entirely.
    const targetLang = getExplicitTargetLang();
    if (isTransEnabled && targetLang && b.cover_edition_key) {
        fetchPromises.push(fetchOpenLibrary(`https://openlibrary.org/books/${b.cover_edition_key}.json`, { priority: 'high', passType: 'work_detail' }).then(r => r.ok ? r.json() : null));
    }
    try {
        const results = await Promise.all(fetchPromises);
        if (currentDrawerWorkKey !== b.key) return;
        const workData = results[0];
        const editionData = results[1]; // Will be undefined if translation is disabled
        const cacheKey = `${b.key}_${targetLang}`;
        let canonicalTitle = (workData && workData.title) ? workData.title : b.title;
        if (isTransEnabled && targetLang) {
            if (translationCache.has(cacheKey)) {
                apiTelemetry.recordCacheHit('ram', 'title');
                canonicalTitle = translationCache.get(cacheKey);
            } else {
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
                        const matchingEdition = pickBestEdition(validEditions, b.author_name, b.original_title || b.title, isTranslateCoversEnabled(), targetLang);
                        if (matchingEdition && matchingEdition.title) {
                            const validSub = isValidSubtitle(matchingEdition.subtitle, b.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                            const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                            if (shouldReplaceTitle(b.title, fullTitle) && !isDuplicateTitle(fullTitle, b.key, targetLang)) {
                                canonicalTitle = fullTitle;
                                setTranslationCache(cacheKey, fullTitle, matchingEdition.localizedCoverId, matchingEdition.key);
                                saveTranslationCache();
                                if (isTranslateCoversEnabled() && matchingEdition.localizedCoverId) {
                                    b.cover_i = matchingEdition.localizedCoverId;
                                    updateCardCoverInGrid(b.key, matchingEdition.localizedCoverId, matchingEdition.key);
                                }
                            } else {
                                setTranslationCache(cacheKey, b.title, matchingEdition.localizedCoverId, matchingEdition.key);
                                saveTranslationCache();
                            }
                        } else {
                            setTranslationCache(cacheKey, canonicalTitle);
                            saveTranslationCache();
                        }
                    }
                } catch { }
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
export const closeDetailsDrawer = () => {
    currentDrawerWorkKey = null;
    closeTagsPopup();
    DOM.detailsDrawer.classList.remove('active');
    setTimeout(() => {
        DOM.detailsDrawer.style.display = 'none';
    }, 300);
};
export const needsTranslation = (b, targetLang) => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return false;
    if (!targetLang || !b.key) return false;
    const cacheKey = `${b.key}_${targetLang}`;
    if (translationCache.has(cacheKey)) return false;
    if (translationPromiseCache.has(cacheKey)) return false;

    const targetNorm = normalizeLanguageCode(targetLang);
    const bookLangs = (b.language || []).map(l => normalizeLanguageCode(l));

    // 1. If target language is English: Open Library is natively English (>95% of records).
    // Skip proactive grid lookups for English searches (0 network calls, 0 orange cards).
    // Foreign-root records (like Una corte) resolve on demand in the Details Drawer.
    if (targetNorm === 'eng') {
        return false;
    }

    // 2. In search mode only: If book has known language metadata that does NOT include target language AND has <= 1 edition, skip.
    if (currentViewMode === 'search' && bookLangs.length > 0 && !bookLangs.includes(targetNorm) && (b.edition_count || 1) <= 1) {
        return false;
    }

    return true;
};
// Quality gate for accepting a translated/alternate-edition title. The
// search payload usually carries the canonical, best-titled edition, so a
// swap must never degrade it: reject empty/oversized/shouty-spam candidates
// and trivial variants of the displayed title.
export function shouldReplaceTitle(currentTitle, candidateTitle) {
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
// Scroll-idle coalescing queue for cheap background grid writes (title
// swaps). Cover work loads immediately (decoding is async and paint is
// viewport-bounded). Flushed from handleScrollState's scroll-end timeout,
// paced across frames (see below).
export const pendingGridWrites = [];
export const flushDeferredGridWrites = () => {
    if (!pendingGridWrites.length) return;
    // Pace across frames: a long scroll's backlog landing in one rest-time
    // batch showed up in traces as a ~20ms style/layout spike right after
    // scroll end. Slices of 15 text writes are comfortably sub-millisecond;
    // if motion resumed, the remainder waits for the next scroll-end flush.
    const slice = pendingGridWrites.splice(0, 15);
    for (const fn of slice) {
        try { fn(); } catch { /* best-effort background enhancement */ }
    }
    if (pendingGridWrites.length && !isScrollActive()) {
        requestAnimationFrame(flushDeferredGridWrites);
    }
};
export const updateCardTitleInGrid = (workKey, newTitle) => {
    // Coalesce past scroll activity: cheap text writes queue for the
    // scroll-end flush instead of invalidating paint tiles mid-scroll.
    // Recursion terminates — the flush runs at rest.
    if (isScrollActive()) {
        pendingGridWrites.push(() => updateCardTitleInGrid(workKey, newTitle));
        return;
    }
    const escapedKey = CSS.escape(workKey);
    const card = document.querySelector(`.book-card[data-key="${escapedKey}"]`);
    if (card) {
        const titleEl = card.querySelector('.book-title');
        if (titleEl) {
            titleEl.textContent = newTitle;
            titleEl.title = newTitle;
        }
    }
};
export const updateCardCoverInGrid = async (workKey, coverId, coverEditionKey) => {
    if (!workKey) return;
    const escapedKey = CSS.escape(workKey);
    const card = document.querySelector(`.book-card[data-key="${escapedKey}"]`);
    if (!card) return;
    const coverContainer = card.querySelector('.cover-container');
    if (!coverContainer) return;
    const cleanCoverId = coverId && coverId > 0 ? coverId : null;
    const cleanEdition = coverEditionKey ? String(coverEditionKey).replace(/^\/books\//, '') : null;
    const cid = cleanCoverId || cleanEdition;
    if (!cid) return;

    const existingImg = coverContainer.querySelector('img[data-cover-id]');
    if (existingImg && existingImg.getAttribute('data-cover-id') === String(cid)) {
        return; // Already rendering this exact cover; skip DOM recreation
    }

    const coverUrl = getCoverUrl(cid, 'M', false);

    const cachedCover = getCoverFromMemory(cid);
    if (cachedCover) {
        coverContainer.innerHTML = `<img src="${cachedCover}" data-cover-id="${cid}" class="book-cover" alt="Cover Image" loading="lazy" decoding="async" onload="this.classList.add('cover-fresh')" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';">`;
        return;
    }

    // Preload the new translated cover image and await resolution with a 3.5s timeout guard
    // so the amber translating border remains active until the cover is fully downloaded.
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3500);
        const img = new Image();
        img.onload = () => {
            clearTimeout(timer);
            // Open Library transparent placeholder rejection (1x1 transparent GIF defense)
            if (img.naturalWidth <= 1 && img.naturalHeight <= 1) {
                rememberCoverNegative(cid, 'empty_placeholder');
                resolve();
                return;
            }
            rememberCoverInMemory(cid, coverUrl);
            coverContainer.innerHTML = `<img src="${coverUrl}" data-cover-id="${cid}" class="book-cover" alt="Cover Image" loading="lazy" decoding="async" onload="this.classList.add('cover-fresh')" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-cover\\'>No Cover</div>';">`;
            cacheCoverInBackground(cid);
            resolve();
        };
        img.onerror = () => {
            clearTimeout(timer);
            rememberCoverNegative(cid, '404');
            // On failure, keep existing cover intact
            resolve();
        };
        img.src = coverUrl;
    });
};

// (Scroll-reveal entrances were removed: below-fold arrivals now simply
// appear (they were off-screen), which proved smoother and less visually
// noisy than animating them — the mount fade carries first paint.)

// ── Unified IntersectionObserver for Progressive Translation (50% Leeway) ──
export let translationObserver = null;
export const initTranslationObserver = () => {
    if (translationObserver) {
        translationObserver.disconnect();
        translationObserver = null;
    }
    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
        translationObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const card = entry.target;
                    if (translationObserver) translationObserver.unobserve(card);
                    const workKey = card.getAttribute('data-key');
                    if (workKey) scheduleSingleCardTranslation(workKey);
                }
            });
        }, {
            root: null,
            rootMargin: '0px 0px 50% 0px', // Exactly 50% past viewport bottom
            threshold: 0.01
        });
    }
};

export const scheduleSingleCardTranslation = (workKey) => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return;
    const targetLang = getExplicitTargetLang();
    if (!targetLang || !workKey) return;
    const cacheKey = `${workKey}_${targetLang}`;
    if (translationCache.has(cacheKey) || translationPromiseCache.has(cacheKey)) return;

    const doc = (currentViewMode === 'library' ? library : allDisplayedDocs).find(d => d.key === workKey);
    if (!doc || !needsTranslation(doc, targetLang)) return;
    const preferCovers = isTranslateCoversEnabled();
    const escapedKey = CSS.escape(workKey);

    translationQueue.add(cacheKey, async () => {
        const taskGenToken = translationGenerationToken;
        // Visual indicator: ONLY mark the card amber when its task actively executes in the worker!
        const card = DOM.grid ? DOM.grid.querySelector(`.book-card[data-key="${escapedKey}"]`) : null;
        if (card) card.classList.add('is-translating');

        try {
            if (taskGenToken !== translationGenerationToken) return;
            if (translationCache.has(cacheKey)) {
                apiTelemetry.recordCacheHit('ram', 'title');
                const cachedTitle = translationCache.get(cacheKey);
                if (cachedTitle !== doc.title) {
                    doc.title = cachedTitle;
                    updateCardTitleInGrid(doc.key, cachedTitle);
                }
                if (preferCovers && translationCoverCache.has(cacheKey)) {
                    apiTelemetry.recordCacheHit('ram', 'cover');
                    const cov = translationCoverCache.get(cacheKey);
                    if (cov && cov.cover_i && cov.cover_i > 0) {
                        await updateCardCoverInGrid(doc.key, cov.cover_i, null);
                    }
                }
                return;
            }
            if (!translationPromiseCache.has(cacheKey)) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 12000);
                const fetchPromise = (async () => {
                    try {
                        const entries = await fetchWorkEditions(doc.key, targetLang, doc.edition_count, controller.signal);
                        clearTimeout(timeoutId);
                        return entries;
                    } catch {
                        clearTimeout(timeoutId);
                        return null;
                    }
                })();
                translationPromiseCache.set(cacheKey, fetchPromise);
            }
            const entries = await translationPromiseCache.get(cacheKey);
            if (taskGenToken !== translationGenerationToken) return;
            if (Array.isArray(entries)) {
                const validEditions = entries.filter(entry => {
                    if (!entry.languages) return false;
                    if (!isValidEditionForWork(entry, doc.key)) return false;
                    return entry.languages.some(lang => {
                        const code = lang.key ? lang.key.replace('/languages/', '').toLowerCase() : '';
                        return editionLangMatches(code, targetLang);
                    });
                });
                const matchingEdition = pickBestEdition(validEditions, doc.author_name, doc.original_title || doc.title, preferCovers, targetLang);
                if (matchingEdition && matchingEdition.title) {
                    const validSub = isValidSubtitle(matchingEdition.subtitle, doc.author_name, matchingEdition.title) ? matchingEdition.subtitle : '';
                    const fullTitle = matchingEdition.title + (validSub ? `: ${validSub.trim()}` : '');
                    if (shouldReplaceTitle(doc.title, fullTitle) && !isDuplicateTitle(fullTitle, doc.key, targetLang)) {
                        resolvedTitlesInActivePass.add(fullTitle.trim().toLowerCase());
                        setTranslationCache(cacheKey, fullTitle, matchingEdition.localizedCoverId, matchingEdition.key);
                        saveTranslationCache();
                        if (fullTitle !== doc.title) {
                            doc.title = fullTitle;
                            updateCardTitleInGrid(doc.key, fullTitle);
                        }
                        if (preferCovers && matchingEdition.localizedCoverId && matchingEdition.localizedCoverId > 0) {
                            doc.cover_i = matchingEdition.localizedCoverId;
                            await updateCardCoverInGrid(doc.key, matchingEdition.localizedCoverId, null);
                        }
                    } else {
                        setTranslationCache(cacheKey, doc.title, matchingEdition.localizedCoverId, matchingEdition.key);
                        saveTranslationCache();
                        if (preferCovers && matchingEdition.localizedCoverId && matchingEdition.localizedCoverId > 0) {
                            await updateCardCoverInGrid(doc.key, matchingEdition.localizedCoverId, null);
                        }
                    }
                } else {
                    // Valid API fetch completed, but no matching foreign edition exists
                    setTranslationCache(cacheKey, doc.title);
                    saveTranslationCache();
                }
            }
            // If entries is null/undefined due to network error/timeout, do not poison persistent cache
        } catch {
            // Fail silently
        } finally {
            translationPromiseCache.delete(cacheKey);
            const currentCard = DOM.grid ? DOM.grid.querySelector(`.book-card[data-key="${escapedKey}"]`) : null;
            if (currentCard) currentCard.classList.remove('is-translating');
        }
    });
};
export const syncCardTitles = (docs) => {
    if (!DOM.translateToggle || !DOM.translateToggle.checked) return;
    resolvedTitlesInActivePass.clear();
    const targetLang = getExplicitTargetLang();
    if (!targetLang) return;
    const preferCovers = isTranslateCoversEnabled();
    // Cache pre-apply for books that have already been resolved
    docs.forEach((b) => {
        if (!b.key) return;
        const cacheKey = `${b.key}_${targetLang}`;
        if (translationCache.has(cacheKey)) {
            apiTelemetry.recordCacheHit('ram', 'title');
            const cachedTitle = translationCache.get(cacheKey);
            if (cachedTitle !== b.title) {
                b.title = cachedTitle;
                updateCardTitleInGrid(b.key, cachedTitle);
            }
        }
        if (preferCovers && translationCoverCache.has(cacheKey)) {
            apiTelemetry.recordCacheHit('ram', 'cover');
            const cov = translationCoverCache.get(cacheKey);
            if (cov && cov.cover_i && cov.cover_i > 0) {
                updateCardCoverInGrid(b.key, cov.cover_i, null);
            }
        }
    });

    // If Complete Translation is ON -> eagerly schedule all matching books
    if (DOM.completeTranslateToggle && DOM.completeTranslateToggle.checked) {
        docs.forEach(b => {
            if (needsTranslation(b, targetLang)) scheduleSingleCardTranslation(b.key);
        });
        return;
    }

    // Default Progressive Mode: Observe rendered cards via IntersectionObserver (50% leeway)
    if (!translationObserver) initTranslationObserver();
    docs.forEach(b => {
        if (!b.key || !needsTranslation(b, targetLang)) return;
        const card = DOM.grid.querySelector(`.book-card[data-key="${CSS.escape(b.key)}"]`);
        if (card && translationObserver) {
            translationObserver.observe(card);
        }
    });
};
export const renderResults = (rawFetchedCount, totalFoundOnAPI, isLoadMore, hiddenInBatch, newStartIdx, needsFullRerender) => {
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
        setRenderIndex(0);
        renderNextChunk(isEditionsSort, filterLangAA);
    } else {
        const activeSkeletons = DOM.grid.querySelectorAll('.skeleton-card');
        activeSkeletons.forEach(skel => skel.remove());
        setRenderIndex(newStartIdx);
        renderNextChunk(isEditionsSort, filterLangAA);
    }
    if ((activeMinStar > 0 || activeMinRCount > 0) && currentTotalHidden > 0) {
        DOM.hiddenMsg.textContent = `${currentTotalHidden} books from the fetched batches were hidden for not meeting your minimum rating requirements.`;
        DOM.hiddenMsg.style.display = 'block';
    } else { DOM.hiddenMsg.style.display = 'none'; }
    // Page size comes from the in-flight query (lastFetchLimit), never the
    // slider default: with the custom limit off the API returns 50/page.
    // rawFetchedCount is the RAW api count for this request (pre-dedup,
    // pre-filter): only a genuinely short page means exhaustion.
    DOM.loadMoreBtn.style.display = ((currentPage * lastFetchLimit) >= totalFoundOnAPI || rawFetchedCount < lastFetchLimit) ? 'none' : 'inline-block';
    if (allDisplayedDocs.length === 0) {
        DOM.status.textContent = 'All books in this batch were hidden by your rating filters. Click "Find More Books" to query the next batch.';
        DOM.status.style.display = 'block';
        DOM.grid.style.display = 'none';
    }
};
export const renderSavedCollection = (books = library) => {
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
        setRenderIndex(0);
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
export const updateToggleAllBtnState = () => {
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
    const allInLibrary = currentList.every(b => isLibraryWork(b.key));
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
export const collapseMobileSidebarIfOpen = () => {
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
// Collapse the sidebar when a search query dispatches so results get the
// full width. Mobile delegates to the drawer-specific collapse; desktop
// clicks the real toggle (single source of truth: transitions, backdrop,
// rail relocation all run through its handler). Idempotent: already-
// collapsed sidebars are left alone. Library mode never reaches here
// (performSearch returns early there — live filtering keeps the sidebar).
export const collapseSidebarForSearch = () => {
    if (window.innerWidth <= 768) {
        collapseMobileSidebarIfOpen();
        return;
    }
    const container = document.querySelector('.app-container');
    if (container && !container.classList.contains('sidebar-collapsed') && sidebarToggleBtn) {
        sidebarToggleBtn.click();
    }
};
export const syncSettingsCategoriesForMode = (mode) => {
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
export const validateAndApplyInputLimit = () => {
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
    if (!isExt) safeStorage.setItem('ole_fetch_limit', clampedVal.toString());
};
export const applyListView = (enabled) => {
    DOM.grid.classList.toggle('list-view', enabled);
    const fg = document.getElementById('featuredClassicsGrid');
    if (fg) fg.classList.toggle('list-view', enabled);
};
export const isMobileViewport = () => window.innerWidth <= 768;
export const updateSelectionBar = () => {
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
        if (!isLibraryWork(key)) nonLibraryCount++;
    });
    const removing = selectedKeys.size > 0 && nonLibraryCount === 0;
    // Heart icon matching the site's library-button visual language.
    const heartSVG = `<svg class="bulk-heart" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    DOM.selectionBulkBtn.innerHTML = `${heartSVG}<span>${removing ? `Remove ${count}` : `Add ${count}`}</span>`;
};
export const syncThemeCheckboxes = (isDark, save = false) => {
    const cbMobile = document.getElementById('mobileThemeCheckbox');
    if (cbMobile) cbMobile.checked = isDark;
    document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (save) {
        safeStorage.setItem('ole_theme', isDark ? 'dark' : 'light');
    }
};
export const setSettingsPanelOpen = (open) => {
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
export const mobileSidebarBackdrop = document.getElementById('mobileSidebarBackdrop');
// Measure actual header height and expose as CSS custom property so extended
export let lastWasMobileViewport = window.innerWidth <= 768;
export let cachedHeaderHeight = 0;

export function updateMobileHeaderHeight() {
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

export function checkMobileSidebarState() {
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
export const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
export const railFilterBtn = document.getElementById('railFilterBtn');
export const railSortBtn = document.getElementById('railSortBtn');
export const getSidebarSide = () => safeStorage.getItem('ole_sidebar_side') === 'right' ? 'right' : 'left';
export const syncSidebarSideUI = () => {
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
export const relocateSidebarToggleForSide = () => {
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
export const applySidebarSide = (side, save = false) => {
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
// Tap a "N tags" badge (list view) or a "+N" tag-overflow badge (grid view)
// to see the full subject list in a small popup, instead of only what fit in
// a hover title tooltip (which doesn't work on tap anyway).
export let openTagsPopupEl = null;
export let activeTagsPopupAnchor = null;
export let tagsPopupBackdropEl = null;
export let _tagsPopupClosedAt = 0;

export const closeTagsPopup = () => {
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

export const openTagsPopup = (anchorEl) => {
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
export const applyCompactHeader = (enabled) => {
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
// ── Right-side overlay: exact header-group clearance ────────────────────
// Static margins can't be right across scrollbar widths and mode paddings.
// This measures the REAL panel edge and slides the results-header-right
// group so its right edge sits exactly one half-button (18px) clear of the
// floating panel. Self-correcting: it reads the currently rendered
// position, so one pass is enough regardless of environment. Runs on
// resize, mode changes, and after each sidebar open/close settles.
export function syncRightGroupGap() {
    var rh = document.querySelector('.results-header-right');
    if (!rh) return;
    rh.style.removeProperty('--ole-rhdr-gap');
    rh.style.marginRight = '';
}

export var rightGroupSyncTimer = null;
export function scheduleRightGroupSync() {
    if (rightGroupSyncTimer) clearTimeout(rightGroupSyncTimer);
    rightGroupSyncTimer = setTimeout(syncRightGroupGap, 60);
}

export function applyOverlayedSidebar() {
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
export const mobileLayoutToggle = document.getElementById('mobileLayoutToggle');
// Remembers whether the desktop Legacy Layout was enabled before Mobile Legacy
// Layout took over, so disabling this mode can restore it (toggle + storage +
// actual layout) instead of silently dropping the user's earlier preference.
export let desktopLegacyWasEnabled = false;

export const applyMobileLegacyLayout = (enabled) => {
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
            asideEl.style.removeProperty('transform');
        }
        const hintEl = document.getElementById('mobileSidebarSwipeHint');
        if (hintEl) {
            hintEl.style.removeProperty('transform');
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
};
// The swipe hint lives OUTSIDE the sidebar (as a sibling of aside.filters)
// because the sidebar clips horizontal overflow while open — a tab poking
// out of its right edge would be cut off there. It's anchored to the
// app-container and slid to the sidebar's right edge via --ear-open-offset,
// which must track the aside's real layout width (330px, or 90vw on narrow
// phones). Function declaration so applyMobileLegacyLayout can call it.
export function syncMobileEarOffset() {
    const container = document.querySelector('.app-container');
    if (!container) return;
    const asideEl = container.querySelector('aside.filters');
    const w = asideEl
        ? Math.round(asideEl.getBoundingClientRect().width)
        : Math.min(330, Math.round(window.innerWidth * 0.9));
    container.style.setProperty('--ear-open-offset', w + 'px');
    const hint = document.getElementById('mobileSidebarSwipeHint');
    if (hint) hint.style.setProperty('--ear-open-offset', w + 'px');
}
// Keep the hint's tooltip honest about which direction works right now.
// (Function declaration so applyMobileLegacyLayout — which runs earlier in
// this file — can call it during initial setup.)
export function updateSwipeHintState() {
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

export function updateSwipeHintVisibility() {
    const isDiscoverVisible = DOM.discoverDashboard && DOM.discoverDashboard.style.display !== 'none';
    const isGenresTab = isDiscoverVisible && currentDiscoverTab === 'genres';
    document.body.classList.toggle('hide-swipe-hint', isGenresTab);
}
// ── Mobile Alternative Layout: selection mode ─────────────────────────────
// Hold-to-select on book cards, gated to the Alternative mobile layout
// (body.mobile-legacy-layout) + ≤768px. Long-pressing a card enters
// selection mode; tapping cards then toggles their selection; the pinned
// selection bar below the header provides select-all + bulk add/remove.
export let selectionMode = false;
export let selectedKeys = new Set();
export let holdTimer = null;
export let holdSuppressClick = false;
export let holdStart = null;
export let lastSelectionModeChange = 0;
export const SELECTION_HOLD_MS = 450;
export const SELECTION_MOVE_TOLERANCE = 10;
export let mobileLegacyRevealTimeoutId = null;
export let lastDragEndTime = 0;
// Drive the mobile-legacy sidebar content fade: while a slide transition
// (drag-release or ear-tap) is in flight, <body> gets this class so the CSS
// keeps the inner content hidden until the panel is fully extended, then
// fades it in. Mirrors the desktop legacy content-fade idea but scoped to
// the transform-based mobile-legacy slide.
export function triggerMobileLegacyReveal() {
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
export const mobileSidebarSwipeHint = document.getElementById('mobileSidebarSwipeHint');
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
    });
}

// Re-evaluate on viewport crossing the mobile breakpoint, so e.g. rotating
// a tablet or resizing a desktop window past 768px cleanly drops back to
// the (unaffected) desktop layout without needing a manual toggle (coordinated in main resize listener).

// Drag-to-open/close: hold anywhere on screen, then drag right to pull the
// sidebar open (or left to push it closed). A close-swipe may also start on
// the open panel itself, on any non-interactive spot. The sidebar tracks the
// finger 1:1 while dragging — no release-only detection — and on release it
// snaps with hysteresis: past 30% while opening → fully open, below 70%
// while closing → fully collapsed, otherwise back to where it started.
// Gestures lock each other out: a natively scrolling list owns the finger
// (sideways motion can't birth a drag mid-scroll), and an active drag pins
// both scrollers until release (diagonal drift can't scroll underneath).
// The swipe hint doubles as a grabbable ear: grabbing it and dragging works
// the same as dragging anywhere else.
// Only active while Mobile Legacy Layout is on and the viewport is mobile.
(() => {
    const container = document.querySelector('.app-container');
    const aside = container ? container.querySelector('aside.filters') : null;
    const hint = document.getElementById('mobileSidebarSwipeHint');
    const mainEl = document.querySelector('main.results');
    if (!container || !aside) return;

    const DRAG_ACTIVATE_DISTANCE = 12;   // horizontal px of intent before the drag takes over
    const DRAG_MAX_OFF_AXIS_RATIO = 0.6; // vertical drift allowed vs horizontal travel
    const SNAP_OPEN_THRESHOLD = 0.3;     // opening swipe: release past 30% open → snaps fully open
    const SNAP_CLOSE_THRESHOLD = 0.7;    // closing swipe: release below 70% open → snaps fully closed

    // Right-side sidebar mirrors the whole gesture: the panel lives at
    // +100% instead of -100% and opens with a leftward swipe.
    const isSidebarRight = () => document.body.classList.contains('sidebar-right');

    let drag = null; // { startX, startY, wasCollapsed, asideWidth, active, startedOnSidebar, startMainScroll, startAsideScroll }
    let dragRafId = null;
    let pendingClamped = null;
    let lastRenderedOpacity = -1;
    // Swallows the phantom click a sidebar-originated drag can leave on its
    // release point (e.g. toggling a <summary> the finger slid off). Armed
    // only by real drags that began inside the panel; one-shot + expiry.
    let suppressSidebarClickUntil = 0;

    const dragEligible = (target) => {
        if (!document.body.classList.contains('mobile-legacy-layout')) return false;
        if (!isMobileViewport()) return false;
        if (document.body.classList.contains('hide-swipe-hint')) return false;
        // Don't hijack touches on interactive controls. Inert sidebar chrome
        // (group containers, summaries, padding) stays grabbable while the
        // panel is open, so a close-swipe can start on the sidebar itself
        // instead of reaching for the backdrop sliver; taps still work
        // because a tap never reaches drag activation. Collapsed, the
        // off-canvas panel isn't touchable anyway, so it stays excluded.
        const exclusions = 'button, a, input, select, textarea, label, header, .results-header, .selection-bar, .rail-popover, .settings-dropdown, .details-drawer-overlay, input[type="range"], .tags-compact-badge, .tag-overflow, .tags-popup, .tags-popup-backdrop, .autocomplete-list, .ui-tags-wrap';
        const sidebarOpen = container && !container.classList.contains('sidebar-collapsed');
        if (target.closest(sidebarOpen ? exclusions : `${exclusions}, .filters`)) return false;
        return true;
    };

    // Computes continuous integer-aligned positions for aside and ear tab.
    // Ear track formula:
    // Left:  -14 + (width + 14) * clamped  (spans -14px collapsed rest to +width open rest)
    // Right:  14 - (width + 14) * clamped  (spans +14px collapsed rest to -width open rest)
    const renderDragFrame = () => {
        dragRafId = null;
        if (!drag || !drag.active || pendingClamped === null) return;
        const clamped = pendingClamped;
        const width = drag.asideWidth;
        const isRight = isSidebarRight();
        const asidePx = Math.round((isRight ? 1 - clamped : -1 + clamped) * width);
        const earPx = Math.round(isRight ? 14 - (width + 14) * clamped : -14 + (width + 14) * clamped);

        aside.style.setProperty('transform', `translateX(${asidePx}px)`, 'important');
        if (hint) {
            hint.style.setProperty('transform', `translateY(-50%) translateX(${earPx}px)`, 'important');
        }
        // Gesture lock, scroll side: while the sidebar tracks the finger,
        // pin both scrollers to their grab-time offsets so diagonal drift
        // can't also scroll the content (or the sidebar list) underneath.
        // scrollTop writes are offset-only, compositor-cheap, and stop the
        // moment the drag ends — momentum afterward behaves natively.
        if (mainEl && mainEl.scrollTop !== drag.startMainScroll) mainEl.scrollTop = drag.startMainScroll;
        if (aside.scrollTop !== drag.startAsideScroll) aside.scrollTop = drag.startAsideScroll;
        if (mobileSidebarBackdrop && Math.abs(clamped - lastRenderedOpacity) >= 0.015) {
            lastRenderedOpacity = clamped;
            mobileSidebarBackdrop.style.opacity = clamped.toFixed(2);
        }
    };

    document.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        if (!dragEligible(e.target)) return;
        // RECORD-ONLY: do NOT mutate any DOM or query layout geometry here.
        // Plain taps incur zero forced reflow (scrollTop reads are cheap
        // offsets, not layout). The scroll baselines arm the gesture lock
        // below: a natively scrolling (or momentum-gliding) list owns the
        // finger until it settles.
        drag = {
            startX: e.touches[0].clientX,
            startY: e.touches[0].clientY,
            wasCollapsed: container.classList.contains('sidebar-collapsed'),
            asideWidth: null,
            active: false,
            startMainScroll: mainEl ? mainEl.scrollTop : 0,
            startAsideScroll: aside.scrollTop
        };
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!drag) return;
        const t = e.touches[0];
        const dx = t.clientX - drag.startX;
        const dy = t.clientY - drag.startY;
        if (!drag.active) {
            // Gesture lock, swipe side: while content or the sidebar list is
            // natively scrolling under this touch (including momentum after
            // the finger's vertical intent), sideways motion must not birth
            // a sidebar drag. Once scrolling settles, a deliberate horizontal
            // move can still engage — dx below stays a valid intent signal.
            if ((mainEl && mainEl.scrollTop !== drag.startMainScroll)
                || aside.scrollTop !== drag.startAsideScroll) return;
            // A hold becomes a drag only once horizontal intent is clear.
            if (Math.abs(dx) < DRAG_ACTIVATE_DISTANCE) return;
            if (Math.abs(dy) > Math.abs(dx) * DRAG_MAX_OFF_AXIS_RATIO) return;
            const wantsOpen = isSidebarRight() ? dx < 0 : dx > 0;
            if (wantsOpen === !drag.wasCollapsed) return;
            drag.active = true;
            // Touch targets don't move mid-gesture, so the grab point's
            // location decides this once: inside the panel or outside it.
            drag.startedOnSidebar = !!e.target.closest('aside.filters');

            // Prevent card multi-select hold gesture from firing mid-drag
            if (typeof cancelHold === 'function') cancelHold();

            // Measure width ONCE before any DOM mutations to avoid forced reflow
            drag.asideWidth = aside.offsetWidth || Math.min(330, Math.round(window.innerWidth * 0.9));
            const width = drag.asideWidth;

            // Synchronously pin initial positions so there is zero 1-frame visual jump
            const initClamped = drag.wasCollapsed ? 0 : 1;
            const isRight = isSidebarRight();
            const initAsidePx = Math.round((isRight ? 1 - initClamped : -1 + initClamped) * width);
            const initEarPx = Math.round(isRight ? 14 - (width + 14) * initClamped : -14 + (width + 14) * initClamped);

            aside.classList.add('dragging');
            aside.style.setProperty('transform', `translateX(${initAsidePx}px)`, 'important');
            if (hint) {
                hint.style.setProperty('transform', `translateY(-50%) translateX(${initEarPx}px)`, 'important');
            }
            if (mobileSidebarBackdrop) {
                mobileSidebarBackdrop.style.transition = 'none';
                lastRenderedOpacity = initClamped;
                mobileSidebarBackdrop.style.opacity = String(initClamped);
            }
            // Content hides only while OPENING (the settled reveal fixes the
            // half-rendered mid-pullout look). A panel that starts open keeps
            // its content visible throughout the slide, so a nudge that goes
            // nowhere never flashes.
            if (drag.wasCollapsed) aside.classList.add('drag-pulling');
        }

        const width = drag.asideWidth;
        const dir = isSidebarRight() ? -1 : 1;
        const travel = dir * dx;
        const rawProgress = drag.wasCollapsed ? (travel / width) : (1 + travel / width);
        pendingClamped = Math.max(0, Math.min(1, rawProgress));

        if (!dragRafId) {
            dragRafId = requestAnimationFrame(renderDragFrame);
        }
    }, { passive: true });

    const endDrag = (e) => {
        if (!drag) return;
        // Cancel any pending drag rAF callback so it cannot fire after release cleanup
        if (dragRafId) {
            cancelAnimationFrame(dragRafId);
            dragRafId = null;
        }
        if (!drag.active) { drag = null; return; }
        const t = e.changedTouches && e.changedTouches[0];
        const dx = t ? t.clientX - drag.startX : 0;
        const width = (drag && drag.asideWidth) || Math.min(330, Math.round(window.innerWidth * 0.9));
        const dir = isSidebarRight() ? -1 : 1;
        const travel = dir * dx;
        const progress = drag.wasCollapsed
            ? Math.max(0, Math.min(1, travel / width))
            : Math.max(0, Math.min(1, 1 + travel / width));
        // Hysteresis: a small way past the origin side already commits to
        // the destination, so both opening and closing take a short swipe.
        const shouldOpen = progress >= (drag.wasCollapsed ? SNAP_OPEN_THRESHOLD : SNAP_CLOSE_THRESHOLD);

        aside.classList.remove('dragging');
        aside.classList.remove('drag-pulling');
        aside.style.removeProperty('transform');
        if (hint) hint.style.removeProperty('transform');
        if (mobileSidebarBackdrop) {
            mobileSidebarBackdrop.style.transition = '';
            mobileSidebarBackdrop.style.opacity = '';
        }
        container.classList.toggle('sidebar-collapsed', !shouldOpen);
        if (mobileSidebarBackdrop) mobileSidebarBackdrop.classList.toggle('active', shouldOpen);

        // One-shot the settled resting position strictly on the hint element
        if (hint) {
            hint.style.setProperty('--ear-open-offset', `${width}px`);
        }

        if (drag.active) {
            // The release that just dragged the sidebar can also surface as a
            // click on the hint — mark it so the hint's tap handler ignores it.
            lastDragEndTime = Date.now();
            // A real drag that began inside the panel can leave a phantom
            // click on its release point — arm the one-shot suppressor below.
            if (drag.startedOnSidebar) suppressSidebarClickUntil = Date.now() + 350;
            // The settled reveal only matters when the panel actually opened
            // from collapsed; anything else (staying put, collapsing) keeps
            // whatever visibility it already had instead of flashing.
            if (shouldOpen && drag.wasCollapsed) triggerMobileLegacyReveal();
        }
        drag = null;
        pendingClamped = null;
        lastRenderedOpacity = -1;

        updateSwipeHintState();
    };

    document.addEventListener('touchend', endDrag, { passive: true });
    document.addEventListener('touchcancel', endDrag, { passive: true });

    // Swallow the phantom click a sidebar-originated drag can leave behind
    // (e.g. toggling a <summary> the finger slid off). Capture phase, panel
    // only, one-shot inside a short post-gesture window — ordinary taps
    // (which never arm the suppressor) pass through untouched.
    document.addEventListener('click', (e) => {
        if (Date.now() > suppressSidebarClickUntil) return;
        if (e.target && e.target.closest && e.target.closest('aside.filters')) {
            e.stopPropagation();
            e.preventDefault();
            suppressSidebarClickUntil = 0;
        }
    }, true);
})();
export const mainResultsEl = document.querySelector('main.results');
export const isSelectionEligible = () => {
    return document.body.classList.contains('mobile-legacy-layout') && window.innerWidth <= 768;
};

// Current visible book list for select-all / bulk actions.
export const getCurrentSelectionList = () => {
    if (DOM.discoverDashboard.style.display !== 'none') {
        return currentDiscoverTab === 'trending' ? (cachedTrendingBooks || []) : [];
    }
    return currentViewMode === 'library' ? getLocalFilteredBooks() : allDisplayedDocs;
};

export const setSelectionMode = (active) => {
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

export const toggleCardSelection = (workKey) => {
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

export const clearHoldTimer = () => {
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

export const cancelHold = () => {
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
        const allInLibrary = keys.every(key => isLibraryWork(key));
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
            setCachedSubjectCounts(null);
            setCachedLocalFilteredBooks(null);
            syncLibraryKeySet();
            localforage.setItem('ole_bookmarks', library).catch(console.error);
            updateLibraryBadge();
            // Refresh heart state on all visible cards at once.
            document.querySelectorAll('.book-card').forEach(card => {
                const key = card.getAttribute('data-key');
                const btn = card.querySelector('.library-btn');
                if (!key || !btn) return;
                const isInLib = isLibraryWork(key);
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
export const handleGridClick = (e, getBookFn) => {
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
        if (workKey) toggleCardSelection(workKey);
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
            if (DOM.sortNote) DOM.sortNote.style.display = 'none';
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

// Mobile: shorten inactive discover tab labels so flex-shrink can compress them
// Active:   "Trending Books" / "Popular Genres"
// Inactive: "Books"          / "Genres"
export function updateDiscoverToggleLabels() {
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
export const resetAllSettingsToDefault = () => {
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
        'ole_translate_covers',
        'ole_complete_translation',
        'ole_persist_url',
        'ole_enhanced_autofill',
        'ole_custom_limit',
        'ole_fetch_limit',
        'ole_extended_limit',
        'ole_debug_mode',
        'ole_pin_settings',
        'ole_smooth_scrolling',
        'ole_sched_delay',
        'ole_sched_max_conn',
        'ole_sched_burst',
        'ole_custom_proxy_url'
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

    // 7. Reset Mobile Alternative Layout to ON (default: pull-out sidebar).
    // Boot treats a missing key as ON, so the removed storage key already
    // agrees — just restore the toggle and apply with boot's own gating.
    if (mobileLayoutToggle) {
        mobileLayoutToggle.checked = true;
    }
    if (typeof applyMobileLegacyLayout === 'function') {
        const isDesktopMouse = window.matchMedia('(pointer: fine)').matches || window.matchMedia('(hover: hover)').matches;
        applyMobileLegacyLayout(!isDesktopMouse && isMobileViewport());
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

    // 10. Reset Title Translation to ON, Translate Covers to ON, & Complete Translation to OFF
    if (DOM.translateToggle) {
        DOM.translateToggle.checked = true;
    }
    if (DOM.translateCoversToggle) {
        DOM.translateCoversToggle.checked = true;
    }
    if (DOM.completeTranslateToggle) {
        DOM.completeTranslateToggle.checked = false;
    }
    if (DOM.translateCoversRow) {
        DOM.translateCoversRow.style.display = 'flex';
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

    // 14. Reset Pin Settings & Telemetry HUD Persistence to OFF
    safeStorage.setItem('ole_pin_settings', 'false');
    safeStorage.setItem('ole_telemetry_pinned', 'false');
    safeStorage.removeItem('ole_telemetry_active_tab');
    if (typeof switchTelemetryHUDTab === 'function') {
        switchTelemetryHUDTab('telemetryPaneMetrics');
    } else {
        const metricsTab = document.getElementById('telemetryTabMetricsBtn');
        if (metricsTab) metricsTab.click();
    }
    if (DOM.pinSettingsToggle) {
        DOM.pinSettingsToggle.checked = false;
    }
    if (typeof updateTelemetryPinState === 'function') {
        updateTelemetryPinState();
    }
    if (typeof toggleTelemetryHUD === 'function') {
        toggleTelemetryHUD(false);
    }
    if (DOM.smoothScrollingToggle) {
        DOM.smoothScrollingToggle.checked = true;
    }
    safeStorage.setItem('ole_smooth_scrolling', 'true');
    syncSmoothScrollBodyClass();
    syncWheelListener();
    if (typeof cancelAllSmoothScrolls === 'function') {
        cancelAllSmoothScrolls();
    }

    // 15. Reset Rate Scheduler & Proxy parameters to defaults
    setSchedulerMode('optimized');
    setSchedulerMinDelayMs(334);
    setSchedulerMaxConnections(3);
    setSchedulerBurstCapacity(3);
    setCustomProxyUrl(DEFAULT_PROXY_URL);
    safeStorage.setItem('ole_custom_proxy_url', DEFAULT_PROXY_URL);
    const debugProxyIn = DOM.debugProxyInput || document.getElementById('debugProxyInput');
    if (debugProxyIn) debugProxyIn.value = DEFAULT_PROXY_URL;
    safeStorage.setItem('ole_scheduler_mode', 'optimized');
    safeStorage.removeItem('ole_sched_delay');
    safeStorage.removeItem('ole_sched_max_conn');
    safeStorage.removeItem('ole_sched_burst');
    if (typeof syncSchedulerControls === 'function') syncSchedulerControls();
    if (typeof fetchOpenLibrary !== 'undefined' && fetchOpenLibrary.resetBurstTokens) {
        fetchOpenLibrary.resetBurstTokens();
        fetchOpenLibrary.triggerPacingUpdate();
    }

    // 16. Button feedback
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
// ── Desktop Smooth Scrolling Engine (Minecraft Mod Style) ─────────────────
export const containerScrollStates = new WeakMap();
export const activeScrollContainers = new Set();

export let lastKnownMouseX = null;
export let lastKnownMouseY = null;
if (typeof window !== 'undefined') {
    window.addEventListener('mousemove', (e) => {
        lastKnownMouseX = e.clientX;
        lastKnownMouseY = e.clientY;
    }, { passive: true });
}

export const restoreCursorHitTest = () => {
    if (lastKnownMouseX !== null && lastKnownMouseY !== null) {
        const el = document.elementFromPoint(lastKnownMouseX, lastKnownMouseY) || window;
        el.dispatchEvent(new MouseEvent('mousemove', {
            clientX: lastKnownMouseX,
            clientY: lastKnownMouseY,
            bubbles: true,
            cancelable: true
        }));
    }
};

export const cancelAllSmoothScrolls = () => {
    activeScrollContainers.forEach(container => {
        const state = containerScrollStates.get(container);
        if (state && state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
            state.isAnimating = false;
            state.targetY = state.currentY = container.scrollTop;
        }
    });
    activeScrollContainers.clear();
    document.body.classList.remove('smooth-scrolling-active');
};

export function isSmoothScrollingActive() {
    if (window.innerWidth <= 768) return false;
    if (document.body.classList.contains('reduce-animations')) return false;
    return safeStorage.getItem('ole_smooth_scrolling') !== 'false';
}

export function syncSmoothScrollBodyClass() {
    document.body.classList.toggle('smooth-scroll-on', isSmoothScrollingActive());
}

// The wheel interceptor must be non-passive (it preventDefaults to own the
// scroll), which forces every wheel tick through the main thread even when
// the engine is idle — measurable input latency on deep trees. So it is
// only registered while the engine can actually engage; otherwise wheel
// input stays fully native/off-thread. Idempotent (addEventListener dedupes).
export function syncWheelListener() {
    window.removeEventListener('wheel', onWindowWheelCapture, { capture: true });
    if (isSmoothScrollingActive()) {
        window.addEventListener('wheel', onWindowWheelCapture, { passive: false, capture: true });
    }
}

export const isOverlayScrollContainer = (el) => {
    if (!el || !(el instanceof HTMLElement)) return false;
    return !!(
        (el.matches && el.matches('.settings-dropdown, .rail-popover, .shortcuts-modal-container, .shortcuts-modal-body, .telemetry-floating-modal, .telemetry-floating-body, .details-drawer-container')) ||
        (el.closest && el.closest('.settings-dropdown, .rail-popover, .shortcuts-modal-container, .shortcuts-modal-body, .telemetry-floating-modal, .telemetry-floating-body, .details-drawer-container'))
    );
};

export const findScrollableTarget = (path, delta) => {
    let insideOverlay = false;
    for (const el of path) {
        if (!el || el === window || el === document || el === document.documentElement || el === document.body) {
            break;
        }
        if (el instanceof HTMLElement) {
            // Exclude native <select> elements
            if (el.tagName === 'SELECT' || (el.closest && el.closest('select'))) return null;

            if (isOverlayScrollContainer(el)) {
                insideOverlay = true;
            }

            const style = window.getComputedStyle(el);
            const isContained = style.overscrollBehavior === 'contain' ||
                                style.overscrollBehaviorY === 'contain' ||
                                insideOverlay;
            if (isContained) {
                insideOverlay = true;
            }

            const overflowY = style.overflowY;
            if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
                const maxScroll = el.scrollHeight - el.clientHeight;
                const canScroll = delta > 0 ? el.scrollTop < maxScroll - 1 : el.scrollTop > 1;
                if (canScroll) return el;
                // If container is at its boundary and has overscroll containment, do not chain upward!
                if (isContained) return null;
            }
        }
    }

    if (insideOverlay) return null;

    const mainResults = document.querySelector('main.results');
    if (mainResults && mainResults.scrollHeight > mainResults.clientHeight) {
        const style = window.getComputedStyle(mainResults);
        if (style.overflowY !== 'hidden') {
            const max = mainResults.scrollHeight - mainResults.clientHeight;
            const can = delta > 0 ? mainResults.scrollTop < max - 1 : mainResults.scrollTop > 1;
            if (can) return mainResults;
        }
    }
    return null;
};

export const ensureContainerScrollListener = (container) => {
    if (container._oleSmoothListenerAttached) return;
    container._oleSmoothListenerAttached = true;
    container.addEventListener('scroll', () => {
        const state = containerScrollStates.get(container);
        if (!state || state.isAnimating) return; // Disconnect feedback loop: ignore own RAF writes
        state.targetY = state.currentY = container.scrollTop; // Sync target on external user drag / keys
    }, { passive: true });
};

export const animateContainerScroll = (container, state) => {
    let lastTime = performance.now();
    const step = (currentTime) => {
        if (!state.isAnimating) return;

        const dt = Math.min(0.064, (currentTime - lastTime) / 1000);
        lastTime = currentTime;

        // Prevent stale maxScroll infinite loops if content shrinks or container resizes mid-glide
        const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        if (state.targetY > maxScroll) state.targetY = maxScroll;
        if (state.targetY < 0) state.targetY = 0;

        const diff = state.targetY - state.currentY;
        if (Math.abs(diff) < 0.35) {
            container.scrollTop = state.targetY;
            state.currentY = state.targetY;
            state.isAnimating = false;
            state.rafId = null;
            activeScrollContainers.delete(container);
            lastGlideEnd = performance.now();
            if (activeScrollContainers.size === 0) {
                document.body.classList.remove('smooth-scrolling-active');
                restoreCursorHitTest();
            }
            return;
        }

        // Soft attack envelope anchored to glide start (softens initial frame-1 spike over 35ms)
        const elapsed = (currentTime - state.startTime) / 1000;
        const attack = elapsed < 0.035 ? Math.max(0.18, elapsed / 0.035) : 1.0;

        // Frame-rate independent exponential decay (responsive, non-slippery deceleration)
        // Decay rate of 15.0 ensures a crisp ~200-220ms glide across 30Hz, 60Hz, 144Hz, 170Hz, and 240Hz+ displays
        const decayRate = 15.0;
        const factor = (1 - Math.exp(-decayRate * dt)) * attack;
        let newY = state.currentY + diff * factor;
        // Frame-1 minimum-motion floor: a lone small tick must always produce
        // ≥1px of visible motion (single RAF regime — no stepped fallback).
        if (state.firstFrame) {
            state.firstFrame = false;
            const demand = state.targetY - state.currentY;
            if (Math.abs(newY - state.currentY) < 1 && Math.abs(demand) >= 1) {
                newY = state.currentY + Math.sign(demand) * 1;
            }
        }
        if (diff > 0 && newY > state.targetY) newY = state.targetY;
        if (diff < 0 && newY < state.targetY) newY = state.targetY;
        newY = Math.max(0, Math.min(maxScroll, newY));
        state.currentY = newY;
        container.scrollTop = newY;
        if (SCROLL_DEBUG && (++state.dbgN % 10 === 0)) {
            console.log('[glide]', { scrollTop: Math.round(container.scrollTop * 100) / 100, targetY: Math.round(state.targetY * 100) / 100, factor: Math.round(factor * 1000) / 1000 });
        }
        state.rafId = requestAnimationFrame(step);
    };
    state.rafId = requestAnimationFrame(step);
};

export let lastWheelTime = 0;
export let lastWheelDelta = 0;
// Timestamp of the most recent glide end; the chatter veto below applies
// ONLY mid-glide (or within 120ms after one) so a lone tick from rest is
// never suppressed.
let lastGlideEnd = 0;
// ?scrolldebug=1 console logger: records raw wheel payloads + per-frame
// glide state. Console-only, zero UI. Used to characterize real encoder
// output (e.g. Razer Viper increments) before/after physics changes.
const SCROLL_DEBUG = new URLSearchParams(window.location.search).has('scrolldebug');
// ?plaincards=1 diagnostic: strips card + cover box-shadows so raster cost
// can be A/B tested against everything else (shadows force extra paint
// passes + larger invalidation rects per tile). Radii, images and layout
// stay identical. Temporary diagnostic aid, not a setting.
if (typeof document !== 'undefined' && new URLSearchParams(window.location.search).has('plaincards')) {
    document.body.classList.add('plain-cards');
}

export const onWindowWheelCapture = (e) => {
    if (!isSmoothScrollingActive()) return;

    // Exclusions:
    if (e.ctrlKey || e.metaKey) return; // Browser pinch-zoom
    if (e.shiftKey) return; // Explicit horizontal scroll
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // Horizontal-dominant or tilt wheel
    if (e.deltaMode === 2) return; // Page jumps
    if (e.target.closest && e.target.closest('select')) return; // Native select controls

    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 20; // Firefox line-mode normalization

    // Chatter veto applies ONLY mid-glide: a lone tick from rest is never
    // suppressed (it cannot be encoder bounce by definition).
    const now = performance.now();
    if (SCROLL_DEBUG) console.log('[wheel]', { deltaY: e.deltaY, deltaMode: e.deltaMode, msSinceLast: Math.round(now - lastWheelTime) });
    const glideActive = activeScrollContainers.size > 0 || now - lastGlideEnd < 120;
    if (glideActive && now - lastWheelTime < 20 && Math.abs(delta) < 15 && Math.sign(delta) !== Math.sign(lastWheelDelta)) {
        return;
    }
    lastWheelTime = now;
    lastWheelDelta = delta;

    // Fast path: a plain wheel over content goes straight to main.results.
    // The full walk below (composedPath allocation + getComputedStyle per
    // ancestor + layout reads) runs per wheel tick at 100Hz+ on trackpads —
    // pure overhead for the overwhelmingly common case. Overlays and exotic
    // targets keep the measured walk. Only the two cheap extent reads
    // remain (scroll offsets never force layout); at a boundary we return
    // and let the browser handle native overscroll natively.
    let container = null;
    const t = e.target;
    const main = resultsMainEl || document.querySelector('main.results');
    if (t instanceof HTMLElement && main && !isOverlayScrollContainer(t)
        && (t === main || t.closest('main.results'))) {
        const max = main.scrollHeight - main.clientHeight;
        if (delta > 0 ? main.scrollTop < max - 1 : main.scrollTop > 1) {
            container = main;
        } else {
            return;
        }
    } else {
        const path = e.composedPath ? e.composedPath() : [e.target];
        const isOverOverlay = path.some(isOverlayScrollContainer);
        container = findScrollableTarget(path, delta);
        if (!container) {
            if (isOverOverlay) {
                e.preventDefault(); // Boundary reached or non-scrollable overlay: prevent native chain to background
            }
            return;
        }
    }

    e.preventDefault();
    ensureContainerScrollListener(container);

    let state = containerScrollStates.get(container);
    if (!state) {
        state = {
            targetY: container.scrollTop,
            currentY: container.scrollTop,
            startTime: 0,
            rafId: null,
            isAnimating: false,
            firstFrame: false
        };
        containerScrollStates.set(container, state);
    }

    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);

    // Kickoff & accumulation (startTime anchored to glide start, never refreshed per flurry tick):
    if (!state.isAnimating) {
        state.isAnimating = true;
        state.startTime = performance.now();
        state.currentY = container.scrollTop;
        state.targetY = container.scrollTop;
        state.firstFrame = true;
        state.dbgN = 0;
        activeScrollContainers.add(container);
        if (container === resultsMainEl || (container && container.matches && container.matches('main.results'))) {
            document.body.classList.add('smooth-scrolling-active');
        }
        animateContainerScroll(container, state);
    }

    // Accumulate target with a tight 1.2x multiplier and 640px max lead clamp for sustained high-speed flicks
    const maxLead = 640;
    const newTarget = state.targetY + delta * 1.2;
    state.targetY = Math.max(state.currentY - maxLead, Math.min(state.currentY + maxLead, newTarget));
    state.targetY = Math.max(0, Math.min(maxScroll, state.targetY));
};
export const syncSchedulerControls = () => {
    const isOptimized = schedulerMode === 'optimized';
    const cleanProxy = getCleanProxyBase(customProxyUrl);
    const isProxy = !!cleanProxy;

    const toggle = document.getElementById('schedulerModeToggle');
    const label = document.getElementById('schedulerModeLabel');
    const debugDelaySlider = document.getElementById('debugDelaySlider');
    const debugDelayVal = document.getElementById('debugDelayVal');
    const debugMaxConnSlider = document.getElementById('debugMaxConnSlider');
    const debugMaxConnVal = document.getElementById('debugMaxConnVal');
    const debugBurstSlider = document.getElementById('debugBurstSlider');
    const debugBurstVal = document.getElementById('debugBurstVal');

    if (toggle) toggle.checked = isOptimized;
    if (label) {
        label.textContent = isOptimized ? 'Optimized' : 'Manual';
        if (isOptimized) label.classList.remove('is-manual');
        else label.classList.add('is-manual');
    }

    if (debugDelaySlider) {
        debugDelaySlider.disabled = isOptimized;
        if (!isOptimized) debugDelaySlider.value = schedulerMinDelayMs;
    }
    if (debugDelayVal) {
        if (isOptimized) {
            debugDelayVal.textContent = isProxy ? 'Auto (0ms / 334ms)' : 'Auto (334ms direct)';
            debugDelayVal.title = isProxy
                ? 'Optimized Pacing: 0ms delay on Cloudflare Edge cache hits (instant line rate); strictly paces subsequent origin dispatches by 334ms whenever an Edge cache miss occurs to respect Open Library\'s 3.0 req/s rate limit.'
                : 'Direct Origin Pacing: Enforces a strict 334ms delay between consecutive requests to guarantee compliance with Open Library\'s 3.0 req/s limit without a proxy buffer.';
        } else {
            debugDelayVal.textContent = `${schedulerMinDelayMs}ms`;
            debugDelayVal.title = `Manual Start Spacing: Fixed delay of ${schedulerMinDelayMs}ms between dispatched requests.`;
        }
    }

    if (debugMaxConnSlider) {
        debugMaxConnSlider.disabled = isOptimized;
        if (!isOptimized) debugMaxConnSlider.value = schedulerMaxConnections;
    }
    if (debugMaxConnVal) {
        if (isOptimized) {
            debugMaxConnVal.textContent = isProxy ? 'Auto (8 max / ≤3 origin)' : 'Auto (3 max direct)';
            debugMaxConnVal.title = isProxy
                ? 'Optimized Concurrency: Multiplexes up to 8 simultaneous connections to the Cloudflare Edge, with an internal safety latch restricting unconfirmed requests to ≤3 until response headers verify an Edge hit vs Origin miss.'
                : 'Direct Concurrency: Limited to 3 concurrent connections directly to Open Library origin to prevent socket saturation and HTTP 429 rate-limiting.';
        } else {
            debugMaxConnVal.textContent = `${schedulerMaxConnections}`;
            debugMaxConnVal.title = `Manual Max Concurrency: Up to ${schedulerMaxConnections} concurrent connections.`;
        }
    }

    if (debugBurstSlider) {
        debugBurstSlider.disabled = isOptimized;
        if (!isOptimized) debugBurstSlider.value = schedulerBurstCapacity;
    }
    if (debugBurstVal) {
        if (isOptimized) {
            debugBurstVal.textContent = isProxy ? 'Auto (Instant)' : 'Auto (0 off)';
            debugBurstVal.title = isProxy
                ? 'Optimized Burst: Edge requests bypass the token bucket and dispatch instantly without queue wait times as long as a connection slot is available.'
                : 'Burst Disabled: Bursting is deactivated (0 tokens) for direct origin connections to maintain steady-state request pacing and prevent bursting into rate limits.';
        } else {
            debugBurstVal.textContent = `${schedulerBurstCapacity}`;
            debugBurstVal.title = `Manual Burst Capacity: Up to ${schedulerBurstCapacity} burst tokens replenished over time.`;
        }
    }
};
export let switchTelemetryHUDTab = null;

// ── Floating Draggable Telemetry Modal Controls ───────────────────────────
export const updateTelemetryPinState = () => {
    const pinBtn = document.getElementById('telemetryPinBtn');
    if (!pinBtn) return;
    const isPinned = safeStorage.getItem('ole_telemetry_pinned') === 'true';
    pinBtn.classList.toggle('is-pinned', isPinned);
    pinBtn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
    pinBtn.title = isPinned ? 'Pinned: Will reopen across page reloads' : 'Pin HUD: Keep open across page reloads';
};

export const toggleTelemetryHUD = (forceState) => {
    const modal = document.getElementById('telemetryFloatingModal');
    if (!modal) return;
    const willOpen = typeof forceState === 'boolean' ? forceState : (modal.style.display === 'none' || !modal.style.display);
    modal.style.display = willOpen ? 'flex' : 'none';
    if (willOpen) {
        // Arming lockout: disable pointer events on footer buttons for 450ms so follow-through taps are ignored
        const footer = modal.querySelector('.telemetry-floating-footer');
        if (footer) {
            footer.style.pointerEvents = 'none';
            setTimeout(() => {
                footer.style.pointerEvents = '';
            }, 450);
        }

        if (window.innerWidth <= 768) {
            modal.style.left = '';
            modal.style.top = '';
            modal.style.right = '';
            modal.style.bottom = '';
            if (typeof setSettingsPanelOpen === 'function') {
                setSettingsPanelOpen(false);
            }
        }
        syncTelemetryHUD();
        updateTelemetryPinState();
    } else {
        safeStorage.setItem('ole_telemetry_pinned', 'false');
        updateTelemetryPinState();
    }
};

// ── Telemetry HUD Sync & Experimental Controls ────────────────────────────
export const syncTelemetryHUD = () => {
    if (!DOM.telemetryFloatingModal || DOM.telemetryFloatingModal.style.display === 'none') return;

    const snap = apiTelemetry.getSnapshot();

    // Section 1: Network & Pipeline
    const elStartRate = document.getElementById('telStartRate');
    if (elStartRate) elStartRate.textContent = `${snap.currentRate1s} / ${snap.sustainedRate5s} req/s`;

    const elPeakRate = document.getElementById('telPeakRate');
    if (elPeakRate) elPeakRate.textContent = `${snap.peakObservedRate} req/s`;

    const elQueueWait = document.getElementById('telQueueWait');
    if (elQueueWait) elQueueWait.textContent = `${snap.avgQueueWaitMs} ms / ${snap.avgHighPriQueueWaitMs} ms`;

    const elRtt = document.getElementById('telRtt');
    if (elRtt) elRtt.textContent = `${snap.avgRttMs} ms (${fetchOpenLibrary.getActiveConnections()} / ${fetchOpenLibrary.getQueueLength()})`;

    // Section 2: Search & Discovery Engine
    const elSearchQueries = document.getElementById('telSearchQueries');
    if (elSearchQueries) elSearchQueries.textContent = `${snap.searchCount} reqs`;

    const elSearchDocs = document.getElementById('telSearchDocs');
    if (elSearchDocs) elSearchDocs.textContent = `${snap.searchDocs} docs`;

    const elAutocomplete = document.getElementById('telAutocomplete');
    if (elAutocomplete) elAutocomplete.textContent = `${snap.autocompleteCount} lookups`;

    const elDiscoveryDetails = document.getElementById('telDiscoveryDetails');
    if (elDiscoveryDetails) elDiscoveryDetails.textContent = `${snap.discoveryCount + snap.detailCount} reqs`;

    // Section 3: Speed & Benchmark Logs
    const elLastSearchTime = document.getElementById('telLastSearchTime');
    if (elLastSearchTime) {
        if (snap.lastSearchTotalSec > 0) {
            elLastSearchTime.textContent = `${snap.lastSearchTotalSec.toFixed(2)}s (${snap.lastSearchQuerySec.toFixed(2)}s / ${snap.lastSearchProcSec.toFixed(2)}s / ${snap.lastSearchRenderSec.toFixed(2)}s)`;
        } else {
            elLastSearchTime.textContent = '—';
        }
    }

    const elSearchTimingSummary = document.getElementById('telSearchTimingSummary');
    if (elSearchTimingSummary) {
        if (snap.avgSearchDurationSec !== '—') {
            elSearchTimingSummary.textContent = `${snap.minSearchDurationSec}s / ${snap.avgSearchDurationSec}s / ${snap.maxSearchDurationSec}s`;
        } else {
            elSearchTimingSummary.textContent = '— / — / —';
        }
    }

    const elLayerLatencies = document.getElementById('telLayerLatencies');
    if (elLayerLatencies) {
        elLayerLatencies.textContent = `~0.2 ms / ${snap.avgEdgeLatencyMs} ms / ${snap.avgOriginLatencyMs} ms`;
    }

    // Section 4: Translation Pipeline
    const elTranslatedWorks = document.getElementById('telTranslatedWorks');
    if (elTranslatedWorks) elTranslatedWorks.textContent = `${snap.translatedWorks} books`;

    const elPassRatio = document.getElementById('telPassRatio');
    if (elPassRatio) elPassRatio.textContent = `${snap.pass1Pct}% (${snap.pass1Count}) / ${snap.pass2Pct}% (${snap.pass2Count})`;

    const elReqsPerBook = document.getElementById('telReqsPerBook');
    if (elReqsPerBook) elReqsPerBook.textContent = `${snap.reqsPerBook}`;

    // Section 5: Cache Shield & Health
    const elStatus = document.getElementById('telStatus');
    if (elStatus) {
        elStatus.textContent = `${snap.originRequests || 0} / ${snap.edgeCacheHits || 0}`;
    }

    const elCacheHits = document.getElementById('telCacheHits');
    if (elCacheHits) {
        elCacheHits.textContent = `${snap.ramCacheHits} / ${snap.idbCacheHits} / ${snap.edgeCacheHits}`;
    }

    const elContentHits = document.getElementById('telContentHits');
    if (elContentHits) {
        elContentHits.textContent = `${snap.apiHits} / ${snap.titleHits} / ${snap.coverHits}`;
    }

    const elErrors = document.getElementById('telErrors');
    if (elErrors) {
        elErrors.textContent = `${snap.http429s} / ${snap.http403s} / ${snap.http404s} / ${snap.errors}`;
        elErrors.title = snap.lastErrorSummary || 'No errors logged';
        if (snap.http429s > 0 || snap.http403s > 0 || snap.errors > 0) {
            elErrors.style.color = '#f85149';
        } else if (snap.http404s > 0) {
            elErrors.style.color = '#e3b341';
        } else {
            elErrors.style.color = '';
        }
    }

    const elBadge = document.getElementById('telemetryTransportBadge');
    if (elBadge) {
        elBadge.textContent = customProxyUrl ? 'Proxy Mode' : 'Direct Mode';
        elBadge.classList.toggle('is-direct', !customProxyUrl);
        elBadge.style.color = '';
    }
};

export const initDraggableTelemetry = () => {
    const header = document.getElementById('telemetryHeaderDraggable');
    const modal = document.getElementById('telemetryFloatingModal');
    if (!header || !modal) return;

    // Restore saved position if available (desktop viewports only)
    if (window.innerWidth > 768) {
        const savedLeft = safeStorage.getItem('ole_telemetry_left');
        const savedTop = safeStorage.getItem('ole_telemetry_top');
        if (savedLeft && savedTop) {
            modal.style.right = 'auto';
            modal.style.bottom = 'auto';
            modal.style.left = savedLeft;
            modal.style.top = savedTop;
        }
    }

    // One-time legacy migration: convert active persistent debug to pinned telemetry
    if (safeStorage.getItem('ole_persistent_debug') === 'true' && safeStorage.getItem('ole_telemetry_open') === 'true') {
        safeStorage.setItem('ole_telemetry_pinned', 'true');
    }
    safeStorage.removeItem('ole_debug_mode');
    safeStorage.removeItem('ole_persistent_debug');
    safeStorage.removeItem('ole_telemetry_open');

    // Pinned restore or one-shot ?debug=1 URL parameter (excluding 0, false, off, no)
    const isPinned = safeStorage.getItem('ole_telemetry_pinned') === 'true';
    const urlParams = new URLSearchParams(window.location.search);
    const debugParam = urlParams.get('debug');
    const isDebugUrl = debugParam !== null && !['0', 'false', 'no', 'off'].includes(debugParam.toLowerCase());
    if (isPinned || isDebugUrl) {
        toggleTelemetryHUD(true);
    }

    // Telemetry Segmented Tabs switching & persistence
    const tabBtns = modal.querySelectorAll('.telemetry-tab');
    const tabPanes = modal.querySelectorAll('.telemetry-pane');
    const setTelemetryTab = (paneId) => {
        tabBtns.forEach(btn => {
            const isActive = btn.getAttribute('data-pane') === paneId;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            btn.setAttribute('tabindex', isActive ? '0' : '-1');
        });
        tabPanes.forEach(pane => {
            const isActive = pane.id === paneId;
            pane.classList.toggle('active', isActive);
            pane.style.display = isActive ? 'block' : 'none';
        });
        safeStorage.setItem('ole_telemetry_active_tab', paneId);
    };
    switchTelemetryHUDTab = setTelemetryTab;

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPane = btn.getAttribute('data-pane');
            if (targetPane) setTelemetryTab(targetPane);
        });
    });

    // ARIA Tablist keyboard navigation (ArrowLeft / ArrowRight / Home / End)
    const tabsList = modal.querySelector('.telemetry-tabs');
    if (tabsList) {
        tabsList.addEventListener('keydown', (e) => {
            const tabsArray = Array.from(tabBtns);
            const currentIndex = tabsArray.indexOf(document.activeElement);
            if (currentIndex === -1) return;

            let nextIndex = currentIndex;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                nextIndex = (currentIndex + 1) % tabsArray.length;
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                nextIndex = (currentIndex - 1 + tabsArray.length) % tabsArray.length;
            } else if (e.key === 'Home') {
                e.preventDefault();
                nextIndex = 0;
            } else if (e.key === 'End') {
                e.preventDefault();
                nextIndex = tabsArray.length - 1;
            }

            if (nextIndex !== currentIndex) {
                tabsArray[nextIndex].focus();
                const targetPane = tabsArray[nextIndex].getAttribute('data-pane');
                if (targetPane) setTelemetryTab(targetPane);
            }
        });
    }

    const savedTab = safeStorage.getItem('ole_telemetry_active_tab');
    if (savedTab && (savedTab === 'telemetryPaneMetrics' || savedTab === 'telemetryPaneScheduler')) {
        setTelemetryTab(savedTab);
    }

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerDown = (e) => {
        if (window.innerWidth <= 768) return; // Keep modal centered on mobile viewports
        if (e.target.closest('#telemetryCloseBtn') || e.target.closest('input') || e.target.closest('button')) return;
        isDragging = true;
        startX = e.clientX || (e.touches && e.touches[0].clientX);
        startY = e.clientY || (e.touches && e.touches[0].clientY);

        const rect = modal.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        modal.style.right = 'auto';
        modal.style.bottom = 'auto';
        modal.style.left = `${initialLeft}px`;
        modal.style.top = `${initialTop}px`;

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;
        const currentX = e.clientX || (e.touches && e.touches[0].clientX);
        const currentY = e.clientY || (e.touches && e.touches[0].clientY);
        const deltaX = currentX - startX;
        const deltaY = currentY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        const maxLeft = window.innerWidth - modal.offsetWidth - 8;
        const maxTop = window.innerHeight - modal.offsetHeight - 8;

        newLeft = Math.max(8, Math.min(newLeft, maxLeft));
        newTop = Math.max(8, Math.min(newTop, maxTop));

        modal.style.left = `${newLeft}px`;
        modal.style.top = `${newTop}px`;
    };

    const onPointerUp = () => {
        if (isDragging) {
            safeStorage.setItem('ole_telemetry_left', modal.style.left);
            safeStorage.setItem('ole_telemetry_top', modal.style.top);
        }
        isDragging = false;
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
    };

    header.addEventListener('pointerdown', onPointerDown);
};
export const railPopoverState = {}; // groupId -> { popoverEl, placeholderEl, group, btn, open }

// Filter must always stack above Sort, regardless of which the person
// happened to open first — Object.keys() order previously followed click
// order, so opening Sort before Filter put Sort on top and let it claim the
// full remaining viewport height, cutting off Filter underneath it.
export const RAIL_POPOVER_ORDER = ['filterGroup', 'sortGroup'];

// Only two of these ever exist (Filter, Sort) — rather than generic code for
// an arbitrary number of stacked popovers with a lot of position-bouncing
// logic to keep them from overlapping, this handles the two known cases
// directly: Filter is always on top, Sort always below it, and the one rule
// that actually matters is that neither can render past the other's edge or
// off the bottom of the screen.
export const positionRailPopovers = () => {
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

export const closeRailPopover = (groupId) => {
    const state = railPopoverState[groupId];
    if (!state || !state.open) return;
    const { popoverEl, placeholderEl, group, btn } = state;
    popoverEl.classList.remove('open');
    if (btn) btn.classList.remove('rail-btn-active');
    state.open = false;
    setTimeout(() => {
        if (!state.open) {
            if (placeholderEl && placeholderEl.parentNode) {
                placeholderEl.parentNode.replaceChild(group, placeholderEl);
            }
            if (popoverEl.parentNode) popoverEl.parentNode.removeChild(popoverEl);
        }
    }, 200);
    positionRailPopovers();
    if (!Object.keys(railPopoverState).some(id => railPopoverState[id].open)) {
        document.body.classList.remove('rail-popover-open');
    }
};

export const closeAllRailPopovers = () => {
    Object.keys(railPopoverState).forEach(closeRailPopover);
};
export const legacyCollapsedRail = document.getElementById('legacyCollapsedRail');
export const openRailPopover = (btn, groupId) => {
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
export const wireRailShortcut = (btn, groupId) => {
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
export const applyLegacyLayout = (enabled) => {
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
export function restoreHeaderElementsToTop() {
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
export let scrollClassTimeout = null;
export const resultsMainEl = document.querySelector('main.results');
export const resultsHeaderEl = document.querySelector('.results-header');
// Notched mouse wheels deliver scroll events in bursts with idle gaps: the
// old 80ms removal toggled 300 cards' styles on and off per notch (style
// recalc + paint churn between almost every notch). Hold across typical
// notch gaps instead; a real pointer-down (intent to interact) restores
// interactivity instantly so clicks never wait out the hold.
export const SCROLL_CLASS_IDLE_MS = 250;
export const clearScrollingState = () => {
    clearTimeout(scrollClassTimeout);
    scrollClassTimeout = null;
    document.body.classList.remove('is-scrolling');
    if (resultsMainEl) resultsMainEl.classList.remove('is-scrolling');
    flushDeferredGridWrites();
};
document.addEventListener('pointerdown', () => {
    if (document.body.classList.contains('is-scrolling')) clearScrollingState();
}, { capture: true, passive: true });

// Desktop sticky-header rollout visuals: driven by a rAF follower, NOT raw
// scrollTop, so stepped native wheel notches and smooth-scroll glides both
// produce continuous output. Fixed lerp k=0.2 (stable, no oscillation).
let headerDisplayedProgress = 0;
let headerTargetProgress = null;
let headerRafId = 0;
const applyHeaderVisual = (p) => {
    if (!resultsHeaderEl) return;
    if (!(p > 0)) {
        resultsHeaderEl.classList.remove('desktop-sticky-active', 'desktop-sticky-extending');
        resultsHeaderEl.style.removeProperty('--desktop-sticky-progress');
        return;
    }
    resultsHeaderEl.classList.add('desktop-sticky-active');
    resultsHeaderEl.style.setProperty('--desktop-sticky-progress', p.toFixed(3));
    if (p > 0.6) resultsHeaderEl.classList.add('desktop-sticky-extending');
    else resultsHeaderEl.classList.remove('desktop-sticky-extending');
};
const scheduleHeaderVisual = (target) => {
    // null = disengage immediately (mode exit mirrors the old synchronous
    // teardown so no stale header lingers in the wrong mode).
    if (target === null) {
        if (headerRafId) { cancelAnimationFrame(headerRafId); headerRafId = 0; }
        headerDisplayedProgress = 0;
        headerTargetProgress = null;
        applyHeaderVisual(0);
        return;
    }
    headerTargetProgress = target;
    if (headerRafId) return;
    const tick = () => {
        const diff = headerTargetProgress - headerDisplayedProgress;
        if (Math.abs(diff) < 0.002) {
            headerDisplayedProgress = headerTargetProgress;
            headerRafId = 0;
        } else {
            headerDisplayedProgress += diff * 0.2;
            headerRafId = requestAnimationFrame(tick);
        }
        applyHeaderVisual(headerDisplayedProgress);
    };
    headerRafId = requestAnimationFrame(tick);
};
export const handleScrollState = () => {
    positionRailPopovers();
    if (!document.body.classList.contains('is-scrolling')) {
        document.body.classList.add('is-scrolling');
    }
    if (resultsMainEl && !resultsMainEl.classList.contains('is-scrolling')) {
        resultsMainEl.classList.add('is-scrolling');
    }

    // Desktop fully-collapsible sidebar mode: smooth progressive sticky header.
    // Target comes from a smoothstep rollout over the 70–320px zone (zero
    // slope at onset AND arrival — no opening burst, no 100% wall slam);
    // visuals follow via the rAF follower above. Hysteresis: engage past
    // 74px scrolling down, hold until below 66px scrolling up (kills
    // threshold flicker when hovering at the onset).
    if (!document.body.classList.contains('legacy-layout') && window.innerWidth > 768 && resultsMainEl && resultsHeaderEl) {
        const st = resultsMainEl.scrollTop;
        const wasEngaged = headerTargetProgress !== null && headerTargetProgress > 0;
        if (st > 74 || (wasEngaged && st >= 66)) {
            const t = Math.min(1, Math.max(0, (st - 70) / 250));
            const target = t * t * (3 - 2 * t);
            // NOTE: the schedule call lives INSIDE this branch on purpose.
            // The teardown branch below must never fall through to it: with
            // `target` unassigned (undefined !== null) it would schedule an
            // undefined target, NaN-poison the follower, and latch the header
            // dead until refresh (the rAF guard then blocks all re-engages).
            if (target !== headerTargetProgress) scheduleHeaderVisual(target);
        } else if (wasEngaged || headerDisplayedProgress > 0.002) {
            // Fully out of the zone: teardown synchronously (as before the
            // follower existed). Gliding an invisible ghost here is exactly
            // the re-appear blink: scrollTop already arrived while the header
            // is still fading. null = disengaged idle (matches
            // scheduleHeaderVisual(null)) so downstream guards see no
            // false-engaged state. No early return: the is-scrolling reset
            // below must still run every scroll event.
            if (headerRafId) { cancelAnimationFrame(headerRafId); headerRafId = 0; }
            headerDisplayedProgress = 0;
            headerTargetProgress = null;
            applyHeaderVisual(0);
            // No schedule call here and no shared `target` variable: falling
            // through with an unassigned target is what NaN-latched the header.
        } else {
            // Deadband hold: keep previous target, schedule nothing.
        }
    } else if (resultsHeaderEl && (headerTargetProgress !== null || resultsHeaderEl.classList.contains('desktop-sticky-active'))) {
        scheduleHeaderVisual(null);
    }

    clearTimeout(scrollClassTimeout);
    scrollClassTimeout = setTimeout(clearScrollingState, SCROLL_CLASS_IDLE_MS);
};
