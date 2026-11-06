/**
 * Generated. The app's identity -- used for link tags, the key screen and the
 * footer -- and the check that React loaded before anything reads it.
 */
window.APP_META = {
  "app": "news-sentiment",
  "repo": "eodhd-news-sentiment",
  "title": "EODHD News & Sentiment",
  "description": "A news feed with EODHD's sentiment scores over the same symbols, on your own key.",
  "keyNote": "Whether a key reaches news and sentiment depends on the plan; whatever yours lacks is named on screen in EODHD's own words. Mind the metering: sentiment costs 5 API units per symbol and each News tab 5 a load, against the free tier's 20 a day; on the free tier the app starts with one symbol, on a paid plan with three.",
  "storage": [
    "eodhd_news_",
    "eodhd_sentiment_tickers"
  ]
};

if (!window.React || !window.ReactDOM) {
  var bootError = document.getElementById('boot-error');
  if (bootError) bootError.style.display = 'block';
  throw new Error('React did not load from unpkg.com, so the app cannot start. See the message on the page.');
}
