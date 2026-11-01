/* 讀書：離線 TXT 閱讀器（網頁版）
 * 書、閱讀進度、匯入的字型都存在這支手機的瀏覽器資料庫裡，不會上傳到任何地方。 */
(function () {
  'use strict';

  const VERSION = '1.0.1';
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  function stableHash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  const isCJK = (s) => /[⺀-鿿豈-﫿]/.test(s);

  // ======================================================================
  // 設定
  // ======================================================================
  const DEFAULTS = {
    vertical: true, fontSize: 20, lineHeight: 1.8, letterSpacing: 0.04, marginH: 18, marginV: 20,
    theme: 'paper', dayTheme: 'paper', font: 'system',
    toTraditional: false, cornerQuotes: true, fullwidthAlnum: true, skipBlank: false,
    animation: true, tapBothNext: false, keepAwake: false
  };
  const THEMES = [
    { id: 'white', name: '白', bg: '#FFFFFF', fg: '#222222', sub: '#9A9A9A', dark: false },
    { id: 'paper', name: '米黃', bg: '#F5ECD7', fg: '#3A3127', sub: '#A0927A', dark: false },
    { id: 'green', name: '護眼', bg: '#CFE5CC', fg: '#24331F', sub: '#6F8A69', dark: false },
    { id: 'gray', name: '淺灰', bg: '#E4E4E2', fg: '#2B2B2B', sub: '#8E8E8C', dark: false },
    { id: 'night', name: '夜間', bg: '#1E1E20', fg: '#B8B2A7', sub: '#6A6762', dark: true },
    { id: 'black', name: '純黑', bg: '#000000', fg: '#8F8A80', sub: '#4E4C48', dark: true }
  ];
  const themeOf = (id) => THEMES.find((t) => t.id === id) || THEMES[1];
  const SKEY = 'reader.settings.v1';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 存不了就算了 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 同上 */ } }
  };
  let settings = (function () {
    try {
      const s = JSON.parse(store.get(SKEY) || 'null');
      if (s && typeof s === 'object') return Object.assign({}, DEFAULTS, s);
    } catch (e) { /* 設定壞了就用預設值 */ }
    return Object.assign({}, DEFAULTS);
  })();
  const saveSettings = () => store.set(SKEY, JSON.stringify(settings));

  // ======================================================================
  // 資料庫（IndexedDB）：books 書目與進度、texts 全文、fonts 字型檔
  // ======================================================================
  const DB = (function () {
    let opening = null;
    function open() {
      if (!opening) {
        opening = new Promise((resolve, reject) => {
          if (!window.indexedDB) { reject(new Error('這個瀏覽器不能存資料')); return; }
          const req = indexedDB.open('reader', 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'name' });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => { opening = null; reject(req.error); };
        });
      }
      return opening;
    }
    async function run(name, mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const req = fn(tx.objectStore(name));
        let out;
        if (req) req.onsuccess = () => { out = req.result; };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('資料庫寫入失敗'));
      });
    }
    return {
      get: (n, k) => run(n, 'readonly', (s) => s.get(k)),
      all: (n) => run(n, 'readonly', (s) => s.getAll()),
      keys: (n) => run(n, 'readonly', (s) => s.getAllKeys()),
      put: (n, v) => run(n, 'readwrite', (s) => s.put(v)),
      del: (n, k) => run(n, 'readwrite', (s) => s.delete(k))
    };
  })();

  // ======================================================================
  // 編碼判斷：UTF-8 / UTF-16 / Big5 / GBK(GB18030)
  // ======================================================================
  const COMMON = new Set(Array.from(
    '的一是不了在人有我他這这個个們们中來来上大為为和國国地到以說说時时要就出會会可也你對对生能而子那得於于著着下自之年過过發发後后作裡里她麼么什沒没看起還还' +
    '，。「」、！？：；…“”'));
  function score(s) {
    let n = 0;
    for (const c of s) {
      if (COMMON.has(c)) n++;
      else if (c === '�') n -= 3;
    }
    return n;
  }
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return new TextDecoder('utf-8').decode(u8.subarray(3));
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { /* 不是乾淨的 UTF-8 */ }
    // 取前段試解，看哪個編碼解出最多常用字
    const sample = u8.subarray(0, Math.min(u8.length, 120000));
    let best = 'utf-8', bestScore = -Infinity;
    for (const enc of ['big5', 'gb18030', 'gbk', 'utf-8']) {
      let d;
      try { d = new TextDecoder(enc); } catch (e) { continue; }
      const sc = score(d.decode(sample));
      if (sc > bestScore) { bestScore = sc; best = enc; }
    }
    return new TextDecoder(best).decode(u8);
  }

  // ======================================================================
  // 章節切分
  // ======================================================================
  const MAX_CHAPTER = 40000, PART_SIZE = 20000, CHUNK_SIZE = 12000;
  const HEADING = /^(?:第[0-9０-９零〇一二两兩三四五六七八九十百千万萬]+(?:[章节節卷集部篇话話幕].{0,30}|回(?:[\s　:：·・、.．\-—_].{0,30})?)|(?:序章|序言|序幕|序|楔子|引子|引言|前言|终章|終章|尾声|尾聲|后记|後記|番外篇?|外传|外傳|间章|間章|幕间|幕間|最终话|最終話|终话|終話|附录|附錄|后日谈|後日談|Prologue|Epilogue|PROLOGUE|EPILOGUE)(?:[\s　:：·・、.．\-—_「『（(【].{0,30})?|(?:Chapter|CHAPTER)\s*[0-9]+.{0,30})$/;
  const TRIM = /^[\s　﻿​]+|[\s　﻿​]+$/g;

  function isHeading(line) {
    const n = line.length;
    if (!n || n > 40) return false;
    if ('。，；、'.indexOf(line[n - 1]) >= 0) return false;
    return HEADING.test(line);
  }
  // 連續空行只留一個，去掉頭尾空行
  function clean(lines) {
    const out = [];
    for (const l of lines) {
      if (!l) { if (out.length && out[out.length - 1]) out.push(''); } else out.push(l);
    }
    while (out.length && !out[out.length - 1]) out.pop();
    return out;
  }
  // 長度以 UTF-16 計，每段多算一個換行；和排版引擎的位置計算一致
  const lengthOf = (paras) => paras.reduce((a, p) => a + p.length + 1, 0);
  function make(title, paras) {
    const c = clean(paras);
    return { title, paras: c, length: lengthOf(c) };
  }
  function appendChapter(list, title, raw) {
    const paras = clean(raw);
    if (lengthOf(paras) <= MAX_CHAPTER) { list.push({ title, paras, length: lengthOf(paras) }); return; }
    let part = [], len = 0, n = 1;
    for (const p of paras) {
      part.push(p); len += p.length + 1;
      if (len >= PART_SIZE) { list.push(make(title + '（' + n + '）', part)); n++; part = []; len = 0; }
    }
    if (clean(part).length) list.push(make(title + '（' + n + '）', part));
  }
  function chunk(paras, title) {
    if (lengthOf(paras) <= MAX_CHAPTER) return paras.length ? [{ title, paras, length: lengthOf(paras) }] : [];
    const out = [];
    let part = [], len = 0;
    for (const p of paras) {
      part.push(p); len += p.length + 1;
      if (len >= CHUNK_SIZE) { out.push(make('第 ' + (out.length + 1) + ' 部分', part)); part = []; len = 0; }
    }
    if (clean(part).length) out.push(make('第 ' + (out.length + 1) + ' 部分', part));
    return out;
  }
  function parseBook(text, fallbackTitle) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const chapters = [];
    let title = null, cur = [];
    const prelude = [];
    for (const raw of lines) {
      const line = raw.replace(TRIM, '');
      if (isHeading(line)) {
        if (title !== null) appendChapter(chapters, title, cur);
        else if (clean(prelude).length) appendChapter(chapters, fallbackTitle, prelude);
        title = line; cur = [];
      } else if (title !== null) cur.push(line);
      else prelude.push(line);
    }
    if (title !== null) appendChapter(chapters, title, cur);
    else for (const c of chunk(clean(prelude), fallbackTitle)) chapters.push(c);
    if (!chapters.length) chapters.push({ title: fallbackTitle, paras: [], length: 0 });
    const starts = [];
    let acc = 0;
    for (const c of chapters) { starts.push(acc); acc += c.length; }
    return { chapters, starts, total: Math.max(acc, 1) };
  }

  // ======================================================================
  // 顯示前的文字處理：簡轉繁、引號、直排英數
  // ======================================================================
  const S2T = { loading: null, chars: null, phrases: null, first: null, max: 0 };
  function loadS2T() {
    if (!S2T.loading) {
      S2T.loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 's2t.js';
        s.onload = () => {
          const d = self.S2T_DATA;
          if (!d) { reject(new Error('字典格式不對')); return; }
          const cps = Array.from(d.c), chars = new Map();
          for (let i = 0; i + 1 < cps.length; i += 2) chars.set(cps[i], cps[i + 1]);
          const phrases = new Map(Object.entries(d.p)), first = new Set();
          let max = 0;
          for (const k of phrases.keys()) { first.add(k[0]); if (k.length > max) max = k.length; }
          Object.assign(S2T, { chars, phrases, first, max });
          self.S2T_DATA = null;
          resolve();
        };
        s.onerror = () => { S2T.loading = null; reject(new Error('簡轉繁字典載入失敗')); };
        document.head.appendChild(s);
      });
    }
    return S2T.loading;
  }
  function s2t(t) {
    const C = S2T.chars, P = S2T.phrases, F = S2T.first, M = S2T.max, n = t.length;
    let out = '', i = 0;
    while (i < n) {
      const c = t[i];
      if (F.has(c)) {
        let hit = false;
        for (let L = Math.min(M, n - i); L >= 2; L--) {
          const v = P.get(t.substring(i, i + L));
          if (v !== undefined) { out += v; i += L; hit = true; break; }
        }
        if (hit) continue;
      }
      const code = t.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < n) {
        const cp = t.substring(i, i + 2);
        out += C.get(cp) || cp; i += 2;
      } else {
        out += C.get(c) || c; i++;
      }
    }
    return out;
  }
  const flagsOf = (s) => ({ traditional: !!s.toTraditional, quotes: !!s.cornerQuotes, fullwidth: !!(s.vertical && s.fullwidthAlnum) });
  const flagsKey = (f) => (f.traditional ? 'T' : '') + (f.quotes ? 'Q' : '') + (f.fullwidth ? 'F' : '');
  const ALNUM = /(^|[^A-Za-z0-9])([A-Za-z0-9]{1,3})(?![A-Za-z0-9])/g;
  function toFull(s) {
    let o = '';
    for (let i = 0; i < s.length; i++) o += String.fromCharCode(s.charCodeAt(i) + 0xFEE0);
    return o;
  }
  function transformText(t, f) {
    if (!t) return t;
    if (f.traditional) t = s2t(t);
    if (f.quotes) {
      // 英文縮寫裡的 ’（例如 don’t）不換
      t = t.replace(/“/g, '「').replace(/”/g, '」').replace(/‘/g, '『').replace(/’(?![A-Za-z])/g, '』');
    }
    // 直排時，三個字以內的英數字改全形，看起來是直立的
    if (f.fullwidth) t = t.replace(ALNUM, (m, a, b) => a + toFull(b));
    return t;
  }

  // ======================================================================
  // 字型
  // ======================================================================
  const SANS = '"PingFang TC", "Heiti TC", -apple-system, "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  const loadedFonts = new Map();   // 檔名 → font-family
  let fontNames = [];
  async function reloadFontNames() {
    try { fontNames = (await DB.keys('fonts')).map(String).sort(); } catch (e) { fontNames = []; }
  }
  function fontFamily() {
    const f = settings.font;
    if (f === 'mincho') return '"Hiragino Mincho ProN", "Songti TC", "Noto Serif TC", "PMingLiU", ' + SANS;
    if (f.indexOf('file:') === 0) {
      const fam = loadedFonts.get(f.slice(5));
      if (fam) return '"' + fam + '", ' + SANS;
    }
    return SANS;
  }
  async function ensureFont() {
    const f = settings.font;
    if (f.indexOf('file:') !== 0) return;
    const name = f.slice(5);
    if (loadedFonts.has(name)) return;
    try {
      const rec = await DB.get('fonts', name);
      if (!rec) throw new Error('找不到字型');
      const family = 'UF' + stableHash(name);
      const face = new FontFace(family, rec.data);
      await face.load();
      document.fonts.add(face);
      loadedFonts.set(name, family);
    } catch (e) {
      settings.font = 'system';
      saveSettings();
      if (settingsPanel) settingsPanel.refresh('font');
      toast('字型載入失敗，改用預設字型');
    }
  }

  // ======================================================================
  // 排版引擎：直排／橫排、每頁剛好整數行、翻頁
  // ======================================================================
  function createEngine(root, post) {
    const q = (s) => root.querySelector(s);
    const content = q('#content'), probe = q('#probe'), m1 = q('#m1'), m2 = q('#m2');
    const header = q('#header'), footL = q('#footL'), footR = q('#footR');
    const HEAD = 30;           // 頁首／頁尾文字預留的空間（px）

    const S = {
      set: null, ch: null, paras: [], starts: [], N: 1, L: 36, v: true,
      page: 0, pages: 1, lines: 1, anchor: 0
    };

    let queue = Promise.resolve();
    function enqueue(fn) {
      queue = queue.then(fn).catch((e) => post({ type: 'log', message: String((e && e.stack) || e) }));
      return queue;
    }

    const px = (n) => n + 'px';
    function setBox(e, o) {
      for (const k of ['top', 'right', 'bottom', 'left', 'width', 'height']) {
        e.style[k] = (k in o) ? (typeof o[k] === 'number' ? px(o[k]) : o[k]) : 'auto';
      }
    }

    function applySettings(set) {
      S.set = set;
      root.style.setProperty('--bg', set.bg);
      root.style.setProperty('--fg', set.fg);
      root.style.setProperty('--sub', set.sub);
    }

    function build() {
      const ch = S.ch, skip = !!S.set.skipBlank;
      const frag = document.createDocumentFragment();
      const h = document.createElement('h2');
      h.textContent = ch.title || '　';
      frag.appendChild(h);
      const gap = document.createElement('p');
      gap.className = 'blank';
      gap.textContent = '　';
      frag.appendChild(gap);
      const paras = [], starts = [];
      let off = 0;
      for (const t of ch.paras) {
        if (t.length === 0) {
          if (!skip) {
            const p = document.createElement('p');
            p.className = 'blank';
            p.textContent = '　';
            frag.appendChild(p); paras.push(p); starts.push(off);
          }
        } else {
          const p = document.createElement('p');
          p.textContent = t;
          frag.appendChild(p); paras.push(p); starts.push(off);
        }
        off += t.length + 1;
      }
      content.textContent = '';
      content.appendChild(frag);
      S.paras = paras; S.starts = starts;
    }

    // 算出每頁剛好 N 行，左右（或上下）用遮罩蓋住
    function layout() {
      const set = S.set;
      const W = window.innerWidth, H = window.innerHeight;
      const cs = getComputedStyle(probe);
      const it = parseFloat(cs.paddingTop) || 0, ir = parseFloat(cs.paddingRight) || 0;
      const ib = parseFloat(cs.paddingBottom) || 0, il = parseFloat(cs.paddingLeft) || 0;
      const fs = Math.max(10, Math.round(set.fontSize));
      const L = Math.max(fs + 2, Math.round(fs * set.lineHeight));
      const v = !!set.vertical;
      const hm = Math.max(0, Math.round(set.marginH)), vm = Math.max(0, Math.round(set.marginV));
      S.v = v; S.L = L;

      root.style.setProperty('--L', px(L));
      content.className = v ? 'v' : 'h';
      const cst = content.style;
      cst.transition = 'none';
      cst.transform = 'none';
      cst.fontSize = px(fs);
      cst.lineHeight = px(L);
      cst.letterSpacing = (set.letterSpacing || 0) + 'em';
      cst.fontFamily = set.fontFamily;

      let N;
      if (v) {
        const top = Math.round(it + HEAD + vm), bottom = Math.round(ib + HEAD + vm);
        const avail = W - il - ir - 2 * hm;
        N = Math.max(1, Math.floor(avail / L));
        const right = Math.round(ir + (W - il - ir - N * L) / 2);
        const left = W - right - N * L;
        setBox(content, { top, bottom, right });
        setBox(m1, { top: 0, bottom: 0, right: 0, width: Math.max(0, right) });
        setBox(m2, { top: 0, bottom: 0, left: 0, width: Math.max(0, left) });
        setBox(header, { top: Math.round(it + 8), left, right });
        setBox(footL, { bottom: Math.round(ib + 8), left, right });
        setBox(footR, { bottom: Math.round(ib + 8), left, right });
        header.style.textAlign = 'right';
      } else {
        const topBase = it + HEAD + vm, botBase = ib + HEAD + vm;
        const avail = H - topBase - botBase;
        N = Math.max(1, Math.floor(avail / L));
        const top = Math.round(topBase + (avail - N * L) / 2);
        const bottom = H - top - N * L;
        const left = Math.round(il + hm), right = Math.round(ir + hm);
        setBox(content, { top, left, right });
        setBox(m1, { top: 0, left: 0, right: 0, height: Math.max(0, top) });
        setBox(m2, { bottom: 0, left: 0, right: 0, height: Math.max(0, bottom) });
        setBox(header, { top: Math.round(it + 8), left, right });
        setBox(footL, { bottom: Math.round(ib + 8), left, right });
        setBox(footR, { bottom: Math.round(ib + 8), left, right });
        header.style.textAlign = 'left';
      }
      S.N = N;
      measure();
    }

    function measure() {
      const first = content.firstElementChild, last = content.lastElementChild;
      if (!first) { S.lines = 1; S.pages = 1; return; }
      const a = first.getBoundingClientRect(), b = last.getBoundingClientRect();
      const total = S.v ? (a.right - b.left) : (b.bottom - a.top);
      S.lines = Math.max(1, Math.round(total / S.L));
      S.pages = Math.max(1, Math.ceil(S.lines / S.N));
    }

    // 字元位置 ⇄ 行 ⇄ 頁；座標都相對於第一個元素，不受翻頁位移影響
    const origin = () => content.firstElementChild.getBoundingClientRect();
    function lineAt(o, r) {
      return S.v ? Math.floor((o.right - (r.left + r.right) / 2) / S.L)
                 : Math.floor(((r.top + r.bottom) / 2 - o.top) / S.L);
    }
    function firstLineOf(o, r) {
      return S.v ? Math.round((o.right - r.right) / S.L) : Math.round((r.top - o.top) / S.L);
    }
    function lastLineOf(o, r) {
      return (S.v ? Math.round((o.right - r.left) / S.L) : Math.round((r.bottom - o.top) / S.L)) - 1;
    }
    const range = document.createRange();
    function charRect(tn, k) {
      const n = tn.length;
      range.setStart(tn, k);
      range.setEnd(tn, Math.min(n, k + 1));
      let r = range.getBoundingClientRect();
      if (!r.width && !r.height && k + 2 <= n) {
        range.setEnd(tn, k + 2);
        r = range.getBoundingClientRect();
      }
      return r;
    }
    function offsetAtLine(line) {
      const ps = S.paras;
      if (!ps.length) return 0;
      const o = origin();
      let lo = 0, hi = ps.length - 1, idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (firstLineOf(o, ps[mid].getBoundingClientRect()) <= line) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (idx < 0) return 0;
      const p = ps[idx], r = p.getBoundingClientRect(), start = S.starts[idx];
      if (p.className === 'blank' || firstLineOf(o, r) >= line) return start;
      if (line > lastLineOf(o, r)) return idx + 1 < ps.length ? S.starts[idx + 1] : start + p.textContent.length;
      const tn = p.firstChild, n = tn.length;
      let a = 0, z = n - 1, ans = n - 1;
      while (a <= z) {
        const m = (a + z) >> 1;
        if (lineAt(o, charRect(tn, m)) >= line) { ans = m; z = m - 1; } else a = m + 1;
      }
      return start + ans;
    }
    function lineOfOffset(off) {
      const ps = S.paras;
      if (!ps.length) return 0;
      let lo = 0, hi = ps.length - 1, idx = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (S.starts[mid] <= off) { idx = mid; lo = mid + 1; } else hi = mid - 1;
      }
      const o = origin(), p = ps[idx];
      if (p.className === 'blank') return firstLineOf(o, p.getBoundingClientRect());
      const tn = p.firstChild;
      const k = Math.max(0, Math.min(tn.length - 1, off - S.starts[idx]));
      return lineAt(o, charRect(tn, k));
    }
    function pageOfOffset(off) {
      if (!(off > 0)) return 0;
      return Math.max(0, Math.min(S.pages - 1, Math.floor(lineOfOffset(off) / S.N)));
    }

    function show(p, animate, keepAnchor) {
      p = Math.max(0, Math.min(S.pages - 1, p | 0));
      S.page = p;
      const d = p * S.N * S.L;
      content.style.transition = (animate && S.set.animation) ? 'transform 0.24s ease-out' : 'none';
      content.style.transform = S.v ? 'translate3d(' + d + 'px,0,0)' : 'translate3d(0,' + (-d) + 'px,0)';
      if (!keepAnchor) S.anchor = p === 0 ? 0 : offsetAtLine(p * S.N);
      chrome();
      post({ type: 'pos', chapter: S.ch.index, offset: S.anchor, page: p, pages: S.pages });
    }
    function chrome() {
      const ch = S.ch;
      header.textContent = ch.title || '';
      footL.textContent = (S.page + 1) + ' / ' + S.pages;
      const done = ch.base + ((S.page + 1) / S.pages) * ch.length;
      const frac = ch.total > 0 ? Math.min(1, done / ch.total) : 0;
      footR.textContent = (frac * 100).toFixed(1) + '%';
    }
    function next() {
      if (!S.ch) return;
      if (S.page < S.pages - 1) show(S.page + 1, true); else post({ type: 'next' });
    }
    function prev() {
      if (!S.ch) return;
      if (S.page > 0) show(S.page - 1, true); else post({ type: 'prev' });
    }

    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => enqueue(async () => {
        if (root.hidden || !S.ch || !S.set) return;
        layout();
        show(pageOfOffset(S.anchor), false, true);
      }), 150);
    });

    // 觸控：點兩側翻頁、點中間叫出選單、滑動翻頁
    let t0 = null;
    root.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { t0 = null; return; }
      const t = e.touches[0];
      t0 = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    root.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
    root.addEventListener('touchcancel', () => { t0 = null; });
    root.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!t0) return;
      const t = e.changedTouches[0], s = t0;
      t0 = null;
      gesture(s.x, s.y, t.clientX - s.x, t.clientY - s.y);
    }, { passive: false });
    root.addEventListener('click', (e) => gesture(e.clientX, e.clientY, 0, 0));   // 用滑鼠時
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    function gesture(x, y, dx, dy) {
      if (!S.ch) return;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (adx > 30 && adx > ady * 1.2) {
        // 直排：手指往右滑＝下一頁；橫排：往左滑＝下一頁
        if (S.v ? dx > 0 : dx < 0) next(); else prev();
        return;
      }
      if (!S.v && ady > 30 && ady > adx * 1.2) { if (dy < 0) next(); else prev(); return; }
      if (adx > 15 || ady > 15) return;
      const z = x / window.innerWidth;
      if (z > 0.3 && z < 0.7) { post({ type: 'menu' }); return; }
      if (S.set && S.set.tapBothNext) { next(); return; }
      const leftSide = z <= 0.3;
      if (S.v ? leftSide : !leftSide) next(); else prev();
    }

    return {
      load(ch, pos, set) {
        return enqueue(async () => {
          applySettings(set);
          S.ch = ch;
          build();
          layout();
          if (pos && pos.end) {
            show(S.pages - 1, false);
          } else {
            const off = (pos && pos.offset > 0) ? pos.offset : 0;
            S.anchor = off;
            show(pageOfOffset(off), false, true);
          }
        });
      },
      apply(set) {
        return enqueue(async () => {
          applySettings(set);
          if (!S.ch) return;
          build();
          layout();
          show(pageOfOffset(S.anchor), false, true);
        });
      },
      clear() {
        return enqueue(async () => { S.ch = null; S.paras = []; S.starts = []; content.textContent = ''; });
      },
      next: () => next(),
      prev: () => prev(),
      state: () => S,
      gesture
    };
  }

  // ======================================================================
  // 小工具：提示、底部面板、動作表、對話框
  // ======================================================================
  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // 一次只開一個浮層
  const Overlay = (function () {
    const backdrop = $('backdrop');
    let cur = null;
    backdrop.addEventListener('click', () => close());
    function open(node, opts) {
      opts = opts || {};
      if (cur) close(true);
      cur = { node, onClose: opts.onClose };
      backdrop.className = opts.light ? 'light' : '';
      backdrop.hidden = false;
      node.hidden = false;
      void node.offsetWidth;
      backdrop.classList.add('show');
      node.classList.add('show');
    }
    function close(immediate) {
      if (!cur) return;
      const c = cur;
      cur = null;
      backdrop.classList.remove('show');
      c.node.classList.remove('show');
      const done = () => { if (!cur) backdrop.hidden = true; if (cur === null || cur.node !== c.node) c.node.hidden = true; };
      if (immediate) done(); else setTimeout(done, 280);
      if (c.onClose) c.onClose();
    }
    return { open, close, get active() { return !!cur; } };
  })();

  function openSheet(title, build, opts) {
    opts = opts || {};
    if (Overlay.active) Overlay.close(true);
    const sheet = $('sheet'), body = $('sheetBody');
    $('sheetTitle').textContent = title;
    body.textContent = '';
    body.scrollTop = 0;
    sheet.classList.toggle('half', !!opts.half);
    build(body);
    Overlay.open(sheet, { light: opts.light, onClose: opts.onClose });
    if (opts.after) requestAnimationFrame(() => opts.after(body));
  }
  $('sheetDone').addEventListener('click', () => Overlay.close());

  function actionSheet(head, items) {
    const box = $('actions');
    box.textContent = '';
    const grp = el('div', 'grp');
    if (head) {
      const h = el('div', 'head');
      if (head.title) h.appendChild(el('b', null, head.title));
      if (head.message) h.appendChild(document.createTextNode(head.message));
      grp.appendChild(h);
    }
    for (const it of items) {
      const b = el('button', it.danger ? 'danger' : '', it.label);
      if (it.checked) {
        const ck = el('span', 'ck');
        ck.innerHTML = ICONS.check;
        b.appendChild(ck);
      }
      b.addEventListener('click', () => { Overlay.close(); setTimeout(it.run, 240); });
      grp.appendChild(b);
    }
    box.appendChild(grp);
    const cancel = el('button', 'cancel', '取消');
    cancel.addEventListener('click', () => Overlay.close());
    box.appendChild(cancel);
    Overlay.open(box);
  }

  function dialog(opts) {
    return new Promise((resolve) => {
      const box = $('dialog');
      box.textContent = '';
      box.appendChild(el('h3', null, opts.title));
      if (opts.message) box.appendChild(el('p', null, opts.message));
      let input = null;
      if (opts.input != null) {
        input = el('input');
        input.type = 'text';
        input.value = opts.input;
        input.setAttribute('enterkeyhint', 'done');
        box.appendChild(input);
      } else if (!opts.message) {
        box.querySelector('h3').style.marginBottom = '18px';
      }
      const btns = el('div', 'btns');
      let result = null;
      const finish = (v) => { result = v; Overlay.close(); };
      if (opts.cancel !== false) {
        const c = el('button', null, opts.cancelLabel || '取消');
        c.addEventListener('click', () => finish(null));
        btns.appendChild(c);
      }
      const ok = el('button', null, opts.okLabel || '好');
      ok.addEventListener('click', () => finish(input ? input.value : true));
      btns.appendChild(ok);
      box.appendChild(btns);
      if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } });
      Overlay.open(box, { onClose: () => { if (input) input.blur(); resolve(result); } });
      if (input) setTimeout(() => { input.focus(); input.select(); }, 60);
    });
  }

  // ======================================================================
  // 書架
  // ======================================================================
  let books = [];
  const darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };

  function setUiTheme() {
    const t = themeOf(settings.theme);
    const dark = R.open ? t.dark : !!darkMQ.matches;
    document.body.classList.toggle('dark', dark);
    const color = R.open ? t.bg : (dark ? '#000000' : '#F2F2F7');
    $('themeColor').setAttribute('content', color);
    document.documentElement.style.backgroundColor = color;
  }

  const lastRead = (b) => (b.progress && b.progress.lastRead) || b.added || 0;
  function statusOf(b) {
    const p = b.progress;
    if (!p) return '未讀';
    if (p.fraction >= 0.995) return '已讀完';
    return (p.fraction < 0.01 ? '剛開始' : Math.floor(p.fraction * 100) + '%') + ' · ' + (p.chapterTitle || '');
  }
  function coverTitle(t) {
    let s = isCJK(t) ? t.replace(/[\s　]/g, '') : t;
    const cps = Array.from(s);
    if (cps.length > 16) s = cps.slice(0, 15).join('') + '…';
    return s;
  }

  // 排序：最近閱讀、最近加入、書名、閱讀進度
  let collator = null;
  try { collator = new Intl.Collator('zh-Hant-TW', { numeric: true, sensitivity: 'base' }); } catch (e) { collator = null; }
  const byTitle = (a, b) => (collator ? collator.compare(a.title, b.title) : (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  const SORTS = [
    { id: 'recent', label: '最近閱讀', cmp: (a, b) => lastRead(b) - lastRead(a) },
    { id: 'added', label: '最近加入', cmp: (a, b) => (b.added || 0) - (a.added || 0) },
    { id: 'title', label: '書名', cmp: byTitle },
    { id: 'progress', label: '閱讀進度', cmp: (a, b) => ((b.progress && b.progress.fraction) || 0) - ((a.progress && a.progress.fraction) || 0) || lastRead(b) - lastRead(a) }
  ];
  let sortId = store.get('reader.sort') || 'recent';
  const sortOf = () => SORTS.find((x) => x.id === sortId) || SORTS[0];
  $('sortBtn').addEventListener('click', () => {
    actionSheet({ title: '書架排序' }, SORTS.map((x) => ({
      label: x.label,
      checked: x.id === sortOf().id,
      run: () => { sortId = x.id; store.set('reader.sort', x.id); renderShelf(); $('library').scrollTop = 0; }
    })));
  });

  function renderShelf() {
    const shelf = $('shelf');
    shelf.textContent = '';
    const sort = sortOf();
    const list = books.slice().sort((a, b) => sort.cmp(a, b) || byTitle(a, b));
    $('empty').hidden = list.length > 0;
    shelf.hidden = list.length === 0;
    $('sortBtn').hidden = list.length < 2;
    $('libCount').textContent = list.length ? list.length + ' 本書' + (list.length > 1 ? ' · 依' + sort.label + '排序' : '') : '';
    for (const b of list) shelf.appendChild(bookCell(b));
  }

  function bookCell(b) {
    const btn = el('button', 'book');
    const cover = el('div', 'cover');
    const hue = stableHash(b.title) % 360;
    cover.style.background = 'linear-gradient(140deg, hsl(' + hue + ', 30%, 60%), hsl(' + hue + ', 28%, 37%))';
    cover.appendChild(el('div', 'spine'));
    cover.appendChild(el('div', 'rule'));
    cover.appendChild(el('div', isCJK(b.title) ? 'ct v' : 'ct', coverTitle(b.title)));
    const f = b.progress ? b.progress.fraction : 0;
    if (f > 0) {
      const bar = el('div', 'pbar');
      bar.style.width = (Math.min(1, f) * 100).toFixed(1) + '%';
      cover.appendChild(bar);
    }
    btn.appendChild(cover);
    btn.appendChild(el('div', 'b-title', b.title));
    btn.appendChild(el('div', 'b-status', statusOf(b)));
    attachPress(btn, () => openBook(b), () => bookActions(b));
    return btn;
  }

  // 點一下打開、長按出選單
  function attachPress(node, onTap, onLong) {
    let timer = 0, sx = 0, sy = 0, fired = false;
    const cancel = () => { clearTimeout(timer); node.classList.remove('pressing'); };
    node.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { cancel(); return; }
      fired = false;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      clearTimeout(timer);
      node.classList.add('pressing');
      timer = setTimeout(() => {
        fired = true;
        node.classList.remove('pressing');
        if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) { /* 沒震動也沒關係 */ } }
        onLong();
      }, 480);
    }, { passive: true });
    node.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) cancel();
    }, { passive: true });
    node.addEventListener('touchend', (e) => { cancel(); if (fired) e.preventDefault(); }, { passive: false });
    node.addEventListener('touchcancel', cancel);
    node.addEventListener('click', (e) => {
      if (fired) { fired = false; e.preventDefault(); return; }
      onTap();
    });
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (fired) return;
      cancel();
      onLong();
    });
  }

  function bookActions(b) {
    const p = b.progress;
    actionSheet({ title: b.title, message: p ? '讀到 ' + statusOf(b) : '還沒開始讀' }, [
      { label: '從頭開始讀', run: async () => { await resetProgress(b); renderShelf(); openBook(b); } },
      { label: '重新命名', run: () => renameBook(b) },
      { label: '刪除', danger: true, run: () => confirmDelete(b) }
    ]);
  }
  async function renameBook(b) {
    const v = await dialog({ title: '重新命名', input: b.title, okLabel: '確定' });
    if (v == null) return;
    const t = v.replace(TRIM, '');
    if (!t) { toast('書名不能是空的'); return; }
    if (t === b.title) return;
    b.title = t;
    await saveBook(b);
    renderShelf();
  }
  function confirmDelete(b) {
    actionSheet({ message: '「' + b.title + '」和它的閱讀進度會一起刪除。' }, [
      {
        label: '刪除這本書', danger: true, run: async () => {
          try {
            await DB.del('texts', b.id);
            await DB.del('books', b.id);
          } catch (e) { toast('刪除失敗'); return; }
          store.del(progKey(b.id));
          books = books.filter((x) => x !== b);
          renderShelf();
        }
      }
    ]);
  }
  async function saveBook(b) {
    try { await DB.put('books', b); } catch (e) { toast('存檔失敗：' + ((e && e.message) || e)); }
  }

  // 匯入 TXT
  async function importFiles(files) {
    if (!files.length) return;
    let ok = 0, dup = 0;
    const failed = [];
    toast('匯入中…');
    for (const f of files) {
      try {
        const title = f.name.replace(/\.[^.]+$/, '').replace(TRIM, '') || '未命名';
        if (books.some((b) => b.title === title && b.size === f.size)) { dup++; continue; }
        const text = decodeText(await f.arrayBuffer());
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        await DB.put('texts', { id, text });
        const book = { id, title, size: f.size, added: Date.now(), progress: null };
        await DB.put('books', book);
        books.push(book);
        ok++;
      } catch (e) {
        failed.push(f.name);
      }
    }
    renderShelf();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if (failed.length) {
      dialog({ title: '有 ' + failed.length + ' 個檔案沒有匯入', message: failed.join('\n') + (ok ? '\n\n其他 ' + ok + ' 本已匯入。' : ''), cancel: false });
    } else if (ok) {
      toast('已匯入 ' + ok + ' 本' + (dup ? '，' + dup + ' 本已經在書架上' : ''));
    } else if (dup) {
      toast('這些書已經在書架上了');
    }
  }
  for (const input of document.querySelectorAll('.txtInput')) {
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      importFiles(files);
    });
  }

  // 提示：在 iPhone 的 Safari 裡打開時，教他加入主畫面
  function installHint() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (ios && !standalone && !store.get('reader.hintClosed')) $('installHint').hidden = false;
  }
  $('hintClose').addEventListener('click', () => { $('installHint').hidden = true; store.set('reader.hintClosed', '1'); });

  // ======================================================================
  // 閱讀畫面
  // ======================================================================
  const R = { open: false, book: null, doc: null, chapter: 0, offset: 0, page: 0, pages: 1, flags: '', token: 0, saveTimer: 0 };
  const engine = createEngine($('reader'), onEngine);

  function engineSettings() {
    const t = themeOf(settings.theme);
    return {
      vertical: settings.vertical, fontSize: settings.fontSize, lineHeight: settings.lineHeight,
      letterSpacing: settings.letterSpacing, marginH: settings.marginH, marginV: settings.marginV,
      bg: t.bg, fg: t.fg, sub: t.sub, fontFamily: fontFamily(),
      animation: settings.animation, skipBlank: settings.skipBlank, tapBothNext: settings.tapBothNext
    };
  }

  async function openBook(b) {
    if (R.open) return;
    Object.assign(R, { open: true, book: b, doc: null, chapter: 0, offset: 0, page: 0, pages: 1 });
    store.set('reader.lastOpen', b.id);
    const reader = $('reader'), loading = $('loading');
    loading.innerHTML = '<div class="spin"></div><div>正在開啟…</div>';
    loading.hidden = false;
    const t = themeOf(settings.theme);
    reader.style.setProperty('--bg', t.bg);
    reader.style.setProperty('--fg', t.fg);
    reader.style.setProperty('--sub', t.sub);
    reader.hidden = false;
    $('library').hidden = true;
    setUiTheme();
    updateWake();
    try {
      const rec = await DB.get('texts', b.id);
      if (!rec) throw new Error('找不到這本書的內容，可能已經被刪除了。');
      await nextFrame();
      if (R.book !== b) return;
      const doc = parseBook(rec.text, b.title);
      R.doc = doc;
      const p = b.progress;
      if (p) {
        R.chapter = clamp(p.chapter | 0, 0, doc.chapters.length - 1);
        R.offset = Math.max(0, p.offset | 0);
      }
      await loadChapter(R.chapter, { offset: R.offset });
      if (R.book === b) loading.hidden = true;
    } catch (e) {
      loading.textContent = '';
      loading.appendChild(el('div', 'err', '無法開啟這本書\n' + ((e && e.message) || e)));
      const back = el('button', null, '返回書架');
      back.addEventListener('click', closeReader);
      loading.appendChild(back);
    }
  }

  async function loadChapter(i, pos) {
    const doc = R.doc;
    if (!doc || i < 0 || i >= doc.chapters.length) return;
    const token = ++R.token;
    R.chapter = i;
    if (pos.offset != null) R.offset = Math.max(0, pos.offset);
    const f = flagsOf(settings);
    if (f.traditional) {
      try { await loadS2T(); } catch (e) { f.traditional = false; toast('簡轉繁字典載入失敗'); }
    }
    await ensureFont();
    if (token !== R.token || R.doc !== doc) return;
    const ch = doc.chapters[i];
    const plain = !f.traditional && !f.quotes && !f.fullwidth;
    R.flags = flagsKey(flagsOf(settings));
    updateMenu();
    return engine.load({
      title: plain ? ch.title : transformText(ch.title, f),
      paras: plain ? ch.paras : ch.paras.map((p) => transformText(p, f)),
      index: i, count: doc.chapters.length, base: doc.starts[i], length: ch.length, total: doc.total
    }, pos, engineSettings());
  }
  const goToChapter = (i) => loadChapter(i, { offset: 0 });

  function onEngine(msg) {
    const doc = R.doc;
    switch (msg.type) {
      case 'menu':
        toggleMenu();
        break;
      case 'next':
        if (!doc) return;
        if (R.chapter + 1 < doc.chapters.length) loadChapter(R.chapter + 1, { offset: 0 });
        else toast('已經是最後一頁了');
        break;
      case 'prev':
        if (!doc) return;
        if (R.chapter > 0) loadChapter(R.chapter - 1, { end: true });
        else toast('已經是第一頁了');
        break;
      case 'pos':
        if (msg.chapter !== R.chapter) return;
        R.offset = msg.offset; R.page = msg.page; R.pages = Math.max(1, msg.pages);
        saveProgress(true);
        updateMenu();
        break;
      case 'log':
        console.warn('[reader]', msg.message);
        break;
    }
  }

  function fraction() {
    const d = R.doc;
    if (!d || !d.chapters[R.chapter]) return 0;
    const inCh = R.pages > 0 ? (R.page + 1) / R.pages : 0;
    return clamp((d.starts[R.chapter] + inCh * d.chapters[R.chapter].length) / d.total, 0, 1);
  }
  // 進度先同步寫進 localStorage（關 App 的瞬間也來得及），資料庫稍後再寫
  const progKey = (id) => 'reader.p.' + id;
  function saveProgress(later) {
    const b = R.book, d = R.doc;
    if (!b || !d || !d.chapters[R.chapter]) return;
    b.progress = { chapter: R.chapter, offset: R.offset, fraction: fraction(), lastRead: Date.now(), chapterTitle: d.chapters[R.chapter].title };
    store.set(progKey(b.id), JSON.stringify(b.progress));
    clearTimeout(R.saveTimer);
    if (later === true) R.saveTimer = setTimeout(() => DB.put('books', b).catch(() => {}), 500);
    else DB.put('books', b).catch(() => {});
  }
  function resetProgress(b) {
    b.progress = null;
    store.del(progKey(b.id));
    return saveBook(b);
  }

  function closeReader() {
    saveProgress();
    hideMenu(true);
    Overlay.close(true);
    R.open = false; R.book = null; R.doc = null; R.token++;
    store.del('reader.lastOpen');
    engine.clear();
    $('reader').hidden = true;
    $('library').hidden = false;
    setUiTheme();
    updateWake();
    renderShelf();
  }

  // ---------- 選單 ----------
  const menu = $('menu'), slider = $('chSlider');
  let sliding = false, menuTimer = 0;
  const ICONS = {
    horiz: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6.5h16M4 12h16M4 17.5h10"/></svg>',
    vert: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M17.5 4v16M12 4v16M6.5 4v10"/></svg>',
    moon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z"/></svg>',
    sun: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.1M12 19.1v2.1M5.5 5.5L7 7M17 17l1.5 1.5M2.8 12h2.1M19.1 12h2.1M5.5 18.5L7 17M17 7l1.5-1.5"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    mark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 3h11a1 1 0 0 1 1 1v17l-6.5-4.3L5.5 21V4a1 1 0 0 1 1-1z"/></svg>'
  };
  function setRangeFill(r) {
    const min = +r.min, max = +r.max, v = +r.value;
    r.style.setProperty('--p', (max > min ? ((v - min) / (max - min)) * 100 : 0) + '%');
  }
  function toggleMenu() { if (menu.hidden) showMenu(); else hideMenu(); }
  function showMenu() {
    clearTimeout(menuTimer);
    menu.classList.remove('out');
    menu.hidden = false;
    updateMenu();
  }
  function hideMenu(immediate) {
    if (menu.hidden) return;
    if (immediate) { menu.hidden = true; return; }
    menu.classList.add('out');
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => { menu.hidden = true; menu.classList.remove('out'); }, 170);
  }
  function updateMenu() {
    if (menu.hidden || !R.doc) return;
    const d = R.doc, n = d.chapters.length;
    $('mTitle').textContent = R.book.title;
    $('mChapter').textContent = d.chapters[R.chapter].title;
    slider.max = String(Math.max(0, n - 1));
    slider.hidden = n < 2;
    $('chSpacer').hidden = n >= 2;
    if (!sliding) {
      slider.value = String(R.chapter);
      $('mProgress').textContent = '第 ' + (R.chapter + 1) + ' / ' + n + ' 章 · ' + (fraction() * 100).toFixed(1) + '%';
    }
    setRangeFill(slider);
    $('prevCh').disabled = R.chapter <= 0;
    $('nextCh').disabled = R.chapter >= n - 1;
    $('dirIcon').innerHTML = settings.vertical ? ICONS.horiz : ICONS.vert;
    $('dirLabel').textContent = settings.vertical ? '改橫排' : '改直排';
    const dark = themeOf(settings.theme).dark;
    $('nightIcon').innerHTML = dark ? ICONS.sun : ICONS.moon;
    $('nightLabel').textContent = dark ? '日間' : '夜間';
  }
  $('menuMid').addEventListener('click', () => hideMenu());
  $('backBtn').addEventListener('click', closeReader);
  $('prevCh').addEventListener('click', () => goToChapter(R.chapter - 1));
  $('nextCh').addEventListener('click', () => goToChapter(R.chapter + 1));
  slider.addEventListener('input', () => {
    sliding = true;
    setRangeFill(slider);
    const d = R.doc;
    if (d) $('mProgress').textContent = d.chapters[+slider.value].title;
  });
  slider.addEventListener('change', () => {
    sliding = false;
    const i = +slider.value;
    if (i !== R.chapter) goToChapter(i); else updateMenu();
  });
  $('tocBtn').addEventListener('click', () => { hideMenu(true); openTOC(); });
  $('fmtBtn').addEventListener('click', () => { hideMenu(true); openSettings(); });
  $('dirBtn').addEventListener('click', () => setSetting('vertical', !settings.vertical));
  $('nightBtn').addEventListener('click', toggleNight);

  function toggleNight() {
    if (themeOf(settings.theme).dark) settings.theme = settings.dayTheme || 'paper';
    else { settings.dayTheme = settings.theme; settings.theme = 'night'; }
    saveSettings();
    settingsChanged('theme');
  }

  // ---------- 目錄 ----------
  function openTOC() {
    const d = R.doc;
    if (!d) return;
    let curRow = null;
    openSheet('目錄', (body) => {
      const g = el('div', 'group');
      g.style.marginTop = '6px';
      d.chapters.forEach((c, i) => {
        const row = el('button', 'row toc-row' + (i === R.chapter ? ' cur' : ''));
        row.appendChild(el('span', 'n', String(i + 1)));
        row.appendChild(el('span', 'grow', c.title));
        if (i === R.chapter) {
          const m = el('span', 'mark');
          m.innerHTML = ICONS.mark;
          row.appendChild(m);
          curRow = row;
        }
        row.addEventListener('click', () => { Overlay.close(); goToChapter(i); });
        g.appendChild(row);
      });
      body.appendChild(g);
    }, {
      after: (body) => {
        if (curRow) body.scrollTop = Math.max(0, curRow.offsetTop - body.clientHeight / 2 + curRow.offsetHeight / 2);
      }
    });
  }

  // ---------- 排版設定 ----------
  function setSetting(k, v) {
    settings[k] = v;
    saveSettings();
    settingsChanged(k);
  }
  let applyTimer = 0, applying = false, applyAgain = false;
  function settingsChanged(k) {
    if (k === 'theme') {
      if (R.open) {
        const t = themeOf(settings.theme);
        const r = $('reader');
        r.style.setProperty('--bg', t.bg); r.style.setProperty('--fg', t.fg); r.style.setProperty('--sub', t.sub);
      }
      setUiTheme();
    }
    if (k === 'keepAwake') updateWake();
    updateMenu();
    if (settingsPanel) settingsPanel.refresh(k);
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyToReader, 70);
  }
  async function applyToReader() {
    if (!R.open || !R.doc) return;
    if (applying) { applyAgain = true; return; }
    applying = true;
    try {
      if (flagsKey(flagsOf(settings)) !== R.flags) await loadChapter(R.chapter, { offset: R.offset });
      else { await ensureFont(); await engine.apply(engineSettings()); }
    } finally {
      applying = false;
      if (applyAgain) { applyAgain = false; applyToReader(); }
    }
  }

  let settingsPanel = null;
  function openSettings() {
    openSheet('排版', (body) => { settingsPanel = buildSettings(body); }, {
      half: true, light: true, onClose: () => { settingsPanel = null; }
    });
  }

  function buildSettings(body) {
    const refreshers = {};
    const add = (k, fn) => { (refreshers[k] = refreshers[k] || []).push(fn); };
    const title = (t) => body.appendChild(el('div', 'g-title', t));
    const group = () => body.appendChild(el('div', 'group'));
    const foot = (t) => body.appendChild(el('div', 'foot', t));

    // 方向
    title('排版方向');
    {
      const g = group(), row = el('div', 'row pad'), seg = el('div', 'seg');
      const bv = el('button', null, '直排'), bh = el('button', null, '橫排');
      bv.addEventListener('click', () => setSetting('vertical', true));
      bh.addEventListener('click', () => setSetting('vertical', false));
      seg.appendChild(bv); seg.appendChild(bh); row.appendChild(seg); g.appendChild(row);
      const r = () => { bv.classList.toggle('on', !!settings.vertical); bh.classList.toggle('on', !settings.vertical); };
      r(); add('vertical', r);
    }

    // 背景
    title('背景');
    {
      const g = group(), wrap = el('div', 'themes');
      const items = THEMES.map((t) => {
        const b = el('button', 'theme');
        const dot = el('span', 'dot', '文');
        dot.style.background = t.bg; dot.style.color = t.fg;
        b.appendChild(dot); b.appendChild(el('span', null, t.name));
        b.addEventListener('click', () => {
          if (!t.dark) settings.dayTheme = t.id;
          setSetting('theme', t.id);
        });
        wrap.appendChild(b);
        return [t, b];
      });
      g.appendChild(wrap);
      const r = () => items.forEach(([t, b]) => b.classList.toggle('on', settings.theme === t.id));
      r(); add('theme', r);
    }

    // 滑桿
    function slide(g, label, key, min, max, step, fmt) {
      const row = el('div', 'row');
      row.appendChild(el('span', 'lbl', label));
      const r = el('input');
      r.type = 'range'; r.min = min; r.max = max; r.step = step;
      const val = el('span', 'val');
      const sync = () => { r.value = settings[key]; val.textContent = fmt(+settings[key]); setRangeFill(r); };
      r.addEventListener('input', () => {
        const v = Math.round(+r.value / step) * step;
        settings[key] = +v.toFixed(3);
        val.textContent = fmt(settings[key]);
        setRangeFill(r);
        saveSettings();
        settingsChanged(key);
      });
      row.appendChild(r); row.appendChild(val); g.appendChild(row);
      sync(); add(key, () => { if (document.activeElement !== r) sync(); });
    }
    title('文字');
    {
      const g = group();
      slide(g, '字級', 'fontSize', 14, 36, 1, (v) => String(Math.round(v)));
      slide(g, '行距', 'lineHeight', 1.3, 2.6, 0.1, (v) => v.toFixed(1));
      slide(g, '字距', 'letterSpacing', 0, 0.3, 0.02, (v) => v.toFixed(2));
    }
    title('邊距');
    {
      const g = group();
      slide(g, '左右', 'marginH', 4, 60, 2, (v) => String(Math.round(v)));
      slide(g, '上下', 'marginV', 0, 80, 2, (v) => String(Math.round(v)));
    }

    // 字型
    title('字型');
    const fontGroup = group();
    function renderFonts() {
      fontGroup.textContent = '';
      const opt = (label, sub, id, onDelete) => {
        const row = el('button', 'row');
        const g = el('span', 'grow', label);
        if (sub) g.appendChild(el('span', 'sub', sub));
        row.appendChild(g);
        if (settings.font === id) { const m = el('span', 'mark'); m.innerHTML = ICONS.check; row.appendChild(m); }
        if (onDelete) {
          const d = el('span', 'del', '刪除');
          d.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
          row.appendChild(d);
        }
        row.addEventListener('click', () => setSetting('font', id));
        fontGroup.appendChild(row);
      };
      opt('蘋方', '系統黑體', 'system');
      opt('明朝體', '日文明體，缺字用黑體補', 'mincho');
      for (const name of fontNames) opt(name.replace(/\.[^.]+$/, ''), '匯入的字型', 'file:' + name, () => deleteFont(name));
      const imp = el('button', 'row accent');
      imp.textContent = '＋ 匯入字型檔（.ttf／.otf）';
      imp.addEventListener('click', () => $('fontInput').click());
      fontGroup.appendChild(imp);
    }
    renderFonts(); add('font', renderFonts); add('fonts', renderFonts);
    foot('想用明體，可以匯入免費的「源樣明體」「Noto Serif TC」等字型檔。');

    // 開關
    function toggle(g, label, key, sub) {
      const row = el('label', 'row');
      const t = el('span', 'grow', label);
      if (sub) t.appendChild(el('span', 'sub', sub));
      const input = el('input', 'vh');
      input.type = 'checkbox';
      input.checked = !!settings[key];
      input.addEventListener('change', () => setSetting(key, input.checked));
      row.appendChild(t); row.appendChild(input); row.appendChild(el('span', 'sw'));
      g.appendChild(row);
      add(key, () => { input.checked = !!settings[key]; });
    }
    title('文字處理');
    {
      const g = group();
      toggle(g, '簡體轉繁體', 'toTraditional', '台灣用字');
      toggle(g, '引號改成「」『』', 'cornerQuotes');
      toggle(g, '直排時短英數字轉全形', 'fullwidthAlnum');
      toggle(g, '隱藏空行', 'skipBlank');
    }
    title('操作');
    {
      const g = group();
      toggle(g, '翻頁動畫', 'animation');
      toggle(g, '點左右兩側都翻下一頁', 'tapBothNext');
      toggle(g, '閱讀時螢幕不自動鎖定', 'keepAwake', '較舊的 iOS 可能無效');
    }
    foot('讀書 ' + VERSION + '　書、進度和字型都只存在這支手機上。');

    return { refresh(k) { (refreshers[k] || []).forEach((f) => f()); } };
  }

  // 匯入字型
  $('fontInput').addEventListener('change', async () => {
    const input = $('fontInput');
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['ttf', 'otf', 'woff', 'woff2'].indexOf(ext) < 0) {
      dialog({ title: '無法匯入字型', message: '只支援 .ttf、.otf、.woff 字型檔（.ttc 不支援）。', cancel: false });
      return;
    }
    toast('正在載入字型…');
    try {
      const data = await file.arrayBuffer();
      const family = 'UF' + stableHash(file.name);
      const face = new FontFace(family, data);
      await face.load();
      document.fonts.add(face);
      await DB.put('fonts', { name: file.name, data, added: Date.now() });
      loadedFonts.set(file.name, family);
      await reloadFontNames();
      if (settingsPanel) settingsPanel.refresh('fonts');
      setSetting('font', 'file:' + file.name);
      toast('已匯入字型');
    } catch (e) {
      dialog({ title: '無法匯入字型', message: '這個檔案讀不出來，可能不是字型檔或已經損壞。', cancel: false });
    }
  });
  async function deleteFont(name) {
    try { await DB.del('fonts', name); } catch (e) { /* 刪不掉就算了 */ }
    loadedFonts.delete(name);
    await reloadFontNames();
    if (settings.font === 'file:' + name) setSetting('font', 'system');
    else if (settingsPanel) settingsPanel.refresh('fonts');
  }

  // ---------- 螢幕不自動鎖定 ----------
  let wakeLock = null;
  async function updateWake() {
    const want = R.open && settings.keepAwake && document.visibilityState === 'visible';
    if (want && !wakeLock && navigator.wakeLock) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } catch (e) { wakeLock = null; }
    } else if (!want && wakeLock) {
      try { await wakeLock.release(); } catch (e) { /* 已經放開了 */ }
      wakeLock = null;
    }
  }

  // ---------- 鍵盤（接外接鍵盤或在電腦上測試時） ----------
  document.addEventListener('keydown', (e) => {
    if (!R.open || Overlay.active || e.target.tagName === 'INPUT') return;
    const v = settings.vertical;
    if (e.key === ' ' || e.key === 'PageDown' || e.key === 'ArrowDown' || (e.key === 'ArrowLeft' && v) || (e.key === 'ArrowRight' && !v)) {
      e.preventDefault(); engine.next();
    } else if (e.key === 'PageUp' || e.key === 'ArrowUp' || (e.key === 'ArrowRight' && v) || (e.key === 'ArrowLeft' && !v)) {
      e.preventDefault(); engine.prev();
    } else if (e.key === 'Escape') {
      toggleMenu();
    }
  });

  // 不讓兩指縮放整個畫面
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveProgress();
    updateWake();
  });
  window.addEventListener('pagehide', () => saveProgress());
  if (darkMQ.addEventListener) darkMQ.addEventListener('change', setUiTheme);

  // ======================================================================
  // 啟動
  // ======================================================================
  async function init() {
    setUiTheme();
    installHint();
    try {
      books = (await DB.all('books')) || [];
    } catch (e) {
      books = [];
      toast('無法讀取書架資料');
    }
    // 資料庫來不及寫入時，用 localStorage 裡較新的進度
    for (const bk of books) {
      try {
        const p = JSON.parse(store.get(progKey(bk.id)) || 'null');
        if (p && (!bk.progress || (p.lastRead || 0) > (bk.progress.lastRead || 0))) {
          bk.progress = p;
          DB.put('books', bk).catch(() => {});
        }
      } catch (e) { /* 壞掉的進度就不管 */ }
    }
    await reloadFontNames();
    renderShelf();
    // 上次關掉 App 時正在讀的書，直接打開
    const last = store.get('reader.lastOpen');
    const b = last && books.find((x) => x.id === last);
    if (b) openBook(b);
    // 離線快取：第一次打開之後，沒有網路也能用
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  window.__reader = { R, engine, settings: () => settings, parseBook, decodeText, s2t: (t) => loadS2T().then(() => s2t(t)) };
  init();
})();
