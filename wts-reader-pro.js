/* ==============================================================
   WTS ARTICLE READER PRO 2026 (Rewrite)
   Reading Progress + Advanced Text-To-Speech for Blogger
   Vanilla JS — no external dependencies, no server/API required.
   ============================================================== */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  if (window.WTS_READER_ACTIVE) return;
  window.WTS_READER_ACTIVE = true;

  /* ============================================================
     0. CONFIG — hariri hapa kubinafsisha
     ============================================================ */
  var CONFIG = {
    articleSelector: '.post-body',
    ignoreSelectors: [
      'pre', 'code', 'script', 'style', 'iframe', 'noscript',
      '.ad', '.ads', '.advertisement', '.adsbygoogle',
      '.wts-no-tts', '.no-tts', 'figcaption.wts-skip'
    ],
    focusModeSelectors: [], // ongeza selectors za ziada za sidebar/widget za theme yako
    wordsPerMinute: 200,          // kwa "estimated reading time"
    defaultRate: 1,
    defaultPitch: 1,
    defaultVolume: 1,
    autoPauseOnHiddenTab: true,
    autoResumeOnReturn: true,
    enableWordHighlight: true,
    resumeMaxAgeDays: 30,
    sleepTimerOptions: [0, 5, 10, 15, 30, 60], // 0 = imezimwa
    keyboardShortcuts: true,
    // --- Engine mbadala ya Kiswahili bure (isiyo rasmi, bila API key) ---
    // 'auto'      = tumia sauti ya asili ya kifaa; ikiwa haipo kwa Kiswahili, tumia Google
    // 'native'    = lazimisha sauti ya asili ya kifaa daima
    // 'gtranslate'= lazimisha Google Translate TTS daima (bure, si rasmi, ukomo wa herufi)
    ttsEngine: 'auto',
    gtranslateChunkChars: 170, // Google TTS ina ukomo wa herufi kwa ombi moja
    statsStorageKey: 'wts_reader_stats_v1',
    historyStorageKey: 'wts_reader_history_v1',
    historyMaxItems: 50,
    debug: false
  };

  function log() {
    if (CONFIG.debug) { try { console.log.apply(console, ['[WTS Reader]'].concat([].slice.call(arguments))); } catch (e) {} }
  }

  var postBody = document.querySelector(CONFIG.articleSelector);
  if (!postBody) return;

  var supportsTTS = ('speechSynthesis' in window);
  var pageKey = 'wts_pos_' + location.pathname;

  /* ============================================================
     1. READING PROGRESS BAR (scroll-based)
     ============================================================ */
  var progWrap = document.createElement('div');
  progWrap.id = 'wts-reading-progress-wrap';
  progWrap.className = 'wts-reader-pro';
  progWrap.innerHTML = '<div id="wts-reading-progress"></div>';
  document.body.appendChild(progWrap);

  var progressEl = document.getElementById('wts-reading-progress');
  var pctEl = document.createElement('div');
  pctEl.id = 'wts-reading-progress-pct';
  pctEl.className = 'wts-reader-pro';
  pctEl.textContent = '0%';
  document.body.appendChild(pctEl);

  var pctTimer;
  function updateScrollProgress() {
    var start = postBody.offsetTop;
    var height = postBody.offsetHeight - window.innerHeight;
    var position = window.scrollY - start;
    var value = height > 0 ? (position / height) * 100 : 0;
    value = Math.max(0, Math.min(100, value));
    progressEl.style.width = value + '%';
    pctEl.textContent = Math.round(value) + '%';
    pctEl.classList.add('show');
    clearTimeout(pctTimer);
    pctTimer = setTimeout(function () { pctEl.classList.remove('show'); }, 1200);
    saveScrollPosition();
  }
  window.addEventListener('scroll', throttle(updateScrollProgress, 80), { passive: true });

  function throttle(fn, wait) {
    var t = 0;
    return function () {
      var now = Date.now();
      if (now - t >= wait) { t = now; fn.apply(this, arguments); }
    };
  }

  if (!supportsTTS) { log('speechSynthesis not supported in this browser — TTS disabled.'); return; }

  /* ============================================================
     2. TEXT PREP — vunja makala kuwa "chunks" (aya) na sentensi
     ============================================================ */
  var BLOCK_TAGS = ['P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TD', 'FIGCAPTION'];

  function isIgnored(el) {
    for (var i = 0; i < CONFIG.ignoreSelectors.length; i++) {
      if (el.matches && el.matches(CONFIG.ignoreSelectors[i])) return true;
      if (el.closest && el.closest(CONFIG.ignoreSelectors[i])) return true;
    }
    return false;
  }

  function splitSentences(text) {
    var parts = text.match(/[^.!?…]+[.!?…]+(\s|$)|[^.!?…]+$/g) || [text];
    return parts.map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function buildChunks() {
    var nodes = postBody.querySelectorAll(BLOCK_TAGS.join(','));
    var chunks = [];
    nodes.forEach(function (el) {
      if (isIgnored(el)) return;
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length < 2) return;
      // epuka kuchukua parent na child mara mbili (mfano LI ndani ya blockquote)
      if (el.closest(BLOCK_TAGS.filter(function (t) { return t !== el.tagName; }).join(',')) &&
          el.parentElement && BLOCK_TAGS.indexOf(el.parentElement.tagName) !== -1) {
        // ruhusu tu — hatari ndogo ya kurudia mara chache si hatari kubwa
      }
      chunks.push({
        el: el,
        text: text,
        sentences: splitSentences(text),
        wordCount: text.split(/\s+/).filter(Boolean).length
      });
    });
    return chunks;
  }

  var chunks = buildChunks();
  if (!chunks.length) { log('No readable text found.'); return; }

  var totalWords = chunks.reduce(function (a, c) { return a + c.wordCount; }, 0);
  var estimatedMinutes = Math.max(1, Math.round(totalWords / CONFIG.wordsPerMinute));

  /* ============================================================
     3. LANGUAGE DETECTION
     ============================================================ */
  var SW_HINTS = ['na', 'ya', 'wa', 'kwa', 'hii', 'hiyo', 'sana', 'kuwa', 'katika', 'ni', 'la', 'za', 'kwamba'];
  var EN_HINTS = ['the', 'and', 'is', 'of', 'to', 'in', 'that', 'for', 'with', 'was', 'are'];

  function heuristicDetectLang(text) {
    var words = text.toLowerCase().split(/\W+/);
    var sw = 0, en = 0;
    words.forEach(function (w) {
      if (SW_HINTS.indexOf(w) !== -1) sw++;
      if (EN_HINTS.indexOf(w) !== -1) en++;
    });
    if (sw === 0 && en === 0) return null;
    return sw > en ? 'sw' : 'en';
  }

  function getGTranslateLang() {
    try {
      if (typeof GTranslateGetCurrentLang === 'function') {
        var l = GTranslateGetCurrentLang();
        if (l) return l;
      }
    } catch (e) {}
    var cookie = document.cookie.match(/googtrans=\/[a-z-]+\/([a-z-]+)/i);
    if (cookie) return cookie[1];
    return null;
  }

  function detectLanguage() {
    return getGTranslateLang() ||
      (document.documentElement.lang ? document.documentElement.lang.slice(0, 2) : null) ||
      heuristicDetectLang(chunks.slice(0, 3).map(function (c) { return c.text; }).join(' ')) ||
      (navigator.language ? navigator.language.slice(0, 2) : 'en');
  }

  // Auto-detect direction (LTR/RTL) - Kiswahili/Kiingereza ni LTR, lakini kama theme
  // ina lugha ya RTL (Kiarabu n.k.) tunaiheshimu.
  var RTL_LANGS = ['ar', 'he', 'fa', 'ur'];
  function applyDirection(lang) {
    document.documentElement.dir = RTL_LANGS.indexOf(lang) !== -1 ? 'rtl' : 'ltr';
  }

  /* ============================================================
     4. VOICES
     ============================================================ */
  var voices = [];
  function loadVoices() { voices = speechSynthesis.getVoices() || []; }
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;

  function scoreVoice(v, lang) {
    var vl = v.lang.toLowerCase();
    var l = lang.toLowerCase();
    if (vl === l) return 3;
    if (vl.indexOf(l) === 0) return 2;
    if (vl.slice(0, 2) === l.slice(0, 2)) return 1;
    return 0;
  }

  function getBestVoice(lang, preferredName) {
    if (preferredName) {
      var byName = voices.find(function (v) { return v.name === preferredName; });
      if (byName) return byName;
    }
    var best = null, bestScore = -1;
    voices.forEach(function (v) {
      var s = scoreVoice(v, lang || 'en');
      if (s > bestScore) { bestScore = s; best = v; }
    });
    // Kiswahili mara nyingi haipo kwenye vifaa vingi -> anguka kwenye Kiingereza (default kwa mahitaji ya mtumiaji)
    if ((!best || bestScore === 0) && lang !== 'en') {
      var en = voices.find(function (v) { return v.lang.toLowerCase().indexOf('en') === 0; });
      if (en) return en;
    }
    return best || voices[0] || null;
  }

  /* ============================================================
     5. PRONUNCIATION / TEXT NORMALIZATION (msingi)
     ============================================================ */
  function normalizeForSpeech(text) {
    return text
      .replace(/&/g, ' and ')
      .replace(/(\d+)\.(\d+)/g, '$1 point $2')
      .replace(/https?:\/\/\S+/g, 'link')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* ============================================================
     6. STATE
     ============================================================ */
  var state = {
    playing: false,
    paused: false,
    chunkIndex: 0,
    sentenceIndex: 0,
    lang: detectLanguage(),
    rate: CONFIG.defaultRate,
    pitch: CONFIG.defaultPitch,
    volume: CONFIG.defaultVolume,
    voiceName: null,
    sleepTimerMinutes: 0,
    sleepTimeout: null,
    sessionStartTs: null,
    secondsRead: 0,
    wasPausedByHiddenTab: false,
    retryCount: 0
  };
  applyDirection(state.lang);

  function savedSettings() {
    try { return JSON.parse(localStorage.getItem('wts_reader_settings') || '{}'); } catch (e) { return {}; }
  }
  function persistSettings() {
    try {
      localStorage.setItem('wts_reader_settings', JSON.stringify({
        rate: state.rate, pitch: state.pitch, volume: state.volume,
        voiceName: state.voiceName, lang: state.lang, theme: currentTheme(),
        sleepTimerMinutes: state.sleepTimerMinutes
      }));
    } catch (e) {}
  }
  (function restoreSettings() {
    var s = savedSettings();
    if (s.rate) state.rate = s.rate;
    if (s.pitch) state.pitch = s.pitch;
    if (s.volume != null) state.volume = s.volume;
    if (s.voiceName) state.voiceName = s.voiceName;
    if (s.lang) { state.lang = s.lang; applyDirection(state.lang); }
    if (s.sleepTimerMinutes) state.sleepTimerMinutes = s.sleepTimerMinutes;
  })();

  function saveScrollPosition() {
    try {
      var data = JSON.parse(localStorage.getItem(pageKey) || '{}');
      data.scrollY = window.scrollY;
      data.ts = Date.now();
      localStorage.setItem(pageKey, JSON.stringify(data));
    } catch (e) {}
  }
  function savePlaybackPosition() {
    try {
      var data = JSON.parse(localStorage.getItem(pageKey) || '{}');
      data.chunkIndex = state.chunkIndex;
      data.sentenceIndex = state.sentenceIndex;
      data.ts = Date.now();
      data.title = document.title;
      localStorage.setItem(pageKey, JSON.stringify(data));
    } catch (e) {}
  }
  function loadSavedPosition() {
    try {
      var data = JSON.parse(localStorage.getItem(pageKey) || 'null');
      if (!data) return null;
      var ageDays = (Date.now() - (data.ts || 0)) / 86400000;
      if (ageDays > CONFIG.resumeMaxAgeDays) return null;
      return data;
    } catch (e) { return null; }
  }

  /* ============================================================
     7. STATS + HISTORY (localStorage, hakuna server)
     ============================================================ */
  function bumpStats(seconds, words) {
    try {
      var s = JSON.parse(localStorage.getItem(CONFIG.statsStorageKey) || '{}');
      s.totalSeconds = (s.totalSeconds || 0) + seconds;
      s.totalWords = (s.totalWords || 0) + words;
      s.articlesRead = s.articlesRead || {};
      s.articlesRead[location.pathname] = Date.now();
      localStorage.setItem(CONFIG.statsStorageKey, JSON.stringify(s));
    } catch (e) {}
  }
  function addToHistory() {
    try {
      var h = JSON.parse(localStorage.getItem(CONFIG.historyStorageKey) || '[]');
      h = h.filter(function (item) { return item.url !== location.pathname; });
      h.unshift({ url: location.pathname, title: document.title, ts: Date.now() });
      if (h.length > CONFIG.historyMaxItems) h = h.slice(0, CONFIG.historyMaxItems);
      localStorage.setItem(CONFIG.historyStorageKey, JSON.stringify(h));
    } catch (e) {}
  }

  /* ============================================================
     8. UI BUILD
     ============================================================ */
  var bar = el('div', 'wts-tts-bar wts-reader-pro');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Article reader');

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function iconBtn(id, label, iconHTML, extraCls) {
    var b = el('button', 'wts-btn' + (extraCls ? ' ' + extraCls : ''), iconHTML);
    b.id = id;
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    return b;
  }

  // --- Row 1: main controls
  var controlsRow = el('div', 'wts-controls-row', '');
  controlsRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;width:100%;';

  var btnRestart = iconBtn('wts-restart', 'Restart', '⏮');
  var btnPrev = iconBtn('wts-prev', 'Previous paragraph', '⏪');
  var btnBack10 = iconBtn('wts-back10', 'Skip back 10s', '↺');
  var btnPlay = iconBtn('wts-play', 'Play', '▶', 'wts-primary');
  var btnPause = iconBtn('wts-pause', 'Pause', '⏸');
  var btnFwd10 = iconBtn('wts-fwd10', 'Skip forward 10s', '↻');
  var btnNext = iconBtn('wts-next', 'Next paragraph', '⏩');
  var btnStop = iconBtn('wts-stop', 'Stop', '⏹', 'wts-danger');
  btnPause.disabled = true; btnStop.disabled = true;

  var label = el('span', 'wts-tts-label', 'Listen to Article');
  var eq = el('span', 'wts-tts-eq', '<i></i><i></i><i></i><i></i>');
  eq.setAttribute('aria-hidden', 'true');
  var status = el('span', 'wts-tts-status', '');
  status.id = 'wts-status';

  var btnSettings = iconBtn('wts-settings-toggle', 'Settings', '⚙');
  var btnTheme = iconBtn('wts-theme-toggle', 'Toggle dark/light mode', '🌙');

  [btnRestart, btnPrev, btnBack10, btnPlay, btnPause, btnFwd10, btnNext, btnStop]
    .forEach(function (b) { controlsRow.appendChild(b); });
  controlsRow.appendChild(label);
  controlsRow.appendChild(eq);
  controlsRow.appendChild(status);
  controlsRow.appendChild(btnTheme);
  controlsRow.appendChild(btnSettings);

  // --- Meta row (elapsed / remaining / % / reading time)
  var metaRow = el('div', 'wts-tts-meta', '');
  var metaElapsed = el('span', '', '0:00');
  var metaBar = el('div', 'wts-meta-bar', '<span></span>');
  var metaBarInner = metaBar.firstElementChild;
  var metaRemaining = el('span', '', '~' + estimatedMinutes + ' min');
  metaRow.appendChild(metaElapsed);
  metaRow.appendChild(metaBar);
  metaRow.appendChild(metaRemaining);

  // --- Settings panel
  var panel = el('div', 'wts-panel', '');

  function panelSection(title) {
    var sec = el('div', 'wts-panel-section', '');
    sec.appendChild(el('h4', '', title));
    panel.appendChild(sec);
    return sec;
  }

  // Voice + language
  var secVoice = panelSection('Voice & Language');
  var rowLang = el('div', 'wts-row', '');
  rowLang.appendChild(el('label', '', 'Language'));
  var selLang = document.createElement('select');
  ['sw', 'en'].forEach(function (code) {
    var o = document.createElement('option');
    o.value = code; o.textContent = code === 'sw' ? 'Kiswahili' : 'English';
    if (code === state.lang) o.selected = true;
    selLang.appendChild(o);
  });
  rowLang.appendChild(selLang);
  secVoice.appendChild(rowLang);

  var rowVoice = el('div', 'wts-row', '');
  rowVoice.appendChild(el('label', '', 'Voice'));
  var selVoice = document.createElement('select');
  rowVoice.appendChild(selVoice);
  secVoice.appendChild(rowVoice);

  function refreshVoiceOptions() {
    selVoice.innerHTML = '';
    var relevant = voices.filter(function (v) { return v.lang.toLowerCase().indexOf(state.lang) === 0; });
    var list = relevant.length ? relevant : voices;
    list.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.name; o.textContent = v.name + ' (' + v.lang + ')';
      if (v.name === state.voiceName) o.selected = true;
      selVoice.appendChild(o);
    });
  }
  refreshVoiceOptions();
  speechSynthesis.addEventListener && window.addEventListener('voiceschanged', refreshVoiceOptions);
  var voicePoll = setInterval(function () { if (voices.length) { refreshVoiceOptions(); clearInterval(voicePoll); } }, 400);

  // Rate / pitch / volume
  var secAudio = panelSection('Voice — Rate, Pitch, Volume');
  function styleRangeFill(input) {
    var min = parseFloat(input.min), max = parseFloat(input.max), val = parseFloat(input.value);
    var pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    input.style.background =
      'linear-gradient(to right, var(--wts-accent) 0%, var(--wts-accent) ' + pct +
      '%, var(--wts-border) ' + pct + '%, var(--wts-border) 100%)';
  }
  function sliderRow(labelText, min, max, step, value, onInput) {
    var row = el('div', 'wts-row', '');
    row.appendChild(el('label', '', labelText));
    var input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value;
    var val = el('span', 'wts-val', value);
    input.addEventListener('input', function () {
      val.textContent = input.value;
      styleRangeFill(input);
      onInput(parseFloat(input.value));
    });
    styleRangeFill(input);
    row.appendChild(input); row.appendChild(val);
    secAudio.appendChild(row);
    return input;
  }
  var rateInput = sliderRow('Rate', 0.5, 2, 0.1, state.rate, function (v) { state.rate = v; restartCurrentUtteranceIfPlaying(); persistSettings(); });
  var pitchInput = sliderRow('Pitch', 0, 2, 0.1, state.pitch, function (v) { state.pitch = v; restartCurrentUtteranceIfPlaying(); persistSettings(); });
  var volInput = sliderRow('Volume', 0, 1, 0.05, state.volume, function (v) { state.volume = v; restartCurrentUtteranceIfPlaying(); persistSettings(); });

  // Sleep timer
  var secSleep = panelSection('Sleep Timer');
  var chipRow = el('div', 'wts-chip-row', '');
  CONFIG.sleepTimerOptions.forEach(function (min) {
    var chip = el('button', 'wts-chip', min === 0 ? 'Off' : min + ' min');
    chip.type = 'button';
    if (min === state.sleepTimerMinutes) chip.classList.add('wts-active');
    chip.addEventListener('click', function () {
      Array.prototype.forEach.call(chipRow.children, function (c) { c.classList.remove('wts-active'); });
      chip.classList.add('wts-active');
      state.sleepTimerMinutes = min;
      armSleepTimer();
      persistSettings();
    });
    chipRow.appendChild(chip);
  });
  secSleep.appendChild(chipRow);

  // Accessibility
  var secA11y = panelSection('Accessibility');
  var rowContrast = el('div', 'wts-row', '');
  var contrastBtn = el('button', 'wts-chip', 'High Contrast');
  contrastBtn.type = 'button';
  contrastBtn.addEventListener('click', function () {
    document.body.classList.toggle('wts-high-contrast');
    contrastBtn.classList.toggle('wts-active');
  });
  rowContrast.appendChild(contrastBtn);
  secA11y.appendChild(rowContrast);

  var rowHighlight = el('div', 'wts-row', '');
  var highlightBtn = el('button', 'wts-chip wts-active', 'Highlight current word');
  highlightBtn.type = 'button';
  highlightBtn.addEventListener('click', function () {
    CONFIG.enableWordHighlight = !CONFIG.enableWordHighlight;
    highlightBtn.classList.toggle('wts-active', CONFIG.enableWordHighlight);
    if (!CONFIG.enableWordHighlight) clearWordHighlight();
  });
  rowHighlight.appendChild(highlightBtn);
  secA11y.appendChild(rowHighlight);

  bar.appendChild(controlsRow);
  bar.appendChild(metaRow);
  bar.appendChild(panel);
  postBody.parentNode.insertBefore(bar, postBody);

  btnSettings.addEventListener('click', function (e) {
    e.stopPropagation();
    panel.classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (!panel.classList.contains('open')) return;
    if (bar.contains(e.target)) return; // bonyezo ndani ya bar/panel halijifungi
    panel.classList.remove('open');
  });

  /* ============================================================
     9. THEME (dark/light) — huheshimu system preference kwanza
     ============================================================ */
  function currentTheme() { return document.documentElement.getAttribute('data-wts-theme') || 'light'; }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-wts-theme', t);
    btnTheme.textContent = t === 'dark' ? '☀' : '🌙';
  }
  (function initTheme() {
    var saved = savedSettings().theme;
    if (saved) { applyTheme(saved); return; }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  })();
  btnTheme.addEventListener('click', function () {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    persistSettings();
  });

  /* ============================================================
     10. WORD / SENTENCE / PARAGRAPH HIGHLIGHTING
     ============================================================ */
  var wrappedChunkIndex = -1;
  var currentWordSpans = [];

  function wrapWordsInChunk(chunk) {
    clearWordWrap(chunk);
    if (!CONFIG.enableWordHighlight) return;
    var walker = document.createTreeWalker(chunk.el, NodeFilter.SHOW_TEXT, null);
    var textNodes = [];
    var n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && n.parentElement.closest('.wts-no-tts, pre, code, script, style')) continue;
      if (n.textContent.trim()) textNodes.push(n);
    }
    textNodes.forEach(function (node) {
      var frag = document.createDocumentFragment();
      var parts = node.textContent.split(/(\s+)/);
      parts.forEach(function (part) {
        if (/^\s+$/.test(part) || part === '') {
          frag.appendChild(document.createTextNode(part));
        } else {
          var span = document.createElement('span');
          span.className = 'wts-word-token';
          span.textContent = part;
          frag.appendChild(span);
        }
      });
      node.parentNode.replaceChild(frag, node);
    });
    chunk.el.classList.add('wts-wrapped');
  }
  function clearWordWrap(chunk) {
    if (!chunk.el.classList.contains('wts-wrapped')) return;
    chunk.el.querySelectorAll('.wts-word-token').forEach(function (span) {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    chunk.el.normalize();
    chunk.el.classList.remove('wts-wrapped');
  }
  function clearWordHighlight() {
    document.querySelectorAll('.wts-reading-word').forEach(function (s) { s.classList.remove('wts-reading-word'); });
  }

  // --- Auto-scroll yenye heshima kwa mtumiaji: ikiwa mtumiaji anascroll mwenyewe
  // wakati anasikiliza, tunaacha kumfuata mpaka atulie (asishughulike) kwa muda,
  // ndipo tunarudi kumuonyesha sehemu inayosomwa kwa sasa.
  var IDLE_RESUME_MS = 3500;
  var programmaticScroll = false;
  var autoScrollSuspended = false;
  var idleScrollTimer = null;
  var progScrollTimer = null;

  function scrollToChunk(chunk) {
    programmaticScroll = true;
    chunk.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearTimeout(progScrollTimer);
    progScrollTimer = setTimeout(function () { programmaticScroll = false; }, 700);
  }

  window.addEventListener('scroll', function () {
    if (programmaticScroll) return;   // hii ni scroll yetu wenyewe, si ya mtumiaji
    if (!state.playing) return;       // muhimu tu wakati wa kusikiliza
    autoScrollSuspended = true;
    clearTimeout(idleScrollTimer);
    idleScrollTimer = setTimeout(function () {
      autoScrollSuspended = false;
      var chunk = chunks[state.chunkIndex];
      if (chunk && state.playing) scrollToChunk(chunk);
    }, IDLE_RESUME_MS);
  }, { passive: true });

  function highlightParagraph(chunk) {
    chunks.forEach(function (c) { c.el.classList.remove('wts-reading-paragraph'); });
    chunk.el.classList.add('wts-reading-paragraph');
    if (!autoScrollSuspended) scrollToChunk(chunk);
  }
  function highlightWordAt(chunk, sentenceStartOffset, charIndex, wordLen) {
    if (!CONFIG.enableWordHighlight) return;
    if (wrappedChunkIndex !== state.chunkIndex) {
      chunks.forEach(function (c, i) { if (i !== state.chunkIndex) clearWordWrap(c); });
      wrapWordsInChunk(chunk);
      wrappedChunkIndex = state.chunkIndex;
    }
    clearWordHighlight();
    var tokens = chunk.el.querySelectorAll('.wts-word-token');
    var target = sentenceStartOffset + charIndex;
    var acc = 0;
    for (var i = 0; i < tokens.length; i++) {
      var len = tokens[i].textContent.length;
      if (target >= acc && target < acc + len + 1) { tokens[i].classList.add('wts-reading-word'); break; }
      acc += len;
    }
  }

  /* ============================================================
     12. MEDIA SESSION API (lock-screen / bluetooth / earphones)
     ============================================================ */
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    var ogImage = document.querySelector('meta[property="og:image"]');
    navigator.mediaSession.metadata = new MediaMetadata({
      title: document.title,
      artist: location.hostname,
      album: 'WTS Article Reader',
      artwork: ogImage ? [{ src: ogImage.content, sizes: '512x512', type: 'image/jpeg' }] : []
    });
    navigator.mediaSession.setActionHandler('play', play);
    navigator.mediaSession.setActionHandler('pause', pauseSpeech);
    navigator.mediaSession.setActionHandler('stop', stop);
    navigator.mediaSession.setActionHandler('previoustrack', prevParagraph);
    navigator.mediaSession.setActionHandler('nexttrack', nextParagraph);
    navigator.mediaSession.setActionHandler('seekbackward', function () { skipSeconds(-10); });
    navigator.mediaSession.setActionHandler('seekforward', function () { skipSeconds(10); });
  }

  /* ============================================================
     13. TTS ENGINE (paragraph -> sentence queue)
     ============================================================ */
  var timerInterval = null;

  function totalSentenceCountBefore(chunkIdx) {
    var n = 0;
    for (var i = 0; i < chunkIdx; i++) n += chunks[i].sentences.length;
    return n;
  }
  function totalSentenceCount() { return chunks.reduce(function (a, c) { return a + c.sentences.length; }, 0); }

  function updateMeta() {
    var doneSentences = totalSentenceCountBefore(state.chunkIndex) + state.sentenceIndex;
    var total = totalSentenceCount();
    var pct = total ? Math.round((doneSentences / total) * 100) : 0;
    metaBarInner.style.width = pct + '%';
    updateMiniProgress(pct);
    var remainingWords = Math.round(totalWords * (1 - pct / 100));
    var remainingMin = Math.max(0, Math.round(remainingWords / CONFIG.wordsPerMinute));
    metaRemaining.textContent = '~' + remainingMin + ' min left (' + pct + '%)';
  }

  function startTimer() {
    state.sessionStartTs = state.sessionStartTs || Date.now();
    clearInterval(timerInterval);
    timerInterval = setInterval(function () {
      state.secondsRead++;
      var m = Math.floor(state.secondsRead / 60);
      var s = state.secondsRead % 60;
      metaElapsed.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  }
  function stopTimer() { clearInterval(timerInterval); }

  function speakCurrentSentence() {
    var chunk = chunks[state.chunkIndex];
    if (!chunk) { finishReading(); return; }
    if (state.sentenceIndex >= chunk.sentences.length) {
      state.chunkIndex++;
      state.sentenceIndex = 0;
      if (state.chunkIndex >= chunks.length) { finishReading(); return; }
      chunk = chunks[state.chunkIndex];
      highlightParagraph(chunk);
    }
    var sentenceText = chunk.sentences[state.sentenceIndex];
    if (!sentenceText) { state.sentenceIndex++; speakCurrentSentence(); return; }

    var sentenceOffset = chunk.text.indexOf(sentenceText);
    var utter = new SpeechSynthesisUtterance(normalizeForSpeech(sentenceText));
    var voice = getBestVoice(state.lang, state.voiceName);
    if (voice) { utter.voice = voice; utter.lang = voice.lang; state.voiceName = voice.name; }
    else { utter.lang = state.lang; }
    utter.rate = state.rate;
    utter.pitch = state.pitch;
    utter.volume = state.volume;

    utter.onboundary = function (e) {
      if (e.name === 'word' || e.charIndex != null) {
        highlightWordAt(chunk, sentenceOffset, e.charIndex, e.charLength || 1);
      }
    };
    utter.onend = function () {
      state.retryCount = 0;
      state.sentenceIndex++;
      savePlaybackPosition();
      speakCurrentSentence();
    };
    utter.onerror = function () {
      state.retryCount++;
      if (state.retryCount <= 2) {
        speakCurrentSentence(); // jaribu tena
      } else {
        state.retryCount = 0;
        state.sentenceIndex++; // ruka sentensi yenye tatizo
        speakCurrentSentence();
      }
    };

    speechSynthesis.speak(utter);
    if (state.sentenceIndex === 0) highlightParagraph(chunk);
    status.textContent = 'Reading…';
    updateMeta();
  }

  function play() {
    if (speechSynthesis.paused && speechSynthesis.speaking) {
      speechSynthesis.resume();
    } else {
      speechSynthesis.cancel();
      speakCurrentSentence();
    }
    state.playing = true; state.paused = false;
    bar.classList.add('wts-tts-playing');
    setPlayUIState();
    startTimer();
    setupMediaSession();
    addToHistory();
    dispatchEvt('play');
    showMiniPlayer();
  }
  function pauseSpeech() {
    speechSynthesis.pause();
    state.playing = false; state.paused = true;
    bar.classList.remove('wts-tts-playing');
    status.textContent = 'Paused';
    setPlayUIState();
    stopTimer();
    dispatchEvt('pause');
  }
  function stop() {
    speechSynthesis.cancel();
    clearWordHighlight();
    chunks.forEach(function (c) { c.el.classList.remove('wts-reading-paragraph'); clearWordWrap(c); });
    state.playing = false; state.paused = false;
    bar.classList.remove('wts-tts-playing');
    status.textContent = '';
    setPlayUIState();
    stopTimer();
    if (state.secondsRead > 3) bumpStats(state.secondsRead, Math.round((state.secondsRead / 60) * CONFIG.wordsPerMinute));
    state.secondsRead = 0; state.sessionStartTs = null;
    dispatchEvt('stop');
    clearTimeout(state.sleepTimeout);
  }
  function finishReading() {
    status.textContent = 'Finished!';
    state.playing = false;
    bar.classList.remove('wts-tts-playing');
    setPlayUIState();
    stopTimer();
    bumpStats(state.secondsRead, totalWords);
    try { localStorage.removeItem(pageKey); } catch (e) {}
    dispatchEvt('finish');
    showToast('You have finished reading this article. Well done!', []);
  }
  function restartReading() {
    speechSynthesis.cancel();
    state.chunkIndex = 0; state.sentenceIndex = 0;
    play();
  }
  function prevParagraph() {
    speechSynthesis.cancel();
    state.chunkIndex = Math.max(0, state.chunkIndex - 1);
    state.sentenceIndex = 0;
    if (state.playing || state.paused) play();
  }
  function nextParagraph() {
    speechSynthesis.cancel();
    state.chunkIndex = Math.min(chunks.length - 1, state.chunkIndex + 1);
    state.sentenceIndex = 0;
    if (state.playing || state.paused) play();
  }
  function skipSeconds(sec) {
    // Web Speech API haina "seek" halisi; tunakadiria sentensi ngapi ni sawa na sekunde hizo
    var wps = (CONFIG.wordsPerMinute / 60) * state.rate; // maneno kwa sekunde
    var wordsToSkip = Math.round(wps * Math.abs(sec));
    var chunk = chunks[state.chunkIndex];
    if (!chunk) return;
    var dir = sec > 0 ? 1 : -1;
    var idx = state.sentenceIndex;
    var wordsCounted = 0;
    while (wordsCounted < wordsToSkip) {
      idx += dir;
      if (idx < 0) { prevParagraph(); return; }
      if (idx >= chunk.sentences.length) { nextParagraph(); return; }
      wordsCounted += (chunk.sentences[idx] || '').split(/\s+/).length;
    }
    speechSynthesis.cancel();
    state.sentenceIndex = Math.max(0, idx);
    if (state.playing || state.paused) play();
  }
  function restartCurrentUtteranceIfPlaying() {
    if (state.playing) { speechSynthesis.cancel(); speakCurrentSentence(); }
  }

  function setPlayUIState() {
    btnPlay.disabled = state.playing;
    btnPause.disabled = !state.playing;
    btnStop.disabled = !(state.playing || state.paused);
  }

  function dispatchEvt(name, detail) {
    try { document.dispatchEvent(new CustomEvent('wts:' + name, { detail: detail || {} })); } catch (e) {}
  }

  /* ============================================================
     14. SLEEP TIMER
     ============================================================ */
  function armSleepTimer() {
    clearTimeout(state.sleepTimeout);
    if (!state.sleepTimerMinutes) return;
    state.sleepTimeout = setTimeout(function () {
      stop();
      showToast('Sleep timer reached — reading has stopped.', []);
    }, state.sleepTimerMinutes * 60000);
  }

  /* ============================================================
     15. AUTO PAUSE ON HIDDEN TAB
     ============================================================ */
  if (CONFIG.autoPauseOnHiddenTab) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (state.playing) { pauseSpeech(); state.wasPausedByHiddenTab = true; }
      } else if (CONFIG.autoResumeOnReturn && state.wasPausedByHiddenTab) {
        state.wasPausedByHiddenTab = false;
        play();
      }
    });
  }

  /* ============================================================
     16. TOASTS
     ============================================================ */
  function showToast(message, actions) {
    var existing = document.querySelector('.wts-toast');
    if (existing) existing.remove();
    var toast = el('div', 'wts-toast wts-reader-pro', '');
    toast.appendChild(el('span', '', message));
    (actions || []).forEach(function (a) {
      var b = el('button', a.ghost ? 'wts-ghost' : '', a.label);
      b.addEventListener('click', function () { a.onClick(); toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 250); });
      toast.appendChild(b);
    });
    document.body.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('show'); });
    setTimeout(function () { if (toast.parentNode) { toast.classList.remove('show'); setTimeout(function () { toast.remove(); }, 250); } }, 8000);
  }

  /* ============================================================
     17. MINI FLOATING DRAGGABLE PLAYER
     ============================================================ */
  var mini = el('div', 'wts-mini-player wts-hidden wts-reader-pro', '');
  var miniRing = el('div', 'wts-mini-ring', '');
  var miniIcon = el('span', 'wts-mini-icon', '▶');
  mini.appendChild(miniRing);
  mini.appendChild(miniIcon);
  document.body.appendChild(mini);

  function updateMiniProgress(pct) { mini.style.setProperty('--wts-mini-progress', pct); }

  function showMiniPlayer() { mini.classList.remove('wts-hidden'); }

  var miniExpanded = false;
  function collapseMini() {
    miniExpanded = false;
    mini.classList.remove('expanded');
    mini.innerHTML = '';
    mini.appendChild(miniRing);
    mini.appendChild(miniIcon);
    miniIcon.textContent = state.playing ? '⏸' : '▶';
  }
  function expandMini() {
    miniExpanded = true;
    mini.classList.add('expanded');
    mini.innerHTML = '';
    var head = el('div', 'wts-mini-head', '');
    head.appendChild(el('strong', '', document.title));
    var close = el('button', 'wts-mini-close', '✕');
    close.addEventListener('click', function (e) { e.stopPropagation(); collapseMini(); });
    head.appendChild(close);
    var ctrls = el('div', 'wts-mini-controls', '');
    var mPrev = iconBtn('', 'Previous paragraph', '⏪'); mPrev.addEventListener('click', prevParagraph);
    var mPlay = iconBtn('', 'Play/Pause', state.playing ? '⏸' : '▶', 'wts-primary');
    mPlay.addEventListener('click', function () {
      state.playing ? pauseSpeech() : play();
      mPlay.textContent = state.playing ? '⏸' : '▶';
    });
    var mNext = iconBtn('', 'Next paragraph', '⏩'); mNext.addEventListener('click', nextParagraph);
    var mStop = iconBtn('', 'Stop', '⏹', 'wts-danger');
    mStop.addEventListener('click', function () { stop(); mPlay.textContent = '▶'; });
    [mPrev, mPlay, mNext, mStop].forEach(function (b) { ctrls.appendChild(b); });
    mini.appendChild(head);
    mini.appendChild(ctrls);
  }

  // Drag logic (pointer events) — click bila kusogea = expand/collapse
  (function makeDraggable() {
    var dragging = false, moved = false, startX, startY, origX, origY;
    mini.addEventListener('pointerdown', function (e) {
      if (miniExpanded) return; // usisogeze wakati imefunguliwa kikamilifu
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      var rect = mini.getBoundingClientRect();
      origX = rect.left; origY = rect.top;
      mini.setPointerCapture(e.pointerId);
    });
    mini.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (moved) {
        mini.style.left = (origX + dx) + 'px';
        mini.style.top = (origY + dy) + 'px';
        mini.style.right = 'auto'; mini.style.bottom = 'auto';
      }
    });
    mini.addEventListener('pointerup', function () {
      // Kama pointerdown haikuanzisha "dragging" (mfano: imefunguliwa/expanded na
      // mtumiaji amebonyeza kitufe cha ndani kama Pause/Stop/Close), tusijifunge
      // moja kwa moja - acha kitufe husika kifanye kazi yake kwanza.
      if (!dragging) return;
      dragging = false;
      if (!moved) { miniExpanded ? collapseMini() : expandMini(); }
    });
  })();

  document.addEventListener('wts:play', function () { if (!miniExpanded) miniIcon.textContent = '⏸'; });
  document.addEventListener('wts:pause', function () { if (!miniExpanded) miniIcon.textContent = '▶'; });
  document.addEventListener('wts:stop', function () { if (!miniExpanded) miniIcon.textContent = '▶'; });

  /* ============================================================
     18. BUTTON BINDINGS
     ============================================================ */
  btnPlay.addEventListener('click', play);
  btnPause.addEventListener('click', pauseSpeech);
  btnStop.addEventListener('click', stop);
  btnRestart.addEventListener('click', restartReading);
  btnPrev.addEventListener('click', prevParagraph);
  btnNext.addEventListener('click', nextParagraph);
  btnBack10.addEventListener('click', function () { skipSeconds(-10); });
  btnFwd10.addEventListener('click', function () { skipSeconds(10); });

  selLang.addEventListener('change', function () {
    state.lang = selLang.value;
    applyDirection(state.lang);
    refreshVoiceOptions();
    persistSettings();
    restartCurrentUtteranceIfPlaying();
  });
  selVoice.addEventListener('change', function () {
    state.voiceName = selVoice.value;
    persistSettings();
    restartCurrentUtteranceIfPlaying();
  });

  /* ============================================================
     19. KEYBOARD SHORTCUTS
     ============================================================ */
  if (CONFIG.keyboardShortcuts) {
    document.addEventListener('keydown', function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].indexOf(tag) !== -1) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          state.playing ? pauseSpeech() : play();
          break;
        case 'ArrowRight':
          e.shiftKey ? nextParagraph() : skipSeconds(10);
          break;
        case 'ArrowLeft':
          e.shiftKey ? prevParagraph() : skipSeconds(-10);
          break;
        case 'ArrowUp':
          state.volume = Math.min(1, state.volume + 0.1); volInput.value = state.volume; volInput.dispatchEvent(new Event('input'));
          break;
        case 'ArrowDown':
          state.volume = Math.max(0, state.volume - 0.1); volInput.value = state.volume; volInput.dispatchEvent(new Event('input'));
          break;
        case '+':
          state.rate = Math.min(2, state.rate + 0.1); rateInput.value = state.rate; rateInput.dispatchEvent(new Event('input'));
          break;
        case '-':
          state.rate = Math.max(0.5, state.rate - 0.1); rateInput.value = state.rate; rateInput.dispatchEvent(new Event('input'));
          break;
        case 'Escape':
          stop();
          break;
      }
    });
  }

  /* ============================================================
     20. RESUME PROMPT
     ============================================================ */
  (function offerResume() {
    var saved = loadSavedPosition();
    if (saved && (saved.chunkIndex > 0 || saved.sentenceIndex > 0)) {
      showToast('You left off partway through this article. Continue?', [
        { label: 'Continue', onClick: function () { state.chunkIndex = saved.chunkIndex || 0; state.sentenceIndex = saved.sentenceIndex || 0; play(); } },
        { label: 'Start over', ghost: true, onClick: function () {} }
      ]);
    }
  })();

  /* ============================================================
     21. DEVELOPER API (window.WTSReader)
     ============================================================ */
  window.WTSReader = {
    play: play, pause: pauseSpeech, stop: stop, restart: restartReading,
    nextParagraph: nextParagraph, prevParagraph: prevParagraph, skipSeconds: skipSeconds,
    setRate: function (r) { state.rate = r; rateInput.value = r; styleRangeFill(rateInput); persistSettings(); restartCurrentUtteranceIfPlaying(); },
    setPitch: function (p) { state.pitch = p; pitchInput.value = p; styleRangeFill(pitchInput); persistSettings(); restartCurrentUtteranceIfPlaying(); },
    setVolume: function (v) { state.volume = v; volInput.value = v; styleRangeFill(volInput); persistSettings(); restartCurrentUtteranceIfPlaying(); },
    setLanguage: function (l) { state.lang = l; selLang.value = l; refreshVoiceOptions(); persistSettings(); },
    getStats: function () { try { return JSON.parse(localStorage.getItem(CONFIG.statsStorageKey) || '{}'); } catch (e) { return {}; } },
    getHistory: function () { try { return JSON.parse(localStorage.getItem(CONFIG.historyStorageKey) || '[]'); } catch (e) { return []; } },
    config: CONFIG,
    version: '2026.1.0'
  };

  setPlayUIState();
  updateMeta();
  log('WTS Article Reader Pro ready. Paragraphs:', chunks.length, 'Words:', totalWords);
});
