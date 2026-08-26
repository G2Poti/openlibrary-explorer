# Open Library Catalog - Project Changelog & Revision History

## Version 1.7 - Compact Desktop Mode, Overlayed Sidebar, Instant Discover Caching, Progressive Physics & Clean Synopses (Current)

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
- **Clean Synopses & Library Subjects:** Added an intelligent synopsis sanitizer for book descriptions and a dedicated **Clean Subjects** option for My Library that automatically formats tags into clean title-case (preserving minor lowercase conjunctions).
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
