# SharX — Claude Code Context

## Šta je SharX
AI drug interaction checker web aplikacija. Korisnik unosi lijekove/suplemente/biljke, Claude AI provjerava interakcije i kontraindikacije. Branko je jedini developer i licencirani farmaceut (MPharm) koji verificira klinički sadržaj.

- **Live URL:** https://sharx-app.github.io/SharX/
- **Hosting:** GitHub Pages
- **Repo:** github.com/sharx-app/SharX

---

## Arhitektura

```
index.html  ← cijela aplikacija (HTML + CSS + JS, single-file)
manifest.json ← PWA manifest
sw.js ← Service Worker (cache: sharx-v6)
icon-192.png / icon-512.png ← PWA ikone
```

**API flow:**
```
Browser → Cloudflare Worker (lively-sea-b64c.bbeljin.workers.dev) → Anthropic API
```

- Model: `claude-sonnet-4-5`
- Temperature: 0
- Max tokens: 4000
- Prompt caching: aktiviran (`cache_control: ephemeral` na system promptu)

---

## Stack
- Vanilla HTML/CSS/JS (bez frameworka)
- jsPDF v2.5.1 (CDN) za PDF export
- Google Analytics: G-QFMB6H7DJ6
- PWA (Service Worker + Web App Manifest)
- LocalStorage: history (max 5), cache (TTL 7 dana), jezik, install-dismissed

---

## Ključne funkcije u JS-u

| Funkcija | Opis |
|----------|------|
| `checkInteraction()` | Glavni async API poziv |
| `showResult()` | Renderuje rezultat u UI |
| `showError()` | Error handling UI |
| `printReport()` | PDF export via jsPDF |
| `escapeHtml()` | XSS zaštita (koristi se svugdje) |
| `saveToHistory()` / `renderHistory()` | History sistem |
| `getFromCache()` / `saveToCache()` | LocalStorage cache |
| `loadFromUrl()` | URL query param sharing |
| `setLanguage()` | Višejezičnost (EN/SR/DE/ES/FR/IT) |

---

## UI struktura
- **Input sekcija:** 2–5 slotova (Drug Rx / Supplement / Herb), + Health Conditions polje
- **Quick examples:** 6 predefiniranih primjera (pills)
- **Result card:**
  - Tab 1: Interactions (Mechanism, Clinical, Recommendation)
  - Tab 2: Contraindications (do 6, sa nivoima: major/moderate/minor/info)
- **History:** zadnjih 5 provjera
- **PWA install banner**

---

## Sigurnost
- `escapeHtml()` pokriva sve korisničke inpute u DOM-u
- API ključ je skrivenom iza Cloudflare Worker proxyja (nije eksponiran u kodu)
- HTTPS only

---

## Otvoreni zadaci

- [ ] Rate limiting na Cloudflare Workeru (zaštita API ključa)
- [ ] Autocomplete za nazive lijekova (RxNorm / OpenFDA API)
- [ ] Povećati history limit iznad 5
- [ ] Dark mode
- [ ] Aria-label accessibility atributi
- [ ] Usage analytics (koje interakcije se najčešće traže)
- [ ] Backend server (Vercel/Railway) — preduslov za RAG implementaciju

---

## Stil rada
- Komunikacija uvijek na srpskom/bosanskom
- Direktno, bez uvoda — odmah na stvar
- Ne mijenjaj ništa što nije u zadatku
- Sav kod ide u `index.html` (single-file pristup)
- Nema komentara u kodu osim kad je razlog neoočigledan

---

## Karpathy Guidelines (Claude Code Behavior)

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
* State your assumptions explicitly. If uncertain, ask.
* If multiple interpretations exist, present them - don't pick silently.
* If a simpler approach exists, say so. Push back when warranted.
* If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

* No features beyond what was asked.
* No abstractions for single-use code.
* No "flexibility" or "configurability" that wasn't requested.
* No error handling for impossible scenarios.
* If you write 200 lines and it could be 50, rewrite it.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

* Don't "improve" adjacent code, comments, or formatting.
* Don't refactor things that aren't broken.
* Match existing style, even if you'd do it differently.
* If you notice unrelated dead code, mention it - don't delete it.
* Remove imports/variables/functions that YOUR changes made unused.
* Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

* "Add validation" → "Write tests for invalid inputs, then make them pass"
* "Fix the bug" → "Write a test that reproduces it, then make it pass"
* For multi-step tasks, state a brief plan with verify steps.

**Working if:** fewer unnecessary changes in diffs, clarifying questions come before implementation.
