// utils.js — pure shared leaves. Zero imports: this module must stay a
// dependency leaf so every other module can import from it freely.
export const isScrollActive = () =>
    typeof document !== 'undefined' && !!document.body && document.body.classList.contains('is-scrolling');
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
export const escapeHTML = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => _escMap[tag]);
};
export const renderErrorHTML = (title, description, details = '') => {
    return `
        <div class="error-display-box">
            <div class="error-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <span>${escapeHTML(title)}</span>
            </div>
            <p class="error-desc">${escapeHTML(description)}</p>
            ${details ? `<div class="error-details">Original Error: ${escapeHTML(details)}</div>` : ''}
        </div>
    `;
};
export const cleanSubjects = (arr) => {
    if (!arr) return [];
    // Tolerate legacy/imported entries where subjects were saved as a plain
    // string instead of an array — a single malformed book must never be
    // able to crash the storage-boot chain (it used to blank the whole app).
    if (typeof arr === 'string') arr = arr.split(/\s*[,;\/]\s*|\s+-\s+/);
    if (!Array.isArray(arr)) return [];
    let res = [];
    const seen = new Set();
    arr.forEach(s => {
        const str = typeof s === 'string' ? s : (s && typeof s === 'object' && s.name ? String(s.name) : (s != null ? String(s) : ''));
        if (!str) return;
        str.split(/\s*[,;\/]\s*|\s+-\s+/).forEach(part => {
            const t = part.trim();
            if (t && !seen.has(t.toLowerCase())) {
                seen.add(t.toLowerCase());
                res.push(t);
            }
        });
    });
    return res;
};
export const ANNA_ARCHIVE_URL = 'https://annas-archive.gl';
export const API_BASE = 'https://openlibrary.org/search.json';
export const API_CONTACT_EMAIL = 'infinitestoragespaceheckyeah@gmail.com';
export const parseSafeInt = (v, defaultVal) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : defaultVal;
};
export const getCleanProxyBase = (proxy) => {
    if (!proxy) return '';
    let p = proxy.trim();
    if (!p) return '';
    if (!/^https?:\/\//i.test(p)) {
        p = `https://${p}`;
    }
    return p.replace(/\/+$/, '');
};
export const normalizeCacheKey = (rawUrl) => {
    try {
        const u = new URL(rawUrl.startsWith('http') ? rawUrl : `https://openlibrary.org${rawUrl}`);
        u.searchParams.delete('contact');
        u.searchParams.sort(); // Stable query sorting
        return `${u.pathname}?${u.searchParams.toString()}`;
    } catch (e) {
        return rawUrl;
    }
};
export const langMapToOL = {
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
export const langMapToAA = {};
for (const [k, v] of Object.entries(langMapToOL)) {
    if (!langMapToAA[v]) langMapToAA[v] = k;
}
export const LANGUAGE_ALIASES = {
    eng: ['eng', 'en'],
    fre: ['fre', 'fra', 'fr'],
    ger: ['ger', 'deu', 'de'],
    spa: ['spa', 'es'],
    ita: ['ita', 'it'],
    rus: ['rus', 'ru'],
    chi: ['chi', 'zho', 'zh'],
    jpn: ['jpn', 'ja'],
    por: ['por', 'pt'],
    hin: ['hin', 'hi'],
    ara: ['ara', 'ar'],
    dut: ['dut', 'nld', 'nl'],
    pol: ['pol', 'pl'],
    hun: ['hun', 'hu'],
    rum: ['rum', 'ron', 'ro'],
    cze: ['cze', 'ces', 'cs'],
    swe: ['swe', 'sv'],
    dan: ['dan', 'da'],
    kor: ['kor', 'ko'],
    ukr: ['ukr', 'uk'],
    gre: ['gre', 'ell', 'el'],
    tur: ['tur', 'tr'],
    heb: ['heb', 'he'],
    ind: ['ind', 'id'],
    ben: ['ben', 'bn'],
    tha: ['tha', 'th'],
    fin: ['fin', 'fi'],
    nor: ['nor', 'nob', 'nno', 'no'],
    cat: ['cat', 'ca'],
    bul: ['bul', 'bg'],
    lat: ['lat', 'la'],
    lit: ['lit', 'lt'],
    afr: ['afr', 'af'],
    hrv: ['hrv', 'hr'],
    srp: ['srp', 'sr'],
    gle: ['gle', 'ga'],
    lav: ['lav', 'lv'],
    per: ['per', 'fas', 'fa'],
    vie: ['vie', 'vi'],
    slo: ['slo', 'slk', 'sk'],
    kan: ['kan', 'kn'],
    tib: ['tib', 'bod', 'bo'],
    wel: ['wel', 'cym', 'cy'],
    jav: ['jav', 'jv'],
    urd: ['urd', 'ur'],
    yid: ['yid', 'yi'],
    arm: ['arm', 'hye', 'hy'],
    bel: ['bel', 'be'],
    kin: ['kin', 'rw'],
    tam: ['tam', 'ta'],
    kaz: ['kaz', 'kk'],
    slv: ['slv', 'sl'],
    mal: ['mal', 'ml'],
    mon: ['mon', 'mn'],
    geo: ['geo', 'kat', 'ka'],
    mar: ['mar', 'mr'],
    epo: ['epo', 'eo'],
    est: ['est', 'et'],
    tel: ['tel', 'te'],
    fil: ['fil', 'tl'],
    guj: ['guj', 'gu'],
    glg: ['glg', 'gl'],
    kir: ['kir', 'ky'],
    may: ['may', 'msa', 'ms'],
    aze: ['aze', 'az'],
    swa: ['swa', 'sw'],
    que: ['que', 'qu'],
    pan: ['pan', 'pa'],
    bak: ['bak', 'ba'],
    alb: ['alb', 'sqi', 'sq'],
    uzb: ['uzb', 'uz'],
    bos: ['bos', 'bs'],
    baq: ['baq', 'eus', 'eu'],
    bur: ['bur', 'mya', 'my'],
    amh: ['amh', 'am'],
    kur: ['kur', 'ku', 'ckb'],
    fry: ['fry', 'fy'],
    zul: ['zul', 'zu'],
    pus: ['pus', 'ps'],
    nep: ['nep', 'ne'],
    som: ['som', 'so'],
    uig: ['uig', 'ug'],
    orm: ['orm', 'om'],
    mac: ['mac', 'mkd', 'mk'],
    hat: ['hat', 'ht'],
    lao: ['lao', 'lo'],
    tat: ['tat', 'tt'],
    sin: ['sin', 'si'],
    tgk: ['tgk', 'tg'],
    sna: ['sna', 'sn'],
    sun: ['sun', 'su'],
    mlg: ['mlg', 'mg'],
    xho: ['xho', 'xh'],
    hau: ['hau', 'ha'],
    snd: ['snd', 'sd'],
    nya: ['nya', 'ny']
};
export const CANONICAL_LANG_MAP = new Map();
Object.entries(LANGUAGE_ALIASES).forEach(([canonical, aliases]) => {
    aliases.forEach(alias => CANONICAL_LANG_MAP.set(alias.toLowerCase(), canonical));
});
export const normalizeLanguageCode = (code) => {
    if (!code) return '';
    const clean = String(code).trim().toLowerCase().replace('/languages/', '');
    return CANONICAL_LANG_MAP.get(clean) || clean;
};
export const editionLangMatches = (code, targetLang) => {
    if (!code || !targetLang) return false;
    return normalizeLanguageCode(code) === normalizeLanguageCode(targetLang);
};
