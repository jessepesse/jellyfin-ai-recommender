# Suunnitelma: Gemini Context Caching & SDK-migraatio

Tämä dokumentti kuvaa suunnitelman Google Gemini API:n **Context Caching** -ominaisuuden integroimiseksi sekä pakollisen **SDK-migraation** toteuttamiseksi `jellyfin-ai-recommender` -projektiin.

## 1. Tavoite
Vähentää viivettä (latency) ja laskea API-kustannuksia hyödyntämällä Geminin kykyä tallentaa toistuva konteksti (kuten makuprofiili ja laaja estolista) välimuistiin. Samalla päivitetään vanhentunut SDK.

## 2. Analyysi nykytilasta

### SDK-tilanne
- **Nykyinen:** `@google/generative-ai@0.24.1` — **deprecated**, tuki päättyi 31.8.2025.
- **Uusi:** `@google/genai` — virallinen korvaaja, eri API-rajapinta.
- SDK-migraatio on **pakollinen edellytys** kaikelle jatkotyölle.

### Prompt-rakenne ja token-kulutus
`GeminiService` sisältää 6 AI-metodia. Näistä vain `getRecommendations()` lähettää merkittävästi tokeneita per pyyntö:

| Metodi | Token-arvio | Caching-hyöty |
|--------|------------|---------------|
| `getRecommendations()` | Suuri (exclusion table, tuhansia rivejä) | 🟢 Hyötyisi eniten |
| `curatorDiscover()` | Keskisuuri (max 150 kandidaattia) | 🟡 Marginaalinen |
| `rankCandidates()` | Pieni–keskisuuri | 🔴 Ei hyötyisi |
| `criticSelect()` | Pieni | 🔴 Ei hyötyisi |
| `summarizeProfile()` | Pieni (80 nimikettä) | 🔴 Ei hyötyisi |
| `analyzeUserTaste()` | Pieni (50 nimikettä) | 🔴 Ei hyötyisi |

### Implicit caching (uusi tieto)
Gemini 2.5+ ja 3.x -mallit (mukaan lukien nykyinen `gemini-3-flash-preview`) tukevat **implicit cachingia**:
- 90% alennus cached tokeneista — **ei vaadi koodimuutoksia**
- Ehto: promptin alun pitää olla yhdenmukainen pyyntöjen välillä
- Ei tallennuskustannuksia (toisin kuin eksplisiittinen caching)

## 3. Tekniset vaatimukset

### SDK-migraatio (`@google/generative-ai` → `@google/genai`)
- Uusi SDK käyttää `GoogleGenAI`-luokkaa (vanha: `GoogleGenerativeAI`)
- Context caching API on erilainen
- Tukee paremmin strukturoitua outputia (JSON mode)
- **Muutokset koskevat:** `gemini.ts` (kaikki 6 metodia + `buildClientAndModel()`)

### Context Caching (Gemini API)
- **Implicit caching:** Automaattinen, toimii kun promptin alkuosa pysyy samana.
- **Explicit caching:** Minimikoko ≥ 32 768 tokenia, TTL oletus 1h, tallennuskustannus per tunti.
- **Malli:** Tuettu Gemini 2.5+ ja 3.x -malleissa.

## 4. Toteutussuunnitelma

### Vaihe 1: SDK-migraatio (prioriteetti: kriittinen)
1. Vaihdetaan `@google/generative-ai` → `@google/genai`
2. Päivitetään `buildClientAndModel()` uudelle API-rajapinnalle
3. Päivitetään `generateAIContent()` uudelle SDK:lle
4. Testataan kaikki 6 AI-metodia migraation jälkeen

### Vaihe 2: Prompt-rakenteen optimointi implicit cachingille (prioriteetti: korkea)
Muokataan `buildPromptWithProfile()` niin, että vakio-osat ovat aina alussa:

**Nykyinen järjestys:**
```
ROLE → CONTEXT & FILTERS → TASTE → EXCLUSION TABLE → RULES → OUTPUT FORMAT
```

**Optimoitu järjestys (implicit caching -ystävällinen):**
```
ROLE → RULES → OUTPUT FORMAT → TASTE → CONTEXT & FILTERS → EXCLUSION TABLE
```

Tämä maksimoi implicit caching -osumat ilman lisäkoodia tai kustannuksia.

### Vaihe 3: Eksplisiittinen caching (prioriteetti: matala, vain tarvittaessa)
Toteutetaan vain jos kirjastokoot ovat suuria (>1000 nimikettä) JA implicit caching ei riitä:

1. Token-laskuri arvioimaan, ylittääkö exclusion table 32k tokenin rajan
2. In-memory `Map<string, { cacheName, expiresAt }>` — ei tietokantamuutoksia
3. Cache luodaan synkronoinnin jälkeen, ei per request
4. Kohdistetaan vain `getRecommendations()`-metodiin

### Huomio: OpenRouter-yhteensopivuus
Context caching toimii vain Google AI Direct -providerilla. OpenRouter käyttää OpenAI-yhteensopivaa API:a eikä tue Geminin context cachingia. Koodi tarvitsee provider-tarkistuksen.

## 5. Hyödyt ja riskit

### Hyödyt
- **Kustannussäästö:** Implicit caching antaa 90% alennuksen cached tokeneista (Gemini 3 Flash)
- **Nopeus:** Cached tokenit prosessoidaan nopeammin
- **Ei lisäkustannuksia:** Implicit caching on ilmaista, toisin kuin eksplisiittinen

### Riskit/Huomioitavaa
- **SDK-migraatio:** Iso breaking change, kaikki AI-kutsut muuttuvat
- **Implicit caching ei ole taattu:** Cache-osumat riippuvat promptin yhdenmukaisuudesta
- **Eksplisiittinen caching (jos toteutetaan):** Tallennuskustannus per tunti, vanhojen cachien siivous pakollinen
- **OpenRouter:** Ei hyödy cachingista lainkaan

## 6. Kustannusarvio

| Kirjastokoko | Tokenit/pyyntö | Strategia |
|-------------|---------------|-----------|
| Pieni (<200) | ~5k–15k | Implicit riittää |
| Keskisuuri (200–1000) | ~15k–50k | Implicit riittää |
| Suuri (>1000) | ~50k–150k | Implicit + mahdollisesti eksplisiittinen |

## 7. Toteutusjärjestys

| # | Tehtävä | Vaikeusaste | Vaikutus |
|---|---------|-------------|---------|
| 1 | SDK-migraatio `@google/genai` | Keskisuuri | Kriittinen (tuki loppunut) |
| 2 | Prompt-rakenteen optimointi | Matala | Suuri (90% alennus ilmaiseksi) |
| 3 | Eksplisiittinen caching | Suuri | Marginaalinen lisähyöty |
