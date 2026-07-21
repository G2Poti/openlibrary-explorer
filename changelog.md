# Open Library Catalog - Project Changelog & Revision History

## Version 1.5 - UI Overhaul (Dashboard, Sidebar, Side-rail, Interactivity) & Server-Side Ratings (Current)

**Home Page Dashboard & UI Polish**
- Expanded the "Trending Books" selection with a doubled, more diverse dataset rather than just classics.
- Replaced section titles with two buttons, moved them up to the header to make efficient use of the UI's space.
- Perfected global box-model math to ensure book covers in grid views are exactly vertically flush with sidebar icons across all layouts.
- Updated the Home button to display a simple home icon, sized consistently across modes.

**Sidebar Collapse & Animation Refinements**
- Eliminated all jitter and "kick-back" during sidebar collapse animations by stripping conflicting margin transitions and anchoring the sidebar to a static internal bounding box.
- Added a new vertical icon rail (My Library, Add/Remove All, Filter, Sort) that surfaces cleanly when collapsing the sidebar, with synchronized fade-in/out animations on expand.
- Clicking the Filter or Sort icon in the collapsed rail now opens that section in a floating popover instead of expanding the whole sidebar. Popovers dismiss by clicking outside, pressing Escape, or clicking the icon again, and opening both Filter and Sort at once stacks them cleanly instead of letting them overlap.

**Legacy Layout Option**
- Added a new "Legacy Layout" toggle in Settings for anyone who prefers the original sidebar and header design.
- Off by default (new layout applies); switching it on restores the classic look.

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
