/* Акции · Мосбиржа — мини-приложение Telegram.
   Данные — data.json (выпуск скилла ru-stocks-digest, его выкладывает бот после каждого обзора),
   живые цены — MOEX ISS прямо из приложения (задержка 15 минут). Действия (графики и PDF в чат,
   свежий обзор, рассылка) — ссылкой t.me/<бот>?start=…: бот получает команду и отвечает в чате. */
(() => {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp;
  const IN_TG = !!(tg && tg.initData);
  const $ = (s, el = document) => el.querySelector(s);
  const S = { d: null, err: null, live: {}, liveAt: '', imoex: null, tab: 'home', filter: 'all', sort: 'rank',
              range: 126, detail: null, hover: null, deals: null, dealsAt: '' };
  const NB = ' ';
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MON_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const MON3 = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const B = { go: 'Брать', wait: 'Ждать цены', no: 'Не брать', sgo: 'Шорт сейчас', swait: 'Шорт: ждать', sno: 'Шорта нет', aside: 'В стороне' };
  const TREND = { up: 'вверх', down: 'вниз', side: 'боковой' };
  const ARROW = { up: '↗', down: '↘', side: '→' };

  // ---------- мелочи ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = x => (x === null || x === undefined || x === '' || !isFinite(+x)) ? null : +x;
  const decFor = x => { x = Math.abs(x || 0); return x >= 1000 ? 0 : x >= 100 ? 1 : x >= 10 ? 2 : x >= 1 ? 3 : 4; };
  function fmt(x, dec, sign) {
    x = num(x);
    if (x === null) return '—';
    if (dec == null) dec = decFor(x);
    const a = Math.abs(x).toFixed(dec);
    const parts = a.split('.');
    let s = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NB) + (parts[1] ? ',' + parts[1] : '');
    if (x < 0 && +a !== 0) s = '−' + s; else if (sign && x > 0 && +a !== 0) s = '+' + s;
    return s;
  }
  const trim0 = s => s.indexOf(',') >= 0 ? s.replace(/0+$/, '').replace(/,$/, '') : s;
  const pct = (x, dec = 1, sign = true) => num(x) === null ? '—' : fmt(x, dec, sign) + '%';
  const cls = x => num(x) === null ? '' : x > 0 ? 'up' : x < 0 ? 'down' : '';
  const ddmm = iso => iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) : '';
  const dmy = iso => iso ? ddmm(iso) + '.' + iso.slice(0, 4) : '';
  const dateObj = iso => new Date(iso.slice(0, 10) + 'T12:00:00');
  const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const safeUrl = u => /^https?:\/\/[^\s<>"']+$/i.test(u || '') ? u : null;
  const hue = t => { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const daysTo = iso => Math.round((dateObj(iso) - dateObj(todayIso())) / 864e5);
  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === 'sel') tg.HapticFeedback.selectionChanged();
      else if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success');
      else tg.HapticFeedback.impactOccurred(kind || 'light');
    } catch (e) { /* старый клиент */ }
  }
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function openLink(u) {
    if (!safeUrl(u)) return;
    haptic('light');
    if (tg && IN_TG && tg.openLink) tg.openLink(u); else window.open(u, '_blank', 'noopener');
  }
  // Команда боту: ссылка t.me/<бот>?start=<команда> — бот выполнит её и ответит в чате
  function cmd(p, note) {
    const bot = S.d && S.d.bot;
    if (!bot) { toast('Команды работают из Telegram'); return; }
    haptic('medium');
    const url = 'https://t.me/' + bot + '?start=' + encodeURIComponent(p);
    if (tg && IN_TG && tg.openTelegramLink) {
      toast(note || 'Открываю чат с ботом…');
      tg.openTelegramLink(url);
      setTimeout(() => { try { tg.close(); } catch (e) { /* уже закрыто */ } }, 500);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  // ---------- данные ----------
  const tk = t => S.d.tickers[t];
  const priceOf = t => (S.live[t] && num(S.live[t].last) !== null) ? S.live[t].last : tk(t).price.last;
  const chgOf = t => (S.live[t] && num(S.live[t].chg) !== null) ? S.live[t].chg : tk(t).price.d1;

  function upcoming(days) {
    const today = todayIso();
    const end = days ? new Date(dateObj(today).getTime() + days * 864e5).toISOString().slice(0, 10) : '9999';
    return (S.d.events || []).filter(e => e.date >= today && e.date <= end);
  }

  async function load() {
    S.err = null;
    render();
    try {
      const r = await fetch('data.json?ts=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      S.d = await r.json();
      render();
      // Открыть сразу бумагу или раздел: ?t=LKOH (кнопка в чате), #t=LKOH, startapp=t_LKOH; ?tab=cal
      const q = new URLSearchParams(location.search);
      const sp = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
      const t0 = q.get('t') || (/[#&]t=([A-Z0-9]+)/.exec(location.hash) || [])[1] || (/^t_([A-Z0-9]+)$/.exec(sp) || [])[1];
      const tab = q.get('tab') || (/[#&]tab=(\w+)/.exec(location.hash) || [])[1];
      if (tab && VIEWS[tab]) setTab(tab, true);
      if (t0 && S.d.tickers[t0]) openDetail(t0, true);
      fetchLive();
      fetchDeals();
    } catch (e) {
      S.err = String((e && e.message) || e);
      render();
    }
  }

  // Живые цены с Мосбиржи (ISS отдаёт данные с задержкой 15 минут и разрешает запросы из браузера)
  async function fetchLive(manual) {
    if (!S.d) return;
    const ctl = window.AbortController ? new AbortController() : null;
    const to = setTimeout(() => ctl && ctl.abort(), 8000);
    const base = 'https://iss.moex.com/iss/engines/stock/markets/';
    const u1 = base + 'shares/boards/TQBR/securities.json?iss.meta=off&iss.only=marketdata' +
      '&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME,SYSTIME&securities=' + S.d.order.join(',');
    const u2 = base + 'index/boards/SNDX/securities/IMOEX.json?iss.meta=off&iss.only=marketdata' +
      '&marketdata.columns=SECID,CURRENTVALUE,LASTCHANGEPRC,UPDATETIME,SYSTIME';
    try {
      const opt = ctl ? { signal: ctl.signal } : {};
      const [a, b] = await Promise.all([fetch(u1, opt).then(r => r.json()), fetch(u2, opt).then(r => r.json()).catch(() => null)]);
      const cols = (a.marketdata && a.marketdata.columns) || [];
      const ix = k => cols.indexOf(k);
      const live = {};
      let sys = '';
      ((a.marketdata && a.marketdata.data) || []).forEach(row => {
        const last = num(row[ix('LAST')]);
        sys = row[ix('SYSTIME')] || sys;
        if (last) live[row[ix('SECID')]] = { last, chg: num(row[ix('LASTTOPREVPRICE')]), time: row[ix('UPDATETIME')] };
      });
      if (b && b.marketdata && b.marketdata.data && b.marketdata.data[0]) {
        const c2 = b.marketdata.columns, r2 = b.marketdata.data[0];
        const v = num(r2[c2.indexOf('CURRENTVALUE')]);
        if (v) S.imoex = { last: v, chg: num(r2[c2.indexOf('LASTCHANGEPRC')]) };
      }
      if (Object.keys(live).length) {
        S.live = live;
        S.liveAt = sys ? ddmm(sys.slice(0, 10)) + ', ' + sys.slice(11, 16) : '';
        render(false);
        if (S.detail && S.detail !== '__digest') refreshDetailPrice();
        if (manual) { haptic('ok'); toast('Цены обновлены'); }
      } else if (manual) toast('Мосбиржа сейчас не отдаёт цены');
    } catch (e) {
      if (manual) toast('Не получилось обновить цены');
    } finally {
      clearTimeout(to);
    }
  }

  // ---------- открытые сделки (Костя, 14.10.2026) ----------
  // Сценарии учёта из выгрузки (data.json → deals.recs) пересчитываются по свежим дневным свечам ISS теми же
  // правилами, что у бота (deals.js = bot/deals.py = track.evaluate). Нет сети — состояние на момент выгрузки.
  const CLOSE_KINDS = ['close_above', 'close_below'];
  const mskToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const fmtL = x => { x = num(x); if (x === null) return '—'; const v = Math.abs(x); return trim0(fmt(x, v === 0 ? 0 : Math.max(0, Math.min(4, 4 - Math.floor(Math.log10(v)))))); };
  const zoneTxt = z => !z || !z.length ? '' : (Math.min(...z) === Math.max(...z) ? fmtL(z[0]) : fmtL(Math.min(...z)) + '–' + fmtL(Math.max(...z)));

  function exportedDeals() {
    const dd = S.d && S.d.deals, D = window.Deals;
    if (!dd || !dd.recs || !D) return [];
    return dd.recs.filter(r => dd.state && dd.state[r.id]).map(r => {
      const e = dd.state[r.id];
      const last = num(e.price) !== null ? { close: e.price, date: e.price_date } : null;
      return D.item(r, e, last, !!e.crossed, (+r.valid || 5) - (+e.days_left || 0), dd.ctx);
    });
  }
  const dealItems = () => S.deals || exportedDeals();

  async function fetchDeals() {
    const dd = S.d && S.d.deals;
    if (!dd || !dd.recs || !dd.recs.length || !window.Deals) return;
    const since = {};
    dd.recs.forEach(r => { if (!since[r.t] || r.asof < since[r.t]) since[r.t] = r.asof; });
    const base = 'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/';
    const ctl = window.AbortController ? new AbortController() : null;
    const to = setTimeout(() => ctl && ctl.abort(), 12000);
    try {
      const opt = ctl ? { signal: ctl.signal } : {};
      const got = await Promise.all(Object.keys(since).map(t =>
        fetch(base + t + '/candles.json?interval=24&iss.meta=off&candles.columns=open,close,high,low,begin&from=' + since[t], opt)
          .then(r => r.json())
          .then(j => [t, ((j.candles && j.candles.data) || []).filter(row => row.slice(0, 4).every(v => v !== null && v !== ''))
            .map(row => ({ open: +row[0], close: +row[1], high: +row[2], low: +row[3], date: String(row[4]).slice(0, 10) }))])
          .catch(() => [t, null])));
      const bars = {};
      got.forEach(([t, b]) => { if (b && b.length) bars[t] = b; });
      if (!Object.keys(bars).length) return;
      const fresh = window.Deals.compute(dd.recs.filter(r => bars[r.t]), bars, mskToday(), dd.ctx);
      S.deals = fresh.concat(exportedDeals().filter(x => !bars[x.t]));     // по бумагам без свечей — из выгрузки
      const n = new Date(Date.now() + 3 * 3600e3).toISOString();
      S.dealsAt = ddmm(n.slice(0, 10)) + ', ' + n.slice(11, 16);
      if (S.detail && S.detail !== '__digest') refreshDetailPrice(); else render(false);
    } catch (e) {
      /* сеть: остаётся выгрузка */
    } finally {
      clearTimeout(to);
    }
  }

  function joinTxt(x) {
    const sh = x.side === 'short';
    if (x.group !== 'open') return null;
    if (x.stale) {            // вышел выпуск новее сделки: новые деньги — по его сценарию
      const k = tk(x.t) || {}, when = ddmm(S.d.run_date);
      return x.cur_ok ? ['go', 'Зайти или докупить — по сценарию выпуска ' + when + ': ' + (sh ? k.scond : k.cond)]
        : ['no', 'Зайти или докупить — нет: в выпуске ' + when + ' сценария ' + (sh ? 'продажи' : 'покупки') + ' нет. Сделка ведётся по плану своего выпуска: стоп, цели, срок'];
    }
    if (x.t1_done) return ['no', 'Новый вход — поздно: T1 уже была, половина зафиксирована, стоп в безубытке'];
    if (num(x.limit) === null) return null;
    if (x.join_ok) return ['go', (sh ? 'Успеть продать (зайти в шорт): не ниже ' : 'Успеть зайти: не выше ') + fmtL(x.limit) + ' ₽'];
    if (num(x.price) !== null && (sh ? x.price >= x.stop : x.price <= x.stop)) return ['no', 'Цена у стопа — новый вход не рассматривается'];
    return ['no', 'Догонять поздно: цена ' + (sh ? 'ниже ' : 'выше ') + fmtL(x.limit) + ' ₽ — прибыль/риск до T1 хуже 1:1,5'];
  }
  function addTxt(x) {
    const sh = x.side === 'short', verb = sh ? 'Добрать шорт' : 'Докупить';
    if (x.group !== 'open' || x.stale) return '';
    if (x.t1_done) return verb + ' — нет: после T1 позицию не наращиваем';
    if (!x.add) {
      const rule = (x.rec && x.rec.add_rule) || '';
      if (!rule) return verb + ' — по плану выпуска ' + ddmm(x.rec.run) + ': только в зоне входа, за стопом — нет';
      const why = /^не /.test(rule) && rule.indexOf(':') > 0 ? rule.slice(rule.indexOf(':') + 1).trim() : 'вход одной ценой';
      return verb + ' — нет: ' + why;
    }
    return verb + (x.add_ok ? ': можно в зоне ' + zoneTxt(x.add) + ' ₽ — цена сейчас в ней' : ': только в зоне ' + zoneTxt(x.add) + ' ₽');
  }
  const levelsTxt = x => ['стоп ' + fmtL(x.stop) + (x.t1_done ? ' (безубыток)' : ''), 'T1 ' + fmtL(x.t1) + (x.t1_done ? ' ✓' : ' (1/2)'),
    'T2 ' + fmtL(x.t2), num(x.days_in_trade) !== null ? 'срок: прошло ' + x.days_in_trade + ' из ' + (x.rec ? x.rec.tdays : '') + ' торг. дн.' : '']
    .filter(Boolean).join(' · ');

  function dealCard(x, inDetail) {
    const k = tk(x.t) || {}, sh = x.side === 'short', res = num(x.result_pct);
    const fake = { t: x.t, dec: k.dec, bucket: 'go', sc: { entry: [x.entry_price, x.entry_price], stop: x.stop, tp: [{ price: x.t1 }, { price: x.t2 }] } };
    const j = joinTxt(x), a = addTxt(x);
    return `<div class="card${inDetail ? '' : ' tap'} scen deal"${inDetail ? '' : ` data-t="${x.t}"`}>
      <div class="top">${ava(x.t)}<div class="mid"><div class="t1">${esc(k.name || x.t)} <span class="pill ${sh ? 'sgo' : 'go'}">${sh ? 'шорт' : 'лонг'}</span></div>
        <div class="t2">вход ${ddmm(x.entry_date)} по ${fmtL(x.entry_price)} ₽ · выпуск ${ddmm(x.rec.run)}</div></div>
        <div class="right"><b>${fmtL(x.price)}</b><span class="${cls(res)}">${res !== null ? pct(res) : ''}</span></div></div>
      ${ladder(fake, x.price)}
      <div class="dl">${j ? `<div class="${j[0]}">${x.stale ? (j[0] === 'go' ? '↪️' : '⛔') : (j[0] === 'go' ? '✅' : '⛔')} ${esc(j[1])}</div>` : ''}${a ? `<div>➕ ${esc(a)}</div>` : ''}</div>
      <div class="small" style="margin-top:6px">${esc(levelsTxt(x))}</div>
    </div>`;
  }
  function pendRow(x) {
    const k = tk(x.t) || {}, sh = x.side === 'short', r = x.rec;
    const cond = CLOSE_KINDS.indexOf(r.kind) >= 0 ? (sh ? 'закрытие ниже ' : 'закрытие выше ') + fmtL(r.level) : 'до ' + zoneTxt(r.zone);
    const dist = num(x.price) ? ' (' + pct((r.level / x.price - 1) * 100) + ')' : '';
    const tail = x.crossed ? ' — цена за уровнем, ждём закрытия дня' : x.days_left ? ' · ещё ' + x.days_left + ' торг. дн.' : '';
    return `<button class="lrow" data-t="${x.t}">${ava(x.t)}<div class="mid"><div class="t1">${esc(k.name || x.t)}</div>
      <div class="t2">${x.t} · выпуск ${ddmm(r.run)}</div>
      <div class="t3">${pill(sh ? 'swait' : 'wait')}<span class="c">${esc(cond + dist + tail)}</span></div></div>
      <div class="right"><b>${fmtL(x.price)}</b></div></button>`;
  }
  function closedRow(x) {
    const k = tk(x.t) || {}, res = num(x.result_pct);
    const how = x.status === 't1' ? ({ t2: 'T1 и T2', breakeven: 'T1, остаток в безубыток', time: 'T1, остаток по сроку' }[x.remainder] || 'T1')
      : x.status === 'stop' ? 'стоп' : 'выход по сроку';
    return `<button class="lrow" data-t="${x.t}">${ava(x.t)}<div class="mid"><div class="t1">${esc(k.name || x.t)}${x.side === 'short' ? ' · шорт' : ''}</div>
      <div class="t2">вход ${ddmm(x.entry_date)} по ${fmtL(x.entry_price)} → ${how} ${ddmm(x.exit_date)}</div></div>
      <div class="right"><b class="${cls(res)}">${pct(res)}</b></div></button>`;
  }
  function dealGroups() {
    const all = dealItems();
    const weekAgo = new Date(Date.now() + 3 * 3600e3 - 7 * 864e5).toISOString().slice(0, 10);
    return { open: all.filter(x => x.group === 'open'), pend: all.filter(x => x.group === 'pending'),
             closed: all.filter(x => x.group === 'closed' && (x.exit_date || '') >= weekAgo) };
  }
  const dealsStamp = () => S.dealsAt ? 'по свечам Мосбиржи · ' + S.dealsAt + ' МСК, задержка 15 мин'
    : (S.d.deals && S.d.deals.asof ? 'на ' + ddmm(S.d.deals.asof.slice(0, 10)) + ', ' + S.d.deals.asof.slice(11, 16) + ' МСК' : '');

  // ---------- кусочки интерфейса ----------
  const IC = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10.3 12 3.6l8.5 6.7v8.9a1.4 1.4 0 0 1-1.4 1.4H15v-6.1H9v6.1H4.9a1.4 1.4 0 0 1-1.4-1.4z"/></svg>',
    stocks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 20.5h17"/><path d="m4.8 15.8 4.6-4.9 3.6 3.1 6.4-7.4"/><path d="M15.2 6.4h4.3v4.3"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.6"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    track: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7.2" width="17" height="12.6" rx="2.4"/><path d="M8.7 7.2V5.7a1.6 1.6 0 0 1 1.6-1.6h3.4a1.6 1.6 0 0 1 1.6 1.6v1.5"/><path d="M3.5 12.6h17"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4.5 7h15M4.5 12h15M4.5 17h15"/></svg>',
  };
  const TABS = [['home', 'Главная'], ['stocks', 'Акции'], ['track', 'Сделки'], ['cal', 'События'], ['more', 'Ещё']];
  const mi = (ic, c, title, sub, attrs) => `<button class="mi" ${attrs}><span class="ic" style="--c:${c}">${ic}</span><span class="tx"><b>${title}</b><span>${sub}</span></span><span class="ch">›</span></button>`;

  const ava = (t, big) => `<div class="ava${big ? ' big' : ''}" style="--h:${hue(t)}">${esc(t.length <= 3 ? t : t.slice(0, 2))}</div>`;
  const pill = b => `<span class="pill ${b}">${B[b]}</span>`;

  function spark(k) {
    const v = (k.spark || []).filter(x => x != null);
    if (v.length < 2) return '<svg class="spark"></svg>';
    const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
    const pts = v.map((x, i) => (i / (v.length - 1) * 52 + 1).toFixed(1) + ',' + (24 - (x - lo) / r * 22).toFixed(1)).join(' ');
    const col = v[v.length - 1] >= v[0] ? 'var(--up)' : 'var(--down)';
    return `<svg class="spark" viewBox="0 0 54 26" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  // Лестница сценария: стоп — зона входа — T1 — T2, точка — текущая цена
  function ladder(k, last) {
    const sc = k.sc;
    if (!sc || sc.stop == null || !(sc.tp && sc.tp.length) || k.bucket === 'no') return '';
    const ez = (sc.entry || []).filter(x => x != null);
    const e0 = ez.length ? Math.min(...ez) : null, e1 = ez.length ? Math.max(...ez) : null;
    const t1 = sc.tp[0] && sc.tp[0].price, t2 = sc.tp[1] && sc.tp[1].price;
    const vals = [sc.stop, e0, e1, t1, t2, last].filter(v => num(v) !== null);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * 0.05 || 1;
    lo -= pad; hi += pad;
    const P = v => (v - lo) / (hi - lo) * 100;
    const marks = [['Стоп', sc.stop, 'var(--no)'], ['Вход', e1 != null ? (e0 + e1) / 2 : null, 'var(--wait)'],
                   ['T1', t1, 'var(--go)'], ['T2', t2, 'var(--go)']].filter(m => num(m[1]) !== null)
      .map(m => ({ name: m[0], v: m[1], c: m[2], p: P(m[1]) })).sort((a, b) => a.p - b.p);
    let prev = -100;
    marks.forEach(m => { m.row = m.p - prev < 19 ? 1 : 0; if (!m.row) prev = m.p; });
    const segs = [];
    if (e0 != null) {
      // шорт: стоп выше зоны, цели ниже — отрезки риска и прибыли зеркальные
      const short = num(t1) !== null && t1 < e0;
      const rs = short ? [e1, sc.stop] : [sc.stop, e0], gs = short ? [t2 || t1, e0] : [e1, t2 || t1];
      const seg = (cl, a, b) => `<i class="${cl}" style="left:${P(Math.min(a, b))}%;width:${Math.max(0, Math.abs(P(b) - P(a)))}%"></i>`;
      segs.push(seg('seg-risk', rs[0], rs[1]));
      segs.push(`<i class="seg-zone" style="left:${P(e0)}%;width:${Math.max(1.2, P(e1) - P(e0))}%"></i>`);
      segs.push(seg('seg-gain', gs[0], gs[1]));
    }
    const lbl = marks.map(m => `<i class="mk" style="left:${m.p}%;--c:${m.c}"></i><span class="lb r${m.row}" style="left:${Math.min(94, Math.max(6, m.p))}%;--c:${m.c}"><b>${m.name}</b>${fmt(m.v, k.dec)}</span>`).join('');
    const now = num(last) !== null ? `<i class="now" style="left:${P(last)}%" title="цена сейчас"></i>` : '';
    return `<div class="ladder"><i class="rail"></i>${segs.join('')}${lbl}${now}</div>`;
  }

  // Условие сценария с расстоянием от текущей (живой) цены: «до 5 294 (−13,3%)», «выше 15,89 (+4,5%)»
  function condLive(k, last) {
    const sc = k.sc || {}, ez = (sc.entry || []).filter(x => x != null);
    if (k.bucket !== 'wait' || num(last) === null || !ez.length) return k.cond;
    if (sc.mode === 'breakout') { const lv = Math.min(...ez); return `выше ${fmt(lv, k.dec)} (${pct((lv / last - 1) * 100)})`; }
    const lv = num(sc.wait) !== null ? sc.wait : Math.max(...ez);
    return sc.mode === 'now' ? k.cond : `до ${fmt(lv, k.dec)} (${pct((lv / last - 1) * 100)})`;
  }

  function statusNote(k, last) {
    const sc = k.sc || {};
    if (k.bucket === 'no' || num(last) === null || sc.stop == null) return '';
    if (last < sc.stop) return '<span class="pill no">цена ниже стопа сценария</span>';
    const t1 = sc.tp && sc.tp[0] && sc.tp[0].price;
    if (k.bucket === 'wait' && num(t1) !== null && last > t1) return '<span class="pill n">цена ушла выше T1 — уровни выпуска устарели</span>';
    const ez = (sc.entry || []).filter(x => x != null);
    if (k.bucket === 'wait' && sc.mode !== 'breakout' && ez.length && last <= Math.max(...ez) * 1.002)
      return '<span class="pill wait">цена в зоне входа — смотри условие</span>';
    if (k.bucket === 'wait' && sc.mode === 'breakout' && ez.length && last > Math.min(...ez))
      return '<span class="pill wait">цена выше уровня — нужно закрытие дня</span>';
    return '';
  }

  // ---------- шорт (с 11.10.2026): тот же формат сценария, стоп выше, цели ниже ----------
  const SB = { sgo: 'go', swait: 'wait', sno: 'no' };
  function sk(t) {
    const k = tk(t);
    return { t, name: k.name, sector: k.sector, dec: k.dec, sc: k.ssc, br: k.sbr, bucket: SB[k.sbucket] || 'no',
             cond: k.scond || '', reason: k.sreason || '', why: k.swhy || '' };
  }
  function condLiveS(s, last) {
    const sc = s.sc || {}, ez = (sc.entry || []).filter(x => x != null);
    if (s.bucket !== 'wait' || num(last) === null || !ez.length) return s.cond;
    if (sc.mode === 'breakdown') { const lv = Math.max(...ez); return `ниже ${fmt(lv, s.dec)} (${pct((lv / last - 1) * 100)})`; }
    const lv = num(sc.wait) !== null ? sc.wait : Math.min(...ez);
    return sc.mode === 'now' ? s.cond : `до ${fmt(lv, s.dec)} (${pct((lv / last - 1) * 100)})`;
  }
  function statusNoteS(s, last) {
    const sc = s.sc || {};
    if (s.bucket === 'no' || num(last) === null || sc.stop == null) return '';
    if (last > sc.stop) return '<span class="pill no">цена выше стопа шорта</span>';
    const t1 = sc.tp && sc.tp[0] && sc.tp[0].price;
    if (s.bucket === 'wait' && num(t1) !== null && last < t1) return '<span class="pill n">цена ушла ниже T1 — уровни выпуска устарели</span>';
    const ez = (sc.entry || []).filter(x => x != null);
    if (s.bucket === 'wait' && sc.mode !== 'breakdown' && ez.length && last >= Math.min(...ez) * 0.998)
      return '<span class="pill swait">цена в зоне продажи — смотри условие</span>';
    if (s.bucket === 'wait' && sc.mode === 'breakdown' && ez.length && last < Math.max(...ez))
      return '<span class="pill swait">цена ниже уровня — нужно закрытие дня</span>';
    return '';
  }
  function scenCardS(t) {
    const s = sk(t), sc = s.sc || {}, k = tk(t), last = priceOf(t), chg = chgOf(t);
    const meta = [];
    if (sc.strength) meta.push(`<span>Сигнал: <b>${esc(sc.strength)}</b></span>`);
    if (sc.days_med) meta.push(`<span>T1 обычно ~${sc.days_med} дн.</span>`);
    const st = statusNoteS(s, last);
    return `<div class="card tap scen" data-t="${t}">
      <div class="top">${ava(t)}<div class="mid"><div class="t1">${esc(k.name)}</div><div class="t2">${t} · ${esc(k.sector)}</div></div>
        <div class="right"><b>${fmt(last, k.dec)}</b><span class="${cls(chg)}">${pct(chg, 2)}</span></div></div>
      ${ladder(s, last)}
      <div class="meta">${pill(k.sbucket)}<span>${esc(condLiveS(s, last))}</span></div>
      ${meta.length || st ? `<div class="meta">${meta.join('')}${st}</div>` : ''}
    </div>`;
  }
  function intraCard() {
    const ix = S.d.intraday;
    if (!ix) return '';
    const c = (ix.candidates || []).map(x => `<span class="tag tap" data-t="${esc(x.t)}">${esc(x.t)} <b>${x.side === 'long' ? 'лонг' : 'шорт'}</b></span>`).join('');
    return `<div class="sec">Внутри дня · ${WD[dateObj(ix.session).getDay()]} ${ddmm(ix.session)}</div>
      <div class="card"><div class="p" style="margin:0">${esc(ix.text || '')}</div>${c ? `<div class="tags" style="margin-top:8px">${c}</div>` : ''}
      <div class="small" style="margin-top:8px">Уровни по каждой бумаге — в её карточке. Эксперимент: вход по закрытию часа за вчерашним диапазоном, выход до конца основной сессии.</div></div>`;
  }

  function liveChip() {
    if (S.liveAt) return `<span class="chip"><i class="dot"></i>Цены Мосбиржи · ${esc(S.liveAt)}</span>`;
    return `<span class="chip">${esc(S.d.live_note || ('цены на закрытие ' + ddmm(S.d.data_date)))}</span>`;
  }
  function nextChip() {
    const n = (S.d.schedule && S.d.schedule.next || []).find(x => x.slice(0, 16) > new Date().toISOString().slice(0, 16)) || (S.d.schedule && S.d.schedule.next || [])[0];
    if (!n) return '';
    const d = dateObj(n);
    return `<span class="chip">Следующий обзор: ${WD[d.getDay()]} ${ddmm(n)}, ${n.slice(11, 16)} МСК</span>`;
  }

  function kpis() {
    const m = S.d.macro || {}, im = m.imoex || {}, br = m.brent || {};
    const imLast = S.imoex ? S.imoex.last : im.last, imChg = S.imoex ? S.imoex.chg : im.chg_1d_pct;
    const mon = /^\d{4}-(\d{2})/.exec(m.inflation_month || '');
    const items = [];
    if (num(imLast) !== null) items.push(['Индекс IMOEX', fmt(imLast, 0), `<em class="${cls(imChg)}">${pct(imChg)} за день</em>`]);
    if (num(m.key_rate) !== null) items.push(['Ставка ЦБ', trim0(fmt(m.key_rate, 2)) + '%', `<em>решение ${ddmm(m.next_cbr_meeting)}</em>`]);
    if (num(m.inflation_yoy) !== null) items.push(['Инфляция', trim0(fmt(m.inflation_yoy, 1)) + '%', `<em>г/г${mon ? ' в ' + MON_IN[+mon[1] - 1] : ''} · цель ${trim0(fmt(num(m.inflation_target) || 4, 0))}%</em>`]);
    if (num(br.price) !== null) items.push(['Нефть Brent', '$' + trim0(fmt(br.price, 1)), `<em class="${cls(br.chg_1w_pct)}">${pct(br.chg_1w_pct)} за неделю</em>`]);
    if (num(m.usd_rub) !== null) items.push(['Доллар', trim0(fmt(m.usd_rub, 2)) + ' ₽', `<em>курс ЦБ на ${ddmm(m.fx_date)}</em>`]);
    if (num(m.cny_rub) !== null) items.push(['Юань', trim0(fmt(m.cny_rub, 2)) + ' ₽', `<em>курс ЦБ на ${ddmm(m.fx_date)}</em>`]);
    return items.map(x => `<div class="kpi"><span>${x[0]}</span><b>${x[1]}</b>${x[2]}</div>`).join('');
  }

  function scenCard(t) {
    const k = tk(t), sc = k.sc || {}, last = priceOf(t), chg = chgOf(t);
    const meta = [];
    if (sc.strength) meta.push(`<span>Сигнал: <b>${esc(sc.strength)}</b></span>`);
    if (sc.days_med) meta.push(`<span>T1 обычно ~${sc.days_med} дн.</span>`);
    const st = statusNote(k, last);
    return `<div class="card tap scen" data-t="${t}">
      <div class="top">${ava(t)}<div class="mid"><div class="t1">${esc(k.name)}</div><div class="t2">${t} · ${esc(k.sector)}</div></div>
        <div class="right"><b>${fmt(last, k.dec)}</b><span class="${cls(chg)}">${pct(chg, 2)}</span></div></div>
      ${ladder(k, last)}
      <div class="meta">${pill(k.bucket)}<span>${esc(condLive(k, last))}</span></div>
      ${meta.length || st ? `<div class="meta">${meta.join('')}${st}</div>` : ''}
    </div>`;
  }

  function trackMini() {
    const tr = S.d.track || {}, L = tr.last_30d || {};
    if (!L.entered) {
      return `<div class="p" style="margin:0">Учёт ведём${tr.since ? ' с ' + ddmm(tr.since) : ''}: каждый сценарий проверяется по дневным свечам — был ли вход и что пришло раньше, T1 или стоп. Входов по уровням пока не было.</div>
        <div class="tags" style="margin-top:10px"><span class="tag">Сценариев <b>${L.signals || 0}</b></span><span class="tag">Ждут входа <b>${L.pending || 0}</b></span></div>`;
    }
    const tags = [['Был вход', L.entered], ['T1', L.t1], ['Стоп', L.stop], ['По сроку', L.time_exit], ['В позиции', L.in_position]]
      .filter(x => x[1]).map(x => `<span class="tag">${x[0]} <b>${x[1]}</b></span>`).join('');
    const avg = num(L.avg_result_pct_closed) !== null ? `<span class="tag">Средний итог <b class="${cls(L.avg_result_pct_closed)}">${pct(L.avg_result_pct_closed)}</b></span>` : '';
    return `<div class="tags">${tags}${avg}</div><div class="small" style="margin-top:8px">за 30 дней · по плану 1/2 на T1, без комиссий</div>`;
  }

  function eventsList(list) {
    if (!list.length) return '<div class="empty" style="padding:10px">Ближайших событий в данных нет</div>';
    return list.map(e => {
      const d = dateObj(e.date), n = daysTo(e.date);
      const when = n === 0 ? 'сегодня' : n === 1 ? 'завтра' : n > 1 ? 'через ' + n + ' дн.' : '';
      return `<div class="ev"><div class="d"><b>${d.getDate()}</b><span>${MON3[d.getMonth()]}</span></div>
        <div class="t">${esc(e.text)}<span class="small">${WD[d.getDay()]}${when ? ' · ' + when : ''}${e.sub ? ' · ' + esc(e.sub) : ''}</span></div></div>`;
    }).join('');
  }

  function newsLinks(list) {
    if (!list || !list.length) return '<div class="empty" style="padding:10px">Новостей нет</div>';
    return list.filter(n => safeUrl(n.url)).map(n => `<a data-link="${esc(n.url)}">${esc(n.title)}<span class="small">${esc(n.source || '')} · ${ddmm(n.date)}</span></a>`).join('');
  }

  function foot() {
    const d = S.d;
    return `<div class="foot">${esc(d.disclaimer)}<br><br>Выпуск ${dmy(d.run_date)}, данные на закрытие ${ddmm(d.data_date)}. Цены — MOEX ISS с задержкой 15 минут.</div>`;
  }

  // ---------- разделы ----------
  function tiles() {
    const d = S.d;
    if (!d.short_on) return ['go', 'wait', 'no'].map(b => [b, d.groups[b].length]);
    return [['go', d.groups.go.length], ['wait', d.groups.wait.length], ['aside', (d.aside || []).length],
            ['sgo', (d.sgroups.sgo || []).length], ['swait', (d.sgroups.swait || []).length]];
  }
  // фильтр списка акций: группы лонга, шорта и «в стороне»
  function inFilter(t, f) {
    const k = tk(t);
    if (f === 'all') return true;
    if (f === 'aside') return (S.d.aside || []).includes(t);
    if (f === 'short') return k.sbucket === 'sgo' || k.sbucket === 'swait';
    if (f === 'sgo' || f === 'swait') return k.sbucket === f;
    return k.bucket === f;
  }

  function vHome() {
    const d = S.d, u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    const scen = d.groups.go.concat(d.groups.wait);
    const sscen = d.short_on ? (d.sgroups.sgo || []).concat(d.sgroups.swait || []) : [];
    return `
    <section class="hero">
      <div class="hello">${u && u.first_name ? 'Привет, ' + esc(u.first_name) : 'Привет'} 👋</div>
      <h1>Голубые фишки</h1>
      <div class="sub">Выпуск ${esc(d.issue_long)} · закрытие ${ddmm(d.data_date)}</div>
      <div class="chips">${liveChip()}${nextChip()}</div>
    </section>
    ${d.stale && d.stale.length ? `<div class="warnbox">⚠️ Устарело или нет данных: ${esc(d.stale.join('; '))}</div>` : ''}
    <div class="kpis">${kpis()}</div>
    <div class="sec">Сигналы выпуска</div>
    <div class="tiles">${tiles().map(x => `<button class="tile ${x[0]}" data-filter-go="${x[0] === 'sgo' || x[0] === 'swait' ? 'short' : x[0]}"><b>${x[1]}</b><span>${B[x[0]]}</span></button>`).join('')}</div>
    ${homeDeals()}
    <div class="sec">${d.short_on ? 'Лонг — покупка' : 'Сценарии'}<a data-tab="stocks">Все акции</a></div>
    ${scen.length ? scen.map(scenCard).join('') : `<div class="card"><div class="empty"><span class="e">🧘</span>Сейчас по правилам нет ни одного сценария${d.short_on ? ' на покупку' : ''} — бумаги ждут своих уровней.</div></div>`}
    ${d.short_on ? `<div class="sec">Шорт — продажа</div>${d.short_note ? `<div class="warnbox" style="margin-bottom:10px">${esc(d.short_note[0].toUpperCase() + d.short_note.slice(1))}. Шорт у брокера платный; через отсечку шорт платит дивиденд.</div>` : ''}
      ${sscen.length ? sscen.map(scenCardS).join('') : `<div class="card"><div class="empty"><span class="e">🧘</span>Шорт-сценариев по правилам сейчас нет.</div></div>`}` : ''}
    ${intraCard()}
    <div class="sec">Прошлые сценарии<a data-tab="track">Подробнее</a></div>
    <div class="card tap" data-tab="track">${trackMini()}</div>
    <div class="sec">Ближайшие события<a data-tab="cal">Все</a></div>
    <div class="card">${eventsList(upcoming(21).slice(0, 3))}</div>
    <div class="sec">Новости рынка</div>
    <div class="card news">${newsLinks(d.news.slice(0, 6))}</div>
    ${foot()}`;
  }

  // Главная: открытые сделки сразу под плитками — то, о чём просил Костя
  function homeDeals() {
    if (!S.d.deals) return '';
    const g = dealGroups();
    const pend = g.pend.map(x => esc(x.t) + (x.side === 'short' ? ' (шорт)' : '')).join(', ');
    return `<div class="sec">Открытые сделки<a data-tab="track">${g.open.length ? 'Все' : 'Подробнее'}</a></div>
      ${g.open.length ? g.open.map(x => dealCard(x)).join('')
        : `<div class="card tap" data-tab="track"><div class="p" style="margin:0">Открытых сделок нет: ни один сценарий не дошёл до входа.${pend ? ' Ждут входа: ' + pend + '.' : ''}</div></div>`}`;
  }

  function vStocks() {
    const d = S.d;
    let list = d.order.slice();
    if (d.short_on && S.filter === 'no') S.filter = 'aside';
    if (!d.short_on && ['aside', 'short', 'sgo', 'swait'].includes(S.filter)) S.filter = 'all';
    if (S.filter !== 'all') list = list.filter(t => inFilter(t, S.filter));
    if (S.sort === 'chg') list.sort((a, b) => (num(chgOf(b)) ?? -1e9) - (num(chgOf(a)) ?? -1e9));
    const cnt = b => d.order.filter(t => inFilter(t, b)).length;
    const rows = list.map(t => {
      const k = tk(t), last = priceOf(t), chg = chgOf(t);
      const shortOn = d.short_on && (k.sbucket === 'sgo' || k.sbucket === 'swait');
      const longOn = k.bucket !== 'no';
      // строка: группа лонга, а если лонга нет, но есть шорт — группа шорта; оба сценария — две плашки
      const p = !longOn && shortOn ? `${pill(k.sbucket)}<span class="c">${esc(condLiveS(sk(t), last))}</span>`
        : `${pill(d.short_on && !longOn ? 'aside' : k.bucket)}<span class="c">${esc(condLive(k, last))}</span>${longOn && shortOn ? ' ' + pill(k.sbucket) : ''}`;
      return `<button class="lrow" data-t="${t}">${ava(t)}<div class="mid"><div class="t1">${esc(k.name)}</div>
        <div class="t2">${t} · ${esc(k.sector)}${k.rank ? ' · №' + k.rank + ' в рейтинге' : ''}</div>
        <div class="t3">${p}</div></div>
        ${spark(k)}<div class="right"><b>${fmt(last, k.dec)}</b><span class="${cls(chg)}">${pct(chg, 2)}</span></div></button>`;
    }).join('');
    const segs = d.short_on ? [['all', 'Все'], ['go', 'Брать'], ['wait', 'Ждать'], ['short', 'Шорт'], ['aside', 'В стороне']]
                            : [['all', 'Все'], ['go', 'Брать'], ['wait', 'Ждать'], ['no', 'Не брать']];
    return `
    <section class="hero"><h1>Акции</h1><div class="sub">${d.order.length} голубых фишек Мосбиржи · выпуск ${esc(d.issue_long)}</div></section>
    <div class="seg">${segs.map(x => `<button data-filter="${x[0]}" class="${S.filter === x[0] ? 'on' : ''}">${x[1]} · ${cnt(x[0])}</button>`).join('')}</div>
    <div class="sortrow"><button data-sort="rank" class="${S.sort === 'rank' ? 'on' : ''}">По рейтингу</button><button data-sort="chg" class="${S.sort === 'chg' ? 'on' : ''}">По изменению за день</button></div>
    <div class="card list" style="padding:0">${rows || '<div class="empty"><span class="e">🔍</span>В этой группе сейчас пусто</div>'}</div>
    ${foot()}`;
  }

  function vCal() {
    const d = S.d, today = todayIso();
    const divs = d.order.map(t => Object.assign({ t }, tk(t).div)).filter(x => x.next_record_date && x.next_record_date >= today && num(x.next_div_rub) !== null)
      .sort((a, b) => a.next_record_date < b.next_record_date ? -1 : 1);
    const cbr = ((d.macro && d.macro.cbr_meetings) || []).filter(x => x >= today);
    const next = (d.schedule && d.schedule.next) || [];
    return `
    <section class="hero"><h1>События</h1><div class="sub">Отсечки, заседания ЦБ и выпуски обзора</div></section>
    <div class="sec">Ближайшие 6 недель</div>
    <div class="card">${eventsList(upcoming(45))}</div>
    <div class="sec">Дивиденды впереди</div>
    <div class="card">${divs.length ? divs.map(x => {
      const dd = dateObj(x.next_record_date);
      return `<div class="ev tap" data-t="${x.t}"><div class="d"><b>${dd.getDate()}</b><span>${MON3[dd.getMonth()]}</span></div>
        <div class="t"><b>${esc(tk(x.t).name)}</b> · ${trim0(fmt(x.next_div_rub, 2))} ₽${num(x.forward_yield_12m) !== null ? ' · ' + pct(x.forward_yield_12m, 1, false) + ' за 12 мес.' : ''}
        <span class="small">реестр ${dmy(x.next_record_date)}${x.last_buy ? (x.last_buy < today ? ' · последний день покупки прошёл (' + ddmm(x.last_buy) + ')' : ' · купить до ' + ddmm(x.last_buy) + ' включительно') : ''}${x.next_period ? ' · ' + esc(x.next_period) : ''} · ${esc(x.next_source || x.source || 'прогноз Доходъ')}</span></div></div>`;
    }).join('') : '<div class="empty" style="padding:10px">Прогнозов дивидендов нет</div>'}
    <div class="small" style="margin-top:8px">Последний день покупки под дивиденд — за торговый день до реестра (режим Т+1).</div></div>
    <div class="sec">Заседания ЦБ по ставке</div>
    <div class="card"><div class="tags">${cbr.length ? cbr.map(x => `<span class="tag"><b>${ddmm(x)}</b> ${WD[dateObj(x).getDay()]}</span>`).join('') : 'нет данных'}</div>
    <div class="small" style="margin-top:8px">Сейчас ставка ${trim0(fmt(d.macro.key_rate, 2))}%</div></div>
    <div class="sec">Выпуски обзора</div>
    <div class="card"><div class="tags">${next.map(x => `<span class="tag"><b>${WD[dateObj(x).getDay()]} ${ddmm(x)}</b> ${x.slice(11, 16)}</span>`).join('')}</div>
    <div class="small" style="margin-top:8px">Расписание: ${esc((d.schedule.days || []).join(', '))} в ${esc(d.schedule.time)} МСК — обзор обновляется здесь, в меню</div></div>
    ${foot()}`;
  }

  const ST = { pending: ['ждём входа', 'n'], in_position: ['в позиции', 'wait'], open: ['в позиции', 'wait'], t1: ['дошёл до T1', 'go'],
               t2: ['дошёл до T2', 'go'], stop: ['стоп', 'no'], time_exit: ['выход по сроку', 'n'], expired: ['вход не случился', 'n'],
               not_entered: ['вход не случился', 'n'], replaced: ['заменён выпуском', 'n'] };

  function vTrack() {
    const tr = S.d.track || {}, L = tr.last_30d || {}, items = tr.items || [];
    const tiles = [['Сценариев', L.signals || 0, ''], ['Был вход', L.entered || 0, ''], ['Дошли до T1', L.t1 || 0, 'up'],
                   ['Стоп', L.stop || 0, 'down'], ['По сроку', L.time_exit || 0, ''],
                   ['Средний итог', num(L.avg_result_pct_closed) !== null ? pct(L.avg_result_pct_closed) : '—', cls(L.avg_result_pct_closed)]];
    const g = dealGroups(), stamp = dealsStamp();
    return `
    <section class="hero"><h1>Сделки</h1><div class="sub">Открытые сделки по сценариям, что ждёт входа и как сбывались прошлые</div>
      ${stamp ? `<div class="chips"><span class="chip">${S.dealsAt ? '<i class="dot"></i>' : ''}${esc(stamp)}</span></div>` : ''}</section>
    <div class="sec">Открытые сделки</div>
    ${g.open.length ? g.open.map(x => dealCard(x)).join('') : '<div class="card"><div class="empty"><span class="e">🧘</span>Открытых сделок нет — ни один сценарий не дошёл до входа</div></div>'}
    ${g.pend.length ? `<div class="sec">Ждут входа</div><div class="card list" style="padding:0">${g.pend.map(pendRow).join('')}</div>` : ''}
    ${g.closed.length ? `<div class="sec">Закрыты за неделю</div><div class="card list" style="padding:0">${g.closed.map(closedRow).join('')}</div>` : ''}
    <div class="card"><div class="small">«Успеть зайти» — до какой цены вход ещё даёт прибыль/риск до T1 не хуже 1:1,5. «Докупить» — зона из плана сценария; после T1 и за стопом позицию не наращиваем. Итог — по плану (1/2 на T1), без комиссий${S.d.short_on ? '; у шорта без дивиденда' : ''}.</div></div>
    <div class="sec">Уведомления в чат</div>
    <div class="card menu" style="padding:0">
      ${mi('🔔', '#22a861', 'Сообщать о сделках', 'цена дошла до входа — «пора входить» и план; T1, стоп, срок', 'data-cmd="dl_on"')}
      ${mi('🔕', '#8a909a', 'Не сообщать', 'в чат — ничего, только этот раздел', 'data-cmd="dl_off"')}
    </div>
    <div class="sec">Учёт сценариев</div>
    <div class="card"><div class="small" style="margin-bottom:8px">Сбываются ли сценарии прошлых выпусков${tr.since ? ' · с ' + ddmm(tr.since) : ''}</div><div class="grid">${tiles.map(x => `<div><span>${x[0]}</span><b class="${x[2]}">${x[1]}</b></div>`).join('')}</div>
      <div class="small" style="margin-top:10px">за 30 дней${tr.as_of ? ', свечи по ' + ddmm(tr.as_of) : ''}</div></div>
    <div class="sec">Все сценарии выпусков</div>
    <div class="card list" style="padding:0">${items.length ? items.map(it => {
      const s = ST[it.status] || [it.status || '?', 'n'];
      const res = num(it.result_pct);
      const note = String(it.note || '').replace(new RegExp('^' + s[0] + '\\s*[:—-]?\\s*', 'i'), '');
      return `<button class="lrow" data-t="${esc(it.ticker)}">${ava(it.ticker || '?')}<div class="mid"><div class="t1">${esc(it.ticker)} · выпуск ${ddmm(it.run_date)}</div>
        <div class="t2">${esc(it.verdict || '')}${it.signal_strength ? ' · сигнал ' + esc(it.signal_strength) : ''}</div>
        <div class="t3"><span class="pill ${s[1]}">${esc(s[0])}</span><span class="c">${esc(note)}</span></div></div>
        <div class="right">${res !== null ? `<b class="${cls(res)}">${pct(res)}</b>` : ''}</div></button>`;
    }).join('') : '<div class="empty"><span class="e">🗂</span>Пока пусто — первые сценарии появятся после выпуска</div>'}</div>
    <div class="card"><details><summary>Как считаем</summary><p class="p">${esc(tr.method || 'Каждый сценарий проверяется по дневным свечам после даты выпуска.')}</p></details></div>
    ${foot()}`;
  }

  const GLOSSARY = [
    ['Брать · ждать цены · не брать', 'Группы по формальным правилам рейтинга и теханализа: прибыль к риску от 1,5, стоп не дальше 12%, тренд, история похожих случаев. Это не приказ и не совет — решение за тобой.'],
    ['Вход по сценарию', '«Брать» — сценарий в силе по текущим ценам. «Ждать цены» — сценарий заработает, если цена дойдёт до уровня за отведённые дни (откат к поддержке и разворотная свеча) или закроется выше уровня (пробой).'],
    ['Стоп', 'Закрытие дня ниже стопа — сценарий сломан: выход с убытком, без усреднения.'],
    ['T1 и T2', 'Ориентиры фиксации: половина — на T1, стоп остатка переносится в безубыток (цена входа), остаток — на T2.'],
    ['Сила сигнала и «39/47%, n=188»', 'В 188 похожих ситуациях в прошлом T1 приходила раньше стопа в 39% случаев, стоп раньше — в 47%. Это частота прошлого, а не вероятность успеха.'],
    ['Тайм-стоп', 'Если T1 не пришла за указанное число торговых дней — сценарий устарел: выход или пересмотр.'],
    ['Докупка', 'Только пока сценарий в силе: внутри зоны входа (вход частями). Ниже зоны, ниже стопа и в сломанном тренде — не докупать.'],
    ['Открытые сделки', 'Сценарии выпусков, по которым по правилам был вход: когда и по какой цене, итог по плану сейчас, «успеть зайти» — до какой цены прибыль/риск до T1 не хуже 1:1,5, «докупить» — зона из плана. Если вышел выпуск новее, новые деньги — по его сценарию, а открытая сделка ведётся по своему плану. Включи «Сообщать о сделках» — бот напишет «пора входить» с планом, а потом о T1, стопе и сроке.'],
    ['Рейтинг', 'Сила бумаги внутри сектора: стоимость, качество, дивиденды, импульс, мнение аналитиков, рост. Итог — 60% силы и 40% теханализа.'],
    ['Шорт', 'Те же правила зеркально: продажа у сопротивления, на отскоке вверх или после закрытия ниже поддержки; стоп выше входа, цели ниже. Шорт у брокера платный, через отсечку шорт платит дивиденд. В истории шорт по этим правилам слабее покупок — это видно в строке проверки.'],
    ['Внутри дня', 'Правило пробоя вчерашнего диапазона по часовым свечам основной сессии: вход по закрытию часа за уровнем до 17:00, выход до конца сессии. Кандидат — только если у бумаги правило давало перевес в похожих днях после комиссии; иначе это уровни для наблюдения.'],
  ];

  function vMore() {
    const d = S.d;
    return `
    <section class="hero"><h1>Ещё</h1><div class="sub">Действия, расписание и как читать обзор</div></section>
    <div class="sec">Действия</div>
    <div class="card menu" style="padding:0">
      ${mi('🔄', '#2b7cff', 'Свежий обзор сейчас', 'бот соберёт за 1–3 минуты и пришлёт в чат', 'data-cmd="top"')}
      ${mi('🖼', '#8b5cf6', 'Графики и PDF-отчёт', 'альбом графиков и полный отчёт — в чат', 'data-cmd="report"')}
      ${mi('📄', '#0ea5a4', 'Последний выпуск', 'текст обзора от ' + ddmm(d.run_date), 'data-act="digest"')}
      ${mi('💬', '#f59e0b', 'Задать вопрос', 'текстом или голосовым в чате с ботом', 'data-cmd="ask"')}
      ${mi('🔔', '#22a861', 'Обзор ещё и в чат', 'присылать выпуск по расписанию в чат с ботом', 'data-cmd="sub_on"')}
      ${mi('🔕', '#8a909a', 'Обзор только в меню', 'в чат не присылать (так по умолчанию)', 'data-cmd="sub_off"')}
    </div>
    <div class="sec">Расписание</div>
    <div class="card"><b>${esc((d.schedule.days || []).join(', '))} в ${esc(d.schedule.time)} МСК</b><div class="p">Обзор обновляется здесь, в меню, в чат бот сам не пишет: все 15 фишек — лонг (брать, ждать цены), шорт, внутри дня и что в стороне, с уровнями, стопами, целями и планом после входа.</div></div>
    <div class="sec">Как читать обзор</div>
    <div class="card">${GLOSSARY.map(g => `<details><summary>${esc(g[0])}</summary><p class="p">${esc(g[1])}</p></details>`).join('')}</div>
    <div class="sec">Источники данных</div>
    <div class="card"><ul class="dots" style="margin:0">${(d.sources || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
    ${foot()}`;
  }

  const VIEWS = { home: vHome, stocks: vStocks, cal: vCal, track: vTrack, more: vMore };

  // ---------- карточка акции ----------
  // карточка: шорт-сценарий (с 11.10.2026)
  function shortDetail(t, last) {
    const s = sk(t), sc = s.sc, br = s.br, k = tk(t);
    if (!S.d.short_on || !sc) return '';
    if (s.bucket === 'no') return `<div class="sec">Шорт</div><div class="card"><div class="p" style="margin:0">Шорта нет: ${esc(s.reason || 'по правилам продажи нет')}.</div></div>`;
    const ez = (sc.entry || []).filter(x => x != null);
    const zone = ez.length ? (Math.min(...ez) === Math.max(...ez) ? fmt(ez[0], k.dec) : fmt(Math.min(...ez), k.dec) + '–' + fmt(Math.max(...ez), k.dec)) : '—';
    const ref = sc.wait || (ez.length ? Math.min(...ez) : null);
    const tp = sc.tp || [];
    let html = `<div class="sec">Шорт-сценарий</div><div class="card">${ladder(s, last)}
        <div class="kv">
          <div><span>Продажа по сценарию</span><b>${zone}</b><i>${num(ref) !== null && num(last) !== null ? pct((ref / last - 1) * 100) + ' от цены' : ''}${sc.entry_min ? ' · не ниже ' + fmt(sc.entry_min, k.dec) : ''}</i></div>
          <div><span>Стоп</span><b class="down">${fmt(sc.stop, k.dec)}</b><i>${pct(sc.stop_pct)} от входа</i></div>
          ${tp.map((x, i) => `<div><span>T${i + 1}${x.share ? ' · ' + esc(x.share) : ''}</span><b class="up">${fmt(x.price, k.dec)}</b><i>${pct(x.pct)} от входа</i></div>`).join('')}
          <div><span>Прибыль / риск</span><b>${(sc.rr || []).map(x => trim0(fmt(x, 1))).join(' · ') || '—'}</b><i>для T1 · T2</i></div>
          <div><span>T1 обычно</span><b>${sc.days_med ? '~' + sc.days_med + ' дн.' : '—'}</b><i>${sc.days_p75 ? '75% случаев — до ' + sc.days_p75 + ' дн.' : 'торговых дней'}</i></div>
        </div>
        ${sc.plan && sc.plan.entry ? `<div class="rule">${esc(sc.plan.entry)}${sc.trigger ? '. Условие: ' + esc(sc.trigger) : ''}.</div>` : ''}
        ${sc.inval ? `<div class="small" style="margin-top:8px">Сценарий отменяется: ${esc(sc.inval)}${sc.time_stop ? ' · тайм-стоп ' + sc.time_stop + ' торг. дн.' : ''}</div>` : ''}
        ${s.why ? `<div class="small" style="margin-top:8px">Почему: ${esc(s.why)}.</div>` : ''}
        <div class="small" style="margin-top:6px">Риск: ${esc(sc.risk || 'резкий рост выбивает стоп')}; шорт у брокера платный, через отсечку шорт платит дивиденд.</div>
      </div>`;
    if (br && num(br.n) !== null) {
      const pt = num(br.pt) || 0, ps = num(br.ps) || 0, pn = Math.max(0, 1 - pt - ps);
      html += `<div class="sec">Сила сигнала шорта</div><div class="card">
        <div style="display:flex;align-items:center;gap:8px"><span class="pill ${sc.strength === 'сильный' ? 'go' : sc.strength === 'средний' ? 'wait' : 'n'}">сигнал ${esc(sc.strength || '—')}</span><span class="small">n = ${br.n} похожих случаев${br.since ? ' с ' + br.since.slice(0, 4) : ''}</span></div>
        ${br.n >= 20 ? `<div class="stack"><i class="a" style="width:${pt * 100}%"></i><i class="b" style="width:${ps * 100}%"></i><i class="c" style="width:${pn * 100}%"></i></div>
        <div class="slegend"><span><i style="background:var(--go)"></i>T1 раньше стопа ${Math.round(pt * 100)}%</span><span><i style="background:var(--no)"></i>стоп раньше ${Math.round(ps * 100)}%</span><span><i style="background:var(--hint);opacity:.4"></i>ни то ни другое ${Math.round(pn * 100)}%</span></div>` : ''}
        <p class="p">${esc(br.text || '')}</p>
        ${S.d.short_note ? `<div class="small">${esc(S.d.short_note[0].toUpperCase() + S.d.short_note.slice(1))}.</div>` : ''}
      </div>`;
    }
    const pl = sc.plan || {};
    const plan = [pl.breakeven && 'T1: откуп 1/2, ' + pl.breakeven, pl.add && pl.add[0].toUpperCase() + pl.add.slice(1),
                  pl.time && pl.time[0].toUpperCase() + pl.time.slice(1), 'Стоп — по закрытию дня выше стопа, без усреднения.'].filter(Boolean);
    html += `<div class="sec">План после продажи</div><div class="card"><ul class="dots" style="margin:0">${plan.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    return html;
  }

  // карточка: «внутри дня» — уровни вчерашнего диапазона и как правило работало у бумаги
  function intraDetail(t) {
    const k = tk(t), x = k.intra;
    if (!x) return '';
    const row = (side, lab) => {
      const p = x[side] || {}, st = p.stats || {};
      if (num(p.level) === null) return '';
      const stat = st.n_trig ? `в похожих днях: цель раньше стопа ${Math.round((st.p_target || 0) * 100)}%, стоп ${Math.round((st.p_stop || 0) * 100)}% (n=${st.n_trig}), ср. итог ${pct(st.avg_pct, 2)}` : 'похожих дней мало';
      return `<li><b>${lab} ${fmt(p.level, k.dec)}</b> (${esc(p.basis || '')}) → цель ${side === 'long' ? '+' : '−'}${trim0(fmt(x.target_pct, 2))}%, стоп ${side === 'long' ? '−' : '+'}${trim0(fmt(x.stop_pct, 2))}%; ${stat}. ${p.candidate ? '<b>Кандидат</b>' : esc('Нет: ' + (p.why_not || ''))}</li>`;
    };
    return `<div class="sec">Внутри дня · ${WD[dateObj(x.session).getDay()]} ${ddmm(x.session)}</div><div class="card">
      <ul class="dots" style="margin:0">${row('long', 'Час закроется выше')}${row('short', 'Час закроется ниже')}</ul>
      <div class="small" style="margin-top:8px">Вход по закрытию часа основной сессии до 17:00, выход до её конца. Эксперимент; частоты — прошлое, не прогноз.</div></div>`;
  }

  function vDetail(t) {
    const k = tk(t), sc = k.sc, br = k.br, ta = k.ta || {}, last = priceOf(t), chg = chgOf(t);
    const st = statusNote(k, last);
    const myDeals = dealItems().filter(x => x.t === t && x.group === 'open');
    const ss = sk(t), shortOn = S.d.short_on && (ss.bucket === 'go' || ss.bucket === 'wait');
    const sline = shortOn ? (ss.bucket === 'go' ? `🔻 <b>Шорт по сценарию</b> — ${esc(ss.cond)}.`
      : `🔸 <b>Шорт: ждать цены</b> — ${esc(condLiveS(ss, last))}: дойдёт — сценарий продажи в силе, не дойдёт — пропускаем.`) : '';
    let banner = k.bucket === 'go' ? `🟢 <b>Брать по сценарию</b> — ${esc(k.cond)}.`
      : k.bucket === 'wait' ? `🟡 <b>Ждать цены</b> — ${esc(condLive(k, last))}${sc && sc.valid_days ? ' за ' + sc.valid_days + ' торг. дн. после выпуска' : ''}: дойдёт — сценарий в силе, не дойдёт — пропускаем.`
      : `🔴 <b>Не брать</b> — ${esc(k.reason || k.cond)}.`;
    if (shortOn) banner = k.bucket === 'no' ? sline + `<div class="small" style="margin-top:6px">Лонг: не брать — ${esc(k.reason || k.cond)}.</div>`
      : banner + `<div style="margin-top:6px">${sline}</div>`;
    const bcls = shortOn && k.bucket === 'no' ? k.sbucket : k.bucket;
    let html = `
      <div class="dhead"><button class="back" data-act="back" aria-label="Назад">‹</button>${ava(t, true)}
        <div><h1>${esc(k.name)}</h1><div class="sub">${t} · ${esc(k.sector)}${k.rank ? ' · №' + k.rank + ' в рейтинге' : ''}</div></div></div>
      <div class="bigprice"><b id="dPrice">${fmt(last, k.dec)} ₽</b><span id="dChg" class="${cls(chg)}">${pct(chg, 2)} за день</span></div>
      <div class="banner ${bcls}">${banner}${k.why ? '<div style="margin-top:6px">Почему: ' + esc(k.why) + '.</div>' : ''}${st ? '<div style="margin-top:8px">' + st + '</div>' : ''}</div>
      ${myDeals.length ? '<div class="sec">Открытая сделка</div>' + myDeals.map(x => dealCard(x, true)).join('') : ''}
      <div class="card chartcard">
        <div class="chartbar"><span class="small">Дневные свечи</span><div class="seg mini">${[[63, '3М'], [126, '6М'], [250, '1Г']].map(x => `<button data-range="${x[0]}" class="${S.range === x[0] ? 'on' : ''}">${x[1]}</button>`).join('')}</div></div>
        <canvas id="chart" aria-label="График ${esc(t)}"></canvas><div class="tip" id="tip"></div>
        <div class="legend"><span><i style="background:#3b82f6"></i>SMA50</span><span><i style="background:#a855f7"></i>SMA200</span>
          ${sc && k.bucket !== 'no' ? `<span><i style="background:var(--wait);height:8px;opacity:.5"></i>зона входа</span><span><i class="dash" style="--c:var(--no);background:var(--no)"></i>стоп</span><span><i class="dash" style="--c:var(--go);background:var(--go)"></i>T1 / T2</span>` : `<span><i class="dash" style="--c:var(--hint);background:var(--hint)"></i>поддержка / сопротивление</span>`}
        </div>
      </div>`;
    if (sc && k.bucket !== 'no') {
      const ez = (sc.entry || []).filter(x => x != null);
      const zone = ez.length ? (Math.min(...ez) === Math.max(...ez) ? fmt(ez[0], k.dec) : fmt(Math.min(...ez), k.dec) + '–' + fmt(Math.max(...ez), k.dec)) : '—';
      const ref = sc.wait || (ez.length ? Math.max(...ez) : null);
      const tp = sc.tp || [];
      html += `<div class="sec">Сценарий</div><div class="card">${ladder(k, last)}
        <div class="kv">
          <div><span>Вход по сценарию</span><b>${zone}</b><i>${num(ref) !== null && num(last) !== null ? pct((ref / last - 1) * 100) + ' от цены' : ''}${sc.entry_max ? ' · не выше ' + fmt(sc.entry_max, k.dec) : ''}</i></div>
          <div><span>Стоп</span><b class="down">${fmt(sc.stop, k.dec)}</b><i>${pct(sc.stop_pct)} от входа</i></div>
          ${tp.map((x, i) => `<div><span>T${i + 1}${x.share ? ' · ' + esc(x.share) : ''}</span><b class="up">${fmt(x.price, k.dec)}</b><i>${pct(x.pct)} от входа</i></div>`).join('')}
          <div><span>Прибыль / риск</span><b>${(sc.rr || []).map(x => trim0(fmt(x, 1))).join(' · ') || '—'}</b><i>для T1 · T2</i></div>
          <div><span>T1 обычно</span><b>${sc.days_med ? '~' + sc.days_med + ' дн.' : '—'}</b><i>${sc.days_p75 ? '75% случаев — до ' + sc.days_p75 + ' дн.' : 'торговых дней'}</i></div>
        </div>
        ${sc.plan && sc.plan.entry ? `<div class="rule">${esc(sc.plan.entry)}${sc.trigger ? '. Условие: ' + esc(sc.trigger) : ''}.</div>` : ''}
        ${sc.inval ? `<div class="small" style="margin-top:8px">Сценарий отменяется: ${esc(sc.inval)}${sc.time_stop ? ' · тайм-стоп ' + sc.time_stop + ' торг. дн.' : ''}</div>` : ''}
      </div>`;
      if (br && num(br.n) !== null) {
        const pt = num(br.pt) || 0, ps = num(br.ps) || 0, pn = Math.max(0, 1 - pt - ps);
        html += `<div class="sec">Сила сигнала</div><div class="card">
          <div style="display:flex;align-items:center;gap:8px"><span class="pill ${sc.strength === 'сильный' ? 'go' : sc.strength === 'средний' ? 'wait' : 'n'}">сигнал ${esc(sc.strength || '—')}</span><span class="small">n = ${br.n} похожих случаев${br.since ? ' с ' + br.since.slice(0, 4) : ''}</span></div>
          ${br.n >= 20 ? `<div class="stack"><i class="a" style="width:${pt * 100}%"></i><i class="b" style="width:${ps * 100}%"></i><i class="c" style="width:${pn * 100}%"></i></div>
          <div class="slegend"><span><i style="background:var(--go)"></i>T1 раньше стопа ${Math.round(pt * 100)}%</span><span><i style="background:var(--no)"></i>стоп раньше ${Math.round(ps * 100)}%</span><span><i style="background:var(--hint);opacity:.4"></i>ни то ни другое ${Math.round(pn * 100)}%</span></div>` : ''}
          <p class="p">${esc(br.text || '')}</p>
          ${(sc.reasons || []).length ? `<ul class="dots">${sc.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        </div>`;
      }
      const pl = sc.plan || {};
      const plan = [pl.breakeven && 'T1: фиксация 1/2, ' + pl.breakeven, pl.add && pl.add[0].toUpperCase() + pl.add.slice(1), pl.time && pl.time[0].toUpperCase() + pl.time.slice(1),
                    'Стоп — по закрытию дня, без усреднения.'].filter(Boolean);
      html += `<div class="sec">План после входа</div><div class="card"><ul class="dots" style="margin:0">${plan.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    } else if (sc && sc.skip) {
      html += `<div class="sec">Почему не брать</div><div class="card"><div class="p" style="margin:0">${esc(sc.skip)}</div>
        ${sc.levels_txt ? `<div class="small" style="margin-top:8px">Сценарий, который правила отсеяли: ${esc(sc.levels_txt)}</div>` : ''}</div>`;
    }
    html += shortDetail(t, last);
    html += intraDetail(t);
    // теханализ
    const tr = ta.trend || {};
    const tags = [];
    if (tr.d) tags.push(`Тренд день <b>${ARROW[tr.d] || ''} ${TREND[tr.d] || esc(tr.d)}</b>`);
    if (tr.w) tags.push(`неделя <b>${ARROW[tr.w] || ''} ${TREND[tr.w] || esc(tr.w)}</b>`);
    if (num(ta.rsi) !== null) tags.push(`RSI <b>${fmt(ta.rsi, 0)}</b>${ta.rsi_state && ta.rsi_state !== 'норма' ? ' ' + esc(ta.rsi_state) : ''}`);
    if (num(ta.macd_hist) !== null) tags.push(`MACD <b>${ta.macd_hist > 0 ? 'выше' : 'ниже'}</b> сигнальной`);
    if (ta.vol && ta.vol.pressure) tags.push(`Объёмы: <b>${esc(ta.vol.pressure)}</b>`);
    if (num(tr.vs200) !== null) tags.push(`к SMA200 <b class="${cls(tr.vs200)}">${pct(tr.vs200)}</b>`);
    if (num(ta.atr_pct) !== null) tags.push(`ATR <b>${pct(ta.atr_pct, 1, false)}</b> в день`);
    const lv = (arr, name) => (arr || []).length ? `<div class="small" style="margin-top:10px">${name}</div><div class="tags" style="margin-top:4px">${arr.map(x => `<span class="tag"><b>${fmt(x[0], k.dec)}</b> сила ${x[1]}</span>`).join('')}</div>` : '';
    html += `<div class="sec">Теханализ</div><div class="card"><div class="tags">${tags.map(x => `<span class="tag">${x}</span>`).join('')}</div>
      ${lv(ta.sup, 'Поддержки')}${lv(ta.res, 'Сопротивления')}
      ${ta.fib && ta.fib.zone ? `<div class="small" style="margin-top:10px">Фибоначчи: цена ${esc(ta.fib.zone)} (${ta.fib.dir === 'up' ? 'рост' : 'падение'} ${fmt(ta.fib.low, k.dec)} → ${fmt(ta.fib.high, k.dec)})</div>` : ''}
      ${(ta.patterns || []).length ? `<div class="small" style="margin-top:6px">Паттерны: ${esc(ta.patterns.join('; '))}</div>` : ''}
      ${ta.setup && (ta.setup.reasons || []).length ? `<details><summary>Разбор сетапа${ta.setup.type ? ' «' + esc(ta.setup.type) + '»' : ''}${num(ta.setup.score) !== null ? ', ' + ta.setup.score + '/100' : ''}</summary><ul class="dots">${ta.setup.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
    </div>`;
    // фундаментал
    const f = k.fund || {};
    const fx = [['P/E', f.pe, ''], ['P/B', f.pb, ''], ['EV/EBITDA', f.ev_ebitda, ''], ['ROE', f.roe, '%'], ['Долг/EBITDA', f.debt_ebitda, ''],
                ['Див. LTM', f.div_yield_ltm, '%'], ['Payout', f.payout, '%'], ['Прибыль г/г', f.ni_yoy_pct, '%']].filter(x => num(x[1]) !== null);
    if (fx.length) {
      html += `<div class="sec">Фундаментал</div><div class="card"><div class="grid">${fx.map(x => `<div><span>${x[0]}</span><b${x[0] === 'Прибыль г/г' ? ` class="${cls(x[1])}"` : ''}>${x[0] === 'Прибыль г/г' ? pct(x[1], 0) : trim0(fmt(x[1], 1)) + x[2]}</b></div>`).join('')}</div>
        <div class="small" style="margin-top:10px">${esc(f.source || 'smart-lab')}${f.ni_period ? ' · ' + esc(f.ni_period) : ''}</div></div>`;
    }
    const dv = k.div || {};
    if (num(dv.next_div_rub) !== null || num(dv.forward_yield_12m) !== null) {
      html += `<div class="sec">Дивиденды</div><div class="card"><div class="grid">
        ${num(dv.next_div_rub) !== null ? `<div><span>Следующий</span><b>${trim0(fmt(dv.next_div_rub, 2))} ₽</b></div>` : ''}
        ${dv.next_record_date ? `<div><span>Реестр</span><b>${dmy(dv.next_record_date)}</b></div>` : ''}
        ${num(dv.forward_yield_12m) !== null ? `<div><span>За 12 мес.</span><b>${pct(dv.forward_yield_12m, 1, false)}</b></div>` : ''}
      </div><div class="small" style="margin-top:10px">${esc([dv.next_period, dv.next_source || dv.source].filter(Boolean).join(' · '))}</div></div>`;
    }
    const tg2 = k.tg;
    if (tg2 && num(tg2.median) !== null && (tg2.n || 0) >= 3) {
      const lo = Math.min(tg2.min, last), hi = Math.max(tg2.max, last), R = (hi - lo) || 1;
      const P = v => ((v - lo) / R * 92 + 4).toFixed(1);
      html += `<div class="sec">Аналитики</div><div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><div><span class="small">Медиана таргетов</span><div style="font-size:20px;font-weight:800">${fmt(tg2.median, k.dec)} ₽</div></div>
        <div style="text-align:right"><b class="${cls(tg2.up)}">${pct(tg2.up, 0)}</b><div class="small">${tg2.n} брокеров с ${ddmm(tg2.since)}</div></div></div>
        <div class="range"><i class="tr"></i><i class="m" style="left:${P(tg2.min)}%;--c:var(--hint)"></i><i class="m" style="left:${P(tg2.max)}%;--c:var(--hint)"></i><i class="m" style="left:${P(tg2.median)}%;--c:var(--go)"></i><i class="m" style="left:${P(last)}%;--c:var(--text)"></i>
          <span class="l" style="left:${P(tg2.min)}%">${fmt(tg2.min, k.dec)}</span><span class="l" style="left:${P(last)}%">сейчас</span><span class="l" style="left:${P(tg2.max)}%">${fmt(tg2.max, k.dec)}</span></div>
        ${(tg2.latest || []).length ? `<details><summary>Последние таргеты</summary><ul class="dots">${tg2.latest.map(x => `<li>${esc(x.broker)}: <b>${fmt(x.target, k.dec)}</b> · ${ddmm(x.date)}${x.rating ? ' · ' + esc(x.rating) : ''}</li>`).join('')}</ul></details>` : ''}
        <div class="small" style="margin-top:8px">Интерфакс / Финмаркет. Таргет — мнение брокера, не обещание.</div></div>`;
    }
    const s = k.score || {};
    const fac = [['Стоимость', s.value], ['Качество', s.quality], ['Дивиденды', s.dividend], ['Импульс', s.momentum], ['Аналитики', s.analyst], ['Рост', s.growth], ['Теханализ', s.setup]].filter(x => num(x[1]) !== null);
    if (fac.length) {
      html += `<div class="sec">Рейтинг</div><div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="small">Итоговый балл${k.rank ? ' · место №' + k.rank + ' из ' + S.d.order.length : ''}</span><b style="font-size:20px">${fmt(s.total, 0)}<span class="small">/100</span></b></div>
        ${fac.map(x => `<div class="fbar"><span>${x[0]}</span><span class="tr"><i style="width:${Math.max(2, Math.min(100, x[1]))}%"></i></span><b>${fmt(x[1], 0)}</b></div>`).join('')}
        ${(s.penalties || []).length ? `<div class="small" style="margin-top:6px">Штрафы: ${esc(s.penalties.join('; '))}</div>` : ''}
        <div class="small" style="margin-top:6px">Перцентили внутри сектора${s.basis ? ' · ' + esc(s.basis) : ''}</div></div>`;
    }
    const risks = (k.flags || []).slice();
    if (risks.length) html += `<div class="sec">Риски</div><div class="card"><ul class="dots" style="margin:0">${risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`;
    if ((k.news || []).length) html += `<div class="sec">Новости</div><div class="card news">${newsLinks(k.news)}</div>`;
    const canWatch = k.bucket === 'wait' && sc && (sc.mode === 'pullback' || sc.mode === 'breakout') && sc.stop != null;
    const ssc = k.ssc || {};
    const canWatchS = S.d.short_on && k.sbucket === 'swait' && (ssc.mode === 'rally' || ssc.mode === 'breakdown') && ssc.stop != null;
    html += `<div class="actions">${canWatch ? `<button class="btn" data-cmd="al_${t}">🔔 Сообщить, когда дойдёт до уровня</button>` : ''}
      ${canWatchS ? `<button class="btn${canWatch ? ' alt' : ''}" data-cmd="als_${t}">🔔 Шорт: сообщить о входе</button>` : ''}
      <button class="btn${canWatch || canWatchS ? ' alt' : ''}" data-cmd="report">🖼 Графики и PDF-отчёт в чат</button><button class="btn alt" data-cmd="t_${t}">💬 Эта карточка в чате</button></div>
      ${canWatch || canWatchS ? '<div class="small" style="margin:0 18px">Бот напишет в чат, когда цена дойдёт до уровня входа по сценарию — в течение срока сценария.</div>' : ''}${foot()}`;
    return html;
  }

  // ---------- график ----------
  function niceTicks(lo, hi, n) {
    const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => span / x <= n + 0.5) || mag * 10;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function chartLevels(k) {
    const sc = k.sc || {}, ta = k.ta || {}, out = [];
    if (k.bucket !== 'no' && sc.stop != null) {
      out.push({ v: sc.stop, c: '--no', label: 'Стоп' });
      (sc.tp || []).forEach((x, i) => out.push({ v: x.price, c: '--go', label: 'T' + (i + 1) }));
    } else {
      (ta.sup || []).slice(0, 1).forEach(x => out.push({ v: x[0], c: '--hint', label: 'S' }));
      (ta.res || []).slice(0, 1).forEach(x => out.push({ v: x[0], c: '--hint', label: 'R' }));
    }
    return out;
  }

  function drawChart(cv, k, range, hover) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return null;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const col = n => css.getPropertyValue(n).trim();
    const font = col('--font') || 'sans-serif';
    const all = k.c || [];
    if (!all.length) { ctx.fillStyle = col('--hint'); ctx.font = '13px ' + font; ctx.fillText('Нет свечей', 12, 24); return null; }
    const n0 = Math.max(0, all.length - range), C = all.slice(n0);
    const s50 = ((k.sma && k.sma['50']) || []).slice(n0), s200 = ((k.sma && k.sma['200']) || []).slice(n0);
    const padL = 6, padR = 60, padT = 12, padB = 22, w = W - padL - padR, h = H - padT - padB;
    const last = num(priceOf(k.t)) !== null ? priceOf(k.t) : C[C.length - 1][4];
    let lo = Infinity, hi = -Infinity;
    C.forEach(c => { if (c[3] < lo) lo = c[3]; if (c[2] > hi) hi = c[2]; });
    const lv = chartLevels(k);
    lv.forEach(L => { if (num(L.v) !== null && Math.abs(L.v / last - 1) < 0.25) { lo = Math.min(lo, L.v); hi = Math.max(hi, L.v); } });
    const ez = ((k.sc && k.sc.entry) || []).filter(x => x != null);
    if (k.bucket !== 'no') ez.forEach(v => { if (Math.abs(v / last - 1) < 0.25) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    lo = Math.min(lo, last); hi = Math.max(hi, last);
    const pad = (hi - lo) * 0.07 || 1;
    lo -= pad; hi += pad;
    const Y = p => padT + (hi - p) / (hi - lo) * h;
    const step = w / C.length, X = i => padL + step * (i + 0.5);
    // сетка и шкала
    ctx.font = '10.5px ' + font;
    ctx.lineWidth = 1;
    ctx.strokeStyle = col('--sep');
    ctx.fillStyle = col('--hint');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    niceTicks(lo, hi, 4).forEach(p => {
      const y = Math.round(Y(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
      ctx.fillText(fmt(p, k.dec > 0 && hi - lo > 20 ? 0 : k.dec), padL + w + 8, y);
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let pm = -1, px = -100;
    C.forEach((c, i) => {
      const m = +c[0].slice(5, 7);
      if (pm !== -1 && m !== pm && X(i) - px > 36 && X(i) < padL + w - 12) { ctx.fillText(MON3[m - 1], X(i), H - 6); px = X(i); }
      pm = m;
    });
    // зона входа
    if (k.bucket !== 'no' && ez.length) {
      const y0 = Y(Math.max(...ez)), y1 = Y(Math.min(...ez));
      ctx.globalAlpha = 0.17;
      ctx.fillStyle = col('--wait');
      ctx.fillRect(padL, y0 - 1, w, Math.max(3, y1 - y0 + 2));
      ctx.globalAlpha = 1;
    }
    // скользящие
    const line = (arr, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
      let started = false;
      arr.forEach((v, i) => { if (v == null) return; const x = X(i), y = Y(v); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); });
      ctx.stroke();
    };
    line(s200, '#a855f7');
    line(s50, '#3b82f6');
    // свечи
    const up = col('--up'), dn = col('--down');
    const bw = Math.max(1, Math.min(9, step * 0.64));
    ctx.lineWidth = 1;
    C.forEach((c, i) => {
      const color = c[4] >= c[1] ? up : dn, x = X(i);
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(c[2])); ctx.lineTo(Math.round(x) + 0.5, Y(c[3])); ctx.stroke();
      const yo = Y(c[1]), yc = Y(c[4]);
      ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
    });
    // уровни сценария и ярлыки справа
    const tags = [];
    lv.forEach(L => {
      if (num(L.v) === null || L.v < lo || L.v > hi) return;
      const y = Math.round(Y(L.v)) + 0.5, color = col(L.c);
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke(); ctx.setLineDash([]);
      tags.push({ y, color, text: L.label + ' ' + fmt(L.v, k.dec) });
    });
    tags.push({ y: Y(last), color: col('--text'), text: fmt(last, k.dec), now: true });
    tags.sort((a, b) => a.y - b.y);
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 15) tags[i].y = tags[i - 1].y + 15;
    ctx.font = '600 10px ' + font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    tags.forEach(tg_ => {
      const tw = Math.min(padR - 4, ctx.measureText(tg_.text).width + 8);
      ctx.fillStyle = tg_.color;
      roundRect(ctx, padL + w + 3, tg_.y - 7.5, tw, 15, 4);
      ctx.fill();
      ctx.fillStyle = tg_.now ? col('--card') : '#fff';
      ctx.fillText(tg_.text, padL + w + 7, tg_.y + 0.5, padR - 10);
    });
    // перекрестие
    if (hover != null && C[hover]) {
      const x = Math.round(X(hover)) + 0.5;
      ctx.strokeStyle = col('--hint'); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + h); ctx.stroke(); ctx.setLineDash([]);
    }
    return { C, X, step, padL, w, n0 };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawDetailChart() {
    const cv = $('#chart'), t = S.detail;
    if (!cv || !t || !tk(t)) return;
    const k = tk(t), tip = $('#tip');
    let geo = drawChart(cv, k, S.range, null);
    const at = e => {
      if (!geo) return null;
      const r = cv.getBoundingClientRect();
      const i = Math.floor((e.clientX - r.left - geo.padL) / geo.step);
      return i >= 0 && i < geo.C.length ? i : null;
    };
    const show = e => {
      const i = at(e);
      if (i == null) return;
      geo = drawChart(cv, k, S.range, i);
      const c = geo.C[i], prev = i > 0 ? geo.C[i - 1][4] : (k.c[geo.n0 - 1] || [])[4];
      const ch = prev ? (c[4] / prev - 1) * 100 : null;
      tip.innerHTML = `<b>${dmy(c[0])}</b> <span class="${cls(ch)}">${ch != null ? pct(ch, 2) : ''}</span><br>О ${fmt(c[1], k.dec)} · М ${fmt(c[2], k.dec)}<br>Н ${fmt(c[3], k.dec)} · З <b>${fmt(c[4], k.dec)}</b>`;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      tip.style.left = (x > r.width / 2 ? 10 : r.width - 150) + 'px';
      tip.classList.add('show');
    };
    const hide = () => { tip.classList.remove('show'); geo = drawChart(cv, k, S.range, null); };
    cv.onpointerdown = e => { show(e); haptic('sel'); };
    cv.onpointermove = e => { if (e.pointerType === 'mouse' || e.buttons) show(e); };
    cv.onpointerleave = hide;
    cv.onpointerup = e => { if (e.pointerType !== 'mouse') setTimeout(hide, 1600); };
    cv.onpointercancel = hide;
  }

  // ---------- навигация ----------
  function renderTabs() {
    $('#tabbar').innerHTML = '<div class="in">' + TABS.map(x => `<button data-tab="${x[0]}" class="${S.tab === x[0] ? 'on' : ''}" aria-label="${x[1]}">${IC[x[0]]}<span>${x[1]}</span></button>`).join('') + '</div>';
  }

  function skeleton() {
    return `<section class="hero"><div class="sk" style="width:90px;height:14px"></div><div class="sk" style="width:220px;height:30px;margin-top:8px"></div><div class="sk" style="width:180px;height:14px;margin-top:8px"></div></section>
      <div class="kpis">${'<div class="kpi sk" style="height:72px"></div>'.repeat(4)}</div>
      <div class="tiles" style="margin-top:22px">${'<div class="sk" style="height:70px"></div>'.repeat(3)}</div>
      ${'<div class="card sk" style="height:120px;margin-top:12px"></div>'.repeat(2)}`;
  }

  function errorView() {
    return `<div class="card" style="margin-top:24px"><div class="empty"><span class="e">📡</span>Не получилось загрузить данные обзора.<br><span class="small">${esc(S.err)}</span></div>
      <button class="btn" data-act="retry">Повторить</button></div>`;
  }

  function render(anim = true) {
    renderTabs();
    const v = $('#view');
    v.innerHTML = S.err ? errorView() : !S.d ? skeleton() : VIEWS[S.tab]();
    if (anim) { v.classList.remove('fade'); void v.offsetWidth; v.classList.add('fade'); }
  }

  function setTab(tab, silent) {
    if (!VIEWS[tab]) return;
    if (S.detail) closeDetail(true);
    if (!silent) haptic('sel');
    S.tab = tab;
    render();
    window.scrollTo(0, 0);
  }

  function openDetail(t, silent) {
    if (!S.d || !tk(t)) return;
    if (!silent) haptic('light');
    S.detail = t;
    const sh = $('#sheet');
    $('#sheetInner').innerHTML = vDetail(t);
    sh.scrollTop = 0;
    sh.classList.add('open');
    sh.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => requestAnimationFrame(drawDetailChart));
    if (tg && tg.BackButton) tg.BackButton.show();
  }

  function openDigest() {
    haptic('light');
    S.detail = '__digest';
    $('#sheetInner').innerHTML = `<div class="dhead"><button class="back" data-act="back" aria-label="Назад">‹</button><div><h1>Выпуск ${ddmm(S.d.run_date)}</h1><div class="sub">полный текст выпуска</div></div></div>
      <div class="card digest" style="margin-top:12px">${tgHtml(S.d.digest || 'Текста выпуска нет')}</div><div class="actions"><button class="btn" data-cmd="top">🔄 Собрать свежий обзор</button></div>`;
    const sh = $('#sheet');
    sh.scrollTop = 0;
    sh.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (tg && tg.BackButton) tg.BackButton.show();
  }

  function closeDetail(silent) {
    if (!S.detail) return;
    S.detail = null;
    const sh = $('#sheet');
    sh.classList.remove('open');
    sh.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (tg && tg.BackButton) tg.BackButton.hide();
    if (!silent) haptic('light');
  }

  // Пришли живые цены — перерисовать карточку целиком (лесенка, условие, график), не сбивая прокрутку
  function refreshDetailPrice() {
    const t = S.detail, sh = $('#sheet');
    if (!t || !tk(t)) return;
    const y = sh.scrollTop;
    $('#sheetInner').innerHTML = vDetail(t);
    sh.scrollTop = y;
    drawDetailChart();
  }

  // Текст выпуска (HTML Telegram) → безопасный HTML: только b/i/u/s/code/pre/blockquote и ссылки
  function tgHtml(s) {
    const doc = new DOMParser().parseFromString('<div>' + s + '</div>', 'text/html');
    const ok = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', S: 's', CODE: 'code', PRE: 'pre', BLOCKQUOTE: 'blockquote' };
    const walk = node => Array.from(node.childNodes).map(ch => {
      if (ch.nodeType === 3) return esc(ch.nodeValue).replace(/\n/g, '<br>');
      if (ch.nodeType !== 1) return '';
      const inner = walk(ch);
      if (ch.tagName === 'A') { const h = ch.getAttribute('href'); return safeUrl(h) ? `<a data-link="${esc(h)}">${inner}</a>` : inner; }
      const t = ok[ch.tagName];
      return t ? `<${t}>${inner}</${t}>` : inner;
    }).join('');
    return walk(doc.body.firstChild || doc.body);
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-link],[data-cmd],[data-act],[data-range],[data-filter-go],[data-filter],[data-sort],[data-t],[data-tab]');
    if (!el) return;
    const ds = el.dataset;
    if (ds.link) { e.preventDefault(); openLink(ds.link); return; }
    if (ds.cmd) { cmd(ds.cmd); return; }
    if (ds.act === 'back') { closeDetail(); return; }
    if (ds.act === 'digest') { openDigest(); return; }
    if (ds.act === 'retry') { load(); return; }
    if (ds.range) {
      S.range = +ds.range;
      haptic('sel');
      document.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('on', +b.dataset.range === S.range));
      drawDetailChart();
      return;
    }
    if (ds.filterGo) { S.filter = ds.filterGo; setTab('stocks'); return; }
    if (ds.filter) { S.filter = ds.filter; haptic('sel'); render(false); return; }
    if (ds.sort) { S.sort = ds.sort; haptic('sel'); render(false); return; }
    if (ds.t) { openDetail(ds.t); return; }
    if (ds.tab) { setTab(ds.tab); }
  });

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (S.detail && S.detail !== '__digest') drawDetailChart(); }, 150); });

  function applyTheme() {
    const dark = IN_TG ? tg.colorScheme === 'dark' : !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('web', !IN_TG);
    if (tg && IN_TG) {
      try { tg.setHeaderColor('secondary_bg_color'); tg.setBackgroundColor('secondary_bg_color'); } catch (e) { /* старый клиент */ }
      try { if (tg.setBottomBarColor) tg.setBottomBarColor('secondary_bg_color'); } catch (e) { /* нет нижней панели */ }
    }
  }

  // ---------- старт ----------
  applyTheme();
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) { /* вне Telegram */ }
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) { /* старый клиент */ }
    if (tg.BackButton) tg.BackButton.onClick(() => closeDetail());
    try { tg.onEvent('themeChanged', () => { applyTheme(); if (S.d) { render(false); if (S.detail && S.detail !== '__digest') openDetail(S.detail, true); } }); } catch (e) { /* нет событий */ }
    try { if (tg.SettingsButton) { tg.SettingsButton.show(); tg.SettingsButton.onClick(() => setTab('more')); } } catch (e) { /* старый клиент */ }
  }
  if (!IN_TG && window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); render(false); }); } catch (e) { /* Safari < 14 */ }
  }
  load();
  setInterval(() => { if (!document.hidden) fetchLive(); }, 60000);
  setInterval(() => { if (!document.hidden) fetchDeals(); }, 180000);
})();
