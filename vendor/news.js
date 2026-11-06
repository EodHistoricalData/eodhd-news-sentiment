// Decode HTML entities in API strings (e.g. &amp; → &, &quot; → ")
window.decodeHtmlEntities = (text) => {
  if (!text || typeof text !== 'string') return text;
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
};

// The related tickers worth showing on a news item. EODHD lists every
// listing it matched, in code order: "1GOOG.MI, ABE0.F, ABEA.F" came first
// and were the three shown, for a Google story. US listings
// first, then other home markets; regional German venues, Mexican, Buenos
// Aires, Santiago and Sao Paulo cross-listings and Milan's "1XXX" lines are
// left out when anything better is there. `focus` (the page's own symbol)
// goes first. Order within a rank is the API's.
// How old a headline is, under a day: everything younger than an hour read
// "Just now", a 25-minute-old story included. Minutes
// under the hour, "Just now" only under one. Null past a day or for a bad date.
window.NewsAge = (date, now) => {
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const n = now instanceof Date ? now.getTime() : (now == null ? Date.now() : new Date(now).getTime());
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  const mins = Math.floor((n - t) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h ago` : null;
};

window.NewsTickers = (function () {
  const SECONDARY = { F: 1, DU: 1, HA: 1, HM: 1, MU: 1, BE: 1, STU: 1, MX: 1, BA: 1, SN: 1, SA: 1, PVT: 1 };
  const rank = (sym) => {
    const parts = String(sym).toUpperCase().split('.');
    const ex = parts.length > 1 ? parts[parts.length - 1] : 'US';
    const code = parts[0];
    if (SECONDARY[ex] || (ex === 'MI' && /^\d/.test(code))) return 3;
    if (ex === 'INDX') return 2;
    return ex === 'US' ? 0 : 1;
  };
  // The feed files a currency pair and a government bond under .US: tags
  // read "EUR-USD.US" and "FR10Y.US", symbols that do not exist. They are put where they are listed.
  const FIAT = { USD: 1, EUR: 1, GBP: 1, JPY: 1, CHF: 1, CAD: 1, AUD: 1, NZD: 1, CNY: 1, CNH: 1, HKD: 1, SEK: 1, NOK: 1, DKK: 1, SGD: 1, INR: 1, KRW: 1, MXN: 1, BRL: 1, ZAR: 1, TRY: 1, PLN: 1, RUB: 1 };
  const fix = (sym) => {
    const m = /^([A-Z0-9]+)-([A-Z]{3})\.US$/.exec(sym);
    if (m && FIAT[m[2]]) return FIAT[m[1]] ? `${m[1]}${m[2]}.FOREX` : `${m[1]}-${m[2]}.CC`;
    if (/^[A-Z]{2}\d{1,2}Y\.US$/.test(sym)) return sym.replace(/\.US$/, '.GBOND');
    return sym;
  };
  function primary(symbols, max, focus) {
    const seen = new Set();
    const list = (Array.isArray(symbols) ? symbols : [])
      .map(s => fix(String(s || '').trim().toUpperCase()))
      .filter(s => s && !seen.has(s) && seen.add(s));
    const best = list.some(s => rank(s) < 3) ? list.filter(s => rank(s) < 3) : list;
    const f = focus ? String(focus).toUpperCase() : null;
    const sorted = best
      .map((s, i) => ({ s, i, r: s === f ? -1 : rank(s) }))
      .sort((a, b) => (a.r - b.r) || (a.i - b.i))
      .map(x => x.s);
    return max ? sorted.slice(0, max) : sorted;
  }
  return { primary, rank };
})();

// News Cache Manager
window.NewsCache = {
  CACHE_KEY: 'eodhd_news_cache',
  CACHE_DURATION: 5 * 60 * 1000,

  getCache() {
    try {
      const data = localStorage.getItem(this.CACHE_KEY);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  },

  saveCache(cache) {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  },

  getCategoryCache(category) {
    const cache = this.getCache();
    return cache[category] || null;
  },

  saveCategoryCache(category, items) {
    const cache = this.getCache();
    cache[category] = {
      items: items.slice(0, 100),
      lastFetch: Date.now(),
      newestDate: items.length > 0 ? items[0].date : null
    };
    this.saveCache(cache);
  },

  isCacheStale(category) {
    const categoryCache = this.getCategoryCache(category);
    if (!categoryCache) return true;
    return (Date.now() - categoryCache.lastFetch) > this.CACHE_DURATION;
  },

  mergeNews(cached, newItems) {
    if (!cached || cached.length === 0) return newItems;
    if (!newItems || newItems.length === 0) return cached;
    const existingLinks = new Set(cached.map(item => item.link));
    const uniqueNew = newItems.filter(item => !existingLinks.has(item.link));
    const merged = [...uniqueNew, ...cached];
    merged.sort((a, b) => new Date(b.date) - new Date(a.date));
    return merged.slice(0, 100);
  },

  clearCache() {
    localStorage.removeItem(this.CACHE_KEY);
  }
};


// News Feed Component - Concept 3 Glassmorphism
window.NewsView = ({ apiKey, onClose, onUpgradeClick, theme, activeTab, onTabChange, onSettingsClick, holdings }) => {
  // The prices of this screen's AI actions, from the server's list.
  const useFeatureCost = (() => null);
  const digestCost = useFeatureCost('news_digest');
  const [news, setNews] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  // After "Try again" the button leaves while the view loads, and focus fell
  // to <body>. When loading ends it goes back to a Try again that is there
  // again (still refused), else to the view's heading.
  const retryFocusRef = React.useRef(false);
  const retryHeadingRef = React.useRef(null);
  React.useEffect(() => {
    if (loading || !retryFocusRef.current) return;
    retryFocusRef.current = false;
    setTimeout(() => {
      const a = document.activeElement;
      if (a && a !== document.body && document.contains(a)) return;
      const back = document.querySelector('[data-retry-focus]');
      const target = back || retryHeadingRef.current;
      if (target) target.focus();
    }, 0);
  }, [loading]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState(null);
  // Inside a 429 wait Try again sends nothing and says so (RateLimitWait,
  // the same on every screen).
  // The button counts the wait down ("Try again in 12 s") and the line above
  // it names the limit; it said "Try again in a moment" with no number.
  const RLW = window.RateLimitWait;
  const rlWait = RLW.useWait();
  // The limit is named only when it is why the feed failed (a 500 stays
  // "did not answer"); the button counts any wait down.
  const newsLimited = RLW.useCause(error);

  const [category, setCategory] = React.useState(() => holdings && holdings.length > 0 ? 'watchlist' : 'general');
  const [newCount, setNewCount] = React.useState(0);
  const [analyzingIndex, setAnalyzingIndex] = React.useState(null);
  const [digestLoading, setDigestLoading] = React.useState(false);
  const [digestResult, setDigestResult] = React.useState(null);
  const [digestError, setDigestError] = React.useState(null);
  const [myDigestLoading, setMyDigestLoading] = React.useState(false);
  const [myDigestResult, setMyDigestResult] = React.useState(null);

  const C3 = window.C3;
  const isDark = theme === 'dark';
  // Not a live region: the note counts every second; the press was said
  // once when it was held, by RateLimitWait.
  const waitNoteEl = rlWait.note
    ? <p data-wait-note="true" style={{ margin: '12px 0 0', fontSize: 13, color: isDark ? C3.textDark : C3.textLightTheme }}>{rlWait.note}</p> : null;
  // A retry of a failed panel -- a press, or the reload after the wait --
  // takes the focus back where it was (the Try again if the failure is
  // back, else the heading) only when the focus was on that panel: the
  // refresh note's Try again went, and the focus fell to <body>
  // Focus somewhere else on the page is left alone.
  const keepRetryFocus = () => {
    const a = document.activeElement;
    if (a && a.closest && a.closest('[data-retry-focus], [data-rl-fail], [data-news-fail]')) retryFocusRef.current = true;
  };
  const isDemo = window.EODHD_API.isDemo(apiKey);
  const isWebPlatform = window.APP_PLATFORM === 'WEB';
  const effectiveIsDemo = isWebPlatform ? false : isDemo;
  const Cache = window.NewsCache;

  const Icon = ({ name, size = 24, color = 'currentColor' }) => {
    return React.createElement('svg', { 'aria-hidden': true, focusable: 'false',
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: color,
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  const categories = [
    { id: 'watchlist', name: 'My Watchlist', tag: null, isWatchlist: true },
    { id: 'general', name: 'All News', tag: null },
    { id: 'tech', name: 'Tech', tag: 'technology' },
    { id: 'crypto', name: 'Crypto', tag: 'crypto' },
    { id: 'finance', name: 'Finance', tag: 'finance' },
    { id: 'forex', name: 'Forex', tag: 'forex' },
    { id: 'energy', name: 'Energy', tag: 'energy' },
    { id: 'healthcare', name: 'Healthcare', tag: 'healthcare' },
    // 'economy', not 'economic': measured 2026-09-30, t=economic's newest
    // article was 2026-08-18 while t=economy had 2026-09-29.
    // technology / earnings are the right tags; they time out upstream and
    // are handled server-side (cache + timeout).
    { id: 'economy', name: 'Economy', tag: 'economy' },
    { id: 'earnings', name: 'Earnings', tag: 'earnings' },
    { id: 'ipo', name: 'IPO', tag: 'ipo' },
    { id: 'mergers', name: 'M&A', tag: 'mergers' }
  ];

  // The newest load owns the list. Tech clicked (a slow tag upstream), then
  // Crypto: Tech's headlines arrived last and filled the list under the
  // Crypto chip. Each load takes a number; an answer for
  // an older one is dropped.
  const loadSeqRef = React.useRef(0);
  // An older load of the same feed still counts: Try again while the first
  // request hung, the retry failing, dropped the first answer when it came.
  // Its headlines are merged in; a failure never
  // clears headlines that did arrive.
  const servedRef = React.useRef(null);
  // A refused or failed request is not "no news" (drew "No
  // news available" under a panel saying nothing was served).
  const NOT_SERVED = 'The news feed did not answer, so nothing is listed — that is not the same as no news. Try again in a moment.';
  const NOT_SERVED_LIMIT = 'The news feed did not load: ' + window.RateLimitWait.REACHED + ' Nothing is listed — that is not the same as no news.';
  // What did come back, when something did: EODHD's error (500), a refusal,
  // an answer that could not be read. "Did not answer" for a 500 dropped
  // the status the client had.
  const [errorFail, setErrorFail] = React.useState(null);
  // A failure that was the limit stays the limit when the wait is over: the
  // line turned into "did not answer" on the second the wait ended, and was
  // announced, so the end of a pause was said twice.
  const notServedText = (f) => (f && f.limited ? NOT_SERVED_LIMIT
    : f && (f.status || f.unreadable)
      ? 'The news feed did not load: ' + window.RateLimitWait.failReason(f) + ' Nothing is listed — that is not the same as no news.'
      : NOT_SERVED);
  // The host's own panel is already explaining a refusal (the open apps'
  // frame; the terminal has none, so this stays false there). The line above
  // is silenced in that case and the feed stood blank under its chips.
  const [refused, setRefused] = React.useState(false);
  // A load that failed while headlines were on screen: they stay, and this
  // says beside them that the refresh did not load, and why
  // (RateLimitWait.failure). It returned without a word,
  // where Sentiment says it.
  const [refreshFail, setRefreshFail] = React.useState(null);

  const loadNews = async (forceRefresh = false) => {
    const startedAt = Date.now();
    const seq = ++loadSeqRef.current;
    const current = () => seq === loadSeqRef.current;
    const feedKey = `${category}|${apiKey || ''}`;
    // The same feed is still on screen (the chip and key unchanged).
    const sameFeed = () => current() || (feedKeyRef.current === feedKey);
    loadingNowRef.current = true;
    setError(null);
    setRefused(false);
    setNewCount(0);
    if (forceRefresh) setRefreshFail(null);

    const cached = Cache.getCategoryCache(category);

    if (cached && cached.items && !forceRefresh) {
      setNews(cached.items);
      setLoading(false);
      if (!Cache.isCacheStale(category)) return;
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const selectedCategory = categories.find(c => c.id === category);

      let newsData = [];

      if (selectedCategory?.isWatchlist) {
        // Fetch news for each watchlist ticker individually (API doesn't support comma-separated s param)
        const tickers = (holdings || []).map(h => h.symbol).filter(Boolean).slice(0, 8);
        if (tickers.length === 0) {
          setNews([]);
          setLoading(false);
          setRefreshing(false);
          return;
        }
        let firstErr = null;
        const results = await Promise.all(
          tickers.map(ticker =>
            // Full CODE.EXCHANGE — s=AIR is AAR Corp, s=AIR.PA is Airbus.
            // An answer that is not a list could not be read, as on the
            // main feed.
            window.EODHD_API.getNews(apiKey, ticker, 5, { throwErrors: true })
              .then((d) => (d == null || Array.isArray(d) ? d : Promise.reject(Object.assign(new Error(NOT_SERVED), { unreadable: true, status: 200 }))))
              .catch((e) => { firstErr = firstErr || e; return null; })
          )
        );
        if (!sameFeed()) return;
        // Every ticker refused or failed: nothing was served. The first
        // refusal's status goes with it, so the reason can be named.
        if (results.every(x => !Array.isArray(x))) {
          const e = new Error(NOT_SERVED);
          if (firstErr) { e.status = firstErr.status; e.upstreamStatus = firstErr.upstreamStatus; e.rateLimited = firstErr.rateLimited; e.unreadable = firstErr.unreadable; }
          throw e;
        }
        const allNews = results.filter(Array.isArray).flat().filter(Boolean);
        newsData = (Array.isArray(allNews) ? allNews : [])
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        // Deduplicate by link
        const seen = new Set();
        newsData = newsData.filter(n => {
          if (seen.has(n.link)) return false;
          seen.add(n.link);
          return true;
        });
      } else {
        const opts = {};
        if (selectedCategory?.tag) opts.t = selectedCategory.tag;
        const data = await window.EODHD_API.getNews(apiKey, null, 50, { ...opts, throwErrors: true });
        if (!sameFeed()) return;
        // An answer that is not a list could not be read: said as that, not
        // as no answer.
        if (!Array.isArray(data)) throw Object.assign(new Error(NOT_SERVED), data == null ? {} : { unreadable: true });
        newsData = data;
        newsData = newsData.sort((a, b) => new Date(b.date) - new Date(a.date));
      }

      // Merged into what is held now: a newer load may have saved since.
      // Read now, not at the start: an older request may have saved since.
      const held = Cache.getCategoryCache(category) || cached;
      const cachedItems = held?.items || [];
      const mergedNews = Cache.mergeNews(cachedItems, newsData);

      const newItems = mergedNews.length - cachedItems.length;
      if (current() && newItems > 0 && cachedItems.length > 0) setNewCount(newItems);

      if (mergedNews.length > 0) Cache.saveCategoryCache(category, mergedNews);
      setNews(mergedNews);
      setRefreshFail(null);
      servedRef.current = feedKey;
      if (!current()) {
        // An older request answered after a newer one failed: the failure
        // message goes, the newer load keeps its own loading state.
        setError(null);
        setRefused(false);
        return;
      }
    } catch (err) {
      if (!current()) return;
      // Headlines kept on screen: the failure is said next to them.
      const keptFail = RLW.failure(err && err.message === NOT_SERVED && !err.status && !err.unreadable ? null : err);
      // Headlines for this feed already came back (an older request): kept.
      if (servedRef.current === feedKey) { setRefreshFail(keptFail); loadingNowRef.current = false; setLoading(false); setRefreshing(false); return; }
      // What is on screen stays (cached headlines); with nothing to show, say
      // the feed did not answer rather than that there is no news.
      if (cached && cached.items && cached.items.length) setRefreshFail(keptFail);
      if (!(cached && cached.items && cached.items.length)) {
        setNews(null);
        setRefused(Boolean(window.Entitlement && window.Entitlement.explained && window.Entitlement.explained()));
        setErrorFail(keptFail);
        if (!(window.Entitlement && window.Entitlement.explained())) setError(NOT_SERVED);
        // The network came back while this request was still failing: the
        // 'online' event has passed, so the retry is here,
        // through the same single reload as the event's.
        if (onlineAtRef.current > startedAt) setTimeout(() => { if (current()) reconnectRef.current(); }, 0);
      }
    }

    if (!current()) return;
    loadingNowRef.current = false;
    setLoading(false);
    setRefreshing(false);
  };

  // The feed on screen now, for an older load's late answer to check.
  const feedKeyRef = React.useRef('');
  feedKeyRef.current = `${category}|${apiKey || ''}`;
  React.useEffect(() => {
    servedRef.current = null;
    const cached = Cache.getCategoryCache(category);
    if (cached?.items) {
      setNews(cached.items);
      setLoading(false);
    }
    loadNews();
  }, [category, apiKey]);

  // Back online after a failed load: load again, as the asset card does. It
  // stayed on "did not answer" until Try again.
  const errorRef = React.useRef(null);
  const onlineAtRef = React.useRef(0);
  const loadingNowRef = React.useRef(false);
  errorRef.current = error;
  const loadNewsRef = React.useRef(loadNews);
  loadNewsRef.current = loadNews;
  // One reload per reconnect: a flapping link fired 'online' six times in a
  // second and each started the whole screen again, nine requests apiece.
  // The events are gathered for a moment; none
  // starts while a load is running (that one retries itself if it fails
  // after the network came back). The reload replaced the focused Try again
  // and the focus fell to <body>: it goes where a pressed Try again's
  // does.
  const RECONNECT_GATHER_MS = 400;
  const reconnectTimerRef = React.useRef(null);
  const reconnect = () => {
    clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (loadingNowRef.current) return;
      // Without a failure on screen it is the usual load: the cache, asked
      // again only when stale.
      if (!errorRef.current) { loadNewsRef.current(false); return; }
      const a = document.activeElement;
      if (a && a.closest && a.closest('[data-retry-focus]')) retryFocusRef.current = true;
      loadNewsRef.current(true);
    }, RECONNECT_GATHER_MS);
  };
  const reconnectRef = React.useRef(reconnect);
  reconnectRef.current = reconnect;
  React.useEffect(() => {
    const up = () => { onlineAtRef.current = Date.now(); reconnectRef.current(); };
    window.addEventListener('online', up);
    return () => { window.removeEventListener('online', up); clearTimeout(reconnectTimerRef.current); };
  }, []);

  const formatDate = (dateStr) => {
    // A day with no time is that day; only a timestamp is "N min ago".
    if (window.CalendarDate.isDateOnly(dateStr)) return window.CalendarDate.format(dateStr, { month: 'short', day: 'numeric', year: 'numeric' });
    const date = new Date(dateStr);
    const now = new Date();
    const rel = window.NewsAge(date, now);
    if (rel) return rel;
    const diffHours = Math.floor((now - date) / (1000 * 60 * 60));
    if (diffHours < 48) return 'Yesterday';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <window.AppLayout activeTab={activeTab} onTabChange={onTabChange} onSettingsClick={onSettingsClick} theme={theme}>
      {/* Keyframes travel with the view (hosts without the global CSS). */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 50% { opacity: 0.4; } }`}</style>
      {/* Header */}
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h1 ref={retryHeadingRef} tabIndex={-1} style={{ fontSize: '20px', fontWeight: '700', margin: 0 }}>Market News</h1>
            {window.HelpTooltip && <HelpTooltip title="Market News" text="Latest financial news and market updates aggregated from trusted sources. Filter by topic or search for specific companies." isDark={isDark} />}
          </div>
          <p style={{ fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight, margin: 0 }}>Latest financial news</p>
        </div>
        {/* aria-disabled, not disabled: a disabled button drops the focus,
            and Refresh left it on <body> while the news reloaded.
            The click is ignored while busy. */}
        <button onClick={() => { if (!loading && !refreshing) loadNews(true); }} aria-disabled={loading || refreshing ? 'true' : undefined} aria-busy={refreshing ? 'true' : undefined} aria-label="Refresh news" style={{
          width: '40px', height: '40px', borderRadius: '12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
          border: 'none', cursor: 'pointer', color: isDark ? C3.textDark : C3.textLightTheme,
          opacity: (loading || refreshing) ? 0.5 : 1, position: 'relative',
        }}>
          <Icon name="refresh" size={20} />
          {refreshing && (
            <span style={{
              position: 'absolute', top: '-4px', right: '-4px',
              width: '8px', height: '8px', borderRadius: '50%',
              background: C3.glowOrange, animation: 'pulse 1s infinite'
            }} />
          )}
        </button>
      </div>

      <div style={{ padding: '0 20px' }}>
          <>
            {/* New items notification */}
            {newCount > 0 && (
              <div style={{
                ...(isDark ? C3.glassDark : C3.glassLight),
                borderRadius: '12px', padding: '12px 16px', marginBottom: '16px',
                display: 'flex', alignItems: 'center', gap: '8px',
                border: `1px solid ${C3.success}30`,
              }}>
                <span style={{ color: C3.success, fontSize: '14px', fontWeight: '600' }}>
                  +{newCount} new {newCount === 1 ? 'article' : 'articles'}
                </span>
                <button aria-label="Dismiss" onClick={() => setNewCount(0)} style={{
                  marginLeft: 'auto', background: 'transparent', border: 'none',
                  color: isDark ? C3.textMutedDark : C3.textMutedLight, cursor: 'pointer',
                }}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            )}

            {/* Category Tabs */}
            {/* "My Watchlist" is the news of the tickers in `holdings`. A host
                that passes no such prop has no watchlist to show: the tab
                read "No news available" for ever and asked for nothing. An
                empty list is still a watchlist (the terminal always passes
                one) and keeps the tab.
                Web: underlined text tabs, the open one marked with
                aria-pressed (the terminal's stylesheet .mi-tabbar, design stage 2). */}
            {window.APP_PLATFORM === 'WEB' ? (
              <div className="mi-tabbar" role="group" aria-label="News categories" style={{ marginBottom: 16 }}>
                {categories.filter(cat => !cat.isWatchlist || holdings !== undefined).map(cat => (
                  <button key={cat.id} type="button" className="mi-tab" aria-pressed={category === cat.id} onClick={() => { setCategory(cat.id); setDigestResult(null); setDigestError(null); }}>
                    {cat.name}
                  </button>
                ))}
              </div>
            ) : (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
              {categories.filter(cat => !cat.isWatchlist || holdings !== undefined).map(cat => (
                <button key={cat.id} onClick={() => { setCategory(cat.id); setDigestResult(null); setDigestError(null); }} style={{
                  padding: '8px 16px', borderRadius: '100px', fontSize: '13px', fontWeight: '600',
                  whiteSpace: 'nowrap', cursor: 'pointer', border: 'none',
                  background: category === cat.id ? C3.logoGradient : (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'),
                  color: category === cat.id ? 'white' : (isDark ? C3.textDark : C3.textLightTheme),
                }}>
                  {cat.name}
                </button>
              ))}
            </div>
            )}

            {/* Hot News Digest */}
            {(() => {
              if (!news || news.length === 0) return null;
              if (!window.AIService.getSettings().enabled) return null;

              const runDigest = async () => {
                if (digestLoading) return;
                setDigestLoading(true);
                setDigestError(null);
                setDigestResult(null);
                window.Haptics?.medium();
                try {
                  const result = await window.AIService.digestNews(news);
                  setDigestResult(result);
                } catch (e) {
                  setDigestError(window.AIText ? window.AIText.error(e) : e.message);
                }
                setDigestLoading(false);
              };

              return (
                <div style={{ marginBottom: 16 }}>
                  {!digestResult && !digestLoading && !digestError && (
                    <button onClick={runDigest} style={{
                      width: '100%', padding: '14px 16px', borderRadius: 16, border: 'none', cursor: 'pointer',
                      background: C3.logoGradient,
                      color: 'white', fontSize: 15, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}>
                      <span>Summarize today's news</span>
                      {digestCost && <span style={{ fontSize: 11, fontWeight: 400 }}>{`· ${digestCost}`}</span>}
                    </button>
                  )}

                  {digestLoading && (
                    <div style={{
                      ...(isDark ? C3.glassDark : C3.glassLight),
                      borderRadius: 16, padding: 20, textAlign: 'center',
                      border: '1px solid rgba(249,115,22,0.3)',
                    }}>
                      <div style={{
                        width: 24, height: 24, margin: '0 auto 12px',
                        border: '3px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), borderTopColor: '#f97316',
                        borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                      }} />
                      <p style={{ fontSize: 13, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                        Analyzing {Math.min(news.length, 30)} articles...
                      </p>
                    </div>
                  )}

                  {digestError && (
                    <div style={{
                      ...(isDark ? C3.glassDark : C3.glassLight),
                      borderRadius: 16, padding: 16,
                      border: `1px solid ${C3.error}30`,
                    }}>
                      <div style={{ fontSize: 13, color: C3.error, marginBottom: 8 }}>{digestError}</div>
                      <button onClick={runDigest} style={{
                        background: 'none', border: 'none', color: C3.glowOrange,
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}>Try Again</button>
                    </div>
                  )}

                  {digestResult && (
                    <div style={{
                      ...(isDark ? C3.glassDark : C3.glassLight),
                      borderRadius: 16, padding: 16,
                      border: '1px solid rgba(249,115,22,0.2)',
                      background: isDark ? 'rgba(249,115,22,0.05)' : 'rgba(249,115,22,0.03)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {React.createElement(Icon, { name: 'zap', size: 16 })}
                          <span style={{ fontSize: 14, fontWeight: 700, color: (window.A11yColor ? window.A11yColor.text('#f97316', (typeof isDark !== 'undefined' && isDark)) : '#f97316') }}>Hot News Digest</span>
                        </div>
                        <button aria-label="Close digest" onClick={() => { setDigestResult(null); setDigestError(null); }} style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                          color: isDark ? C3.textMutedDark : C3.textMutedLight,
                        }}>✕</button>
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.6, color: isDark ? C3.textDark : C3.textLightTheme }}>
                        {window.renderMarkdown ? window.renderMarkdown(digestResult) : digestResult}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* My Personalized Digest — based on holdings */}
            {(() => {
              if (!news || news.length === 0 || !holdings || holdings.length === 0) return null;
              if (myDigestResult) {
                return (
                  <div style={{ marginBottom: 16 }}>
                    <window.AIResultCard
                      content={myDigestResult}
                      title="My Portfolio Digest"
                      isDark={isDark}
                      onDismiss={() => setMyDigestResult(null)}
                    />
                  </div>
                );
              }
              if (myDigestLoading) {
                return (
                  <div style={{
                    ...(isDark ? C3.glassDark : C3.glassLight),
                    borderRadius: 16, padding: 20, textAlign: 'center', marginBottom: 16,
                  }}>
                    <div style={{
                      width: 24, height: 24, margin: '0 auto 12px',
                      border: '3px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), borderTopColor: isDark ? C3.textMutedDark : C3.textMutedLight,
                      borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                    }} />
                    <p style={{ fontSize: 13, opacity: 0.7 }}>Creating your personalized digest...</p>
                  </div>
                );
              }
              return (
                <div style={{ marginBottom: 16 }}>
                  {window.AIFeatureButton && (
                    <window.AIFeatureButton
                      label="My Digest"
                      feature="news_digest"
                      icon={null}
                      isDark={isDark}
                      loading={myDigestLoading}
                      // Secondary to the news summary above: neutral, so the
                      // screen keeps one orange action (design stage 1).
                      style={{ width: '100%', justifyContent: 'center', ...(myDigestLoading ? {} : { background: 'transparent', border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`, color: isDark ? C3.textDark : C3.textLightTheme }) }}
                      onClick={async () => {
                        setMyDigestLoading(true);
                        try {
                          const result = await window.AIService.getPersonalizedDigest(holdings, news);
                          setMyDigestResult(result);
                        } catch (e) {
                          if (e.message !== 'AI_TOKENS_REQUIRED') {
                            setDigestError(window.AIText ? window.AIText.error(e) : e.message);
                          }
                        }
                        setMyDigestLoading(false);
                      }}
                    />
                  )}
                </div>
              );
            })()}

            {/* Loading */}
            {loading && (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <div style={{
                  width: '32px', height: '32px',
                  border: '3px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'), borderTopColor: C3.glowOrange,
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
                }} />
                <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>Loading news...</p>
              </div>
            )}

            {/* Error */}
            {error && !loading && (
              <div data-news-fail="true" style={{ textAlign: 'center', padding: '48px 0' }}>
                <Icon name="alert" size={64} color={isDark ? C3.textMutedDark : C3.textMutedLight} />
                {/* Read out when it appears, as the other screens' failures
                    are. */}
                <p role="status" style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginTop: '16px' }}>{error === NOT_SERVED ? (newsLimited ? NOT_SERVED_LIMIT : notServedText(errorFail)) : error}</p>
                <RLW.RetryButton wait={rlWait} isDark={isDark} data-retry-focus="true" onClick={() => { retryFocusRef.current = true; loadNews(); }} style={{
                  marginTop: '16px', color: C3.glowOrange, background: 'transparent',
                  border: 'none', cursor: 'pointer', fontWeight: '600',
                }} />
                {waitNoteEl}
              </div>
            )}

            {refused && !loading && !(news && news.length) && (
              <div data-news-fail="true" style={{ textAlign: 'center', padding: '32px 20px' }}>
                {/* The words are the live region; the button counts the wait
                    every second and stays outside it. */}
                <p role="status" style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '16px' }}>
                  Nothing below is missing data — the request was not served. See the panel above.
                </p>
                <RLW.RetryButton wait={rlWait} isDark={isDark} data-retry-focus="true" onClick={() => { retryFocusRef.current = true; loadNews(true); }} style={{
                  padding: '12px 24px', background: C3.logoGradient, border: 'none',
                  borderRadius: '12px', color: 'white', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                }} />
                {waitNoteEl}
              </div>
            )}

            {/* A refresh that failed: the headlines stay, and this says why,
                with Try again (counting the limit's wait down; at the limit
                the feed is asked again by itself once the wait is over). */}
            {refreshFail && !loading && !error && news && news.length > 0 && (
              <RLW.FailNote panel="news-refresh" failure={refreshFail} ownFocus data-retry-focus="true" onRetry={() => { keepRetryFocus(); loadNews(true); }} isDark={isDark}
                text={'The refresh did not load: ' + RLW.failReason(refreshFail)} extra="The headlines shown are the last ones loaded."
                style={{ fontSize: 13, margin: '0 0 12px' }} />
            )}

            {/* News List */}
            {!loading && !error && news && (
              <div>
                {news.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 0' }}>
                    <p style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight }}>No news available</p>
                  </div>
                ) : (
                  <>
                    {(effectiveIsDemo ? news.slice(0, 5) : news).map((item, i) => {
                      return (
                        <div key={i} style={{
                          ...(isDark ? C3.glassDark : C3.glassLight),
                          borderRadius: '16px', padding: '14px', marginBottom: '12px',
                        }}>
                          <a href={item.link} target="_blank" rel="noopener noreferrer" onClick={() => { if (window.MIAnalytics) window.MIAnalytics.track('dl_mi_news_article_open', { source: item.source || 'unknown' }); }} style={{
                            display: 'block', textDecoration: 'none', color: isDark ? C3.textDark : C3.textLightTheme,
                          }}>
                            <div style={{ display: 'flex', gap: '14px' }}>
                              {item.image && (
                                <div style={{
                                  width: '80px', height: '80px', flexShrink: 0,
                                  borderRadius: '12px', overflow: 'hidden',
                                  background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                                }}>
                                  <img src={item.image} alt="" style={{
                                    width: '100%', height: '100%', objectFit: 'cover',
                                  }} onError={(e) => e.target.style.display = 'none'} />
                                </div>
                              )}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <h3 style={{
                                  fontWeight: '600', fontSize: '14px', marginBottom: '8px',
                                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}>{window.decodeHtmlEntities(item.title)}</h3>
                                {item.content && (
                                  <p style={{
                                    fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight,
                                    marginBottom: '8px', display: '-webkit-box', WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                  }}>{window.decodeHtmlEntities(item.content)}</p>
                                )}
                                {/* Wraps between its parts, never inside one: on a phone
                                    "17 min ago" broke over three lines. */}
                                <div style={{
                                  display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '8px', rowGap: '2px',
                                  fontSize: '12px', color: isDark ? C3.textMutedDark : C3.textMutedLight,
                                }}>
                                  <span>{item.source || 'News'}</span>
                                  <span aria-hidden="true">•</span>
                                  <span style={{ whiteSpace: 'nowrap' }}>{formatDate(item.date)}</span>
                                  {item.symbols && item.symbols.length > 0 && (() => {
                                    const tags = window.NewsTickers.primary(item.symbols);
                                    return (
                                      <>
                                        <span aria-hidden="true">•</span>
                                        {/* #f97316 on white read 2.8:1, 50 times a page. */}
                                        <span style={{ color: window.A11yColor ? window.A11yColor.text(C3.glowOrange, isDark) : C3.glowOrange }}>
                                          {tags.slice(0, 3).join(', ')}
                                          {tags.length > 3 && '...'}
                                        </span>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          </a>

                        </div>
                      );
                    })}

                    {/* Upgrade Banner - only for demo users (TG only) */}
                    {effectiveIsDemo && (
                      <div style={{
                        ...(isDark ? C3.glassDark : C3.glassLight),
                        borderRadius: '16px', padding: '20px', marginTop: '8px',
                        textAlign: 'center',
                        border: `1px solid ${isDark ? C3.lineDark : C3.lineLight}`,
                      }}>
                        <div style={{ fontSize: '24px', marginBottom: '8px' }}>{React.createElement(Icon, { name: 'rocket', size: 24 })}</div>
                        <h4 style={{ fontWeight: '700', fontSize: '16px', marginBottom: '8px', color: isDark ? C3.textDark : C3.textLightTheme }}>
                          See the full news feed
                        </h4>
                        <p style={{ fontSize: '13px', color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: '12px', lineHeight: '1.5' }}>
                          Upgrade for unlimited news, AI market analysis, sentiment detection and a personal digest
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '16px' }}>
                          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                            Unlimited News
                          </span>
                          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                            AI Analysis
                          </span>
                          <span style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', background: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
                            Sentiment Score
                          </span>
                        </div>
                        <button onClick={onUpgradeClick} style={{
                          padding: '12px 24px', background: C3.logoGradient, border: 'none',
                          borderRadius: '12px', color: 'white', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                        }}>
                          Upgrade Now
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
      </div>
    </window.AppLayout>
  );
};

