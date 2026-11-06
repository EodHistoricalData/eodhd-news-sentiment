// calendarDate.js — window.CalendarDate: a calendar date ("2026-02-02", no
// time) is the same day in every time zone.
//
// new Date('2026-02-02') is midnight UTC. Formatted or compared in local time
// it is Feb 1 anywhere west of UTC (New York showed every transaction a day
// early), and "today" taken from toISOString() is tomorrow in New York after
// 19:00 and yesterday in Tokyo before 09:00. Every screen that shows or
// compares a date-only value reads it here. A value with a time of day is an
// instant and still converts to the viewer's local time.
(function () {
  const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
  const pad = (n) => String(n).padStart(2, '0');

  // [y, m, d] of a date-only string (an ISO timestamp at exactly midnight UTC
  // with nothing else -- "2026-02-02T00:00:00Z" -- is not one: it says when).
  const parts = (s) => {
    if (typeof s !== 'string') return null;
    const m = DATE_ONLY.exec(s.trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
    return [y, mo, d];
  };
  const isDateOnly = (s) => parts(s) != null;

  // A Date at local midnight of that day: getDate()/getMonth()/setDate() and
  // comparisons with other local dates see the day that was written. An
  // instant passes through new Date().
  const toLocal = (s) => {
    const p = parts(s);
    if (p) return new Date(p[0], p[1] - 1, p[2]);
    if (s instanceof Date) return new Date(s.getTime());
    if (s == null || s === '') return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  // "YYYY-MM-DD" of a Date (or epoch ms) as the viewer's calendar reads it.
  const ymd = (d) => {
    const x = d instanceof Date ? d : new Date(d == null ? Date.now() : d);
    if (isNaN(x.getTime())) return null;
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  };
  // The viewer's today.
  const today = (now) => ymd(now == null ? new Date() : now);
  // A date-only string n days away from another, by the calendar.
  const addDays = (s, n) => {
    const p = parts(s);
    if (!p) return s;
    const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + Math.round(n || 0)));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  };
  // Whole calendar days from a to b (b - a); null when either is not a date.
  const daysBetween = (a, b) => {
    const pa = parts(a), pb = parts(b);
    if (!pa || !pb) return null;
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  };
  // Calendar days from the viewer's today to s (0 = today, 1 = tomorrow).
  const daysFromToday = (s, now) => {
    const day = typeof s === 'string' ? s.trim().slice(0, 10) : null;
    return parts(day) ? daysBetween(today(now), day) : null;
  };

  // toLocaleDateString for a date that may be date-only: a date-only value is
  // formatted as that day (in UTC, where it was put), an instant in the
  // viewer's zone as before. Unreadable -> the input as text.
  const format = (s, opts, locale) => {
    const p = parts(s);
    if (p) {
      return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12))
        .toLocaleDateString(locale || 'en-US', { ...(opts || {}), timeZone: 'UTC' });
    }
    const d = s instanceof Date ? s : (s == null || s === '' ? null : new Date(s));
    if (!d || isNaN(d.getTime())) return s == null ? '' : String(s);
    return d.toLocaleDateString(locale || 'en-US', opts || undefined);
  };

  window.CalendarDate = { isDateOnly, parts, toLocal, ymd, today, addDays, daysBetween, daysFromToday, format };
})();
