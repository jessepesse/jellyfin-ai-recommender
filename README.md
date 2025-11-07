# 🎬 Jellyfin AI Recommender

Saat henkilökohtaisia elokuva- ja sarjasuosituksia Jellyfin-katseluhistoriasi perusteella, tehostettuna Google Gemini -tekoälyllä. Pyydä uudet suosikkisi suoraan Jellyseerriin yhdellä klikkauksella.

> **Huom:** Tämän projektin lähdekoodi on julkinen, mutta Docker-image itsessään ei sisällä mitään salaisuuksia. Sovellus toimii vain, kun sille annetaan tarvittavat API-avaimet ja osoitteet ajon aikana.



---

## Ominaisuudet

-   **Henkilökohtaiset suositukset:** Hyödyntää Google Gemini -tekoälyä analysoimaan katselutottumuksiasi.
-   **Aito katseluhistoria:** Lukee katseludatan suoraan Jellyfin-tililtäsi.
-   **Saumaton Jellyseerr-integraatio:** Pyydä suositeltu elokuva tai sarja yhdellä napinpainalluksella.
-   **Manuaalinen seuranta:** Lisää elokuvia ja sarjoja, jotka olet nähnyt muualla, parantaaksesi suositusten tarkkuutta.
-   **Palaute:** Merkitse suositus katsotuksi, jotta sitä ei ehdoteta uudelleen.
-   **Helppokäyttöinen:** Selkeä ja yksinkertainen web-käyttöliittymä.

---

## Asennus (Docker Compose)

Helpoin tapa ajaa tätä sovellusta on Docker Composella.

### Edellytykset
-   Docker ja Docker Compose asennettuna.
-   Toimiva Jellyfin-palvelin.
-   Toimiva Jellyseerr-palvelin.
-   Google Gemini API-avain (Saat omasi Google AI Studiosta (https://aistudio.google.com/app/apikey)).

### Asennusvaiheet

**1. Luo projektikansio**

Luo palvelimellesi kansio sovellusta varten ja siirry sinne.

```bash
mkdir jellyfin-recommender
cd jellyfin-recommender
```

**2. Luo `docker-compose.yml`-tiedosto**

Luo tiedosto nimeltä `docker-compose.yml` ja liitä sinne yllä oleva sisältö.

**3. Muokkaa `docker-compose.yml`-tiedostoa**

Avaa luomasi `docker-compose.yml` ja päivitä seuraavat kohdat vastaamaan omaa ympäristöäsi:
-   **`image`**: Vaihda `ghcr.io/jessepesse/jellyfin-ai-recommender:latest` omaksi GitHub-käyttäjätunnukseksesi.
-   **`environment`**: Täytä kaikki neljä muuttujaa: `JELLYFIN_URL`, `JELLYSEERR_URL`, `JELLYSEERR_API_KEY` ja `GEMINI_API_KEY`.

**4. Käynnistä sovellus**

Aja seuraava komento samassa kansiossa:

```bash
docker-compose up -d
```
Docker lataa, konfiguroi ja käynnistää sovelluksen taustalla.

**5. Ota käyttöön!**

Avaa selain ja mene osoitteeseen `http://<palvelimesi-ip-osoite>:8501`. Sovelluksen pitäisi olla nyt käyttövalmis.