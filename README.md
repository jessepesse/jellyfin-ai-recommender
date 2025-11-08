# 🎬 Jellyfin AI Recommender

Saat henkilökohtaisia elokuva- ja sarjasuosituksia Jellyfin-katseluhistoriasi perusteella, tehostettuna Google Gemini -tekoälyllä. Pyydä uudet suosikkisi suoraan Jellyseerriin yhdellä klikkauksella.

> **Huom:** Tämän projektin lähdekoodi on julkinen, mutta Docker-image itsessään ei sisällä mitään salaisuuksia. Sovellus toimii vain, kun sille annetaan tarvittavat API-avaimet ja osoitteet ajon aikana.

---

<p align="center">
  <img src="images/screenshot.png" width="750">
</p>

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
-   Google Gemini API-avain. Saat omasi Google AI Studiosta (https://aistudio.google.com/app/apikey).

### Asennusvaiheet

**1. Luo projektikansio**

Luo palvelimellesi kansio sovellusta varten ja siirry sinne.

```bash
mkdir jellyfin-recommender
cd jellyfin-recommender
```

**2. Luo `docker-compose.yml`-tiedosto**

Luo tiedosto nimeltä docker-compose.yml ja liitä sinne alla oleva sisältö. Voit avata esimerkkikoodin klikkaamalla alla olevaa nuolta.

<details>
<summary>Näytä docker-compose.yml -esimerkki</summary>

```yaml
services:
  jellyfin-recommender:
    # Hakee valmiin sovelluksen suoraan GitHub Container Registrystä.
    # Varmista, että tämä osoittaa oikeaan julkiseen imageen.
    image: ghcr.io/jessepesse/jellyfin-ai-recommender:latest
    
    container_name: jellyfin-ai-recommender
    restart: unless-stopped
    
    ports:
      # Yhdistää isäntäkoneen portin 8501 kontin porttiin 8501.
      - "8501:8501"
      
    volumes:
      # Linkittää kontin sisäisen /app-kansion paikalliseen ./data-kansioon.
      # Tänne tallennetaan manuaalisesti lisätyt katselutiedot.
      - ./data:/app
      
    environment:
      # --- TÄYTÄ KAIKKI ALLA OLEVAT TIEDOT ---
      
      # Jellyfin-palvelimesi täydellinen osoite.
      - JELLYFIN_URL=http://<JELLYFIN_PALVELIMEN_IP_OSOITE>:8096
      
      # Jellyseerr-palvelimesi täydellinen osoite.
      - JELLYSEERR_URL=http://<JELLYSEERR_PALVELIMEN_IP_OSOITE>:5055
      
      # Jellyseerr API-avaimesi (löytyy Jellyseerrin asetuksista).
      - JELLYSEERR_API_KEY=<LIITÄ_JELLYSEERR_API_AVAIN_TÄHÄN>
      
      # Google AI Studion (Gemini) API-avaimesi.
      - GEMINI_API_KEY=<LIITÄ_GEMINI_API_AVAIN_TÄHÄN>
```
</details>

**3. Muokkaa `docker-compose.yml`-tiedostoa**

Avaa luomasi `docker-compose.yml` ja päivitä seuraavat kohdat vastaamaan omaa ympäristöäsi:
-   **`environment`**: Täytä kaikki neljä muuttujaa: `JELLYFIN_URL`, `JELLYSEERR_URL`, `JELLYSEERR_API_KEY` ja `GEMINI_API_KEY`.

**4. Käynnistä sovellus**

Aja seuraava komento samassa kansiossa:

```bash
docker-compose up -d
```
Docker lataa, konfiguroi ja käynnistää sovelluksen taustalla.

**5. Ota käyttöön!**

Avaa selain ja mene osoitteeseen `http://<palvelimesi-ip-osoite>:8501`. Sovelluksen pitäisi olla nyt käyttövalmis.