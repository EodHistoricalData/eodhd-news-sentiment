// Sentiment Module — Market Sentiment Analysis View
// Full-screen view with gauge, per-ticker sentiment, social buzz, and news breakdown

// Days by news tone, on EODHD's -1..1 scale. A +/-0.1 cut put every day of
// AAPL, MSFT and NVDA in "+" ("30+ 0- 0~"): large caps' daily tone runs
// 0.5-0.99, so the split said nothing (p.25). Four bands instead:
// strongly positive >= 0.7, positive 0.3-0.7, neutral -0.3..0.3, negative
// below -0.3 -- the same scale the 0-100 score maps to (0.7 = 85, 0.3 = 65).
window.SentimentDays = {
  bands(items) {
    const out = { strong: 0, positive: 0, neutral: 0, negative: 0 };
    (items || []).forEach((d) => {
      const n = Number(d && d.normalized);
      if (!Number.isFinite(n)) return;
      if (n >= 0.7) out.strong++;
      else if (n >= 0.3) out.positive++;
      else if (n > -0.3) out.neutral++;
      else out.negative++;
    });
    return out;
  },
};

// What each ticker's sentiment request returned, kept for ten minutes across
// tab switches. It lived in the view, which unmounts when News is opened, so
// every return to Sentiment asked for every ticker again -- three times a
// minute at five units a symbol, against twenty a day on the free plan.
// Keyed by API key, so a sign-in does not see another
// account's answers. Refresh asks again regardless.
window.SentimentCache = (function () {
  const TTL = 10 * 60 * 1000;
  let owner = null;
  let store = {};
  const forKey = (apiKey) => {
    if (owner !== (apiKey || '')) { owner = apiKey || ''; store = {}; }
    return store;
  };
  return {
    get(apiKey, ticker, now) {
      const hit = forKey(apiKey)[ticker];
      return hit && (now || Date.now()) - hit.at < TTL ? hit.items : undefined;
    },
    put(apiKey, ticker, items, now) { forKey(apiKey)[ticker] = { items, at: now || Date.now() }; },
    // EODHD has no such symbol (404): kept as nothing, and said on its card.
    putMissing(apiKey, ticker, now) { forKey(apiKey)[ticker] = { items: [], missing: true, at: now || Date.now() }; },
    missing(apiKey, ticker, now) {
      const hit = forKey(apiKey)[ticker];
      return Boolean(hit && hit.missing && (now || Date.now()) - hit.at < TTL);
    },
    clear() { store = {}; owner = null; },
    TTL,
  };
})();

// The sentiments endpoint answers a list with one 404 ("Symbol not found")
// when any of it is unknown: tickers=AAPL,MSFT,7203.TSE drew "no data" for
// all three. Such a list is asked again one symbol at a
// time, so the known ones are shown and the unknown one is marked. Only a
// 404 is split: a 429, a refusal or a dropped connection is about the key
// or the network, and asking N times would make it worse.
//   ask(list) -> the answer for the list, or a throw carrying its status
//   -> { data: { SYMBOL: [...] }, missing: [symbols EODHD does not know],
//        failed: [symbols whose own request failed otherwise] }
window.SentimentNotFound = (e) => Boolean(e && (Number(e.status) === 404 || Number(e.upstreamStatus) === 404));
window.SentimentAskSplit = async (list, ask) => {
  const unwrap = (raw) => ((raw && typeof raw === 'object' && !Array.isArray(raw) && raw.data && typeof raw.data === 'object') ? raw.data : raw);
  const into = (out, raw, one) => {
    const data = unwrap(raw);
    if (Array.isArray(data) && one) out[one] = data;
    else if (data && typeof data === 'object' && !Array.isArray(data)) Object.assign(out, data);
  };
  // An answer is readings keyed by symbol (or one symbol's list). Anything
  // else that came back with 200 -- {"message": ...}, a string -- could not
  // be read: it is a failure, never an empty reading. Read as "answered",
  // {"message"} wiped the readings on screen and put [] into the cache for
  // every ticker.
  const readable = (raw, one) => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.error) return true;
    const data = unwrap(raw);
    if (Array.isArray(data)) return Boolean(one);
    if (!data || typeof data !== 'object') return false;
    return Object.keys(data).every((k) => data[k] == null || Array.isArray(data[k]));
  };
  const notRead = () => {
    const RLW = window.RateLimitWait;
    if (RLW && RLW.unreadableError) return RLW.unreadableError('Unreadable response (sentiments)', 200);
    return Object.assign(new Error('Unreadable response (sentiments)'), { unreadable: true, status: 200 });
  };
  try {
    const raw = await ask(list);
    if (!readable(raw, list.length === 1 ? list[0] : null)) throw notRead();
    const out = {};
    into(out, raw, list.length === 1 ? list[0] : null);
    return { data: out, missing: [], answered: Boolean(unwrap(raw)) && typeof unwrap(raw) === 'object', error: raw && raw.error };
  } catch (e) {
    if (!window.SentimentNotFound(e)) throw e;
    if (list.length === 1) return { data: {}, missing: list.slice(), answered: true };
    const out = {};
    const missing = [];
    const failedList = [];
    let failed = null;
    const parts = await Promise.all(list.map((t) => Promise.resolve().then(() => ask([t])).then((raw) => ({ t, raw }), (err) => ({ t, err }))));
    parts.forEach((p) => {
      if (p.err) { if (window.SentimentNotFound(p.err)) missing.push(p.t); else { failed = failed || p.err; failedList.push(p.t); } return; }
      // An error envelope sent with 200 is a failure for that symbol: not
      // remembered as "no data".
      if (p.raw && typeof p.raw === 'object' && !Array.isArray(p.raw) && p.raw.error) { failed = failed || new Error(String(p.raw.error)); failedList.push(p.t); return; }
      if (!readable(p.raw, p.t)) { failed = failed || notRead(); failedList.push(p.t); return; }
      into(out, p.raw, p.t);
    });
    // Every one of them failed for another reason: that is the answer.
    if (failed && !Object.keys(out).length && !missing.length) throw failed;
    return { data: out, missing, answered: true, partial: Boolean(failed), failed: failedList, failure: failed };
  }
};

// A tracked ticker has to name something: ".." passed the old pattern and was
// asked for, then listed as "× no data".
// "&" and "_" are in real codes (M&M.NSE): the saved list dropped them.
// The shared reader decides: this page's own pattern kept
// "M&.NSE" and 21-character codes.
window.SentimentTickerOk = (t) => !!(window.SymbolCode && window.SymbolCode.of(t));

// A ticker named in a link, with its exchange; '' when it names nothing. A
// bare code was given .US whatever it was, so "tickers=EURUSD,BTC-EUR" asked
// for EURUSD.US and BTC-EUR.US and both read "no data".
// The rules are the one reader every screen uses: this
// page kept its own, which dropped "^GSPC.INDX" and "BRK.B" without a word
// and disagreed with What-If on SOL-NZD, USDXAU and ^GSPC.
window.SentimentLinkTicker = (raw) => window.SymbolCode.of(raw) || '';

// The name a tracked ticker is shown by: the code without its exchange,
// unless another tracked ticker has the same code. "tickers=SHOP.TO,shop"
// drew two "SHOP" cards with one aria-label, and Trending read "#1 SHOP /
// #2 SHOP".
window.SentimentTickerLabel = (ticker, all) => {
  const t = String(ticker || '');
  const code = (s) => String(s || '').replace(/\.[^.]*$/, '');
  const mine = code(t);
  const twin = (all || []).some((o) => o !== t && code(o) === mine);
  return twin ? t : mine;
};

// Why the ticker search failed, for what the field says and whether Enter
// asks again. "The ticker search did not answer.
// Press Enter to try again." stood next to "Not included in this plan",
// "Too many requests at once" and "EODHD did not accept the key", and every
// Enter sent another request, a 429 included.
//   'refused' -- the key or the plan (401, 402, 403): Enter will not help
//   'limited' -- the per-minute limit (429): wait, then ask
//   'timeout' -- no answer within the wait: Enter asks again
//   'down'    -- a 5xx, a dropped connection: Enter asks again
window.SentimentSearchFailure = (e) => {
  if (!e) return 'down';
  if (e.timedOut) return 'timeout';
  const upstream = Number(e.upstreamStatus || (e.planRequired && e.planRequired.upstream_status)) || 0;
  const own = Number(e.status || e.statusCode) || 0;
  const status = upstream === 401 || upstream === 402 || upstream === 403 || upstream === 429 ? upstream : own;
  if (e.rateLimited || status === 429) return 'limited';
  if (e.planRequired || e.authRequired || e.keyInvalid || status === 401 || status === 402 || status === 403) return 'refused';
  return 'down';
};
// How long the field waits for the search before it says so, and how long a
// 429 keeps the next search from being sent. A hung search showed
// "Searching..." for 25 s and Enter did nothing.
// ANSWER_MS sits under the open apps' own 10 s search deadline
// (shell/api.js), so a hang is told as a hang there too, not as no answer.
window.SentimentSearchWait = { ANSWER_MS: 9000, LIMIT_MS: 60000 };

// The line under the gauge counts the tickers the reading is made of: it said
// "Aggregated from 2 tracked tickers" with data for one, and "0 tracked
// tickers" with none tracked.
// `status` ({ failed, unknown }: tickers) names the ones that did not load
// and the ones EODHD does not know: "(no data for the rest)" read as an
// answer for a symbol whose request had failed.
window.SentimentAggregateLine = (tracked, data, score, status) => {
  const n = (tracked || []).length;
  const word = (k) => `${k} tracked ticker${k === 1 ? '' : 's'}`;
  if (!n) return 'No tracked tickers — add one below';
  if (score == null) return word(n);
  const used = tracked.filter((t) => ((data || {})[t] || []).length > 0).length;
  if (used === n) return `Aggregated from ${word(n)}, weighted by mentions`;
  const mine = (list) => (list || []).filter((t) => tracked.indexOf(t) !== -1 && !((data || {})[t] || []).length);
  const names = (list) => list.map((t) => window.SentimentTickerLabel(t, tracked)).join(', ');
  const failed = mine(status && status.failed);
  const unknown = mine(status && status.unknown).filter((t) => failed.indexOf(t) === -1);
  if (!failed.length && !unknown.length) return `Aggregated from ${used} of ${word(n)} (no data for the rest), weighted by mentions`;
  const notes = [];
  if (failed.length) notes.push(`${names(failed)} did not load`);
  if (unknown.length) notes.push(`not found on EODHD: ${names(unknown)}`);
  if (n - used - failed.length - unknown.length > 0) notes.push('no data for the rest');
  return `Aggregated from ${used} of ${word(n)}, weighted by mentions (${notes.join('; ')})`;
};

// What a Refresh that failed says next to the readings it kept: it did not load, why, and that what is shown is the last
// reading. `why`: { limited } (the limit caused it), { refusedAbove } (the
// open apps' panel says why), { unreadable } (an answer came back that could
// not be read: not "did not answer", as News and the screener say it).
window.SentimentStaleNote = (stale, tracked, why) => {
  const w = why || {};
  const all = (stale || []).length >= (tracked || []).length;
  const names = (stale || []).map((t) => window.SentimentTickerLabel(t, tracked)).join(', ');
  const head = all ? 'The refresh did not load' : `The refresh did not load for ${names}`;
  const reason = w.refusedAbove ? ' — see the panel above.'
    : w.limited ? ': ' + ((window.RateLimitWait && window.RateLimitWait.REACHED) || "EODHD's per-minute request limit was reached.")
      : w.unreadable ? ': ' + ((window.RateLimitWait && window.RateLimitWait.UNREADABLE) || 'EODHD sent a response the app could not read.')
        : ' — EODHD did not answer, or the connection dropped.';
  return head + reason + (all ? ' The readings shown are the last ones loaded.' : ' Their readings shown are the last ones loaded.');
};

// What an empty gauge or mention list says. With no ticker tracked nothing was
// asked, so "nothing came back for the tracked tickers" was untrue next to
// "No tracked tickers — add one below": it says nothing,
// and the line under the gauge asks for a ticker.
// `status` ({ failed, unknown }: counts): a failed request is "did not
// load", every ticker unknown is said so -- both read "nothing came back".
// `status.unreadable`: what came back could not
// be read, and the line says so (it said "did not load" with no reason).
window.SentimentEmptyNote = (kind, trackedCount, refused, notServed, status) => {
  if (refused) return notServed;
  if (!trackedCount) return null;
  const head = kind === 'buzz' ? 'No mention counts' : 'No sentiment reading';
  if (status && status.failed > 0 && status.unreadable) return `${head} — the request for the tracked tickers did not load: ${(window.RateLimitWait && window.RateLimitWait.UNREADABLE) || 'EODHD sent a response the app could not read.'}`;
  if (status && status.failed > 0) return `${head} — the request for the tracked tickers did not load.`;
  if (status && status.unknown >= trackedCount) return `${head} — EODHD does not know any of the tracked tickers.`;
  return kind === 'buzz'
    ? 'No mention counts — nothing came back for the tracked tickers.'
    : 'No sentiment reading — nothing came back for the tracked tickers.';
};

window.SentimentView = ({ apiKey, theme, onClose, onSelectAsset, activeTab, onTabChange, onSettingsClick }) => {
  const C3 = window.C3;
  const isDark = theme === 'dark';
  const isDemo = window.EODHD_API.isDemo(apiKey);

  // --- State ---
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
  const [error, setError] = React.useState(null);
  // The tracked list belongs in the URL: saved preferences bring your own list
  // back, but a link is what lets you hand somebody the same set of symbols.
  // A link that names symbols wins over the saved list, because it was chosen
  // by whoever opened it.
  //
  // Read in the initialiser, before the first load. It was applied in an
  // effect after it, so opening `#?tickers=ZZZZNOPE.US,TSLA.US` asked for the
  // saved three as well (15 wasted units), and when that answer came back
  // last the gauge showed their score under the linked tickers.
  // The link's tickers, read the same way on arrival and when a link is
  // followed inside the open page (hashchange, Back/Forward): it was read
  // only on arrival, so "#/sentiment?tickers=EURUSD,BTC-EUR" followed from
  // an open Sentiment page changed the address and nothing else. { list, skipped }: what it names, and the parts that name no
  // ticker, said rather than dropped in silence.
  const readLinkTickers = () => {
    const st = window.ViewState ? window.ViewState.read('sentiment') : {};
    const SC = window.SymbolCode;
    // Invisible characters a copied link brings are not part of a code.
    const parts = String((st && st.tickers) || '').split(',').map(function (t) { return SC && SC.strip ? SC.strip(t) : t; }).filter(function (t) { return t.trim(); });
    const skipped = [];
    // Codes on a market EODHD does not list: "d05.si" became D05.SG and,
    // after a reload, D05.STU -- Stuttgart. Said, not
    // added, and not rewritten into another listing.
    const none = [];
    const list = parts
      // A bare code gets its exchange: "AAPL" was asked as typed and came
      // back under AAPL.US, so both rows said "no data"; and
      // "aapl,TSLA,tsla,TSLA.US" made three TSLA rows. Currency and crypto pairs too (window.SentimentLinkTicker).
      .map(function (t) {
        const s = window.SentimentLinkTicker(t);
        if (s && SC && SC.unlisted && SC.unlisted(s)) { if (none.indexOf(s) === -1) none.push(s); return ''; }
        if (!s) skipped.push(t.trim().slice(0, 24));
        return s;
      })
      .filter(function (t, i, all) { return t && all.indexOf(t) === i; })
      // A sentiment request is metered per symbol; a link is not allowed to
      // spend somebody's whole daily quota on arrival.
      .slice(0, 8);
    return { list, skipped, none };
  };
  const linkSkipNote = (got) => {
    const skipped = (got && got.skipped) || [];
    const none = (got && got.none) || [];
    const said = [];
    if (none.length) said.push('No listing found for ' + none.join(', ') + '.');
    if (skipped.length) said.push('Not a ticker, left out of the link: ' + skipped.map(function (t) { return '"' + t + '"'; }).join(', ') + '.');
    return said.length ? said.join(' ') : null;
  };
  const bootLinkRef = React.useRef(null);
  // The saved list, through window.SavedStore: blocked or
  // full storage threw out of the render, "This view stopped drawing".
  // Null when nothing usable is stored.
  const SAVED_KEY = 'eodhd_sentiment_tickers';
  // Kept as stored -- never read again into another listing -- without the
  // invisible characters a pasted code may have brought.
  const unseen = (t) => (window.SymbolCode && window.SymbolCode.strip ? window.SymbolCode.strip(t).trim() : t);
  const validTickers = (v) => (Array.isArray(v) ? v.filter(t => typeof t === 'string').map(unseen).filter(t => window.SentimentTickerOk(t.toUpperCase())) : null);
  const readSavedTickers = () => validTickers(window.SavedStore ? window.SavedStore.read(SAVED_KEY, null) : null);
  // A save that did not keep, said under + Add.
  const [storeNote, setStoreNote] = React.useState(null);
  // The list a change starts from: the stored one, which another tab may
  // have changed -- unless this tab's last write did not keep, when the
  // stored one is older than what is on screen.
  const storeKeptRef = React.useRef(true);
  const baseTickers = (prev) => (storeKeptRef.current ? readSavedTickers() : null) || prev;
  const [trackedTickers, setTrackedTickers] = React.useState(() => {
    try {
      const got = readLinkTickers();
      bootLinkRef.current = got;
      if (got.list.length) return got.list;
    } catch (e) {}
    const saved = readSavedTickers();
    if (saved) return saved;
    // One on the free tier, or when the plan could not be told: a sentiment
    // request is metered at five API units per symbol, and the terminal's
    // three were 15 of the free tier's 20 a day before anything had been
    // read. A paid plan has room for the three.
    return window.EODHD_PLAN === 'paid' ? ['AAPL.US', 'MSFT.US', 'NVDA.US'] : ['AAPL.US'];
  });

  React.useEffect(() => {
    if (!window.ViewState) return;
    window.ViewState.merge({ tickers: (trackedTickers || []).join(',') });
  }, [trackedTickers]);

  const [sentimentData, setSentimentData] = React.useState({});
  // Tickers EODHD answered "Symbol not found" for: marked on their cards.
  const [unknownTickers, setUnknownTickers] = React.useState([]);
  // Tickers whose request failed (a 5xx, the limit, the network): not "no
  // data", and asked again by Try again.
  const [failedTickers, setFailedTickers] = React.useState([]);
  // Of those, the ones whose last readings are still shown: a Refresh that
  // failed.
  const [staleTickers, setStaleTickers] = React.useState([]);
  // The failed request's answer came back and could not be read.
  const [failUnreadable, setFailUnreadable] = React.useState(false);
  // Where the last press inside the wait was ('news': the ticker news's Try
  // again, which says why next to itself), so the note shows once.
  const [heldAt, setHeldAt] = React.useState(null);
  // Inside a 429 wait Refresh and Try again send nothing and say so
  // (RateLimitWait, the same on every screen: B8). Try again counts the wait
  // down and the line above it names the limit; it said "did not load. Try
  // again" with no number.
  const RLW = window.RateLimitWait;
  const rlWait = RLW.useWait();
  // Null until measured. This started at 50 and fell back to 50 when nothing
  // came back, so a refused or failed request drew a gauge reading "50 /
  // Neutral" -- an invented value in the same type as a real one.
  const [overallScore, setOverallScore] = React.useState(null);
  const [selectedTicker, setSelectedTicker] = React.useState(null);
  const [newsBreakdown, setNewsBreakdown] = React.useState(null);
  // The limit is named only when it is why a reading or the news failed: a
  // wait another request started later leaves a 500's words as they were.
  // The buttons count any wait down.
  const gaugeLimited = RLW.useCause(failedTickers.length ? failedTickers : null);
  const tickerNewsLimited = RLW.useCause(newsBreakdown && newsBreakdown.failed ? newsBreakdown : null);
  // Try again on a failed news request asks once more without dropping the
  // ticker: the old way set it to null and back, the whole section left the
  // page with the button in it and the focus fell to <body>.
  const [newsTry, setNewsTry] = React.useState(0);
  const [newsLoading, setNewsLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  // The field had `outline: none` and nothing in its place: focused and
  // unfocused looked the same.
  const [searchFocused, setSearchFocused] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState([]);
  // Which suggestion the arrow keys have landed on; -1 means none yet. The
  // only row Enter takes: the one under the mouse is painted (hoverResult),
  // never taken -- a row under a resting pointer was Enter's
  // (of What-If's and Add Position's).
  const [activeResult, setActiveResult] = React.useState(-1);
  const [hoverResult, setHoverResult] = React.useState(-1);
  React.useEffect(() => { setHoverResult(-1); }, [searchResults]);
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [showSearch, setShowSearch] = React.useState(false);
  // Moves the focus once the next control is on the page; a wait still
  // pending when this component unmounts is dropped (PortalDropdown.js).
  const focusNext = (window.useFocusWhenReady || (() => (f) => setTimeout(() => { const el = f(); if (el) el.focus(); }, 0)))();
  // Closing the panel ends its search: a search still out (or hung) kept its
  // turn, and its "took too long" landed under + Add after Esc and stood
  // there when + Add was opened again on an empty field.
  const endSearch = () => {
    searchSeqRef.current++;
    pendingEnterRef.current = null;
    inFlightRef.current = null;
    searchFailedRef.current = false;
    resultsQueryRef.current = '';
    resultsRowsRef.current = [];
    setSearchLoading(false);
    setAddNote(null);
  };
  const closeAddPanel = () => {
    endSearch();
    setShowSearch(false); setSearchQuery(''); setSearchResults([]); setActiveResult(-1);
    focusNext(() => document.querySelector('[data-sent-add]'));
  };
  // With the focus elsewhere, Escape closes the open panel as a layer.
  (window.useEscLayer || (() => {}))(showSearch, closeAddPanel);
  const [addNote, setAddNote] = React.useState(null);
  // What a link named that is no ticker.
  const [linkNote, setLinkNote] = React.useState(() => linkSkipNote(bootLinkRef.current));
  // A link followed while the page is open: nothing re-mounts, so the view
  // listens for it, as the heatmap and the index page do. A link that names
  // no tickers leaves the list alone. ViewState writes back with
  // replaceState, which fires no hashchange.
  React.useEffect(() => {
    const onHash = () => {
      const VS = window.ViewState;
      if (!VS || typeof VS.splitHash !== 'function') return;
      const parts = VS.splitHash(window.location.hash || '');
      if (parts.tab && parts.tab !== 'sentiment') return;
      const got = readLinkTickers();
      setLinkNote(linkSkipNote(got));
      if (!got.list.length) return;
      setTrackedTickers((prev) => (prev.length === got.list.length && prev.every((t, i) => t === got.list[i]) ? prev : got.list));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Enter in the field, with no row highlighted: the row whose code is what
  // was typed (its US listing first), else the first row. "TSLA" + Enter added
  // nothing: the list arrives 700 ms after typing stops, so Enter
  // found it empty, and with several matches it waited for an arrow key.
  // An Enter that comes before the list is kept and served when it arrives.
  const pendingEnterRef = React.useRef(null);
  const resultsQueryRef = React.useRef('');
  // The rows of that answer, kept with it: the Enter handler read the
  // rendered list, which an Enter between the answer and React's drawing it
  // saw empty -- kept as pending after the answer had looked for one, the
  // pick was lost (the same race as Alerts, CI on PR #199).
  const resultsRowsRef = React.useRef([]);
  // The query a request is out for, from the keystroke to its answer: while
  // it is the text in the field, Enter waits for that answer, never an older
  // one kept for the same text (on d707b8b).
  const inFlightRef = React.useRef(null);
  // The last search for the text did not answer (a 500, no network): Enter
  // asks again rather than saying "No ticker matches". Holds
  // why (window.SentimentSearchFailure), or false: a refusal and a 429 are
  // not asked again on Enter.
  const searchFailedRef = React.useRef(false);
  // Until when a 429 holds the next search back.
  const searchLimitedUntilRef = React.useRef(0);
  // The search refused this key or plan: nothing more is sent until the key
  // changes or + Add is opened again -- editing the text asked again on
  // every pause.
  const searchRefusedRef = React.useRef(false);
  React.useEffect(() => { searchRefusedRef.current = false; }, [apiKey, showSearch]);
  // The key in use now: a refusal or a limit that comes back for a search
  // made under another key says nothing about this one.
  const apiKeyNowRef = React.useRef(apiKey);
  apiKeyNowRef.current = apiKey;
  // What the field says about a failed search, by its kind. A refusal the
  // host's panel already explains (the open apps' frame) is not said twice.
  const searchFailNote = (kind) => {
    if (kind === 'refused') {
      return window.Entitlement && window.Entitlement.explained && window.Entitlement.explained()
        ? null : 'The ticker search was refused for this key or plan.';
    }
    // Not "a minute": the wait is Retry-After's, counted down on the screen's
    // Try again and in the notice above; a second number here disagreed
    // with it.
    if (kind === 'limited') return window.RateLimitWait.REACHED + ' Press Enter to search again when the wait is over.';
    if (kind === 'timeout') return 'The ticker search took too long and was stopped. Press Enter to try again.';
    return 'The ticker search did not answer. Press Enter to try again.';
  };
  const searchSeqRef = React.useRef(0);
  const [searchTry, setSearchTry] = React.useState(0);
  // Enter found nothing to add. Rows for other listings say so, by the
  // text typed.
  const noPickNote = (rows, query) => ((rows || []).length
    ? 'No listing found for ' + String(query).trim()
    : 'No ticker matches "' + query + '"');
  // The row Enter adds, by the shared reader (window.SymbolCode.bestRow). A
  // code typed with its exchange, class or "^" is that listing, as the link
  // reads it: "BRK.B" added BRK.TO, "^GSPC" GSPCX.US and "GSPC.INDX" nothing.
  // An index, which the search lists none of, is
  // taken as typed. A listing typed with its exchange -- Yahoo's too:
  // "VOD.L" is VOD.LSE -- that the rows lack is { check: symbol }:
  // SymbolCode.listed says whether it is one (takePick). "7203.T" read "No ticker
  // matches" and "FOO.L" added FOO.PA, a fund in Paris.
  const bestMatch = (items, query) => {
    const SC = window.SymbolCode;
    const row = SC.bestRow(items, query);
    if (row) return row;
    const t = SC.parse(query);
    if (t.kind === 'index') return { Code: t.code, Exchange: t.exchange, Name: '' };
    if (t.kind === 'listing') return { check: t.symbol };
    return null;
  };
  const searchNowRef = React.useRef('');
  searchNowRef.current = searchQuery;
  // Bumped by every add and on unmount: a quote check still out does not
  // add its listing after another pick.
  const pickGenRef = React.useRef(0);
  React.useEffect(() => () => { pickGenRef.current++; }, []);
  // Enter's pick: added, or checked first, or said.
  const takePick = (pick, query, rows) => {
    if (!pick) { setAddNote(noPickNote(rows, query)); return; }
    if (!pick.check) { addTicker(pick); setActiveResult(-1); return; }
    const SC = window.SymbolCode;
    const api = SC.apiFor(window.EODHD_API, apiKey);
    const gen = pickGenRef.current;
    Promise.resolve(SC.listed(pick.check, api)).then((ok) => {
      if (searchNowRef.current !== query || gen !== pickGenRef.current) return;
      if (ok === true) {
        const d = pick.check.lastIndexOf('.');
        addTicker((SC.listedRow && SC.listedRow(pick.check)) || { Code: pick.check.slice(0, d), Exchange: pick.check.slice(d + 1), Name: '' });
        setActiveResult(-1);
      } else if (ok === 'limited') setAddNote(SC.limitNote(api.limited()));
      // Nothing known (a 500, no connection): said as such, and Enter asks again.
      else if (ok && ok.failed !== undefined) setAddNote(SC.failNote(query, ok.failed, ok.unreadable));
      else setAddNote(SC.noneNote(query));
    });
  };

  // --- Local Icon helper ---
  const Icon = ({ name, size = 24, color = 'currentColor' }) => {
    return React.createElement('svg', { 'aria-hidden': true, focusable: 'false',
      width: size, height: size, viewBox: "0 0 24 24",
      fill: "none", stroke: color, strokeWidth: "2",
      strokeLinecap: "round", strokeLinejoin: "round"
    }, React.createElement('path', { d: window.IconPaths[name] || "" }));
  };

  // --- Persist tracked tickers ---
  // A list taken from another tab is that tab's write: writing it back from
  // here made two tabs answer each other's snapshots.
  const adoptedRef = React.useRef(null);
  React.useEffect(() => {
    if (adoptedRef.current === trackedTickers) { adoptedRef.current = null; return; }
    const w = window.SavedStore ? window.SavedStore.write(SAVED_KEY, trackedTickers) : { ok: true };
    storeKeptRef.current = w.ok;
    setStoreNote(w.ok ? null : 'The list is kept for this visit only. ' + window.SavedStore.failNote(w.reason));
    window.DataSync?.pushSection('preferences', { sentiment_tickers: trackedTickers });
  }, [trackedTickers]);
  // Another tab changed the list: taken here, so the next change in this tab
  // starts from it. Two tabs adding TSLA and AMZN kept only the last one.
  React.useEffect(() => {
    if (!window.SavedStore) return undefined;
    return window.SavedStore.watch(SAVED_KEY, (v) => {
      const list = validTickers(v);
      if (!list) return;
      setTrackedTickers((prev) => {
        if (prev.length === list.length && prev.every((t, i) => t === list[i])) return prev;
        adoptedRef.current = list;
        return list;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Debounced ticker search ---
  React.useEffect(() => {
    // Any change of the text ends the turn of the search before it, an
    // emptied field too: a hung search for "TSLA" kept its turn when the
    // field was cleared and spoke 9 s later.
    if (searchQuery.length < 2) { searchSeqRef.current++; setSearchResults([]); setSearchLoading(false); return; }
    // 700ms, not 300: a search costs an API request, and typing "TSLA" sent
    // three of them -- fifteen percent of a free day for one ticker.
    inFlightRef.current = searchQuery;
    // Only the newest request speaks: an older one answering (or failing)
    // after it overwrote its rows, and an Enter waited for an answer that
    // had come (the same text typed twice). The
    // generation moves on at the keystroke, not when the debounce fires, so
    // a request still out during the wait is already stale.
    const seq = ++searchSeqRef.current;
    const latest = () => seq === searchSeqRef.current;
    const tid = setTimeout(async () => {
      // Inside a 429's wait, or after a refusal, nothing is sent: the field
      // says why.
      const held = Date.now() < searchLimitedUntilRef.current ? 'limited' : (searchRefusedRef.current ? 'refused' : null);
      if (held) {
        if (inFlightRef.current === searchQuery) inFlightRef.current = null;
        pendingEnterRef.current = null;
        searchFailedRef.current = held;
        resultsQueryRef.current = searchQuery;
        resultsRowsRef.current = [];
        setSearchResults([]);
        setAddNote(searchFailNote(held));
        return;
      }
      setSearchLoading(true);
      try {
        // Capped: a search that hangs is told as one after ANSWER_MS, and
        // Enter can ask again. The answer arriving after the
        // cap is dropped.
        let waitTid = null;
        // The code alone for Yahoo's suffix: search/VOD.L answers nothing,
        // search/VOD answers VOD.LSE (window.SymbolCode.searchText).
        const ask = window.EODHD_API.searchStocks(apiKey, window.SymbolCode.searchText(searchQuery) || searchQuery, { throwErrors: true });
        Promise.resolve(ask).catch(() => {});
        const data = await Promise.race([ask, new Promise((_, fail) => {
          waitTid = setTimeout(() => fail(Object.assign(new Error('The ticker search took too long'), { timedOut: true })), window.SentimentSearchWait.ANSWER_MS);
        })]).finally(() => { clearTimeout(waitTid); if (latest() && inFlightRef.current === searchQuery) inFlightRef.current = null; });
        if (!latest()) return;
        searchFailedRef.current = false;
        resultsQueryRef.current = searchQuery;
        // The search answered: what the field said about an earlier failure
        // ("Too many requests at once", "took too long") is no longer true.
        setAddNote(null);
        const shown = (data || []).slice(0, 8);
        resultsRowsRef.current = shown;
        if (pendingEnterRef.current === searchQuery) {
          pendingEnterRef.current = null;
          const pick = bestMatch(shown, searchQuery);
          if (pick && !pick.check) { setSearchLoading(false); addTicker(pick); setActiveResult(-1); return; }
          takePick(pick, searchQuery, shown);
        }
        setSearchResults(data || []);
      } catch (e) {
        // The search did not answer. "No ticker matches" said there was no
        // such ticker, next to the open app's "EODHD did not answer".
        // A waiting Enter is told the search failed instead,
        // and Enter again asks once more (searchTry).
        // A 429 or a refusal is about the key, not the text: kept even from
        // a search the typing has moved past.
        const kind = window.SentimentSearchFailure(e);
        const sameKey = apiKey === apiKeyNowRef.current;
        // The client's wait when it has one (Retry-After, TASK-429), else a minute.
        if (sameKey && kind === 'limited') searchLimitedUntilRef.current = window.RateLimitWait.until() || Date.now() + window.SentimentSearchWait.LIMIT_MS;
        if (sameKey && kind === 'refused') searchRefusedRef.current = true;
        // Said whether or not an Enter is waiting: a hang ended in silence.
        if (!latest()) return;
        searchFailedRef.current = kind;
        resultsQueryRef.current = searchQuery;
        resultsRowsRef.current = [];
        pendingEnterRef.current = null;
        setAddNote(searchFailNote(kind));
        setSearchResults([]);
      }
      setSearchLoading(false);
    }, 700);
    return () => clearTimeout(tid);
  }, [searchQuery, apiKey, searchTry]);

  // Average of `normalized` weighted by `count` -- the number of mentions the
  // day's reading rests on. A plain mean gave a day with two mentions the same
  // say as a day with two hundred. Days without a count weigh
  // one. Null for an empty list.
  const weightedNormalized = (items) => {
    let sum = 0;
    let weight = 0;
    (items || []).forEach(d => {
      const n = Number(d && d.normalized);
      if (!Number.isFinite(n)) return;
      const w = Math.max(1, Number(d.count) || 0);
      sum += n * w;
      weight += w;
    });
    return weight > 0 ? sum / weight : null;
  };

  // What each ticker's sentiment request returned, for this visit. Adding one
  // ticker used to ask again for every tracked one -- four tickers, twenty
  // units, a whole free day for one click.
  // Now only the tickers not yet answered are asked for; the refresh button
  // asks for all of them again.
  // (window.SentimentCache, above: kept across tab switches.)
  // Only the latest load may write: an older answer arriving last used to
  // overwrite the newer one.
  const sentimentReqRef = React.useRef(0);
  // The load on its way: { id, sig, at }, null when none is.
  const runningRef = React.useRef(null);
  // An older load of the same list and key still counts: Refresh while the
  // first request hung, the second failing, dropped the first one's readings
  // when they came. servedRef = the newest load that
  // put readings on screen; sigRef = the list and key on screen now.
  const servedRef = React.useRef({ sig: null, id: 0, at: 0 });
  const sigRef = React.useRef('');
  sigRef.current = (apiKey || '') + '|' + trackedTickers.join(',');
  // The readings on screen now, and for which list and key.
  const shownSentRef = React.useRef({ sig: null, data: {} });
  shownSentRef.current = { sig: shownSentRef.current.sig, data: sentimentData };

  // --- Load sentiment for all tracked tickers ---
  const loadSentiment = React.useCallback(async (force) => {
    const reqId = ++sentimentReqRef.current;
    const sig = (apiKey || '') + '|' + trackedTickers.join(',');
    const startedAt = Date.now();
    runningRef.current = { id: reqId, sig, at: startedAt };
    // Refresh and Try again ask anew: a request still hanging is not joined
    // (the open apps' shell joins one already on its way; EODHD_API.fresh).
    if (force === true && window.EODHD_API && typeof window.EODHD_API.fresh === 'function') window.EODHD_API.fresh();
    setLoading(true);
    setError(null);
    try {
      // One request for every ticker still to be read: the endpoint takes a
      // comma list and answers keyed by symbol ({ "AAPL.US": [...], ... }).
      // This used to be one request per ticker. The metering is
      // still per symbol, but a single round trip is a single round trip.
      const Cache = window.SentimentCache;
      const results = {};
      const cachedFor = (t) => (force === true ? undefined : Cache.get(apiKey, t));
      const missing = trackedTickers.filter(t => !Array.isArray(cachedFor(t)));
      trackedTickers.forEach(t => { const c = cachedFor(t); results[t] = Array.isArray(c) ? c : []; });
      const unknown = trackedTickers.filter(t => force !== true && Cache.missing(apiKey, t));
      let failed = [];
      // What the failed request was (RateLimitWait.failure): an answer that
      // could not be read is said as that, not as "did not answer".
      let failErr = null;
      if (missing.length) {
        try {
          // A list with an unknown symbol in it is answered 404 for all of
          // them; it is asked again per symbol (window.SentimentAskSplit).
          const got = await window.SentimentAskSplit(missing,
            (list) => window.EODHD_API.getSentimentData(apiKey, list.join(','), undefined, undefined, { throwErrors: true }));
          const byKey = got.data;
          got.missing.forEach(ticker => { Cache.putMissing(apiKey, ticker); unknown.push(ticker); });
          failed = (got.failed || []).slice();
          failErr = got.failure || null;
          missing.forEach(ticker => {
            if (got.missing.indexOf(ticker) !== -1) return;
            const base = ticker.split('.')[0];
            let items = byKey[ticker] || byKey[base] || byKey[ticker.toUpperCase()] || null;
            if (!Array.isArray(items)) {
              // Answered, and nothing for this one: remembered as nothing,
              // so it is not asked for again on the next add.
              if (got.answered && !got.error && !got.partial) Cache.put(apiKey, ticker, []);
              return;
            }
            items = [...items].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);
            results[ticker] = items;
            Cache.put(apiKey, ticker, items);
          });
        } catch (e) {
          // results stay empty; the score below says so rather than inventing
          // one, and the tickers asked for are said to have failed.
          failed = missing.slice();
          failErr = e;
        }
      }
      const latest = reqId === sentimentReqRef.current;
      const gotData = missing.some(t => (results[t] || []).length > 0);
      // A Refresh that failed keeps the readings already on screen: it turned
      // AAPL and MSFT into "not served --" and replaced the summary.
      // The last readings stay (what is on screen for
      // this list and key, else the cache), and the line under the gauge
      // says the refresh did not load. News keeps its headlines the same
      // way. (After gotData: kept readings are not an answer.)
      const keptFromBefore = [];
      if (force === true) {
        const onScreen = shownSentRef.current.sig === sig ? shownSentRef.current.data : {};
        failed.forEach((t) => {
          const before = (onScreen[t] && onScreen[t].length) ? onScreen[t] : Cache.get(apiKey, t);
          if (Array.isArray(before) && before.length && !(results[t] || []).length) {
            results[t] = before;
            keptFromBefore.push(t);
          }
        });
      }
      const served = servedRef.current;
      if (!latest) {
        // An older answer is applied only for the same list and key, with
        // readings in it, and not under a newer load's readings.
        if (sigRef.current !== sig || !gotData || (served.sig === sig && served.id > reqId)) return;
        setError(null);
      } else if (missing.length && !gotData && served.sig === sig && served.id < reqId && served.at >= startedAt) {
        // This load failed after an older one's readings arrived (while it
        // was running): kept.
        setLoading(false);
        runningRef.current = null;
        return;
      }
      if (gotData) servedRef.current = { sig, id: reqId, at: Date.now() };
      setSentimentData(results);
      shownSentRef.current = { sig, data: results };
      setUnknownTickers(unknown);
      setFailedTickers(failed);
      setStaleTickers(keptFromBefore);
      setFailUnreadable(Boolean(failed.length && failErr && window.RateLimitWait.failure(failErr).unreadable));

      // Overall score: the mention-weighted average of normalized sentiment
      // across tickers, mapped from [-1, 1] to [0, 100]. Null when nothing
      // came back -- a gauge has to be allowed to say "no reading".
      const avg = weightedNormalized(Object.values(results).flat());
      setOverallScore(avg == null ? null : Math.round(Math.max(0, Math.min(100, (avg + 1) * 50))));
    } catch (e) {
      if (reqId !== sentimentReqRef.current) return;
      if (!(window.Entitlement && window.Entitlement.explained())) setError('Failed to load sentiment data');
      console.error('[Sentiment] Load error:', e);
    }
    if (reqId === sentimentReqRef.current) setLoading(false);
    if (runningRef.current && runningRef.current.id === reqId) runningRef.current = null;
  }, [apiKey, trackedTickers]);
  // Refresh pressed again while the same list is loading: the request on its
  // way answers it, as the open apps' shell joins one (EODHD_API.fresh). Two
  // presses sent two identical /sentiments, both paid.
  // Only while that request is young (RateLimitWait.JOIN_MS, the shell's own
  // window): one that hangs past it is replaced by the next press.
  const refresh = () => {
    const r = runningRef.current;
    if (r && r.sig === sigRef.current && RLW.joins(r.at)) return;
    loadSentiment(true);
  };

  React.useEffect(() => { loadSentiment(); }, [loadSentiment]);

  // --- Load news breakdown for selected ticker ---
  React.useEffect(() => {
    if (!selectedTicker) { setNewsBreakdown(null); return; }
    let cancelled = false;
    (async () => {
      setNewsLoading(true);
      try {
        // throwErrors: a failed request is "could not load", not "no news" --
        // the terminal's getNews answered [] on a 500 and the page read "No
        // recent news found" (the open apps' shell already said failed).
        const news = await window.EODHD_API.getNews(apiKey, selectedTicker, 30, { throwErrors: true });
        if (cancelled) return;
        // Not a list is a failure, not an empty list: a timed-out request
        // used to read "No recent news found for AAPL" under a donut of
        // "1 articles", right below the panel saying EODHD had not answered.
        if (!Array.isArray(news)) {
          // What came back, for the line: nothing, or a body of another
          // shape that could not be read.
          setNewsBreakdown({ failed: true, fail: RLW.failure(news == null ? null : { unreadable: true, status: 200 }) });
        } else if (news.length > 0) {
          let positive = 0, negative = 0, neutral = 0;
          const headlines = [];
          news.forEach(n => {
            const s = n.sentiment;
            let polarity = 0;
            if (s) {
              polarity = typeof s === 'object' ? (s.polarity || 0) : (parseFloat(s) || 0);
            }
            if (polarity > 0.1) positive++;
            else if (polarity < -0.1) negative++;
            else neutral++;
            headlines.push({
              // "S&amp;P 500" came through as typed: decoded as text, never HTML.
              title: window.decodeHtmlEntities ? window.decodeHtmlEntities(n.title) : n.title,
              date: n.date,
              polarity,
              source: n.source || '',
            });
          });
          setNewsBreakdown({ positive, negative, neutral, total: news.length, headlines: headlines.slice(0, 10) });
        } else {
          setNewsBreakdown({ positive: 0, negative: 0, neutral: 0, total: 0, headlines: [] });
        }
      } catch (e) {
        if (cancelled) return;
        // Why, as every screen names it (RateLimitWait.failure): it read
        // "Could not load news for AAPL." for a 500, the limit and a page
        // that could not be read alike.
        setNewsBreakdown({ failed: true, fail: RLW.failure(e) });
      }
      if (!cancelled) setNewsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedTicker, apiKey, newsTry]);

  // --- Add ticker from search ---
  const addTicker = (item) => {
    pickGenRef.current++;
    // The row's symbol as every screen makes it (window.SymbolCode.fromRow):
    // American venues are US, OTC and NYSE MKT included.
    // A row naming nothing readable is said, not stored.
    const symbol = window.SymbolCode.fromRow(item);
    if (!symbol) { setAddNote('"' + String(item && item.Code || '').slice(0, 24) + '" from the search is not a ticker this page can track.'); return; }
    // Picking a ticker that is already tracked used to spend the search
    // request and then do nothing anybody could see.
    if (trackedTickers.includes(symbol)) {
      setAddNote(symbol + ' is already tracked');
    } else {
      setAddNote(null);
      // From the stored list, which another tab may have changed since.
      setTrackedTickers(prev => { const base = baseTickers(prev); return base.includes(symbol) ? base : [...base, symbol]; });
      window.Haptics?.medium();
    }
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
    // The field leaves the page with the pick and the focus fell to <body>
    // it goes back to "+ Add", as after Escape.
    focusNext(() => document.querySelector('[data-sent-add]'));
  };

  const removeTicker = (ticker) => {
    // The card leaves with its "x", and focus fell to <body>: it goes to the
    // card that takes its place, else the one before, else "+ Add".
    const cards = Array.prototype.slice.call(document.querySelectorAll('[data-sent-card]'));
    const at = cards.findIndex(el => el.getAttribute('data-sent-card') === ticker);
    const hadFocus = at !== -1 && cards[at].parentElement && cards[at].parentElement.contains(document.activeElement);
    const next = at === -1 ? null : (cards[at + 1] || cards[at - 1] || null);
    const nextId = next ? next.getAttribute('data-sent-card') : null;
    setTrackedTickers(prev => baseTickers(prev).filter(t => t !== ticker));
    if (selectedTicker === ticker) setSelectedTicker(null);
    window.Haptics?.light();
    if (hadFocus) focusNext(() => {
      const all = Array.prototype.slice.call(document.querySelectorAll('[data-sent-card]'));
      if (all.some(el => el.getAttribute('data-sent-card') === ticker)) return null;   // not re-rendered yet
      return all.find(el => el.getAttribute('data-sent-card') === nextId) || document.querySelector('[data-sent-add]');
    });
  };

  // --- Helper: get ticker score from sentimentData ---
  const getTickerScore = (ticker) => {
    const items = sentimentData[ticker];
    if (!items || items.length === 0) return null;
    const avg = weightedNormalized(items);
    return avg == null ? null : Math.round(Math.max(0, Math.min(100, (avg + 1) * 50)));
  };

  // --- Helper: sentiment trend direction ---
  const getTrend = (ticker) => {
    const items = sentimentData[ticker];
    if (!items || items.length < 2) return 'flat';
    // Compare first half average to second half average
    const mid = Math.floor(items.length / 2);
    const recent = items.slice(0, mid);
    const older = items.slice(mid);
    const recentAvg = weightedNormalized(recent);
    const olderAvg = weightedNormalized(older);
    if (recentAvg == null || olderAvg == null) return 'flat';
    const diff = recentAvg - olderAvg;
    if (diff > 0.05) return 'up';
    if (diff < -0.05) return 'down';
    return 'flat';
  };

  // --- Helper: score color ---
  const scoreColor = (score) => {
    if (score === null) return isDark ? C3.textMutedDark : C3.textMutedLight;
    // Light theme: darker inks (the dark-theme ones are 2-2.5:1 on white).
    if (score >= 65) return isDark ? C3.success : (C3.successLight || '#047857');
    if (score <= 35) return isDark ? C3.error : (C3.errorLight || '#c81e2c');
    return isDark ? C3.warning : '#a16207';
  };

  // --- Helper: label for overall score ---
  const getLabel = (score) => {
    if (score == null) return 'No reading';
    if (score >= 80) return 'Extreme Greed';
    if (score >= 65) return 'Greed';
    if (score >= 45) return 'Neutral';
    if (score >= 25) return 'Fear';
    return 'Extreme Fear';
  };

  // --- Social buzz: count mentions from sentimentData ---
  // Only tickers a reading came back for. A refused or empty answer used to
  // rank as "#1 AAPL 0 mentions", a zero shown as if counted, right under
  // "No sentiment reading".
  const buzzData = React.useMemo(() => {
    const buzz = trackedTickers.filter(ticker => (sentimentData[ticker] || []).length > 0).map(ticker => {
      const items = sentimentData[ticker] || [];
      const totalCount = items.reduce((s, d) => s + (d.count || 0), 0);
      const avgBuzz = items.length > 0
        ? items.reduce((s, d) => s + (d.buzz?.buzz || 0), 0) / items.length
        : 0;
      return { ticker, count: totalCount, buzz: avgBuzz };
    });
    buzz.sort((a, b) => b.count - a.count);
    return buzz;
  }, [sentimentData, trackedTickers]);

  const maxBuzzCount = React.useMemo(() => {
    return Math.max(1, ...buzzData.map(b => b.count));
  }, [buzzData]);

  // --- Demo static data ---
  const demoScore = 62;
  const demoTickers = [
    { ticker: 'AAPL.US', score: 72, trend: 'up' },
    { ticker: 'TSLA.US', score: 45, trend: 'down' },
    { ticker: 'MSFT.US', score: 68, trend: 'up' },
    { ticker: 'NVDA.US', score: 78, trend: 'up' },
    { ticker: 'META.US', score: 55, trend: 'flat' },
  ];

  // --- Styles ---
  const cardStyle = {
    ...(isDark ? C3.glassDark : C3.glassLight),
    borderRadius: 16, padding: 16, marginBottom: 12,
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 12,
    background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
    border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
    color: isDark ? C3.textDark : C3.textLightTheme,
    fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };

  // ============================================================
  //  SVG Semi-circular Gauge
  // ============================================================
  const SentimentGauge = ({ score, size = 200 }) => {
    const cx = size / 2;
    const cy = size / 2 - 10;
    const r = size / 2 - 25;
    const strokeW = 14;
    // Arc from 180deg (left) to 0deg (right) = semicircle
    const startAngle = Math.PI;
    const endAngle = 0;
    const totalAngle = Math.PI;
    const filledAngle = startAngle - (score / 100) * totalAngle;

    // Background arc path
    const arcPath = (startA, endA) => {
      const x1 = cx + r * Math.cos(startA);
      const y1 = cy - r * Math.sin(startA);
      const x2 = cx + r * Math.cos(endA);
      const y2 = cy - r * Math.sin(endA);
      const largeArc = (startA - endA) > Math.PI ? 1 : 0;
      // Sweep 1, not 0. Sweep 0 goes from the left end to the right end the
      // long way round -- under the centre -- so the dial drew as a bowl with
      // its apex at y=165 inside an SVG 150 tall, clipped by its own viewBox,
      // while the needle pointed up into the empty space above it. The needle
      // ends above the centre for every score, so the arc belongs there too.
      return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
    };

    // Needle position
    const needleAngle = startAngle - (score / 100) * totalAngle;
    const needleLen = r - 10;
    const nx = cx + needleLen * Math.cos(needleAngle);
    const ny = cy - needleLen * Math.sin(needleAngle);

    const label = getLabel(score);
    const color = scoreColor(score);

    return (
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <svg aria-hidden="true" focusable="false" width={size} height={size / 2 + 50} viewBox={`0 0 ${size} ${size / 2 + 50}`}>
          {/* Background arc */}
          <path d={arcPath(startAngle, endAngle)} fill="none"
            stroke={isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}
            strokeWidth={strokeW} strokeLinecap="round" />

          {/* Colored gradient arc segments: red -> yellow -> green */}
          <defs>
            <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={C3.error} />
              <stop offset="30%" stopColor={C3.error} />
              <stop offset="45%" stopColor={C3.warning} />
              <stop offset="55%" stopColor={C3.warning} />
              <stop offset="70%" stopColor={C3.success} />
              <stop offset="100%" stopColor={C3.success} />
            </linearGradient>
          </defs>
          <path d={arcPath(startAngle, endAngle)} fill="none"
            stroke="url(#gaugeGrad)"
            strokeWidth={strokeW} strokeLinecap="round" opacity={0.3} />

          {/* Filled arc up to score */}
          <path d={arcPath(startAngle, filledAngle)} fill="none"
            stroke={color} strokeWidth={strokeW} strokeLinecap="round" />

          {/* Needle */}
          <line x1={cx} y1={cy} x2={nx} y2={ny}
            stroke={isDark ? '#ffffff' : '#1e1b4b'} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={4}
            fill={isDark ? '#ffffff' : '#1e1b4b'} />

          {/* Score text */}
          <text x={cx} y={cy - 20} textAnchor="middle"
            fill={color} fontSize={28} fontWeight="700" fontFamily="Sora, sans-serif">
            {score}
          </text>

          {/* Label */}
          <text x={cx} y={cy + 22} textAnchor="middle"
            fill={isDark ? C3.textDark : C3.textLightTheme}
            fontSize={12} fontWeight="600" fontFamily="Sora, sans-serif" opacity={0.8}>
            {label}
          </text>

          {/* Endpoint labels */}
          {/* Dropped clear of the arc: a 14px stroke ending at (25,90) covers
              y 83 to 97, and these read as "ear" and "ed" underneath it. */}
          <text x={10} y={cy + 20} textAnchor="start"
            fill={(window.A11yColor ? window.A11yColor.text(C3.error, isDark) : C3.error)} fontSize={9} fontWeight="600" fontFamily="Sora, sans-serif">Fear</text>
          <text x={size - 10} y={cy + 20} textAnchor="end"
            fill={(window.A11yColor ? window.A11yColor.text(C3.success, isDark) : C3.success)} fontSize={9} fontWeight="600" fontFamily="Sora, sans-serif">Greed</text>
        </svg>
      </div>
    );
  };

  // ============================================================
  //  Sparkline SVG for 30-day trend
  // ============================================================
  // The host's own panel says a request was refused (the open apps' frame;
  // the terminal has none). "No data" and "nothing came back" would then read
  // as an empty answer; they say what happened instead, in the other views' words.
  const refusedAbove = Boolean(window.Entitlement && window.Entitlement.explained && window.Entitlement.explained());
  const NOT_SERVED_LINE = 'Nothing below is missing data — the request was not served. See the panel above.';
  const emptyStatus = { failed: failedTickers.length, unknown: unknownTickers.length, unreadable: failUnreadable && !gaugeLimited };
  const Sparkline = ({ data, width = 80, height = 20 }) => {
    // One day is a reading, not "no data": "50 / 100 · 1d" stood next to
    // "no data". A line needs two days.
    if (data && data.length === 1) {
      return <div style={{ width, height, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>1 day of data</span>
      </div>;
    }
    if (!data || data.length < 2) {
      // Readable, not a 0.2-opacity ghost (1.51:1 at 9 px).
      return <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {refusedAbove
          ? <span style={{ fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>not served</span>
          : <span style={{ fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>no data</span>}
      </div>;
    }
    // Oldest on the left. The readings are kept newest first, and drawn in
    // that order a rising sentiment was a falling red line.
    const values = [...data].sort((a, b) => new Date(a.date) - new Date(b.date)).map(d => (d.normalized || 0));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const isUp = values[values.length - 1] >= values[0];
    return (
      <svg aria-hidden="true" focusable="false" width={width} height={height} style={{ display: 'block', flexShrink: 0 }}>
        <polyline points={points} fill="none"
          stroke={isUp ? C3.success : C3.error} strokeWidth="1.5" />
      </svg>
    );
  };

  // ============================================================
  //  Donut Chart for News Sentiment Breakdown
  // ============================================================
  const DonutChart = ({ positive, negative, neutral, size = 120 }) => {
    const count = positive + negative + neutral;
    const total = count || 1; // the arc divisor; the label below is the count
    const r = (size / 2) - 12;
    const circumference = 2 * Math.PI * r;
    const posLen = (positive / total) * circumference;
    const negLen = (negative / total) * circumference;
    const neuLen = (neutral / total) * circumference;
    const cx = size / 2;
    const cy = size / 2;

    // Each segment is a circle with dash offset
    const posOffset = 0;
    const negOffset = -(posLen);
    const neuOffset = -(posLen + negLen);

    return (
      <svg aria-hidden="true" focusable="false" width={size} height={size} style={{ display: 'block', margin: '0 auto' }}>
        {/* Neutral (base) */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)'}
          strokeWidth={16} />
        {/* Neutral segment */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={C3.warning} strokeWidth={16}
          strokeDasharray={`${neuLen} ${circumference - neuLen}`}
          strokeDashoffset={neuOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          strokeLinecap="butt" />
        {/* Negative segment */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={C3.error} strokeWidth={16}
          strokeDasharray={`${negLen} ${circumference - negLen}`}
          strokeDashoffset={negOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          strokeLinecap="butt" />
        {/* Positive segment */}
        <circle cx={cx} cy={cy} r={r} fill="none"
          stroke={C3.success} strokeWidth={16}
          strokeDasharray={`${posLen} ${circumference - posLen}`}
          strokeDashoffset={posOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          strokeLinecap="butt" />
        {/* Center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill={isDark ? C3.textDark : C3.textLightTheme}
          fontSize={16} fontWeight="700" fontFamily="Sora, sans-serif">{count}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill={isDark ? C3.textMutedDark : C3.textMutedLight}
          fontSize={9} fontFamily="Sora, sans-serif">articles</text>
      </svg>
    );
  };

  // ============================================================
  //  RENDER
  // ============================================================
  return (
    <div style={{
      position: 'relative',
      background: window.APP_PLATFORM === 'WEB' ? 'transparent' : (isDark ? C3.bgGradientDark : C3.bgGradientLight),
      color: isDark ? C3.textDark : C3.textLightTheme,
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      fontFamily: "'Sora', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px 20px',
        borderBottom: '1px solid ' + (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
        position: 'sticky', top: 0, zIndex: 10,
        background: isDark ? 'rgba(21,20,15,0.85)' : 'rgba(224,231,255,0.85)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      }}>
        {/* The "?" sits beside the heading, not in it: inside, the heading's
            name was "Market Sentiment What is Market Sentiment?". */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <h1 ref={retryHeadingRef} tabIndex={-1} style={{ fontWeight: 700, fontSize: 16, margin: 0 }}>Market Sentiment</h1>
          {window.HelpTooltip && <HelpTooltip title="Market Sentiment" text="Gauge overall market mood and per-ticker sentiment. Tracks social buzz, analyst ratings, and price momentum to help time your entries." isDark={isDark} />}
        </div>
        {/* Busy while the readings load: a press then joins the request on
            its way (refresh). The dot is News's sign for the same. */}
        <button onClick={() => { if (rlWait.hold()) { setHeldAt(null); return; } refresh(); }} aria-label={rlWait.left ? `Refresh sentiment (in ${rlWait.left} s)` : 'Refresh sentiment'} aria-disabled={rlWait.left ? 'true' : undefined} aria-busy={loading ? 'true' : undefined} data-sent-refresh="true" title={rlWait.left ? `Too many requests: refresh in ${rlWait.left} s` : 'Refresh sentiment'} style={{
          // 40x40 touch target (was 32x40 at 390 px).
          minWidth: 40, minHeight: 40, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: loading ? 'progress' : 'pointer', padding: 8,
          color: isDark ? C3.textMutedDark : C3.textMutedLight, position: 'relative',
        }}>
          <span style={{ display: 'inline-flex', opacity: loading ? 0.5 : 1 }}><Icon name="refresh" size={16} /></span>
          {loading && (
            <span aria-hidden="true" style={{
              position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: '50%',
              background: C3.glowOrange, animation: 'pulse 1s infinite',
            }} />
          )}
        </button>
      </div>

      <div style={{ padding: '16px 20px', paddingBottom: 40 }}>

        {/* ============= OVERALL GAUGE ============= */}
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0, marginBottom: 4, opacity: 0.7 }}>Overall Market Sentiment</h2>
          {loading ? (
            <div style={{ padding: 40, opacity: 0.7, fontSize: 13 }}>Loading sentiment data...</div>
          ) : error ? (
            <div style={{ padding: 40, color: C3.error, fontSize: 13 }}>{error}</div>
          ) : isDemo ? (
            <SentimentGauge score={demoScore} />
          ) : overallScore == null ? (
            // The dimming is on the sentence only: on the whole block it took
            // the Try again button with it, white on orange at 3.1:1, and the
            // button read as disabled.
            <div style={{ padding: '40px 0', fontSize: 13 }}>
              {window.SentimentEmptyNote('gauge', trackedTickers.length, refusedAbove, NOT_SERVED_LINE, emptyStatus) && (
                <span style={{ opacity: 0.7 }}>{failedTickers.length > 0 && !refusedAbove && gaugeLimited
                  ? 'No sentiment reading — ' + RLW.REACHED
                  : window.SentimentEmptyNote('gauge', trackedTickers.length, refusedAbove, NOT_SERVED_LINE, emptyStatus)}</span>
              )}
              {(refusedAbove || failedTickers.length > 0) && (
                <div style={{ marginTop: 16 }}>
                  <RLW.RetryButton wait={rlWait} isDark={isDark} data-retry-focus="true" onHeld={() => setHeldAt(null)} onClick={() => { retryFocusRef.current = true; loadSentiment(!failedTickers.length); }} style={{
                    padding: '12px 24px', background: C3.logoGradient, border: 'none',
                    borderRadius: '12px', color: 'white', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                  }} />
                </div>
              )}
            </div>
          ) : (
            <SentimentGauge score={overallScore} />
          )}
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 12 }}>
            {window.SentimentAggregateLine(trackedTickers, sentimentData, overallScore, { failed: failedTickers, unknown: unknownTickers })}
          </div>
          {/* A Refresh that failed: the last readings stay on screen, and
              this says the refresh did not load, and why. */}
          {!loading && staleTickers.length > 0 && (
            <p role="status" data-sent-stale="true" style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.5, color: isDark ? C3.textDark : C3.textLightTheme }}>
              {window.SentimentStaleNote(staleTickers, trackedTickers, { limited: gaugeLimited, refusedAbove, unreadable: failUnreadable && !gaugeLimited })}
            </p>
          )}
          {/* Some tickers failed beside a reading: Try again asks for those
              only (the answered ones are kept). */}
          {!loading && overallScore != null && failedTickers.length > 0 && (
            <RLW.RetryButton wait={rlWait} isDark={isDark} data-retry-focus="true" onHeld={() => setHeldAt(null)} onClick={() => { retryFocusRef.current = true; loadSentiment(); }} style={{
              marginTop: 10, padding: '6px 14px', borderRadius: 10, border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'),
              background: 'none', color: isDark ? C3.textDark : C3.textLightTheme, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }} />
          )}
          {rlWait.note && heldAt !== 'news' && (
            <p data-wait-note="true" style={{ margin: '10px 0 0', fontSize: 13, color: isDark ? C3.textDark : C3.textLightTheme }}>{rlWait.note}</p>
          )}
        </div>

        {/* ============= TRACKED TICKERS ============= */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, marginTop: 8 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Tracked Tickers{window.EODHD_PLAN !== 'paid' && (<>{' '}
            <span style={{ fontSize: 11, fontWeight: 500, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>
              · each costs 5 API requests a load; the free tier has 20 a day
            </span></>)}
          </h2>
          <button data-sent-add="true" onClick={() => {
            // Opening or closing ends whatever search the panel had out, and
            // its note.
            if (showSearch) closeAddPanel(); else { endSearch(); setShowSearch(true); }
            window.Haptics?.light();
          }} style={{
            padding: '6px 14px', borderRadius: 10,
            background: C3.logoGradient, border: 'none',
            color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            + Add
          </button>
        </div>
        {/* Always there, so a reader hears a line when it appears. */}
        <div role="status" aria-live="polite" data-sent-add-note={addNote ? 'true' : undefined}
             style={addNote ? { fontSize: 11, marginBottom: 8, color: isDark ? C3.textMutedDark : C3.textMutedLight, overflowWrap: 'anywhere' } : undefined}>{addNote || ''}</div>
        {storeNote && (
          <div role="status" data-sent-store-note="" style={{ fontSize: 11, marginBottom: 8, color: isDark ? C3.textDark : C3.textLightTheme }}>{storeNote}</div>
        )}
        {linkNote && (
          <div role="status" data-sent-link-note="" style={{ fontSize: 11, marginBottom: 8, color: isDark ? C3.textMutedDark : C3.textMutedLight, overflowWrap: 'anywhere' }}>{linkNote}</div>
        )}

        {/* Search input */}
        {showSearch && (
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            {/* The suggestions were <div onClick> with nothing else: Tab went
                from the field straight past them to the close buttons, Enter in
                the field did nothing, and a ticker could not be added from the
                keyboard at all. They are a listbox now, the field owns it, and
                Enter takes the highlighted row -- or the only one, when the
                list has settled on a single match. */}
            <input {...window.TickerFieldProps}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value); setActiveResult(-1); pendingEnterRef.current = null; inFlightRef.current = e.target.value.length >= 2 ? e.target.value : null;
                // A note about the last text's search is not about this one.
                // Inside a 429's wait or after a refusal the search for the
                // new text says it again.
                setAddNote(null);
              }}
              data-esc-own="true"
              onKeyDown={(e) => {
                const shown = searchResults.slice(0, 8);
                const settled = resultsQueryRef.current === searchQuery;
                // Escape: the list first, then the "+ Add" panel itself, with
                // the focus back on "+ Add". It only ever cleared a list, and
                // with none showing did nothing.
                if (e.key === 'Escape') {
                  e.preventDefault();
                  pendingEnterRef.current = null;
                  if (shown.length) { setActiveResult(-1); setSearchResults([]); }
                  else closeAddPanel();
                  return;
                }
                // One letter: no search is sent for it, and F, V, T, C are US
                // codes -- SymbolCode.listed decides. Enter did nothing.
                if (e.key === 'Enter' && searchQuery.trim().length === 1 && activeResult < 0) {
                  e.preventDefault();
                  const SC = window.SymbolCode;
                  const sym = SC.of(searchQuery);
                  if (!sym) setAddNote(SC.problem(SC.read(searchQuery), searchQuery));
                  else takePick({ check: sym }, searchQuery, []);
                  return;
                }
                // A request out for this text: Enter waits for its answer.
                if (e.key === 'Enter' && searchQuery.trim().length >= 2 && inFlightRef.current === searchQuery) {
                  e.preventDefault();
                  pendingEnterRef.current = searchQuery;
                  return;
                }
                if (e.key === 'Enter' && searchQuery.trim().length >= 2 && (!shown.length || !settled) && activeResult < 0) {
                  e.preventDefault();
                  // Answered (nothing out for it): pick from the answer itself,
                  // or say there is nothing to pick. An answer with no rows
                  // kept the Enter waiting for an answer that had come, and
                  // nothing happened.
                  if (settled) {
                    const pick = bestMatch(resultsRowsRef.current, searchQuery);
                    if (pick) takePick(pick, searchQuery, resultsRowsRef.current);
                    else if (searchFailedRef.current) {
                      // Asked again only where that can help: not after a
                      // refusal, and not inside a 429's wait.
                      const kind = searchFailedRef.current;
                      if (kind === 'refused' || (kind === 'limited' && Date.now() < searchLimitedUntilRef.current)) {
                        setAddNote(searchFailNote(kind));
                        return;
                      }
                      setAddNote(null);
                      pendingEnterRef.current = searchQuery;
                      inFlightRef.current = searchQuery;
                      setSearchTry((n) => n + 1);
                    } else setAddNote(noPickNote(resultsRowsRef.current, searchQuery));
                    return;
                  }
                  // The list for what is typed has not arrived yet.
                  pendingEnterRef.current = searchQuery;
                  return;
                }
                if (!shown.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveResult((i) => (i + 1) % shown.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveResult((i) => (i <= 0 ? shown.length - 1 : i - 1));
                } else if (e.key === 'Enter') {
                  const pick = activeResult >= 0 ? shown[activeResult] : bestMatch(shown, searchQuery);
                  e.preventDefault();
                  takePick(pick, searchQuery, shown);
                }
              }}
              placeholder="Ticker, e.g. AAPL, GOOG"
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={searchFocused ? {
                ...inputStyle,
                border: '1px solid ' + (isDark ? C3.glowOrange : '#c2410c'),
                boxShadow: '0 0 0 2px ' + (isDark ? 'rgba(249,115,22,0.45)' : 'rgba(194,65,12,0.35)'),
              } : inputStyle}
              autoFocus
              role="combobox"
              aria-expanded={searchResults.length > 0}
              aria-controls="sentiment-ticker-suggestions"
              aria-activedescendant={activeResult >= 0 ? `sentiment-suggestion-${activeResult}` : undefined}
              aria-autocomplete="list"
            />
            {searchLoading && <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Searching...</div>}
            {searchResults.length > 0 && (
              <div id="sentiment-ticker-suggestions" role="listbox" aria-label="Ticker suggestions"
                   style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto' }}>
                {searchResults.slice(0, 8).map((item, i) => (
                  <div key={i}
                    id={`sentiment-suggestion-${i}`}
                    role="option"
                    aria-selected={activeResult === i}
                    tabIndex={0}
                    onClick={() => addTicker(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addTicker(item); }
                    }}
                    onMouseEnter={() => setHoverResult(i)}
                    onMouseLeave={() => setHoverResult((h) => (h === i ? -1 : h))}
                    style={{
                      padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: (activeResult >= 0 ? activeResult : hoverResult) === i
                        ? (isDark ? 'rgba(249,115,22,0.18)' : 'rgba(249,115,22,0.12)')
                        : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                      outline: activeResult === i ? '2px solid rgba(249,115,22,0.55)' : 'none',
                      marginBottom: 4,
                    }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{item.Code}</span>
                      <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 8 }}>{item.Name}</span>
                    </div>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{item.Exchange}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ticker Grid */}
        <window.PaywallGate
          allowed={!isDemo}
          type="subscription"
          message="See per-ticker sentiment, trend tracking and social buzz metrics with a data subscription."
          actionLabel="Upgrade Plan"
          onAction={() => { if (onSettingsClick) onSettingsClick(); }}
          isDark={isDark}
          style={{ marginBottom: 12 }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
            {(isDemo ? demoTickers : trackedTickers.map(ticker => ({
              ticker,
              score: getTickerScore(ticker),
              trend: getTrend(ticker),
            }))).map(({ ticker, score, trend }) => {
              const isSelected = selectedTicker === ticker;
              const sc = score !== null ? score : '--';
              const trendArrow = trend === 'up' ? '\u2191' : trend === 'down' ? '\u2193' : '\u2192';
              // Light theme: the darker inks (the dark-theme green read 2.03:1 on white).
              const trendColor = trend === 'up' ? (isDark ? C3.success : (C3.successLight || '#047857'))
                : trend === 'down' ? (isDark ? C3.error : (C3.errorLight || '#c81e2c'))
                : (isDark ? C3.textMutedDark : C3.textMutedLight);
              const tickerLabel = window.SentimentTickerLabel(ticker, trackedTickers);

              return (
                <div key={ticker}
                  // Selecting a ticker is how its news breakdown opens. The card
                  // itself was the button, with "Stop tracking" inside it -- a
                  // button in a button. The card is a container now; the control
                  // is a real button laid over it (below), so the ring still
                  // goes round the whole card and nothing on it moves.
                  onClick={() => { if (!isSelected && window.MIAnalytics) window.MIAnalytics.track('dl_mi_sentiment_interact', { action: 'ticker_select', ticker: ticker }); setSelectedTicker(isSelected ? null : ticker); window.Haptics?.light(); }}
                  style={{
                    ...cardStyle, marginBottom: 0, cursor: 'pointer',
                    padding: 12, position: 'relative',
                    border: isSelected
                      ? '1px solid ' + C3.glowOrange
                      : (isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.08)'),
                  }}
                >
                  {/* For the keyboard and for assistive technology; the mouse
                      goes through it to the card (and to the titles on it). */}
                  <button type="button" aria-pressed={isSelected} data-sent-card={ticker}
                    aria-label={unknownTickers.indexOf(ticker) !== -1 ? `${tickerLabel}: not found on EODHD` : failedTickers.indexOf(ticker) !== -1 && !refusedAbove && !(sentimentData[ticker] || []).length ? `${tickerLabel}: did not load` : `${tickerLabel} sentiment${score != null ? ' ' + score + ' of 100' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setSelectedTicker(isSelected ? null : ticker); }}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'none', border: 'none', padding: 0, margin: 0, borderRadius: 'inherit', pointerEvents: 'none' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{tickerLabel}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeTicker(ticker); }}
                      aria-label={`Stop tracking ${tickerLabel}`}
                      // 40x40 target (was 28x28); the negative
                      // margin keeps the card's header row as tall as before.
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', minWidth: 40, minHeight: 40, margin: '-8px -10px -8px 0',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        color: isDark ? C3.textMutedDark : C3.textMutedLight, fontSize: 14, lineHeight: 1 }}>
                      {'\u00D7'}
                    </button>
                  </div>
                  {unknownTickers.indexOf(ticker) !== -1
                    ? <div data-sent-unknown={ticker} style={{ height: 20, display: 'flex', alignItems: 'center', fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>not found on EODHD</div>
                    // A refusal the host's panel explains reads "not served" (Sparkline).
                    : failedTickers.indexOf(ticker) !== -1 && !refusedAbove && !(sentimentData[ticker] || []).length
                    ? <div data-sent-failed={ticker} style={{ height: 20, display: 'flex', alignItems: 'center', fontSize: 10, color: isDark ? C3.textMutedDark : C3.textMutedLight }}>did not load</div>
                    : <Sparkline data={sentimentData[ticker] || []} width={80} height={20} />}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <span title={(sentimentData[ticker] || []).length ? `Average over ${(sentimentData[ticker] || []).length} days with news, weighted by mentions` : undefined}
                      style={{ fontSize: 18, fontWeight: 700, color: scoreColor(score) }}>{sc}{score != null && <span style={{ fontSize: 10, fontWeight: 500, opacity: isDark ? 0.7 : 1 }}>/100{(sentimentData[ticker] || []).length ? ` · ${(sentimentData[ticker] || []).length}d` : ''}</span>}</span>
                    {/* No trend without data: a flat arrow over "no data" read as "unchanged". */}
                    {(isDemo || (sentimentData[ticker] && sentimentData[ticker].length >= 2)) && (
                      <span style={{ fontSize: 16, fontWeight: 700, color: trendColor }}
                        aria-label={trend === 'up' ? 'trending up' : trend === 'down' ? 'trending down' : 'flat'}>{trendArrow}</span>
                    )}
                  </div>
                  {/* Positive / Negative / Neutral counts */}
                  {sentimentData[ticker] && sentimentData[ticker].length > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, minWidth: 0 }}>
                      {(() => {
                        const b = window.SentimentDays.bands(sentimentData[ticker]);
                        const desc = `${b.strong} strongly positive (tone 0.7 or more), ${b.positive} positive (0.3 to 0.7), ${b.neutral} neutral (-0.3 to 0.3), ${b.negative} negative (below -0.3) days`;
                        const pos = (c) => isDark ? (window.A11yColor ? window.A11yColor.text(c, true) : c) : (C3.successLight || '#047857');
                        return (
                          // Wraps inside its card: on a 320 px phone "19++ 11+ 0~ 0- days"
                          // was wider than the card.
                          <span title={desc} aria-label={desc} style={{ display: 'flex', flexWrap: 'wrap', columnGap: 6, rowGap: 2, minWidth: 0 }}>
                            <span style={{ fontSize: 10, color: pos(C3.success) }}>{b.strong}++</span>
                            <span style={{ fontSize: 10, color: pos(C3.success) }}>{b.positive}+</span>
                            <span style={{ fontSize: 10, opacity: 0.7 }}>{b.neutral}~</span>
                            <span style={{ fontSize: 10, color: isDark ? (window.A11yColor ? window.A11yColor.text(C3.error, true) : C3.error) : (C3.errorLight || '#c81e2c') }}>{b.negative}-</span>
                            <span style={{ fontSize: 10, opacity: 0.7 }}>days</span>
                          </span>
                        );
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </window.PaywallGate>

        {/* ============= SOCIAL BUZZ ============= */}
        {/* With nothing tracked there is nothing to count: the section stood
            empty under "No tracked tickers". */}
        {trackedTickers.length > 0 && (<>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Social Buzz</h2>
        <window.PaywallGate
          allowed={!isDemo}
          type="subscription"
          message="Social buzz analysis requires a data subscription."
          actionLabel="Upgrade Plan"
          onAction={() => { if (onSettingsClick) onSettingsClick(); }}
          isDark={isDark}
          style={{ marginBottom: 12 }}
        >
          <div style={cardStyle}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10, opacity: 0.7 }}>Trending Tickers (by mention count)</div>
            {buzzData.map((b, i) => {
              const pct = (b.count / maxBuzzCount) * 100;
              const tickerLabel = window.SentimentTickerLabel(b.ticker, trackedTickers);
              return (
                <div key={b.ticker} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>#{i + 1} {tickerLabel}</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{b.count} mentions</span>
                  </div>
                  <div style={{
                    height: 8, borderRadius: 4,
                    background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      width: `${Math.max(2, pct)}%`,
                      background: i === 0 ? C3.logoGradient
                        : i === 1 ? C3.success
                        : i === 2 ? '#3b82f6'
                        : isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  {b.buzz > 0 && (
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
                      Buzz: {b.buzz.toFixed(1)}x avg
                    </div>
                  )}
                </div>
              );
            })}
            {buzzData.length === 0 && (loading || window.SentimentEmptyNote('buzz', trackedTickers.length, refusedAbove, NOT_SERVED_LINE, emptyStatus)) && (
              <div style={{ fontSize: 12, opacity: 0.7, padding: 12 }}>
                {loading ? 'Loading mention counts…' : window.SentimentEmptyNote('buzz', trackedTickers.length, refusedAbove, NOT_SERVED_LINE, emptyStatus)}
              </div>
            )}
          </div>
        </window.PaywallGate>
        </>)}

        {/* ============= NEWS SENTIMENT BREAKDOWN ============= */}
        {selectedTicker && (
          <>
            <h2 data-sentiment-news-heading tabIndex={-1} style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>
              News Sentiment: {window.SentimentTickerLabel(selectedTicker, trackedTickers)}
            </h2>
            <window.PaywallGate
              allowed={!isDemo}
              type="subscription"
              message="News sentiment breakdown requires a data subscription."
              actionLabel="Upgrade Plan"
              onAction={() => { if (onSettingsClick) onSettingsClick(); }}
              isDark={isDark}
              style={{ marginBottom: 12 }}
            >
              {newsLoading ? (
                <div style={{ ...cardStyle, padding: 30, textAlign: 'center', opacity: 0.7, fontSize: 13 }}>
                  Loading news sentiment...
                </div>
              ) : newsBreakdown && newsBreakdown.failed ? (
                <div style={{ ...cardStyle, padding: 20, textAlign: 'center', fontSize: 13 }}>
                  <div style={{ color: isDark ? C3.textMutedDark : C3.textMutedLight, marginBottom: 10 }}>
                    Could not load news for {window.SentimentTickerLabel(selectedTicker, trackedTickers)}{tickerNewsLimited ? ': ' + RLW.REACHED
                      : (newsBreakdown.fail && !newsBreakdown.fail.limited && (newsBreakdown.fail.status || newsBreakdown.fail.unreadable)) ? ': ' + RLW.failReason(newsBreakdown.fail) : '.'} This is a failed request, not an absence of news.
                  </div>
                  {/* A press inside the wait says why next to this button:
                      the page's own note is up in the gauge card, out of
                      sight on a phone, and the press "did nothing". */}
                  <RLW.RetryButton wait={rlWait} isDark={isDark} noteHere onHeld={() => setHeldAt('news')} onClick={() => {
                    setNewsTry((n) => n + 1);
                    // The button goes while it loads; the section's heading
                    // stays and takes the focus.
                    const find = () => document.querySelector('[data-sentiment-news-heading]');
                    if (window.focusWhenReady) window.focusWhenReady(find);
                    else { const h = find(); if (h) h.focus(); }
                  }} style={{
                    background: 'none', border: '1px solid ' + (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'),
                    borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12,
                    color: isDark ? C3.textDark : C3.textLightTheme,
                  }} />
                </div>
              ) : newsBreakdown && newsBreakdown.total === 0 ? (
                <div style={{ ...cardStyle, padding: 20, textAlign: 'center', opacity: 0.7, fontSize: 13 }}>
                  No recent news found for {window.SentimentTickerLabel(selectedTicker, trackedTickers)}
                </div>
              ) : newsBreakdown ? (
                <div style={cardStyle}>
                  {/* Donut + legend row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                    <DonutChart positive={newsBreakdown.positive} negative={newsBreakdown.negative} neutral={newsBreakdown.neutral} size={110} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: C3.success, display: 'inline-block' }} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Positive</span>
                        <span style={{ fontSize: 12, marginLeft: 'auto', fontWeight: 700, color: C3.success }}>
                          {newsBreakdown.total > 0 ? Math.round((newsBreakdown.positive / newsBreakdown.total) * 100) : 0}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: C3.error, display: 'inline-block' }} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Negative</span>
                        <span style={{ fontSize: 12, marginLeft: 'auto', fontWeight: 700, color: C3.error }}>
                          {newsBreakdown.total > 0 ? Math.round((newsBreakdown.negative / newsBreakdown.total) * 100) : 0}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: C3.warning, display: 'inline-block' }} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Neutral</span>
                        <span style={{ fontSize: 12, marginLeft: 'auto', fontWeight: 700, color: C3.warning }}>
                          {newsBreakdown.total > 0 ? Math.round((newsBreakdown.neutral / newsBreakdown.total) * 100) : 0}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Headlines */}
                  {newsBreakdown.headlines.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, opacity: 0.7 }}>Recent Headlines</div>
                      {newsBreakdown.headlines.map((h, i) => {
                        const sentLabel = h.polarity > 0.1 ? 'Positive' : h.polarity < -0.1 ? 'Negative' : 'Neutral';
                        const sentColor = h.polarity > 0.1 ? C3.success : h.polarity < -0.1 ? C3.error : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)');
                        const sentBg = h.polarity > 0.1 ? 'rgba(34,197,94,0.12)' : h.polarity < -0.1 ? 'rgba(239,68,68,0.12)' : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');
                        return (
                          <div key={i} style={{
                            padding: '8px 0',
                            borderBottom: i < newsBreakdown.headlines.length - 1
                              ? '1px solid ' + (isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)')
                              : 'none',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '2px 6px',
                                borderRadius: 6, background: sentBg, color: sentColor,
                                whiteSpace: 'nowrap', flexShrink: 0, marginTop: 2,
                              }}>{sentLabel}</span>
                              <span style={{ fontSize: 12, lineHeight: 1.4, fontWeight: 500 }}>{h.title}</span>
                            </div>
                            <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3, marginLeft: 50 }}>
                              {h.source}{h.date ? ' \u2022 ' + window.CalendarDate.format(h.date, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  {newsBreakdown.headlines.length === 0 && (
                    <div style={{ fontSize: 12, opacity: 0.7, textAlign: 'center', padding: 12 }}>
                      No recent news found for {window.SentimentTickerLabel(selectedTicker, trackedTickers)}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ ...cardStyle, padding: 20, textAlign: 'center', opacity: 0.7, fontSize: 13 }}>
                  No news data available
                </div>
              )}
            </window.PaywallGate>
          </>
        )}

        {/* Tip: select a ticker -- only when there is one to select. */}
        {!selectedTicker && !loading && trackedTickers.length > 0 && (
          <div style={{
            textAlign: 'center', padding: 20, opacity: 0.7, fontSize: 12, marginTop: 8,
          }}>
            Select a ticker above to see its news sentiment breakdown
          </div>
        )}
      </div>
    </div>
  );
};
