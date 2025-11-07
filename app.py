import os
import requests
import streamlit as st
import json
from dotenv import load_dotenv

load_dotenv()

# Ladataan kaikki salaisuudet ympäristömuuttujista
JELLYFIN_URL = os.environ.get("JELLYFIN_URL")
JELLYSEERR_URL = os.environ.get("JELLYSEERR_URL")
JELLYSEERR_API_KEY = os.environ.get("JELLYSEERR_API_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
DATABASE_FILE = "database.json"

# --- Tietokanta-funktiot (JSON) ---

def load_manual_db():
    """Lataa manuaalisesti lisätyt nimikkeet JSON-tiedostosta."""
    try:
        with open(DATABASE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {} # Palauta tyhjä, jos tiedostoa ei ole

def save_manual_db(db):
    """Tallentaa päivitetyt tiedot JSON-tiedostoon."""
    with open(DATABASE_FILE, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=4)

# --- Jellyfin-funktiot (ennallaan) ---
# ... (Kopioi aiemmasta versiosta jellyfin_login ja get_watched_titles)
def jellyfin_login(username, password):
    """Kirjaa käyttäjän sisään Jellyfiniin ja palauttaa session-tiedot."""
    endpoint = f"{JELLYFIN_URL}/Users/AuthenticateByName"
    headers = {"Content-Type": "application/json", "X-Emby-Authorization": 'MediaBrowser Client="Jellyfin Recommender", Device="Streamlit", DeviceId="recommender-app", Version="1.0"'}
    body = {"Username": username, "Pw": password}
    try:
        response = requests.post(endpoint, json=body, headers=headers)
        response.raise_for_status()
        st.session_state.jellyfin_session = response.json()
        return True
    except requests.exceptions.HTTPError:
        st.error("Kirjautuminen epäonnistui. Tarkista käyttäjänimi ja salasana.")
        return False
    except requests.exceptions.RequestException as e:
        st.error(f"Yhteys Jellyfin-palvelimeen epäonnistui: {e}")
        return False

def get_jellyfin_watched_titles():
    """Hakee katsotut nimikkeet käyttäen tallennettua sessiota."""
    session = st.session_state.jellyfin_session
    user_id = session["User"]["Id"]
    access_token = session["AccessToken"]
    headers = {"X-Emby-Token": access_token}
    params = {"IncludeItemTypes": "Movie,Series", "Recursive": "true", "Filters": "IsPlayed"}
    endpoint = f"{JELLYFIN_URL}/Users/{user_id}/Items"
    try:
        response = requests.get(endpoint, headers=headers, params=params)
        response.raise_for_status()
        items = response.json().get("Items", [])
        return [item.get("Name") for item in items if item.get("Name")]
    except requests.exceptions.RequestException as e:
        st.error(f"Katseluhistorian haku epäonnistui: {e}")
        return []

# --- Tekoäly- ja Jellyseerr-funktiot (ennallaan) ---
# ... (Kopioi aiemmasta versiosta build_prompt, get_gemini_recommendations, search_jellyseerr, request_on_jellyseerr)
def build_prompt(media_type, genre, watched_list):
    """Rakentaa kehotteen, joka pyytää JSON-vastausta."""
    watched_titles_str = ", ".join(watched_list)
    genre_instruction = f"Suositusten tulee kuulua genreen: '{genre}'." if genre != "Kaikki" else "Suosittele nimikkeitä monipuolisesti eri genreistä."
    return f"""
    Olet elokuvien ja TV-sarjojen suosittelun asiantuntija. Tehtäväsi on antaa 5 {media_type}-suositusta.
    Tässä on lista nimikkeistä, jotka olen jo katsonut: {watched_titles_str}
    ÄLÄ suosittele mitään yllä olevan listan nimikkeistä.
    Käyttäjän vaatimukset:
    1. Mediatyyppi: {media_type}
    2. Genre: {genre_instruction}
    Palauta vastauksesi AINOASTAAN JSON-muodossa olevana listana objekteja. Älä laita mitään muuta tekstiä vastaukseesi.
    Jokaisen objektin tulee sisältää seuraavat avaimet: "title", "year", "reason".
    Esimerkki JSON-muodosta:
    [
      {{"title": "Dune: Part Two", "year": 2024, "reason": "Koska pidit Blade Runner 2049:stä, tämän elokuvan visuaalinen maailma ja syvällinen scifi-tarina todennäköisesti vetoavat sinuun."}},
      {{"title": "Severance", "year": 2022, "reason": "Jos pidit Black Mirrorin ajatuksia herättävistä konsepteista, tämä sarja tarjoaa samankaltaisen mysteerin ja yhteiskuntakritiikin."}}
    ]
    """

def get_gemini_recommendations(prompt):
    """Hakee suositukset ja varmistaa, että vastaus on JSON."""
    if not GEMINI_API_KEY:
        st.error("Gemini API-avainta ei ole asetettu palvelimelle.")
        return None
    try:
        import google.generativeai as genai
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(prompt)
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "")
        return json.loads(cleaned_response)
    except Exception as e:
        st.error(f"Gemini API-virhe tai JSON-muunnos epäonnistui: {e}")
        st.code(response.text if 'response' in locals() else "Ei vastausta")
        return None

def search_jellyseerr(title, year):
    """Etsii nimikettä Jellyseeristä ja palauttaa ID:n ja tyypin."""
    headers = {"X-Api-Key": JELLYSEERR_API_KEY}
    encoded_title = requests.utils.quote(title)
    endpoint = f"{JELLYSEERR_URL}/api/v1/search?query={encoded_title}&page=1"
    try:
        response = requests.get(endpoint, headers=headers)
        response.raise_for_status()
        results = response.json().get("results", [])
        for res in results:
            res_year = res.get("releaseDate", "xxxx")[:4] or res.get("firstAirDate", "yyyy")[:4]
            if str(year) == res_year:
                return res.get("id"), res.get("mediaType")
        if results:
            return results[0].get("id"), results[0].get("mediaType")
        return None, None
    except Exception as e:
        st.warning(f"Ei löytynyt nimikkeellä '{title}' Jellyseeristä. Virhe: {e}")
        return None, None

def request_on_jellyseerr(media_id, media_type):
    """Tekee pyynnön Jellyseerriin."""
    headers = {"X-Api-Key": JELLYSEERR_API_KEY, "Content-Type": "application/json"}
    endpoint = f"{JELLYSEERR_URL}/api/v1/request"
    body = {"mediaId": media_id, "mediaType": media_type}
    try:
        response = requests.post(endpoint, headers=headers, json=body)
        response.raise_for_status()
        return True
    except Exception as e:
        st.error(f"Pyyntö epäonnistui. Onko nimike jo pyydetty tai saatavilla? Virhe: {e}")
        return False

# --- UUSI PÄÄFUNKTIO, JOKA HOITAA SUOSITUSTEN HAUN ---
def fetch_and_show_recommendations(media_type, genre):
    """Yhdistää katseluhistoriat ja hakee/näyttää suositukset."""
    username = st.session_state.jellyfin_session['User']['Name']
    
    with st.spinner("Haetaan katseluhistoriaa Jellyfinistä ja tietokannasta..."):
        jellyfin_watched = get_jellyfin_watched_titles()
        db = load_manual_db()
        user_db_entry = db.get(username, {"movies": [], "series": []})
        manual_watched = user_db_entry["movies"] + user_db_entry["series"]
        
        # Yhdistetään listat ja poistetaan duplikaatit
        full_watched_list = sorted(list(set(jellyfin_watched + manual_watched)))

    if full_watched_list:
        st.info(f"Löytyi {len(full_watched_list)} katsottua nimikettä. Kysytään suosituksia tekoälyltä...")
        prompt = build_prompt(media_type, genre, full_watched_list)
        recommendations = get_gemini_recommendations(prompt)
        st.session_state.recommendations = recommendations
    else:
        st.warning("Katseluhistoriaa ei löytynyt.")
        st.session_state.recommendations = None

# --- Streamlit Käyttöliittymä ---

st.set_page_config(page_title="Jellyfin tekoäly suosittelija", layout="wide")
st.title("🎬 Jellyfin tekoäly suosittelija")

if 'jellyfin_session' not in st.session_state:
    st.session_state.jellyfin_session = None

if not st.session_state.jellyfin_session:
    # Kirjautumisnäkymä
    st.header("🔑 Kirjaudu sisään Jellyfin käyttäjälläsi")
    with st.form("login_form"):
        username = st.text_input("Käyttäjänimi")
        password = st.text_input("Salasana", type="password")
        if st.form_submit_button("Kirjaudu"):
            if jellyfin_login(username, password):
                st.rerun() # Päivittää sivun näyttääkseen päänäkymän
else:
    # Päänäkymä kirjautuneelle käyttäjälle
    username = st.session_state.jellyfin_session['User']['Name']

# UUSI OSA: Tervetuloa-viesti ja uloskirjautuminen vierekkäin
    col1, col2 = st.columns([4, 1])
    with col1:
        st.success(f"Tervetuloa, **{username}**!")
    with col2:
        if st.button("Kirjaudu ulos", use_container_width=True):
            # Tyhjennetään kaikki sessiotiedot
            for key in st.session_state.keys():
                del st.session_state[key]
            st.rerun()
    
    # UUSI OSA: Manuaalinen merkitseminen
    with st.expander("📖 Merkitse nimike katsotuksi manuaalisesti"):
        with st.form("manual_add_form", clear_on_submit=True):
            manual_title = st.text_input("Elokuvan tai sarjan nimi")
            manual_type = st.radio("Tyyppi", ["Elokuva", "Sarja"], key="manual_type", horizontal=True)
            if st.form_submit_button("Lisää listalle"):
                if manual_title:
                    db = load_manual_db()
                    # Varmistetaan, että käyttäjällä on oma osio tietokannassa
                    if username not in db:
                        db[username] = {"movies": [], "series": []}
                    
                    # Lisätään nimike oikeaan listaan
                    type_key = "movies" if manual_type == "Elokuva" else "series"
                    if manual_title not in db[username][type_key]:
                        db[username][type_key].append(manual_title)
                        save_manual_db(db)
                        st.toast(f"'{manual_title}' lisätty katsottuihin!")
                    else:
                        st.toast(f"'{manual_title}' on jo listallasi.")

    st.header("🔎 Hae suosituksia")
    media_type = st.radio("Suositellaanko elokuvia vai sarjoja?", ["Elokuva", "TV-sarja"], horizontal=True, key="media_type")
    genres = ["Kaikki", "Toiminta", "Komedia", "Draama", "Scifi", "Fantasia", "Kauhu", "Jännitys"]
    genre = st.selectbox("Valitse genre", genres, key="genre")

    if st.button("Hae suositukset"):
        fetch_and_show_recommendations(media_type, genre)

   # SUOSITUSTEN NÄYTTÄMINEN
if 'recommendations' in st.session_state and st.session_state.recommendations:
    st.header("✨ Tässä sinulle suosituksia:")
    
    # Käydään läpi kopio listasta, jotta voimme muokata alkuperäistä kesken kaiken
    for rec in st.session_state.recommendations[:]:
        title = rec.get('title', 'N/A')
        year = rec.get('year', 'N/A')
        reason = rec.get('reason', 'N/A')
        
        col1, col2 = st.columns([5, 2])
        with col1:
            st.subheader(f"{title} ({year})")
            st.caption(reason)
        
        with col2:
            # Käytetään uniikkeja avaimia napeille
            request_key = f"request_{title}_{year}"
            watched_key = f"watched_{title}_{year}"

            if st.button("Pyydä Jellyseeristä", key=request_key):
                with st.spinner(f"Etsitään ja pyydetään '{title}'..."):
                    media_id, m_type = search_jellyseerr(title, year)
                    if media_id and m_type:
                        if request_on_jellyseerr(media_id, m_type):
                            st.success(f"Pyyntö tehty!")
            
            # --- UUSI OMINAISUUS TÄSSÄ ---
            if st.button("👁️ Merkitse katsotuksi", key=watched_key, help="Merkitse tämä nimike katsotuksi"):
                # Haetaan käyttäjänimi ja nimikkeen tiedot
                username = st.session_state.jellyfin_session['User']['Name']
                title_to_add = title
                
                # Oletetaan tyyppi sen perusteella, mitä käyttäjä alun perin haki
                media_type_from_radio = st.session_state.get("media_type", "Elokuva")
                
                # Ladataan tietokanta
                db = load_manual_db()
                if username not in db:
                    db[username] = {"movies": [], "series": []}
                
                type_key = "movies" if media_type_from_radio == "Elokuva" else "series"
                
                # Lisätään nimike, jos sitä ei vielä ole
                if title_to_add not in db[username][type_key]:
                    db[username][type_key].append(title_to_add)
                    save_manual_db(db)
                    st.toast(f"'{title_to_add}' lisätty katsottuihin!", icon="👁️")

                    # Poistetaan nimike näkyvistä suosituksista välittömästi
                    st.session_state.recommendations = [r for r in st.session_state.recommendations if r.get('title') != title_to_add]
                    st.rerun() # Ladataan sivu uudelleen näyttämään muutos
                else:
                    st.toast(f"'{title_to_add}' on jo listallasi.", icon="✅")

