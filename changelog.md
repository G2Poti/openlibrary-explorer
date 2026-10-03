# Open Library Catalog - Project Changelog & Revision History

## Version 1.8 - Mobile Sidebar Gesture Overhaul, Content Motion & Search Pagination Fixes (Current)

**Mobile Sidebar Drag Performance Overhaul**
- **rAF-Coalesced Drag Loop:** Touch moves batch into a single `requestAnimationFrame` tick instead of mutating DOM per hardware event (120–240Hz digitizers were dirtying styles multiple times per frame).
- **Direct Inline Transforms:** The slide is driven via `transform` with `!important` priority on the panel and ear tab, replacing per-touchmove CSS custom-property writes on `aside.filters` and `.app-container` that forced full-subtree style recalculation (1,500+ nodes) on every tick — the source of the slow-drag choppiness and `[Violation] Forced reflow` warnings.
- **Record-Only Touchstart:** Plain taps incur zero layout cost; the panel width is measured once at drag activation instead of on every touchstart.
- **Trailing rAF Cancellation & Release Cleanup:** `endDrag` cancels pending frames (no post-release clobbering), reuses the cached width instead of re-measuring, and no longer dispatches a synthetic `resize` (which used to trigger a full resize-observer/header/tag cascade on every release and tap).
- **Backdrop Compositing:** Opacity-only transition (removed `backdrop-filter` from the transition list); blur suppressed mid-gesture, dim alone tracks the finger.
- **Ear Tab Tracking:** Driven directly with right-side mirroring, `touch-action: none`, permanent `will-change`, and continuous -14px/+14px rest-offset interpolation — no 14px grab/release pop. Synchronous first-frame pin eliminates the 1-frame snap.
- **Content Isolation Mid-Gesture:** `content-visibility: hidden` on sidebar children while collapsed, dragging, or revealing, bypassing subtree layout and native select-anchor calculations during movement.

**Sidebar Gesture UX Follow-Ups**
- **Hysteresis Snap Thresholds:** Opening commits past 30%, closing commits below 70% (replacing the 50% midpoint), so short swipes complete in both directions.
- **Content Re-Flash Fix:** Content hides only while *opening* from collapsed and the settle fade fires only on real opens — nudging an open sidebar and releasing no longer flashes its contents.
- **Sidebar-Origin Close Swipes:** Close gestures can start on the open panel's inert chrome (group containers, summaries, padding) instead of reaching for the backdrop sliver; interactive controls stay excluded so taps, focus, and scrolling keep working. A one-shot capture-phase suppressor swallows the phantom release-click (e.g. toggling a `<summary>` the finger slid off) inside a 350ms window.
- **Bidirectional Gesture Locking:** A natively scrolling (or momentum-gliding) list owns the finger — sideways motion can't birth a drag mid-scroll; conversely an active drag pins both content and sidebar scrollers to grab-time offsets until release, so diagonal drift never scrolls underneath.

**Mobile Layout Fixes**
- **Sidebar Branding Centering:** The legacy-layout banner combined `width: 100%` with 18px side margins, overflowing the panel by 36px and shoving content 18px right; now `width: auto` so it spans exactly the Filter/Sort content width, centered.
- **Reset-to-Defaults Mode Parity:** Resetting restores the pull-out sidebar default (Alternative Layout ON with boot's viewport gating) instead of forcing rail mode — which also disagreed with fresh-boot behavior after reload.

**Content Motion System**
- **Mount Entrance De-janked:** `.book-card` entrance changed from a `translateY(16px)` rise (which replayed on *every* mount — refresh, searches, library renders, Discover tab switches — reading as content "jumping up") to an opacity-only fade (0.28s + stagger), now also honored by the Reduce Animations setting.
- **Scroll-Reveal Entrances (tried, then reverted):** Cards genuinely arriving from below the fold briefly played a GPU-only rise + fade + scale via a shared `IntersectionObserver`. Removed after traces and feel-testing showed the entrance layer churn plus `content-visibility` skip/render cycling cost more than they saved on sub-1000-card grids — below-fold arrivals now simply appear, and the mount fade carries first paint. The `backwards`-only fill rule (no permanent compositor layers) stays as the guard.
- **Late-Cover Fade-In:** Covers assigned after their card is on screen (ordered background loader via `onload`, missing-cover resolution, translation swaps) fade in on paint instead of snapping; build-time covers ride the card fade untouched.

**Search Pagination Fix ("Find More Books")**
- **Single Page-Size Source of Truth:** Visibility math assumed 100/page while default searches fetch 50/page, hiding the button on every default search with 50+ total results. `lastFetchLimit` (set from the in-flight query, immune to mid-flow toggle flips) now drives both display sites.
- **Raw-Count Short-Page Detection:** Exhaustion detection reads the raw API count (pre-dedup, pre-filter) after finding post-dedup shrinkage of a full page faked exhaustion (e.g. "Showing 48 of 48,079" with the button hidden).

**Verification Infrastructure**
- **Kept Reproducible Suite (`scripts/verify-drag.mjs`):** 60+ deterministic checks — sync-layout-read budgets attributed by stack frame, first-frame pins, hysteresis snaps, mid-window no-flash sampling, sidebar-origin + suppressor behavior, bidirectional scroll locks, card/cover/pagination guards — with touch-delivery tracing, environment-flake retries, and bundle-aware assertions. Verified green on dev source and the production singlefile artifact; smoke harness clean.

---

## Version 1.7g - Modular ES Architecture, Global Shortcuts Engine, Catalog Search Deduplication & UI Stacking Refinement

**Modular ES Architecture & Singlefile Bundler Pipeline**
- **Monolith Decomposition:** Refactored the legacy 7,500-line monolithic `script.js` into focused, single-responsibility ES modules (`dom.js`, `utils.js`, `storage-cache.js`, `network-engine.js`, `book-features.js`, `app-ui.js`, `main.js`), eliminating global namespace pollution and circular evaluation cycles.
- **Singlefile Production Bundling:** Integrated Vite with `vite-plugin-singlefile` to compile the modular codebase into a standalone, distribution-ready single-file HTML bundle.
- **Automated Static Dependency Audits:** Authored custom static AST inspection scripts (`scripts/audit-idents.cjs` and `scripts/audit-imports.cjs`) to prevent undefined variable regressions and unresolved ES export/import references.

**Centralized Keyboard Shortcuts Engine & Modal (`#shortcutsModal`)**
- **Global Keyboard Navigation (`T`, `L`, `F`, `S`, `V`):** Added a global shortcut engine with smart focus guards (ignoring active inputs/textareas/selects) and modifier key suppression:
  - `T`: Toggle Sidebar expansion (dismisses active popouts/drawers first).
  - `L`: Toggle My Library view (smooth toggle between search catalog and saved collection).
  - `V`: Toggle Grid and List View layout.
  - `F`: Toggle Filter popout drawer (when sidebar is in collapsed rail mode).
  - `S`: Toggle Sort popout drawer (when sidebar is in collapsed rail mode).
  - `Esc`: Universal LIFO modal and floating dialog dismissal.
- **Universal Tap-Protection & Modal Dismissal LIFO Stack:** Re-engineered modal dismissal so pressing a shortcut or `Escape` while `#shortcutsModal` is open dismisses only the top modal, keeping the underlying Settings panel open.
- **Event Isolation on `#shortcutsModal`:** Added explicit `e.stopPropagation()` and outside-click guards to prevent closing the Settings dropdown when dismissing the Shortcuts modal via its close button or backdrop.
- **Accessible Shortcuts Modal:** Added a dedicated modal dialog (`#shortcutsModal`) displaying comprehensive navigation, search, and tag tips, linked directly from **Settings → Info → Keyboard Shortcuts [View]** with body scroll locking (`body.shortcuts-modal-open`).

**Overlayed Sidebar Stacking Context, Content Header Blur & Sticky Header Restoration**
- **Scoped Overlay Stacking Hierarchy:** Scoped `.results-header { z-index: auto !important; }` strictly to `body.overlayed-sidebar .app-container:not(.sidebar-collapsed) .results-header` so it only activates while the floating sidebar is expanded. This completely restores `position: sticky !important; z-index: 100 !important;` and the full `62px` height on `.results-header.desktop-sticky-active` in Alternative Mode (`body:not(.legacy-layout)`), ensuring the sliding sticky header floats securely in front of all book cards and preserves its vibrant `backdrop-filter: blur(14px) saturate(180%)`.
- **Content Header Protection & Dimming:** When the floating sidebar expands, `#sidebarOverlayBackdrop` (`z-index: 500`) covers and blurs (4px) all content header navigation elements (`#sidebarToggleBtn`, `#resultsMeta`, `#discoverDashboardToggles`, `#viewSavedBtn`, `#settingsBtn`) and dismisses the sidebar on tap, while keeping the search section sharp and clickable at `z-index: 501`.
- **Sticky Header Stacking Neutralizer:** Neutralized `backdrop-filter` and `transform` on `.results-header.desktop-sticky-active` while the overlayed sidebar is open to prevent child elements from being trapped in an inherited stacking context.

**Catalog Search Deduplication (`deduplicateSearchDocs`)**
- **Composite Work Key Normalization:** Implemented catalog deduplication for Open Library search results matching normalized `title + primary author`, preventing duplicate work entries (such as duplicate records for "Night Owl" by Anna Mae Yu Lamentillo) from appearing as separate cards.
- **Metadata Merging & Richness Scoring:** Evaluates record richness (ratings presence, cover availability, edition count, subject tags), retaining the highest-quality base record and merging missing ratings, cover edition IDs, earliest publication year, and unioning subject tags.
- **Safe Pipeline Insertion:** Deduplication executes immediately upon raw doc ingestion *before* minimum rating/star filters, preventing unrated duplicates from being prematurely discarded before metadata enrichment. Cross-page checks against `allDisplayedDocs` prevent duplicates across infinite scroll batches.
- **Anonymous Work Fallback:** Works lacking an author or title fall back to `doc.key`, ensuring unrelated anonymous works are never falsely collapsed.

**Desktop Smooth Scrolling Cursor & Settings Scroll Isolation**
- **Scoped Results Motion & Cursor Lock:** Confined `smooth-scrolling-active` pointer locks strictly to `main.results` and `.book-card` elements (`body.smooth-scrolling-active main.results .book-card, body.smooth-scrolling-active main.results .book-card *`), guaranteeing floating overlays (`.settings-dropdown`, `.rail-popover`, `.shortcuts-modal-container`, `.telemetry-floating-modal`) maintain full `pointer-events: auto !important` and never lose pointer tracking during scroll gestures.
- **Settings & Popover Scroll Isolation:** Updated `findScrollableTarget` and `onWindowWheelCapture` to detect overlay targets (`isOverlayScrollContainer`). Wheel events over `#settingsPanel` or other overlays never fall back to scrolling `main.results` at max boundaries or when content fits within viewport height, completely eliminating scroll coupling and chaining.
- **Resting Cursor Hit-Test Restoration:** Captures passive mouse coordinates (`lastKnownMouseX`, `lastKnownMouseY`) and dispatches a synthetic `mousemove` event upon glide completion (`diff < 0.35`), prompting Chromium to immediately re-evaluate hit-testing and restore the cursor to pointer hand when resting over a book card.

**UI Polish, Tag Mechanics & Telemetry Fixes**
- **Atomic Subject Tag Standardization & Seed Normalization:** Standardized all subject tags across the entire application into atomic split pills (splitting compound Library of Congress headings such as `"Philippines, history"` into distinct individual pills: `"Philippines"` and `"History"`). Enforced `cleanSubjects` parsing across all home page discovery ingest pipelines (`fetchDiscoverSeed`, `stored.books`, Cloudflare proxy trending bundles, and `mapSubjectWorkToDoc`), and pre-cleaned all 60 trending records in `public/discover_seed.json` (and `dist/discover_seed.json`), ensuring 100% tag presentation parity between the home discover page and catalog search results.
- **Stage Toast Positioning & Search Uncoupling:** Repositioned quick-tag action toasts (`#stageToasts`) to float cleanly below the content header (`top: calc(100% + 8px); left: 50%; transform: translateX(-50%)`) with `z-index: 600`. Prevents toasts from colliding with the centered search bar in Compact Desktop Mode or being submerged behind translucent search controls.
- **Mobile Info Section Suppression:** Hidden `#categoryInfo` and `.desktop-only-category` on mobile screens ($\le 768\text{px}$) via CSS `display: none !important`.
- **Comma Tag Autocomplete Mechanic:** Pressing comma adds the typed tag, clears the input field, hides autocomplete recommendations, and clears autocomplete ghost text.
- **Tag Direct Inclusion/Exclusion Toggle:** Shift-click (Include) and Ctrl/Cmd-click (Exclude) directly on card subject tags toggle filters cleanly.
- **Telemetry HUD Pin Fix:** Closing the floating Telemetry HUD via `X` clears the stored pinned state, preventing it from reopening automatically on page reload.
- **Sidebar Position Runtime Sync:** Fixed Left/Right sidebar placement initialization and change listener binding after the modular split.

---

## Version 1.7f - High-Refresh Smooth Scrolling Engine, Dual-Mode Sticky Header Dynamics, Floating Telemetry HUD & Resilient Universal Library Backup

**High-Refresh Desktop Smooth Scrolling Engine ("Minecraft-Mod" Momentum Physics)**
- **Continuous Delta-Time Exponential Decay:** Replaced fixed-lerp frame-rate dependent animation with continuous delta-time physics (`diff * (1 - Math.exp(-15.0 * dt))`), eliminating frame-rate discrepancies where 144Hz–240Hz monitors finished animations in <50ms. Guarantees uniform, firm ~200–220ms deceleration across 30Hz, 60Hz, 144Hz, 170Hz, 240Hz, and 1000Hz+ displays.
- **Velocity Lead Clamping & Flick Ceiling:** Tuned `maxLead = 640` with a 1.2x impulse multiplier. Single wheel notches glide ~120px and stop tight; rapid flurries top out at ~9,600px/s, allowing users to traverse hundreds of book cards without runaway ice-skating.
- **Glide-Anchored Soft Attack Envelope:** Anchored strictly to glide start (`!isAnimating`), ramping velocity factor via `Math.max(0.18, elapsed / 0.035)` over the first 35ms. Dampens the harsh 1,800px/s frame-1 velocity spike into a smooth onset curve (~1.8px → 3.2px → 4.8px) on single notches while locking to 1.0 for the remainder of sustained flurries to preserve full flick speed.
- **Mechanical Encoder Chatter Filter:** Suppresses tiny opposite-direction micro-bounces ($|delta| < 15$ with sign reversal within $<20\text{ms}$) after passthrough exclusions, protecting aging mechanical mouse encoders without blocking same-direction rapid spins.
- **Feedback Loop Disconnection & State Isolation:** Attached lazy container scroll listeners that inspect `state.isAnimating`, ignoring own RAF writes while synchronizing target coordinates during native user drags or keyboard navigation. Per-container isolation via `WeakMap<Element, ContainerScrollState>` and iterable `Set<Element> activeScrollContainers` ensures leak-free cancellation on toggle-off, reset, resize, or tab visibility change.
- **Orphaned RAF Guard:** Clamps `targetY` against `Math.max(0, scrollHeight - clientHeight)` on every frame, preventing infinite animation loops if content shrinks mid-glide.
- **Accessibility & Settings Default:** Decoupled from the OS-level `prefers-reduced-motion` media query (which falsely disabled smooth scrolling on Windows machines with OS visual effects disabled) and bound it cleanly to the in-app `Reduce Animations` toggle. Enabled by default on desktop (`safeStorage.getItem('ole_smooth_scrolling') !== 'false'`), relocated to **Settings → Preferences → Appearance** directly below List View, and hidden on mobile screens ($\le 768\text{px}$) via `.desktop-only-row`.

**Overlay Sidebar Desktop Scroll Locking**
- **Desktop Scroll Lock:** Locked main results scroll when overlay sidebar is open (`body.overlayed-sidebar .app-container:not(.sidebar-collapsed) main.results { overflow-y: hidden !important; }`).
- **Zero-Layout-Shift Gutter:** Paired with `scrollbar-gutter: stable` to eliminate 15px layout shift when scrollbars hide and reveal.
- **Scroll Chaining Safety:** Target discovery walks `composedPath` and skips containers with `overflowY === 'hidden'`, ensuring wheeling over the dimmed backdrop or locked content never moves the background results grid while the sidebar list remains freely scrollable.

**Alternate Layout Sticky Header Frosted Glass & Dual-Mode Motion Dynamics**
- **Cubic Ease-Out Rollout ($1 - (1-t)^3$):** Replaced legacy 3-stage deadzones (70px/130px/430px) with continuous cubic ease-out tracking over a 250px span (`st` from 70 to 320). Starts promptly on initial scroll with no flat onset deadzone, while asymptotically flattening out as it approaches 100% ($\frac{dP}{dt} \to 0$ at $t=1$). Completely eliminates the final 2-3% hard landing snap even during sub-pixel engine settles.
- **Dual-Mode Conditional Transitions:**
  - *Smooth Scroll ON (`body.smooth-scroll-on`):* Zero CSS transition on `transform` and `opacity`. Pure 170Hz continuous RAF lockstep with zero lag, rubber-banding, or fighting.
  - *Smooth Scroll OFF (`body:not(.smooth-scroll-on)`):* Applies `transition: transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.16s ease`, smoothly interpolating discrete 100px native notches over 160ms instead of teleporting.
- **Continuous Opacity:** Removed legacy `calc(0.2 + 0.8 * ...)` opacity jump on `.desktop-sticky-extending`, ensuring opacity scales smoothly from 0% to 100% without threshold popping.
- **Theme-Aware Frosted Glass Aesthetic:** Translucent `rgba(255, 255, 255, 0.75)` in light mode and `rgba(22, 27, 34, 0.75)` in dark mode with `backdrop-filter: blur(14px) saturate(180%)` and soft shadows. Removed opaque `background: var(--header-bg) !important` override under Compact Header mode so frosted glass renders across all layout configurations. Reverts cleanly to solid static styling when scrolled back to the top (`st < 70`).

**Floating Draggable Telemetry HUD & Mobile Viewport Isolation**
- **Independent Floating Modal (`#telemetryFloatingModal`):** Decoupled Telemetry metrics and Adaptive Rate Scheduler controls out of the settings drawer into an independent, draggable floating window with viewport boundary clamping.
- **Tab Navigation & Action Controls:** Added tab switching between Telemetry stats and Adaptive Rate Scheduler controls, along with pin toggle and close actions.
- **Accidental Tap Safety:** Added a 450ms input arming lockout on HUD open to swallow follow-through taps from the 5-tap developer unlock gesture. Added a 2-step confirmation ("Confirm Clear?") with a 3.5s auto-revert timer to `Clear Cache`.
- **Mobile Isolation:** Hid `#categoryMisc` on mobile viewports ($\le 768\text{px}$) and enforced outside-click dismissal on mobile regardless of whether settings were pinned on desktop.

**Universal Library Backup / Restore & CSV Import Normalization**
- **Canonical Work Key Harmonization:** Exported JSON and CSV backups format standard `/works/OL...W` keys, stripped edition prefixes (`/books/`), and validated integer timestamps under schema version `1.7b`.
- **Multi-Header CSV Ingestion:** Intelligent fuzzy and aliased header mapping (`work_key`, `olid`, `book_title`, `authors`, `genres`, `tags`, etc.) supporting semicolon or comma delimited lists.
- **Collision-Free Fallback Keys:** Generates collision-free local keys (`/works/LOCAL_${title}_${author}_${suffix}`) for imported records lacking an OLID.
- **Post-Import State Sync:** Invokes `syncLibraryKeySet()` and invalidates subject/search filter caches immediately after import to guarantee instant UI consistency.

---

## Version 1.7e - Comprehensive Architectural Integrity & Quality Audit, Zero-Regression Resilience, Memory Cache Harmonization & Universal Accessibility Polish

**Network Engine & Asynchronous Queue Resilience (`fetchOpenLibrary`)**
- **Deterministic `unconfirmedInFlight` Counter Guard:** Implemented an internal single-release latch (`unconfirmedReleased`) within the network pipeline, eliminating double-decrement bugs across overlapping `.then()`, `.catch()`, and `.finally()` blocks and guaranteeing origin concurrency clamps never desynchronize.
- **Network Fetch Abort Timeout:** Integrated a 30-second `AbortController` timeout wrapper on all `fetchOpenLibrary` network calls, preventing hung sockets from permanently occupying queue concurrency slots during connection drops.
- **Queue Retry Telemetry Calibration:** Reset `entry.enqueuedAt = Date.now()` upon re-queueing 5xx transient server errors, ensuring sliding window queue wait time telemetry remains statistically accurate.
- **Translation Queue O(1) Duplicate Check:** Refactored `TranslationQueue` with an internal `queuedKeys` Set companion, replacing $O(N)$ linear array sweeps with instant $O(1)$ lookups during batch translation additions, cancellations, and queue processing.

**Storage Tier Harmonization, Memory Management & Safe Fallbacks**
- **Universal Cover ID Normalization (`normalizeCoverId`):** Standardized all cover lookups across API numbers, raw strings, and prefixed identifiers (`/books/OL...`) into canonical clean strings, unifying `coverMemoryCache`, `cover404MemoryCache`, and IndexedDB stores with 100% lookup hit symmetry.
- **Single-Key In-Memory Storage:** Scrubbed redundant dual-key memory caching, storing each cover exactly once under its normalized ID and reducing memory footprint across large book catalogs.
- **Safe Subject String Coercion (`cleanSubjects`):** Hardened subject parser to safely handle non-string array elements, object structures (`{ name: ... }`), and comma-delimited strings without runtime type exceptions.
- **Quota-Resilient Storage Wrapper (`safeStorage`):** Re-architected storage fallback to prioritize the in-memory `Map` during `getItem()` lookups and automatically switch to memory fallback upon quota exhaustion or private browsing lockouts.
- **Bounded Negative 404 Memory Cache:** Enforced an LRU capacity limit (`COVER_404_MEMORY_CACHE_MAX = 500`) with automatic timestamp expiration checks (`COVER_CACHE_TTL`), preventing memory leaks during extended discovery browsing sessions.

**UI Concurrency, Asynchronous Guards & Lifecycle Safety**
- **Stale Search & View Mode Guard (`performSearch`):** Injected strict cancellation guards (`requestToken !== searchRequestToken || currentViewMode !== 'search'`) after long translation and network sweeps, preventing stale search queries from contaminating the Library view.
- **Detail Drawer Asynchronous Work Guard (`openDetailsDrawer`):** Added a `currentDrawerWorkKey !== b.key` check following asynchronous edition/ratings fetches, eliminating race conditions when users rapidly click multiple books in sequence.
- **Collision-Free Library Import Key Generation (`handleImportFile`):** Implemented safe title fallbacks (`'Untitled'`) and collision-free unique work keys (`/works/LOCAL_${title}_${author}_${suffix}`) during external JSON file imports.
- **Asynchronous Cover Resolver Lock Safety (`resolveMissingCover`):** Enclosed lock cleanup in a `finally { resolvingCoverKeys.delete(key); }` block, ensuring cover resolution locks are released on all network error paths.
- **Independent Discover Bundle & Network Refresh:** Restructured `renderDiscoverDashboard` so that synchronous seed data, background Cloudflare Edge bundle updates, and Open Library network fallbacks operate independently without race conditions.
- **Initial Skeleton Placeholders:** Injected 12 animated skeleton card placeholders into `#featuredClassicsGrid` on initial cold render for instantaneous visual layout stability.
- **Smooth Rail Popover Dismissal:** Deferred DOM element reparenting inside a 200ms `setTimeout` matching CSS transition timings, eliminating visual snaps during filter/sort popover closures.
- **Settings Panel Display State Synchronization:** Updated the settings button toggle to inspect body classes (`!document.body.classList.contains('settings-open')`), ensuring instant single-click opening on first boot.

**Settings, Telemetry & Export Integrity**
- **Unconditional Proxy Settings Reset:** Fixed proxy reset logic in `resetAllSettingsToDefault` and `resetSchedulerBtn` to unconditionally restore `DEFAULT_PROXY_URL` in both runtime memory and input fields.
- **Complete Telemetry IndexedDB Wipe:** Expanded telemetry reset handlers to purge both `COVER_404_DB_PREFIX` and `COVER_DB_PREFIX` IndexedDB tables alongside translation and discovery caches.
- **Cross-Browser Telemetry Export Delay:** Delayed `URL.revokeObjectURL(url)` by 1,000ms in `#exportTelemetryBtn`, preventing corrupted or zero-byte file downloads on Firefox and slower engines.
- **Safe Empty-String Proxy Support:** Refactored proxy configuration loader from truthy `||` coercion to explicit null checking (`savedProxy !== null ? savedProxy : DEFAULT_PROXY_URL`), enabling direct-mode overrides.
- **Scheduler Control Type Safety:** Added defensive `typeof` function guards before dispatching pacing updates and token clamp triggers.

**DOM Deduplication, Accessibility & Web Standards Compliance**
- **Empty Library Toggle All Defense:** Added an empty list guard (`if (!currentList || currentList.length === 0) return;`) to `#toggleAllBtn`, preventing false positive deletion confirmations on empty libraries.
- **Grid Click Selection Deduplication:** Scrubbed duplicate inline selection logic in `handleGridClick` in favor of the canonical `toggleCardSelection` helper.
- **Universal Icon Button Accessibility:** Injected comprehensive `aria-label` attributes across 13+ navigation and action buttons (`#homeBtn`, `#settingsBtn`, `#settingsCloseBtn`, `#railFilterBtn`, `#railSortBtn`, `#clearFiltersBtn`, `#sidebarToggleBtn`, `#sidebarOverlayCloseBtn`, `#viewSavedBtn`, `#detailsCloseBtn`, `#mobileSettingsBtn`, `#toggleAllBtn`).
- **Explicit Form Label Associations:** Linked all filter and metric `<label>` elements to their respective input fields with standard `for="..."` attributes across Include, Exclude, Range, and Rating panels.
- **SEO & Meta Tag Compliance:** Added standard `<meta name="description">` tag to `index.html`.
- **HTML Injection Defense:** Enclosed error descriptions in `escapeHTML()` within `renderErrorHTML()`.
- **Discover Seed Data Corrections:** Scrubbed author typos, corrected character entity arrays in `discover_seed.js`, and validated cover IDs across all trending entries.

---

## Version 1.7d - Deterministic Fast-Lane Queue Engine, Cloudflare Edge Shield Hierarchy, Intelligent Negative 404 Caching, Speed Telemetry & Mode-Locking Scheduler

**Deterministic Fast-Lane Dual-Lane Queue Engine (`fetchOpenLibrary`)**
- **Origin Safety Invariants & Mathematical Proof:** Eliminated optimistic concurrency race conditions where client-side queues firing parallel requests before reading response headers could overwhelm Open Library origin on cold cache misses. The deterministic dual-lane queue engine enforces the invariant `unconfirmedInFlight <= 3` at all times by construction. Total open HTTP/2 multiplexed streams can scale up to 8 in Proxy mode (or 3 in Direct mode), but the number of in-flight requests whose cache status is unconfirmed is strictly clamped to $\le 3$. This mathematically guarantees that even on a 100% cold cache miss batch, no more than 3 requests can ever hit Open Library origin concurrently.
- **Instant 0ms Fast-Lane Socket Turnover:** When a request completes with a confirmed Cloudflare Edge Cache Hit (`cf-cache-status: HIT / STALE / REVALIDATED`, `x-edge-cache-status: HIT`, `cache-control: edge-hit=1`, `age > 0`, or sub-90ms round-trip latency), its unconfirmed slot is immediately recycled (`unconfirmedInFlight--`), and `processQueue()` immediately dispatches the next queued request at full line rate without artificial caller sleeps or pacing delays.
- **Strict Origin Pacing on Misses:** Any request that misses the edge cache (`cf-cache-status: MISS / DYNAMIC`, `edge-miss=1`, or direct fetch) updates `lastOriginStartTime` and paces subsequent origin dispatches with strict $\ge 334\text{ms}$ spacing ($1000\text{ms} / 3 = 3.0\text{ req/sec}$ Open Library rate limit).
- **Benchmark Performance:** Delivers complete 200-book foreign translation sweeps across deep edition catalogs in **1.32s – 1.99s** (a ~90× speedup over serial execution) with 99.2% Edge cache absorption and zero rate-limiting ($0\text{ HTTP 429s}$, $0\text{ HTTP 403s}$).

**Interactive Rate Scheduler Modes & Mode-Locking UI (`syncSchedulerControls`)**
- **Interactive Mode Toggle (`#schedulerModeToggle`):** Introduced a seamless switch between **Optimized Mode** and **Manual Mode**, persisted across reloads in `safeStorage` (`ole_scheduler_mode`).
- **Optimized Mode (Locked Safety Rails):** Automatically disables and locks all 3 sliders (`disabled = true`) to prevent accidental configuration drift, displaying dynamic status pills:
  - *Proxy Mode Active:* Start Spacing `Auto (0ms / 334ms)`, Max Concurrency `Auto (8 max / ≤3 origin)`, Burst Token Capacity `Auto (Instant)`.
  - *Direct Mode Active (No Proxy):* Start Spacing `Auto (334ms direct)`, Max Concurrency `Auto (3 max direct)`, Burst Token Capacity `Auto (0 off)`.
- **Manual Mode (Fixed Slider Benchmark Mode):** Unlocks all 3 sliders (`Start Spacing 25–1500ms`, `Max Concurrency 1–8`, `Burst Token Capacity 0–8`) for raw testing, fixed token-bucket pacing benchmarks, and origin boundary stress tests.
- **Default Cloudflare Edge Proxy Integration:** Built-in `DEFAULT_PROXY_URL = 'https://openlibrary-proxy.peter-ortenszky.workers.dev'`, automatically pre-populating on fresh boot and settings resets without requiring manual configuration.
- **Non-Destructive Reset to Defaults (`resetSchedulerBtn` / `resetAllSettingsToDefault`):** Resetting scheduler defaults restores mode to `Optimized` and resets manual defaults to `334ms / 3 / 3` while **strictly preserving the user's configured Cloudflare Worker proxy URL** with clear green visual feedback (`✓ Defaults Reset!`).
- **UI Header Vertical Alignment:** Refined `.telemetry-title` and `.scheduler-mode-label` with `line-height: 1`, `display: flex`, and `align-items: center` in `style.css`, ensuring pixel-perfect vertical centering alongside the mode pill.

**Cloudflare Edge Worker Proxy Backend Architecture (`openlibrary-proxy.workers.dev`)**
- **Edge Cache TTL Policy:** Configured Cloudflare Edge Cache (`caches.default`) with 7-day persistence (`s-maxage=604800, public`) for all immutable Open Library endpoints (`/search.json`, `/works/.../editions.json`, `/works/...`).
- **Universal CORS Header Injection:** Injects `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: *` (explicitly exposing `cf-cache-status`, `x-edge-cache-status`, `age`, and `cache-control`) to allow client-side JavaScript to inspect cache hits across origins.
- **Diagnostic Edge Cache Status Headers:** Worker injects `x-edge-cache-status: HIT / MISS` and `cache-control: edge-hit=1 / edge-miss=1` into all proxied responses for zero-ambiguity telemetry auditing.
- **Transparent URL Rewriting:** Client-side URL builder intercepts outgoing requests to `https://openlibrary.org/...`, automatically re-rooting path and query parameters to the custom Cloudflare Worker proxy host while preserving query parameters and `&contact=` email safety headers.

**Intelligent 404 Catalog Handling & Universal Negative Caching**
- **Root Cause Resolution:** Identified that Open Library's search index lists legacy works (e.g. `/works/OL27492W`) whose `/editions.json` catalog entries have been deleted or do not exist, returning HTTP 404 on all requests.
- **Universal Negative Caching:** In both `applyLocalFilters` and `performSearch`, whenever `fetchWorkEditions` encounters a 404 Not Found or null response, the canonical title (`b.original_title || b.title`) is immediately cached in memory (`translationCache`) and committed to IndexedDB (`ole_translation_cache_v10`). Subsequent searches, filter changes, and re-sorts serve the title instantly in 0ms from local storage, **permanently eliminating redundant network requests for missing catalog records**.
- **Verbose 404 Error Telemetry:** Error logs capture exact endpoint paths (e.g. `[3:26:07 AM] 404 Not Found (/works/OL27492W/editions.json)`).
- **HUD Error Classification:** Separated HTTP 404 catalog misses from real server errors in the HUD:
  `HTTP Status (429 Rate / 403 Block / 404 Miss / Errors)`
  Missing catalog works are styled in amber/gold warnings, reserving red alerts exclusively for actual 429 rate limits, 403 blocks, or 500 server crashes.

**Cohesive Storage Tier & Content-Type Cache Shield Hierarchy**
- **Storage Tier Breakdown (`Storage Tier Hits`):**
  - `L1 RAM`: In-memory API JSON cache (`apiResponseCache`), Title translation map (`translationCache`), and in-memory cover map (`coverMemoryCache`).
  - `L2 IDB`: Persistent IndexedDB cache (`localforage` translation records + stored cover data URLs).
  - `L3 Edge`: Cloudflare Edge Worker cache hits (`cf-cache-status: HIT`, `x-edge-cache-status: HIT`, `cache-control: edge-hit=1`, `age > 0`, or sub-90ms response latency).
  - `L4 Origin`: Uncached requests reaching Open Library origin servers.
- **Content-Type Breakdown (`Content Hits`):**
  - `API`: Raw JSON endpoints (`search.json`, `editions.json`, `works.json`).
  - `Titles`: Translated book title resolutions.
  - `Covers`: Local and cached cover art images.
- **Mathematical Invariant:** Total Storage Tier Hits ($RAM + IDB + Edge$) **strictly equals** Total Content Hits ($API + Titles + Covers$) across all operations.

**Dedicated Speed & Benchmark Logs Section in Telemetry HUD**
- **Last Search Time (Total / Query / Transl / Render):** Detailed duration breakdown isolating search API network time, client-side translation processing, and DOM rendering (e.g. `0.36s (0.02s / 0.31s / 0.03s)`).
- **Search Duration (Min / Avg / Max):** Rolling benchmark statistics computed over a sliding window of past searches (e.g. `1.37s / 1.37s / 1.38s`).
- **Average Layer Latencies (RAM / Edge / Origin):** Real-time roundtrip latency profiling for each tier:
  - `RAM`: `~0.2 ms`
  - `Edge`: `~34 ms` (Cloudflare Worker edge CDN)
  - `Origin`: `~340 ms` (Open Library transatlantic round-trip)

**Complete Telemetry Session Exporter**
- **Exhaustive Telemetry JSON Snapshot (`#exportTelemetryBtn`):** Dumps complete session telemetry including active scheduler mode, slider configurations, proxy endpoints, real-time throughput metrics (1s/5s start rates, peak rates, queue wait times, network RTT), search benchmark logs (min/avg/max/last query times), storage tier hits, content-type breakdown counters, edition scan ratios (Pass 1 vs Pass 2), and full error logs with microsecond timestamps, HTTP status codes, and exact URL paths.

**Consolidated Home & Discover Cloudflare Edge Bundle Architecture (`/api/discover-bundle`)**
- **Single-Trip Edge Bundling:** Implemented a dedicated `/api/discover-bundle` endpoint on the Cloudflare Worker that aggregates 14 separate upstream queries (2 trending pools: Classics + Recent Trendy, plus all 12 curated genre shelves) into a single optimized payload.
- **7-Day Edge Cache TTL:** Cached at the Cloudflare Edge with `s-maxage=604800, public` and full CORS exposure headers, reducing Discover initial network roundtrips from 14 down to **1 single sub-20ms edge request**.
- **Deterministic Local Storage Unpacking:** `script.js` seamlessly unpacks the incoming bundle, immediately populating in-memory RAM variables (`cachedTrendingBooks`, `cachedGenreShelves`) and persisting them into their respective IndexedDB stores (`ole_trending_cache_v4`, `ole_genre_shelves_cache_v3`) and localStorage mirror (`ole_trending_cache_v4_lsmirror`) with zero downstream schema disruption.
- **Resilient Fallback Guarantee:** If custom proxy mode is disabled or if the bundle request fails, the application automatically falls back to direct parallel origin fetches without stalling the UI.

**Synchronous Frame-1 Cold-Boot Seed Acceleration (`discover_seed.js`)**
- **Instantaneous 0ms First Paint:** Bundled a static, verified dataset snapshot of 60 trending books and 12 genre shelves into `discover_seed.js`, attaching directly to `window.OLE_DISCOVER_SEED`.
- **Zero-CORS Protocol Resilience:** Loaded via `<script src="discover_seed.js"></script>` in `index.html`, eliminating Chromium's `file:///` local sandbox CORS blocks and guaranteeing that brand-new visitors with empty storage render the complete Discover dashboard on Frame 1 in **0ms** without skeleton loader delays, while silently background-refreshing from Cloudflare Edge.

**Unified Cloudflare Cover Image Reverse-Proxy (`/covers/*`)**
- **Centralized URL Resolver (`getCoverUrl`):** Unified all 5 fragmented cover URL constructions across the application (card builders, detail drawers, sequential loaders, sliding queues, and translated grid updates) under a single helper function.
- **30-Day Image Edge Cache:** Proxies `https://covers.openlibrary.org/b/id/...` and `/b/olid/...` through `${customProxyUrl}/covers/...` with a **30-day Edge TTL** (`s-maxage=2592000`) and universal CORS headers, accelerating cover image delivery from ~500ms Internet Archive origin delays down to ~15ms CDN edge hits.
- **Non-Proxy Mode Compatibility:** Automatically routes to direct `covers.openlibrary.org` when proxy mode is disabled.

**Intelligent Negative Cover Caching & 1x1 Placeholder Rejection (`ole_cover_404_`)**
- **Persistent Missing Cover Storage:** Implemented in-memory `cover404MemoryCache` paired with a timeout-guarded IndexedDB store (`ole_cover_404_`), permanently recording missing cover records across browser sessions and immediately skipping redundant network requests.
- **1x1 Transparent Placeholder Defense:** Added strict `< 100` byte response guards across both the sequential reader and the background queue, detecting Open Library's 43-byte transparent dummy 200 images and recording them as negative hits.
- **Pristine Telemetry Error Integrity:** Semantic classification distinguishes true HTTP 404 responses (which increment network error HUD metrics) from 1x1 dummy placeholders (which bypass network without generating false HTTP error counts).
- **Synchronized Cache Purging:** Updated the in-app "Clear Cache" button and telemetry reset handler to purge all `COVER_404_DB_PREFIX` and `COVER_DB_PREFIX` IndexedDB records alongside translation and discover caches.

**Roadmap & Future To-Dos**
- *Completed:* Home/Discover page Cloudflare Edge caching and cover proxying with 0ms Frame-1 synchronous seed rendering.
- *To-Do:* Have Opus perform an exhaustive, end-to-end architectural code audit across all subsystems.

---

## Version 1.7c - Telemetry-First Adaptive Rate Scheduler, Token-Bucket Burst Pacer & Live Debug Testing Suite

**Telemetry-First Adaptive Rate Scheduler & Token-Bucket Pacer (`fetchOpenLibrary`)**
- **Token-Bucket Burst Pacing with Instant Clamping:** Decoupled network scheduler featuring a sliding token bucket (`schedulerBurstCapacity = 3`, `schedulerMinDelayMs = 250ms`, `schedulerMaxConnections = 3`). Dispatches up to capacity immediately during bursts, falling back gracefully to steady spacing once tokens deplete. Dragging the burst slider immediately clamps active tokens without waiting for refill ticks.
- **While-Loop Multi-Connection Concurrency Drain:** The queue processor fills all available parallel connection slots simultaneously during bursts, eliminating single-dispatch throttles.
- **Sorted Canonical Query Cache Key Normalization (`normalizeCacheKey`):** Extracts URL paths, strips ephemeral tracking (`?contact=...`), and sorts search parameters alphabetically. Guarantees 100% cache hit symmetry between read and write paths across Direct and Cloudflare Worker proxy modes.
- **Cache-Before-Cooldown Fast Lane:** Cached requests resolve instantly from memory in 0ms without hitting the network or being blocked by active 429/403 cooldown gates.
- **Pre-Dispatch Abort Signal Guard:** Queue drain checks `signal.aborted` before dispatching, rejecting cancelled requests immediately without consuming connection slots or burst tokens.
- **Dual Circuit Breaker with Separated Error Telemetry:** Preserves the 5-minute safety backoff on both HTTP 429 (Rate Limit) and HTTP 403 (Forbidden) while recording them under distinct metrics for fine-grained diagnosis.

**Live Telemetry Hub, HUD & Session Exporter**
- **Real-Time Sliding Window Metrics (`apiTelemetry`):** Tracks real-time request start rates across 1-second and 5-second sliding windows, peak observed start rates, average network round-trip time (RTT), and queue wait latency (with separate tracking for high-priority user clicks).
- **3-Tier Cache Shield Telemetry:** Real-time counter tracking hits across all 3 tiers: In-Memory API Cache (`apiResponseCache`), IndexedDB Translation Cache (`translationCache`), and Cover Cache (`translationCoverCache`) across all 10 active lookup sites.
- **Workload Profiling & Mathematical Denominator Alignment:** Tracks Pass 1 vs Pass 2 lookups, search requests, work details, and computes exact `API Requests / Translated Book` ratio.
- **Live Debug HUD Card (`#apiTelemetryCard`):** Embedded developer HUD displaying live start rates, peak rates, latencies, workload ratios, error counts, and cache shields with 500ms reactive updates.
- **Interactive Experimental Sliders & Cloudflare Proxy Input:** Real-time range sliders for Start Spacing (25–1500ms), Max Concurrency (1–6), Burst Tokens (0–8), and custom Cloudflare Worker proxy endpoint input.
- **One-Click JSON Telemetry Export:** Exports complete benchmark session telemetry, configurations, and performance statistics to a downloadable JSON report for cross-engine benchmarking.
- **Pin Settings Toggle (`pinSettingsToggle`):** Added a dedicated "Pin Settings" switch directly under Debug Mode in Advanced Settings. When enabled, clicking anywhere outside the Settings panel is ignored, keeping settings pinned open until the user explicitly clicks the close (×) button. Fully persisted in `safeStorage` (`ole_pin_settings`).

---

## Version 1.7b - Multi-Language Translation Engine, Localized Covers, Amber Card Indicator & Tiered LRU Cache

**Hierarchical Lexicographical Sieve & Multi-Language Translation Architecture**
- **Hierarchical Lexicographical Sieve (`pickBestEdition`):** Multi-tiered translation selector resolving authentic foreign translations without English reference bias.
  - **Step 0 (Target Language Gate):** Filters raw incoming editions to the target language with null-safe code normalization.
  - **Tier 1 (Bilingual Pathology Filter):** Disqualifies English-titled parallel clones while preserving eponymous works (*Jane Eyre*, *Dracula*, *Frankenstein*, *Macbeth*).
  - **Tier 2 (In-Batch Consensus Grouping):** Groups candidate editions by normalized title, outvoting one-off typos through crowd consensus.
  - **Tier 3 (Consensus Typography & Exemplar Harvesting):** Decouples text typography selection from cover art discovery within the winning consensus group, pairing the crowd's cleanest mixed-case title (*"Orgullo y Prejuicio"*) with the valid cover image (*13225056*).
- **Universal Structural Segment Decomposition (ISBD Standard):** Universal space-padded structural delimiter extraction (`/`, `-`, `—`, `|`, `:`, `--`) without hardcoded language dictionaries. Automatically extracts the primary foreign Title Proper when parallel English titles are present (*Crime and Punishment* $\rightarrow$ *"Crimen y Castigo"*, *Leviathan Falls* $\rightarrow$ *"Caída Del Leviatán"*).
- **Universal Typography Safeguard (`formatDisplayTitle`):** Output safety net that title-cases rare all-caps catalog entries to pass spam defenses and capitalizes initial letters of lowercase entries.
- **Strictly Scoped Localized Cover Discovery:** Restricts cover image search strictly to editions within the winning consensus group, eliminating cross-work and cross-language cover bleed.

**Dynamic Tiered Edition Discovery Engine (`fetchWorkEditions`)**
- **Two-Pass Dynamic Tail Sweep:** 
  - *Pass 1 (Fast Lane):* Fetches the first 100 editions (~200ms) with early exit when a covered target language edition is found (resolves 93% of queries).
  - *Pass 2 (Deep Tail Sweep):* Performs a single wide sweep (`limit=1000&offset=100`) for deep classics without serial pagination roundtrips.
- **Safe Network Boundary Payload Trimming:** Discards heavy description/revision objects immediately after JSON parsing while strictly preserving `works: entry.works` for omnibus and workKey integrity validation.
- **Connection Pool & Cooldown Defense:** Rate-limited at $\le 4\text{ req/sec}$ (max 3 concurrent connections, 250ms spacing) with automatic 5-minute IP cooldown activation upon 429/403 responses.

**Viewport Progressive Translation & UI Feedback**
- **Pure Substring Cluster Consensus (Zero Hardcoded Word Lists):** Implemented an algorithmic language-agnostic consensus engine in `pickBestEdition` that recognizes distinct word-boundary subphrase containment among editions of the same work. Slices away publisher/MARC catalog decoration (e.g. *"Elfo Oscuro nº 03/03 El refugio"* $\rightarrow$ *"El Refugio"*) by awarding $+4\text{ pts}$ cluster support to root titles and applying a calibrated $-0.05/\text{char}$ micro-Occam tie-breaker across all 20+ languages without brittle hardcoded word lists.
- **Accurate Full-Batch Ticker & Skeleton Sizing:** Progress counters in Library and Search modes are now anchored to the total visible batch count (e.g. `30`), pre-counting cached/native target-language books as instantly completed on frame 1 (`1 of 30 (3%)` $\rightarrow$ `30 of 30 (100%)`) with 1-to-1 matching skeleton placeholders.
- **Complete Translation Progress Indicator & Live Counter:** Real-time formatted ticker (`Translating <view> - X of Y (Z%)`) and animated 3px glowing accent progress bar anchored to the header dividing line during Complete Translation passes across both Library and Search modes ($0\text{px}$ layout shift, hardware-accelerated 300ms fade-out, and generation token cancellation safety).
- **Zero-Pop-in Cover Prewarming Pipeline:** During Complete Translation passes, localized foreign cover bytes preload in the background (`fetchCoverDataUrl`) directly into in-memory RAM before grid rendering, delivering instant 0ms first-frame cover images.
- **Non-Destructive Cover Identity Check:** `updateCardCoverInGrid` checks active `data-cover-id` before mutating the DOM, eliminating redundant element destruction, re-layouts, and post-translation cover double-swaps.
- **Race-Condition Cover Defense:** Upfront `translationCoverCache` guard in `resolveMissingCover` prevents default English work covers from racing and overwriting discovered localized foreign edition covers.
- **Amber Card Translation Indicator (`is-translating`):** Real-time amber pulse border highlight during background translation passes, strictly scoped to active execution workers and disconnecting cleanly upon completion.
- **Awaited Image Preload Pipeline:** Translated card covers preload asynchronously in memory before swapping into the DOM, eliminating blank frames and premature border clearance.
- **Unified `IntersectionObserver` (50% Viewport Leeway):** Standards-based observer with `rootMargin: '0px 0px 50% 0px'` queuing requests smoothly only as cards approach the viewport.
- **On-Demand Details Drawer Resolution:** Bypasses UI background queues for instant modal translation and cover hydration on click.

**Cache Management, Storage & Full Settings Persistence**
- **Complete Settings Persistence Engine:** Full persistence audit making all user configurations sticky in `safeStorage` across browser reloads (Title Translation, Complete Translation, Translate Covers, URL Sync, Enhanced Autocomplete, Custom Limits, List View, Dark Theme, Compact Header, Overlayed Sidebar, Sidebar Position, Clean Synopses, Clean Subjects, and Reduce Animations), while intentionally auto-disabling Debug Mode and Extended Limits for safety.
- **IndexedDB `v10` Storage Upgrade:** Upgraded cache storage to `ole_translation_cache_v10` and `ole_translation_cover_cache_v2` with 500ms debounced persistence.
- **Auto-Reload & Debug Reset on Cache Clear:** Clearing the translation cache flushes IndexedDB tables and RAM maps, displays `"Cleared. Reloading..."`, automatically resets Debug Mode to OFF, and cleanly reloads the page after 750ms.
- **Universal Import / Export Compatibility:** Upgraded backup import/export engine with flexible header aliasing (supporting Open Library, Goodreads, and custom CSV formats), automatic work key normalization (`/works/OL...`), instant RAM token indexing (`cacheBookTokens`), and post-import cover discovery.

---

## Version 1.7 - Compact Desktop Mode, Overlayed Sidebar, Instant Discover Caching, Progressive Physics & Clean Synopses

**Compact Desktop Mode & Overlayed Sidebar System**
- **Compact Desktop Navigation:** Added an optional Compact Mode merging navigation, search, and settings directly into the content header (`.results-header`), featuring 62px header parity, a 3-column grid, and calibrated graceful degradation.
- **Floating Overlayed Sidebar:** Introduced a desktop overlay sidebar that glides over content with background blur, zero-jerk animations, synchronized reveals, and full support for Left/Right docking.
- **Configurable Sidebar Position:** Seamlessly switch sidebar docking between Left and Right across all layout modes with pre-paint persistence and smart control alignment.
- **Desktop Progressive Sticky Header:** Implemented continuous 0–100% scroll physics on desktop that smoothly extends header navigation into view during down-scrolling with zero-flash activation (Alternate Layout only).

**Settings Modal Reorganization & Defaults**
- **Reorganized Settings Tabs:** Structured Settings into **Preferences** (Appearance) and **Advanced** (Compact Mode, Alternate Layout, Sidebar Position, Clean Synopses, Clean Subjects).
- **One-Click Reset to Default:** Added a dedicated reset action restoring all settings to original defaults while safely preserving all saved Library bookmarks.
- **Updated First-Run Defaults:** Compact Mode ON and Overlayed Sidebar ON are now the first-run defaults.

**Discover Dashboards & Instant 0ms RAM Prewarming**
- **60 Trending Books & Curated Genre Alcove:** Expanded the trending catalog to 60 books and curated 12 genre shelves housed in a rich glassmorphic library alcove backdrop with responsive desktop-to-mobile scaling.
- **Instant 0ms Cover RAM Prewarming:** Concurrent `Promise.all` IndexedDB prewarming loads trending and genre covers directly into in-memory RAM at boot, delivering instant, single-frame 0ms cover rendering on startup and tab switching.
- **Sequential Reading-Order Loading:** Search result covers hydrate in strict reading order (left→right, top→bottom) via a 6-worker sliding window with IDB stall defense.

**Search, Autocomplete & Clean Synopses Engine**
- **Typed-Text First Suggestions & Exact-Match Priority:** Autocomplete always pins the typed query as row 0 with live work counts, prioritizing exact matches, supporting `Tab` autocompletion, and eliminating ghost previews.
- **Clean Synopses & Markdown Reference Parsing:** Intelligent synopsis sanitizer parsing inline and reference-style Markdown links (`[anchor][id]` and `[id]: url`), stripping dangling footnote lines, sanitizing spam links, formatting CommonMark typography, and extracting source attributions into clickable badge cards.
- **Clean Library Subjects:** Dedicated **Clean Subjects** option for My Library that automatically formats tags into clean title-case (preserving minor lowercase conjunctions).
- **Zero-Filter Search Protection:** Search buttons automatically grey out and disable when no filters or search terms are entered, preventing empty searches on click or Enter keypress.
- **Defensive Translation Pipeline & Boot Resilience:** Rebuilt translation pipeline with strict language matching, progressive viewport lookups, synopsis priority queuing, and timeout-guarded boot resilience.

**Mobile Experience & Layout Polishing**
- **Symmetric Mobile Header & Desktop Resize Safety:** Symmetrically aligned search navigation and centered the 📚 brand icon above the 42px rail, with desktop mouse safety preserving grid mode on resize.
- **Gesture Reliability & Tucked Swipe Hint:** Refined swipe drawer touch handling to eliminate accidental ear nudges and input focus locks during tap interactions, tucking the swipe hint flush against the screen edge.
- **General Tweaks & Quality-of-Life Polish:** Numerous subtle layout alignments, tooltip anti-clipping safeguards, theme transition enhancements, and minor bug fixes across desktop and mobile modes.

---

## Version 1.6c - Header Streamlining, Luminous Hover Feedback, List Tag Optimization & Persistent Caching

**Header & Settings Streamlining**
- **Header Theme Switcher Removal:** Removed the standalone theme toggle from the top header to reduce clutter; Dark Mode preference is configured exclusively in Settings under Preferences -> General.
- **Theme Persistence Across Sessions:** Persisted user theme preference in storage (`ole_theme`), guaranteeing chosen theme is retained across page reloads and browser sessions.

**Visual Polish & Hover Experience**
- **Luminous Card Hover Accent & Elevation Glow:** Enhanced `.book-card:hover` and `.book-grid.list-view .book-card:hover` under `@media (hover: hover)` with a vibrant accent border (`border-color: rgba(37, 99, 235, 0.45)` in light mode, `rgba(56, 189, 248, 0.55)` in dark mode) and elevated ambient glow shadow for immediate visual identification of the hovered card.
- **Universal Scroll Suppression:** Suppressed hover transforms and pointer events during active scrolling across both window and main containers, preventing hover jitter and maintaining 60fps scrolling.

**List-View Tag Space Utilization**
- **Zero-Overhead Tag Expansion:** Increased desktop List View tag row capacity to 80 characters, allowing 4–5 tags to naturally display across the wide list column before collapsing to the `+N` overflow badge with zero layout calculation overhead.

**Persistent Caching & Boot Performance**
- **IndexedDB Trending Storage & Boot Preloading:** Migrated trending books cache to IndexedDB (`ole_trending_cache_v3`) and preloaded trending books and genre shelves into RAM during session boot for instant (0ms) Home/Discover rendering.
- **Edition-Based Cover Caching:** Extended background cover caching in IndexedDB to support edition keys (`OL...M`) via `/b/olid/` alongside standard numeric IDs (`/b/id/`).

---

## Version 1.6b - Dynamic Tag Packing, Zero-Jump Library, Settings Tabs & UX Polish

**Card Tag Packing & Multi-Row Architecture**
- **Continuous Dynamic Tag Packing:** Replaced rigid capacity tiers with a continuous linear formula (`Math.max(28, Math.floor((cardWidth - 130) / 6.2))`), allowing tags to dynamically expand across wide cards (packing 3+ tags per row) and contract smoothly without clipping.
- **2-Row Grid vs. 1-Row List View:** Standard grid cards format tags into up to 2 clean rows with greedy backfilling; desktop List View cards strictly format into 1 single horizontal row (`packTagsIntoOneRow`).
- **Context-Aware `+N` Overflow Popups:** Clicking `+N` on cards or in the Details Drawer now exclusively displays the remaining *un-displayed* tags, eliminating duplicate repetitions of tags already visible on screen.

**Library View Stability & Zero-Jump Unhearting**
- **In-Place DOM Card Removal:** Unhearting a book in Library view directly removes only the target card element from the DOM (`cardEl.remove()`) without wiping the grid or re-rendering chunks, preserving the scroll position with 100% precision (0px jump) on both mobile and desktop.
- **Dynamic Count & Empty State Sync:** Immediately updates header count text (`Showing all N...` / `Showing X of Y (filtered)`) and transitions cleanly to the empty library message when the last book is unhearted.
- **Empty Library Toggle-All State:** Ensured the "Add/Remove All" button is consistently disabled and greyed out (`opacity: 0.4`) when the library is empty across both collapsed and expanded sidebar views.

**Details Drawer & Persistent Synopsis Caching**
- **Compact Horizontal Tag Pills:** Restyled `#detailsSubjects` with flexible horizontal wrapping and capped the visible tag budget to ~2–3 compact rows with a `+N` badge for the remainder, eliminating full-width vertical stretching.
- **Persistent Synopsis Caching (IndexedDB + RAM):** Upgraded book descriptions to persist in IndexedDB (`ole_desc_`) with a 30-day TTL for instant (0ms) re-opens.
- **Background Trending Prefetching:** Automatically prefetches and caches synopses for the 10 Home/Discover trending books on session boot, operating safely under OpenLibrary rate limits (<10% of 1 minute's budget).

**Settings Panel Tabs Reorganization**
- **Two-Tab Settings Layout:** Reorganized the settings panel into two dedicated tabs ("Preferences" and "Advanced") on both desktop and mobile, eliminating vertical scroll clutter and providing a cleaner configuration experience.

**Visual Polish & High-Performance Scrolling**
- **Title & Author Padding Buffer:** Applied generous right padding to `.book-title` and `.book-author` (96px / 3× heart button width on desktop, 48px / 1.5× on mobile) to guarantee long titles wrap cleanly before encroaching on the action buttons.
- **Hardware-Accelerated 2D Cover Hover & Scroll Stability:** Replaced 3D perspective transforms with smooth 2D hover zoom (`transform: scale(1.04)`), and added an active `.is-scrolling` pointer-events suppression class to guarantee 60fps scrolling without hover thrashing or blank compositor layer drops.
- **Theme Switcher Sun Icon Contrast:** Enhanced the sun icon with vivid amber-gold (`#fbbf24`) and dual drop-shadows for high-contrast visibility against both light and dark header backgrounds.

---

## Version 1.6 - Default Mobile Layout Switch & UX Polish

**Default Mobile Layout & Gesture Experience**
- **Default Mobile Interface:** Swapped default mobile mode so the site boots natively into the full-screen, gesture-driven sidebar (FOUC-free on initial load). Settings toggle defaults to OFF (which switches back to the legacy rail layout).
- **1:1 Touch Dragging & Gesture Control:** Smooth 1:1 finger tracking for opening/closing the sidebar, with automatic gesture locking on specific tabs (e.g. Popular Genres) and touch-safe ear tab hiding.
- **Bulk Multi-Select Mode:** Long-press hold-to-select on mobile book cards with a frosted-glass bulk action toolbar (bulk add/remove from library).

**Header & Navigation Uniformity**
- **Top Header Buttons:** Unified Home, Library (`#viewSavedBtn`), and Settings (`#mobileSettingsBtn`) into matching 36×36px square tile buttons with translucent backgrounds and white icons.
- **Light Mode Header Refresh:** Softened dark slate header gradient in light mode to a vibrant brand blue (`#2563eb` to `#1e40af`).
- **Search Alignment & Spacing:** Aligned header search container padding with main content grid margins (`1.35rem` left, `0.85rem` right), letting the input field flex dynamically. Expanded Discover Dashboard tabs (`Trending Books` & `Popular Genres`) flush to outer grid bounds.

**Card & List-View Architecture**
- **Content-Driven List Cards:** Overhauled list view with flexible heights, natural aspect ratios (`object-fit: cover`), clean title/author ellipsis clamping, and responsive column degradation for smaller viewports.
- **Visual Polish:** Centered tag count pills vertically relative to card controls, downsized heart buttons for mobile list cards, and ensured symmetric padding across views.

**Performance & System Refinements**
- **GPU Layer Optimization:** Promoted transform layers (`will-change`) only during active slides to keep text crisp and minimize GPU memory footprint.
- **Search Speed Indicator:** Replaced `Search completed in Ns` text with an inline SVG stopwatch icon + formatted time number (`1.2s`), centered cleanly on a fixed 52px header grid.
- **Smart Rate-Limit Cooldowns:** Isolated genuine 429/403 API blocks from transient CORS or network errors so IP cooldown timers trigger only when necessary.

**Settings & Theme Contrast**
- **Settings Reorganization:** Grouped settings into clear General, Search, and collapsible Advanced categories.
- **Dark Mode Switch Contrast:** Updated active switch track background to bright royal blue (`#3b82f6`) with a subtle border for dark-on-dark visibility.

---
## Version 1.5c - Mobile Layout Polish & Bug Fixes

**Mobile Layout Polish & Interactions**
- Fixed a mobile tap-delay bug where every button took ~0.5-1s to register a press. Caused by the page never declaring `touch-action`, so the browser held every tap to check whether it was the start of a double-tap-zoom gesture. Added `touch-action: manipulation` globally to remove the delay while still allowing pinch-zoom.
- Disabled the default `-webkit-tap-highlight-color` overlay that became visible on sidebar icons once the above fix let taps register instantly, replacing it with the app's existing hover/active styles for touch feedback.
- Rewrote the mobile settings panel to slide up from the bottom with a fullscreen blurred backdrop and drag-to-dismiss support.
- Rewrote mobile List View and fixed grid distortion when toggling between views.
- Touch-Safe All-Tags Popover: Added a transparent dismissal overlay with single-tap protection to prevent accidental card/drawer clicks, along with mouse wheel/scroll bypass.
- Expanded Details Drawer Tag Flow: Unrestricted tag height so subject tags flow naturally across the scrollable drawer, with a `+N` badge for extra long subject lists.
- Reduced Mobile Details Drawer Tag Density: Reduced visible subject tag capacity in the details drawer on mobile by 50% for a cleaner mobile drawer experience while keeping desktop drawer capacity intact.
- General UI & Badge Visual Refinements: Restructured mobile list card layout and harmonized badge heights and color accents across views.

---
## Version 1.5b - Experimental Mobile Layout Support (Current)

**Experimental Mobile Layout Support**
- Introduced initial experimental responsive layout styles and touch-friendly UI adaptations for mobile viewports (`@media (max-width: 768px)`).
- Optimized header elements, search bar alignment, side-rail visibility, and grid columns on smaller screens to ensure readable layouts and fluid scrolling.

---

## Version 1.5 - UI Overhaul (Dashboard, Sidebar, Side-rail, Interactivity) & Server-Side Ratings

**Home Page Dashboard & UI Polish**
- Expanded the "Trending Books" selection with a doubled, more diverse dataset rather than just classics.
- Replaced section titles with two buttons, moved them up to the header to make efficient use of the UI's space.
- Perfected global box-model math to ensure book covers in grid views are exactly vertically flush with sidebar icons across all layouts.
- Updated the Home button to display a simple home icon, sized consistently across modes.

**Sidebar Collapse & Animation Refinements**
- Eliminated all jitter and "kick-back" during sidebar collapse animations by stripping conflicting margin transitions and anchoring the sidebar to a static internal bounding box.
- Added a new vertical icon rail (My Library, Add/Remove All, Filter, Sort) that surfaces cleanly when collapsing the sidebar, with synchronized fade-in/out animations on expand.

**Server-Side Rating Integration**
- Overhauled the "Min Reviews" filter and "Rating" sort to query OpenLibrary directly via server-side parameters (`ratings_count:[X TO *]`, `sort=rating`) instead of performing client-side post-fetching filters.
- Updated sort-caveat banners and tooltips to stop warning about client-side behavior for the now genuinely server-side filter and sort.

---


## Version 1.4 - New Sidebar Layout

**New Sidebar Layout**
- Redesigned the left sidebar with a compact, collapsible glassmorphism look, with Filter, Sort, and Settings grouped into clearly labeled sections instead of one long list.
- Sidebar now collapses fully to 0 width, with the toggle relocated to the results header so it stays reachable even when hidden.
- Aligned the sidebar and results headers into one continuous line, and gave scrollbars theme-matching colors in light and dark mode.

**Library Improvements**
- Added a working "Add/Remove All to Library" button on the Discover screen, with a lightweight checkmark confirmation instead of one that shifts the layout.
- Fixed Library search/filter/sort not refreshing reliably, and removed the "Find Books" button from Library view since it wasn't needed there.

**Translation & Caching**
- Extended title translation to any language in the filter dropdown, not just Spanish.
- Cached trending books and translation lookups to cut down on redundant Open Library requests, and polished the in-progress translation UI.

**Floating Filter & Sort Popovers**
- Clicking the Filter or Sort icon in the collapsed sidebar rail now opens that section in a floating popover instead of expanding the whole sidebar.
- Popovers can be dismissed by clicking outside, pressing Escape, or clicking the icon again.
- Opening both Filter and Sort at once stacks them cleanly instead of letting them overlap.

**Legacy Layout Option**
- Added a new "Legacy Layout" toggle in Settings for anyone who prefers the original sidebar and header design.
- Off by default (new layout applies); switching it on restores the classic look.

---

## Version 1.3b - Bug Fixes & Query Speed Info Button

**Library Tab Fix**
- Fixed library filtering, sorting, and general search not refreshing when changed. Corrected view mode checks that were mapping to 'saved' instead of 'library', causing the filter pipeline to silently no-op.

**Settings Panel Fix**
- Removed the "Local Library operations are instantaneous." info block from the library settings section, as it was no longer accurate or relevant.
- Harmonized vertical spacing between all settings rows to remove an uneven gap that appeared between the first two toggles and the rest.

**Query Speed Info Button**
- Replaced the disappearing blue status text with a collapsible hoverable info (i) icon that appears after each search completes.
- Hovering the icon reveals the last query's speed stats (Query, Processing, Render, and Total times) in a floating tooltip panel.
- The icon fades out alongside the status text and collapses into the info button once the fade animation finishes.

**Critical Bug Fix**
- Resolved a fatal SyntaxError caused by a duplicate `const isTransEnabled` declaration in the same function scope inside `performSearch()`. This crash prevented the entire script from executing on page load, causing the app to appear broken (light mode, no buttons, empty library).
- Localized the `localforage` dependency by downloading the full minified library (29KB) to eliminate CDN blocking on restricted networks.

---

## Version 1.3 - Multi-Language Translation & Preparation Pipeline

**Generalization of Title Translation**
- Overhauled translation lookup to support Spanish, French, German, and all other languages selected in the language filter dropdown.
- Re-keyed translation map to cache key combinations based on Work Key + Target Language Code instead of Cover Edition Key.
- Overhauled translation queries to fetch the Work's editions directly via `/works/{work_key}/editions.json?limit=40` and return the first edition matching the selected language.

**Execution Pipeline Timing Consolidation**
- Removed the permanent timing metrics marker from the results metadata bar.
- Unified status telemetry into exactly three main phases:
  1. Query (API payload retrieval and JSON parsing)
  2. Processing (Subject cleaning, rating filters, translation batch fetches, and client sorting)
  3. Render (DOM injection of book cards)
- Displayed phase metrics in the temporary blue status text.
- Automatically grouped translation times under the "Processing" phase.

---

## Version 1.2b - Library View Cleaning & Validation Warning Removal

**Restored Fully Independent Library Tab Design**
- Cleared and hid previous search timing metrics from the "Displaying X books in Library" counts header inside My Library.

**Filter Validation Cleaning**
- Completely removed the "Please enter at least one filter to begin." status warning label from inputs and search buttons.
- Modified view state toggle handlers to hide validation checks entirely.

---

## Version 1.2 - Caching, CDN Rate Limiting Safety, & Settings Toggles

**Rate-Limiting Protection**
- Optimized background translation scans to fetch edition profiles sequentially in parallel batches of 5 instead of 20 concurrent requests.
- Resolved CDN rate limits and IP blocking issues.

**Caching System**
- Added global `translationCache` Map and `translationPending` Set registers to prevent duplicate or concurrent redundant queries for the same edition.
- Optimized check criteria via `needsTranslation()` to skip fetching if the work only has a single language matching the target language.

**Settings Upgrades**
- Added a "Title Translation" switch to the Advanced Settings dropdown panel (enabled by default). Disabling it completely skips all translation queries.

**Timing Telemetry**
- Introduced active timer tracking for Querying, Translating, and Rendering, displaying live timer clock counters on the status label.

---

## Version 1.1b - URL Syncing, Header Realignment, & Settings Spacing

- Fixed settings regression where toggling back to search view collapsed advanced rows, by restoring display property to 'flex' instead of 'block'.
- Restructured main header HTML containers to correctly align the central search bar and the far-right controls.
- Added URL Sync Persistence toggle switch to persist query and filter states.
- Cleaned up the details drawer button layout, moving Anna's Archive links to the top header metadata and adding primary redirects to the footer.

---

## Version 1.1 - Details Drawer & Some Translation Fixes

- Resolved a bug where books like "Sourcery" filtered to Polish books when added to the library by prioritizing English language properties.
- Resolved translated title issues by checking edition language data.
- Built an in-app details drawer overlay using parallel `/works` and `/books` requests to resolve synopses and canonical titles instantly.

---

## Version 1.0 - Autocomplete Tags & Filter Systems

- Integrated autocomplete tags with debounce timers.
- Added active tags manager to include/exclude subjects.
- Configured search filters for publication years, ratings, review count limits, and sorting strategies.
- Added responsive grids and list view modes.
