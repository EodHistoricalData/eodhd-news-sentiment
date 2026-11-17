// SentimentScore — one reading of a ticker's news sentiment, the same on the
// dashboard as on the Sentiment page.
//
// The dashboard widget asked /sentiments?s=BTC-USD, EURUSD… without an
// exchange, and EODHD answered with the .US lines of those names: BTC-USD 92%
// (BTC-USD.CC had one article, 0.20, on 1 Oct), EURUSD at 99% from one story.
// It then printed the LAST day's value, even when that day rested on a single
// article, and scaled EODHD's -1..1 "normalized" as 0..1.
//
// Now: the full code (crypto .CC, forex .FOREX, else .US unless an exchange is
// given); the mention-weighted average over the window, as the Sentiment page
// does; nothing at all when the window holds fewer than MIN_MENTIONS mentions;
// and the one 0-100 scale below (scale), which the Sentiment page and the
// EODHD Score's sentiment part (the terminal's server, TONE_ANCHORS) read too.
//
// Pure functions, no DOM.
(function () {
  if (typeof window === 'undefined' || window.SentimentScore) return;

  const MIN_MENTIONS = 3;
  const WINDOW_DAYS = 14;

  // The 0-100 scale: EODHD's mention-weighted tone (-1..1) against the tone of
  // large US stocks, piecewise linear between these [tone, score] points.
  //
  // It used to be (avg + 1) * 50, and EODHD news tone is almost always well
  // above zero. Measured 16.11.2026 on the S&P 100 (99 tickers answered), the
  // 30-day mention-weighted tone, 24 weekly readings over ~6 months, 2,465 in
  // all: q01 0.543, q10 0.699, q30 0.770, q50 0.819, q70 0.878, q90 0.938,
  // q99 0.990. On the old scale 98% of them read "Extreme Greed" and the rest
  // "Greed"; nothing read Neutral or lower, so the label said nothing (14-day
  // windows look the same: q10 0.683, q30 0.768, q70 0.890, q90 0.962).
  //
  // The points put the label cutoffs (80/65/45/25) on those quantiles: Extreme
  // Fear is the least positive tenth of large US stocks, Fear the next fifth,
  // Neutral the middle 40%, Greed the next fifth, Extreme Greed the most
  // positive tenth. A typical stock (0.819) reads 54. The EODHD Score keeps
  // a copy of this list for its sentiment part, and a test holds the two equal
  // (the terminal's server).
  const TONE_ANCHORS = [[-1, 0], [0.70, 25], [0.77, 45], [0.88, 65], [0.94, 80], [1, 100]];

  // Mention-weighted tone (-1..1) -> 0..100, or null for no number. Out of
  // range is clamped. The EODHD Score's copy does the same sums in the same
  // order, so both give the same integer.
  function scale(avg) {
    if (typeof avg !== 'number' || !Number.isFinite(avg)) return null;
    const a = Math.max(-1, Math.min(1, avg));
    for (let i = 1; i < TONE_ANCHORS.length; i++) {
      const [x0, y0] = TONE_ANCHORS[i - 1];
      const [x1, y1] = TONE_ANCHORS[i];
      if (a <= x1) {
        const t = (a - x0) / (x1 - x0);
        return Math.round(Math.max(0, Math.min(100, y0 + t * (y1 - y0))));
      }
    }
    return 100;
  }

  // Which way a ticker's tone went: the newer half of its days against the
  // older half, flat for a move of TREND_STEP or less.
  const TREND_STEP = 0.05;
  // 0.55 - 0.50 is 0.05000000000000004 in floating point and read "up".
  const TREND_EPSILON = 1e-9;
  function trend(recentAvg, olderAvg) {
    if (recentAvg == null || olderAvg == null) return 'flat';
    const diff = recentAvg - olderAvg;
    if (diff > TREND_STEP + TREND_EPSILON) return 'up';
    if (diff < -TREND_STEP - TREND_EPSILON) return 'down';
    return 'flat';
  }

  // A ticker's days oldest first, by date. /sentiments answers newest first;
  // a reader that relies on the order draws time backwards. A copy; days
  // without a date keep their place among themselves (a stable sort).
  function chronological(rows) {
    return (rows || []).slice().sort((a, b) => String((a && a.date) || '').localeCompare(String((b && b.date) || '')));
  }

  // "BTC-USD" -> "BTC-USD.CC", "EURUSD" -> "EURUSD.FOREX", "AAPL" -> "AAPL.US".
  function codeFor(symbol) {
    const s = String(symbol || '').trim().toUpperCase();
    if (!s) return '';
    if (s.includes('.')) return s;
    if (/^[A-Z0-9]{2,10}-(USD|USDT|EUR|BTC|ETH)$/.test(s)) return s + '.CC';
    if (/^[A-Z]{6}$/.test(s) && /^(USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD|CNY|HKD|SEK|NOK|SGD)/.test(s)
        && /(USD|EUR|GBP|JPY|CHF|AUD|CAD|NZD|CNY|HKD|SEK|NOK|SGD)$/.test(s)) return s + '.FOREX';
    return s + '.US';
  }

  // The rows of one ticker out of a /sentiments answer, which is keyed by the
  // code EODHD resolved -- a different key than asked for means EODHD answered
  // about another instrument, and that is not this ticker's sentiment.
  function rowsFor(data, code) {
    // The proxy can wrap the answer as { data: { CODE: [...] } } (the Sentiment
    // page unwraps it too).
    if (data && !Array.isArray(data) && typeof data === 'object' && data.data && typeof data.data === 'object') data = data.data;
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    const want = String(code || '').toUpperCase();
    const key = Object.keys(data).find((k) => k.toUpperCase() === want);
    return key && Array.isArray(data[key]) ? data[key] : [];
  }

  // { score 0..100 on scale(), mentions, days } over the last `days` days, or
  // null.
  function summarize(rows, opts) {
    const o = opts || {};
    const days = o.days || WINDOW_DAYS;
    const min = o.minMentions == null ? MIN_MENTIONS : o.minMentions;
    const now = o.now ? new Date(o.now) : new Date();
    const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
    let sum = 0;
    let weight = 0;
    let dayCount = 0;
    (rows || []).forEach((d) => {
      if (!d || String(d.date || '').slice(0, 10) < cutoff) return;
      const n = Number(d.normalized);
      if (!Number.isFinite(n)) return;
      const w = Math.max(1, Number(d.count) || 0);
      sum += n * w;
      weight += w;
      dayCount++;
    });
    if (weight < min || weight === 0) return null;
    return {
      score: scale(sum / weight),
      mentions: weight,
      days: dayCount,
    };
  }

  window.SentimentScore = { codeFor, rowsFor, summarize, scale, TONE_ANCHORS, trend, chronological, MIN_MENTIONS, WINDOW_DAYS };
})();
