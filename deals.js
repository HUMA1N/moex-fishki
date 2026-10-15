/* Открытые сделки в мини-приложении (Костя, 14.10.2026): какие сделки по сценариям открыты, когда был вход и
   по какой цене, до какой цены ещё можно зайти и где докупать.
   Правила — ровно те же, что у учёта сценариев (track.evaluate в скилле) и у бота (bot/deals.py): вход по зоне —
   касанием, пробой — дневным закрытием за уровнем; стоп и цели — касанием; после T1 половина фиксируется, стоп —
   в безубыток; T1 не пришла за срок — выход по закрытию. Свечи — дневные MOEX ISS с даты расчёта по сегодня;
   сегодняшняя не закрыта, поэтому пробой внутри дня — ещё не вход («ждём закрытия»).
   Дивиденды шорта здесь не вычитаем (в учёте выпуска — вычитаем). Совпадение с Python проверяет bot/test_deals.py. */
(function (root) {
  'use strict';
  const CLOSE = ['close_above', 'close_below'];
  const RR_MIN = 1.5;
  const r6 = x => Math.round(x * 1e6) / 1e6;
  const r2 = x => Math.round(x * 100) / 100;

  // track.evaluate / evaluate_short без дивидендов. rec: {side, asof, stop, tg:[T1,T2], kind, level, zone, valid, tdays}
  function evaluate(rec, bars, until) {
    const short = rec.side === 'short';
    bars = (bars || []).filter(b => b.date > rec.asof).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const st = { status: 'pending', entry_date: null, entry_price: null, t1_date: null, t1_days: null, remainder: null,
                 exit_date: null, exit_price: null, days_in_trade: null, result_pct: null, unrealized: false,
                 last_date: bars.length ? bars[bars.length - 1].date : rec.asof, note: '' };
    const stop0 = +rec.stop, t1 = +rec.tg[0], t2 = +rec.tg[1];
    const kind = rec.kind || (short ? 'zone_up' : 'zone');
    const level = +(rec.level != null ? rec.level : (short ? rec.zone[0] : rec.zone[1]));
    const valid = +(rec.valid || 5), tdays = +(rec.tdays || 15);
    const done = (status, note) => Object.assign(st, { status, note: note || '' });

    let kIn = null, entry = null, sameDayStop = false;
    for (let k = 0; k < bars.length; k++) {
      const b = bars[k];
      if (until && b.date > until) return done('replaced', 'вышел новый выпуск до входа');
      if (k >= valid) return done('not_entered', 'за ' + valid + ' торг. дн. вход по сценарию не случился');
      if (kind === 'close_above' || kind === 'close_below') {
        const beyond = kind === 'close_above' ? b.close > level : b.close < level;
        if (beyond) {
          if (kind === 'close_above' ? b.close >= t1 : b.close <= t1) return done('not_entered', 'закрытие сразу за T1 — вход по сценарию упущен');
          kIn = k; entry = b.close;
          break;
        }
      } else {
        if (short ? b.open >= stop0 : b.open <= stop0) return done('not_entered', 'открытие за стопом — сценарий сломан до входа');
        if (short ? b.high >= level : b.low <= level) {
          kIn = k; entry = short ? Math.max(b.open, level) : Math.min(b.open, level); sameDayStop = true;
          break;
        }
      }
    }
    if (kIn === null) {
      if (until) return done('replaced', 'вышел новый выпуск до входа');
      return done('pending', 'ждём входа: ' + bars.length + ' из ' + valid + ' торг. дн.');
    }
    st.entry_date = bars[kIn].date;
    st.entry_price = r6(entry);
    const part = px => short ? (entry - px) / entry : (px / entry - 1);
    const t1Part = short ? (entry - t1) / entry : (t1 / entry - 1);
    const closeOut = (status, px, day, remainder, note) => {
      const res = st.t1_date ? 0.5 * t1Part + 0.5 * part(px) : part(px);
      return Object.assign(st, { status, remainder: remainder || null, exit_date: bars[kIn + day].date, exit_price: r6(px),
                                 days_in_trade: day, result_pct: r2(res * 100), note: note || '' });
    };
    let curStop = stop0;
    const hitStop = b => short ? (b.open >= curStop || b.high >= curStop) : (b.open <= curStop || b.low <= curStop);
    const reach = (b, x) => short ? b.low <= x : b.high >= x;
    for (let j = kIn; j < bars.length; j++) {
      const b = bars[j], day = j - kIn;
      if (j === kIn) {
        if (sameDayStop && (short ? b.high >= curStop : b.low <= curStop)) return closeOut('stop', curStop, 0, null, 'стоп в день входа');
        continue;
      }
      if (hitStop(b)) {
        const px = short ? Math.max(b.open, curStop) : Math.min(b.open, curStop);
        if (st.t1_date) return closeOut('t1', px, day, 'breakeven', 'после T1 остаток закрыт в безубыток');
        return closeOut('stop', px, day);
      }
      if (!st.t1_date && reach(b, t1)) {
        st.t1_date = b.date; st.t1_days = day;
        curStop = entry;                       // после T1 стоп в безубыток
        if (reach(b, t2)) return closeOut('t1', t2, day, 't2', 'T1 и T2 в один день');
        continue;
      }
      if (st.t1_date && reach(b, t2)) return closeOut('t1', t2, day, 't2');
      if (day >= tdays) {
        if (st.t1_date) return closeOut('t1', b.close, day, 'time', 'остаток закрыт по сроку');
        return closeOut('time_exit', b.close, day, null, 'за ' + tdays + ' торг. дн. T1 не пришла');
      }
    }
    const last = bars[bars.length - 1], day = bars.length - 1 - kIn;
    const res = st.t1_date ? 0.5 * t1Part + 0.5 * part(last.close) : part(last.close);
    return Object.assign(st, { status: st.t1_date ? 't1' : 'open', remainder: st.t1_date ? 'open' : null, days_in_trade: day,
                               result_pct: r2(res * 100), unrealized: true, note: 'в позиции ' + day + ' торг. дн. из ' + tdays });
  }

  function group(e) {
    if (e.status === 'pending') return 'pending';
    if (e.status === 'not_entered' || e.status === 'replaced') return 'dead';
    if (e.status === 'open' || (e.status === 't1' && e.remainder === 'open')) return 'open';
    return 'closed';
  }

  function limitOf(rec) {
    if (rec.lim != null) return +rec.lim;
    return (+rec.tg[0] + RR_MIN * +rec.stop) / (1 + RR_MIN);
  }

  // bot/deals.py: _item — что показать по сценарию. ctx — что говорит последний выпуск (deals.issue_ctx):
  // сделка из прежнего выпуска ведётся по своему плану, а «зайти или докупить» — только по свежему.
  function item(rec, e, last, crossed, nAfter, ctx) {
    const short = rec.side === 'short';
    const entry = e.entry_price, t1Done = !!e.t1_date;
    const stop = t1Done && entry != null ? entry : +rec.stop;
    const price = last ? last.close : null;
    const lim = limitOf(rec), add = rec.add ? rec.add.slice().sort((a, b) => a - b) : null;
    const x = Object.assign({}, e, { id: rec.id, t: rec.t, side: rec.side, rec, group: group(e), t1_done: t1Done, stop,
                                     stop0: +rec.stop, t1: +rec.tg[0], t2: +rec.tg[1], limit: lim, add, price,
                                     price_date: last ? last.date : null, crossed,
                                     days_left: Math.max(0, (+rec.valid || 5) - nAfter) });
    const stale = !!(ctx && rec.run < ctx.date && ctx.active && ctx.active[rec.t]);
    x.stale = stale;
    x.cur_ok = !stale || !!ctx.active[rec.t][rec.side];
    const live = x.group === 'open' && !t1Done && price != null && !stale;
    if (short) {
      x.join_ok = !!(live && lim != null && lim <= price && price < stop);
      x.add_ok = !!(live && add && add[0] <= price && price <= add[add.length - 1] && price < stop);
    } else {
      x.join_ok = !!(live && lim != null && stop < price && price <= lim);
      x.add_ok = !!(live && add && add[0] <= price && price <= add[add.length - 1] && price > stop);
    }
    return x;
  }

  // bot/deals.py: compute — по свечам barsBy {T: [{date, open, high, low, close}]} на дату today (МСК)
  function compute(recs, barsBy, today, ctx) {
    const out = [];
    (recs || []).forEach(rec => {
      const bars = (barsBy[rec.t] || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      if (!bars.length) return;
      const done = bars.filter(b => b.date < today);
      const part = bars[bars.length - 1].date === today ? bars[bars.length - 1] : null;
      const ec = evaluate(rec, done, rec.until);
      let e = part ? evaluate(rec, done.concat([part]), rec.until) : evaluate(rec, done, rec.until);
      let crossed = false;
      if (part && CLOSE.indexOf(rec.kind) >= 0 && ec.status === 'pending') {
        const beyond = rec.kind === 'close_above' ? part.close > rec.level : part.close < rec.level;
        if (beyond && !(rec.until && part.date > rec.until)) { e = ec; crossed = true; }
      }
      const last = part || (done.length ? done[done.length - 1] : null);
      const nAfter = done.filter(b => b.date > rec.asof).length + (part && part.date > rec.asof ? 1 : 0);
      out.push(item(rec, e, last, crossed, nAfter, ctx));
    });
    return out;
  }

  const api = { evaluate, compute, group, item, limitOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Deals = api;
})(this);
