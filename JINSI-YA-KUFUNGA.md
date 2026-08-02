# WTS Article Reader Pro 2026 — Jinsi ya Kufunga kwenye Blogger

## Faili tatu ulizopokea
1. `wts-reader-pro.css` — mwonekano wote (rangi, dark mode, mini player, highlight)
2. `wts-reader-pro.js` — injini nzima (TTS, progress, resume, mipangilio)
3. Hili faili la maelekezo

## Hatua za usakinishaji

### 1) Weka CSS
Blogger → **Theme → Edit HTML** → tafuta tag `</head>` → weka **kabla** yake:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/JINA_LA_GITHUB/REPO@main/wts-reader-pro.css"/>
```

Kama hutaki kutumia GitHub/CDN, unaweza kubandika content yote ya `wts-reader-pro.css`
moja kwa moja ndani ya `<style> ... </style>` mahali popote kabla ya `</head>`.

### 2) Weka JS
Bado ndani ya **Edit HTML**, tafuta tag `</body>` → weka **kabla** yake:

```html
<script src="https://cdn.jsdelivr.net/gh/JINA_LA_GITHUB/REPO@main/wts-reader-pro.js"></script>
```

Au bandika content yote ya `wts-reader-pro.js` ndani ya `<script>...</script>` kabla ya `</body>`
(hii ndiyo njia rahisi zaidi kama hutumii GitHub — sawa na script yako ya awali).

> **Muhimu:** Hakikisha script hii inafungwa mara moja tu kwenye theme (usiiweke kwenye kila
> post gadget), vinginevyo itagongana yenyewe kwa yenyewe.

### 3) Hakikisha muundo wa ukurasa
Script inatafuta `.post-body` (class ya kawaida ya Blogger kwa maudhui ya post). Kama theme
yako inatumia jina tofauti, badilisha kwenye JS mstari huu (juu kabisa, ndani ya `CONFIG`):

```js
articleSelector: '.post-body',
```

### 4) (Hiari) Hali ya Kusoma Bila Vikwazo (Focus Mode)
Kitufe cha 🎯 kinajaribu kuficha sidebar/widgets moja kwa moja kwa kutumia selectors za
kawaida (`aside`, `.sidebar`, `.widget`). Kama theme yako ina majina tofauti ya class za
sidebar, ongeza kwenye `CONFIG.focusModeSelectors` na uzitumie kwenye CSS
(`body.wts-focus-mode .jina-lako-la-sidebar { opacity:.06; }`).

## Marekebisho ya hivi karibuni
- **Auto-scroll ya heshima**: Ukiwa unasikiliza na ukajiscrollia mwenyewe, script haitakusukuma tena mpaka utakapotulia (baada ya ~3.5s), ndipo itarudi kukuonyesha aya inayosomwa.
- **Mini player (pop-up floating)**: Bug ya Play/Pause/Stop/Close kutofanya kazi ndani ya kidirisha kilichofunguliwa imerekebishwa.
- **Vitufe vya duara vimepunguzwa** (havivunji tena muundo kwenye simu).
- **Settings panel** sasa ni fupi zaidi (inaskrolli ndani badala ya kurefuka kushuka chini), na inajifunga mtu akibonyeza nje yake.
- **Sliders za Mwendo/Toni/Kiasi** sasa zinaonyesha wazi (rangi ya kujaa) ni wapi mtumiaji amefikisha kiwango chake.
- **Hali ya Kusoma Bila Vikwazo (Focus Mode)** na **Skrini Nzima (Fullscreen)** zimeondolewa kabisa kwa ombi lako.

## Vipengele vilivyojumuishwa (kutoka orodha yako)
Karibu vipengele vyote vya "Core Reader", "Voice & Audio", "Reading Experience",
"Reader Controls", "Resume & Memory", "Smart Features" (isipokuwa AI halisi), "User
Interface", "Accessibility", "Media Controls", "Sleep & Automation", "Article
Management" (kwa localStorage), "Performance", "Browser Features", "Statistics"
(za msingi), "Translation" (GTranslate detection), na "Pro Features" za msingi
(Developer API, Analytics events, Debug mode) — vyote vimejengwa.

## Vipengele ambavyo HAVIKUJUMUISHWA (na kwa nini)
| Kipengele | Sababu |
|---|---|
| AI Summary / AI Key Points / AI Voice-Speed Recommendation | Vinahitaji API ya AI ya nje (gharama + API key) |
| OCR Text Reading | Inahitaji library nzito (Tesseract.js), itapunguza spidi ya site |
| Cloud Sync | Inahitaji database/server — Blogger haitoi hii |
| PWA / Service Worker / Install as App | Si vitendo kwa post moja ya blog; inahitaji usanifu wa site nzima |
| Version Checker otomatiki | Inahitaji server ya kuangalia matoleo mapya |

Ukihitaji vipengele hivi baadaye, vinawezekana lakini vitahitaji huduma za nje
(mfano: Anthropic/OpenAI API kwa summary, Firebase kwa cloud sync).

## Developer API (kwa wale wanaotaka kuunganisha na vitu vingine)
```js
window.WTSReader.play();
window.WTSReader.pause();
window.WTSReader.stop();
window.WTSReader.setRate(1.25);
window.WTSReader.getStats();
document.addEventListener('wts:finish', function(){ /* fanya kitu ukimaliza kusoma */ });
```

## Kuwasha Debug Mode
Ndani ya `CONFIG` kwenye JS, badilisha `debug: false` kuwa `debug: true` ili kuona
console logs za msaada wakati wa kutatua matatizo.
