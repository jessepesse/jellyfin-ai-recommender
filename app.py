import os
import requests
import streamlit as st
import json
import logging
import time
from dotenv import load_dotenv
from urllib.parse import quote
from functools import wraps
from PIL import Image
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed

load_dotenv()

# --- Logging Configuration ---
LOG_FILE = "app.log"
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Suppress Streamlit's ScriptRunContext warnings from threaded code
logging.getLogger("streamlit.runtime.scriptrunner").setLevel(logging.ERROR)

# Create handlers
try:
    file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    
    # Create formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(levelname)s - [%(funcName)s] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler.setFormatter(formatter)
    
    # Add handler to logger
    logger.addHandler(file_handler)
    logger.info("=== Application Started ===")
except Exception as e:
    print(f"Warning: Could not configure logging to file: {e}")

# --- Application Version ---
APP_VERSION = "0.2.3-alpha-hotfix"

# --- Retry Decorator with Exponential Backoff ---
def retry_with_backoff(max_attempts=3, initial_delay=1, backoff_factor=2):
    """Decorator for retry logic with exponential backoff."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            attempt = 0
            delay = initial_delay
            last_exception = None
            
            while attempt < max_attempts:
                try:
                    logger.debug(f"Attempt {attempt + 1}/{max_attempts} for {func.__name__}")
                    return func(*args, **kwargs)
                except (requests.exceptions.RequestException, ConnectionError, TimeoutError) as e:
                    last_exception = e
                    attempt += 1
                    if attempt < max_attempts:
                        logger.warning(f"{func.__name__} failed (attempt {attempt}/{max_attempts}): {str(e)[:100]}. Retrying in {delay}s...")
                        time.sleep(delay)
                        delay *= backoff_factor
                    else:
                        logger.error(f"{func.__name__} failed after {max_attempts} attempts: {str(e)}")
                except Exception as e:
                    logger.error(f"{func.__name__} encountered unexpected error: {str(e)}")
                    raise
            
            if last_exception:
                raise last_exception
        return wrapper
    return decorator

if 'jellyfin_session' not in st.session_state:
    st.session_state.jellyfin_session = None
if 'recommendations' not in st.session_state:
    st.session_state.recommendations = None
if 'search_results' not in st.session_state:
    st.session_state.search_results = []
if 'search_query' not in st.session_state:
    st.session_state.search_query = ""
if 'is_loading' not in st.session_state:
    st.session_state.is_loading = False
if 'recommendations_fetched' not in st.session_state:
    st.session_state.recommendations_fetched = False
if 'last_error' not in st.session_state:
    st.session_state.last_error = None
if 'should_fetch_recommendations' not in st.session_state:
    st.session_state.should_fetch_recommendations = False

# Initialize requests.Session() for connection reuse
if 'jellyfin_requests_session' not in st.session_state:
    st.session_state.jellyfin_requests_session = requests.Session()
if 'jellyseerr_requests_session' not in st.session_state:
    st.session_state.jellyseerr_requests_session = requests.Session()

# Load all secrets from environment variables
JELLYFIN_URL = os.environ.get("JELLYFIN_URL")
JELLYSEERR_URL = os.environ.get("JELLYSEERR_URL")
JELLYSEERR_API_KEY = os.environ.get("JELLYSEERR_API_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
DATABASE_FILE = "database.json"


# --- Database Initialization ---

def initialize_database():
    """
    Initialize database.json on first application run.
    Creates an empty database if the file doesn't exist.
    This ensures the file exists before Docker volume mounts try to access it.
    """
    try:
        if not os.path.exists(DATABASE_FILE):
            logger.info(f"Database file {DATABASE_FILE} not found. Creating new empty database...")
            with open(DATABASE_FILE, 'w', encoding='utf-8') as f:
                json.dump({}, f, ensure_ascii=False, indent=2)
            logger.info(f"Successfully created new empty database at {DATABASE_FILE}")
        else:
            logger.debug(f"Database file {DATABASE_FILE} already exists")
    except IOError as e:
        logger.error(f"Failed to initialize database: {e}")
        raise RuntimeError(f"Cannot create database file: {e}")


# --- Database Functions (JSON) ---

def load_manual_db():
    """Lataa manuaalisesti lisätyt nimikkeet JSON-tiedostosta."""
    try:
        with open(DATABASE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            logger.debug(f"Successfully loaded database from {DATABASE_FILE}")
            return data
    except FileNotFoundError:
        logger.info(f"Database file {DATABASE_FILE} not found. Creating new empty database.")
        return {}
    except json.JSONDecodeError as e:
        logger.error(f"Database JSON decode error: {e}. Returning empty database.")
        st.error("⚠️ Tietokanta-tiedosto on vioittunut. Palautetaan tyhjä tietokanta. Varmista varmuuskopio!")
        return {}
    except Exception as e:
        logger.error(f"Unexpected error loading database: {e}")
        st.error(f"❌ Virhe tietokannan lataamisessa: {e}")
        return {}

def save_manual_db(db):
    """Tallentaa päivitetyt tiedot JSON-tiedostoon."""
    try:
        # Validate database structure before saving
        if not isinstance(db, dict):
            raise ValueError("Database must be a dictionary")
        
        # Create backup before saving (optional safety measure)
        import shutil
        backup_file = f"{DATABASE_FILE}.backup"
        if os.path.exists(DATABASE_FILE):
            try:
                shutil.copy(DATABASE_FILE, backup_file)
                logger.debug(f"Created backup at {backup_file}")
            except Exception as e:
                logger.warning(f"Could not create backup: {e}")
        
        with open(DATABASE_FILE, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=4)
        logger.debug(f"Successfully saved database to {DATABASE_FILE}")
    except IOError as e:
        logger.error(f"IO Error saving database: {e}")
        st.error(f"❌ Virhe tietokannan tallentamisessa: {e}")
    except Exception as e:
        logger.error(f"Unexpected error saving database: {e}")
        st.error(f"❌ Virhe tietokannan tallentamisessa: {e}")


@retry_with_backoff(max_attempts=3, initial_delay=1)
def jellyfin_login(username, password):
    """Kirjaa käyttäjän sisään Jellyfiniin ja palauttaa session-tiedot."""
    if not JELLYFIN_URL:
        logger.error("JELLYFIN_URL not configured")
        st.error("❌ JELLYFIN_URL ei ole asetettu ympäristömuuttujissa.")
        return False
    
    endpoint = f"{JELLYFIN_URL}/Users/AuthenticateByName"
    headers = {"Content-Type": "application/json", "X-Emby-Authorization": 'MediaBrowser Client="Jellyfin Recommender", Device="Streamlit", DeviceId="recommender-app", Version="1.0"'}
    body = {"Username": username, "Pw": password}
    
    try:
        logger.info(f"Attempting Jellyfin login for user: {username}")
        response = st.session_state.jellyfin_requests_session.post(endpoint, json=body, headers=headers, timeout=10)
        response.raise_for_status()
        st.session_state.jellyfin_session = response.json()
        logger.info(f"Jellyfin login successful for user: {username}")
        return True
    except requests.exceptions.HTTPError as e:
        logger.error(f"Jellyfin login HTTP error: {e.response.status_code}")
        st.error("❌ Kirjautuminen epäonnistui. Tarkista käyttäjänimi ja salasana.")
        return False
    except requests.exceptions.Timeout:
        logger.error("Jellyfin login timeout")
        st.error("❌ Jellyfin-palvelin ei vastaa. Yritä uudelleen.")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Jellyfin connection error: {e}")
        st.error(f"❌ Yhteys Jellyfin-palvelimeen epäonnistui: {str(e)[:100]}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error during Jellyfin login: {e}")
        st.error(f"❌ Odottamaton virhe kirjautumisessa: {e}")
        return False

@st.cache_data(ttl=2*60*60, show_spinner=False)
@retry_with_backoff(max_attempts=3, initial_delay=1)
def get_jellyfin_watched_titles():
    """Hakee katsotut nimikkeet käyttäen tallennettua sessiota ja tallentaa ne tietokantaan. Välimuistissa 2 tunnin ajan."""
    try:
        session = st.session_state.jellyfin_session
        if not session:
            logger.error("No active Jellyfin session")
            st.error("❌ Ei aktiivista Jellyfin-sessiota.")
            return []
        
        user_id = session.get("User", {}).get("Id")
        access_token = session.get("AccessToken")
        
        if not user_id or not access_token:
            logger.error("Invalid Jellyfin session data")
            st.error("❌ Virheellinen Jellyfin-sessiotieto.")
            return []
        
        headers = {"X-Emby-Token": access_token}
        params = {"IncludeItemTypes": "Movie,Series", "Recursive": "true", "Filters": "IsPlayed"}
        endpoint = f"{JELLYFIN_URL}/Users/{user_id}/Items"
        
        logger.debug(f"Fetching watched titles for user {user_id}")
        response = st.session_state.jellyfin_requests_session.get(endpoint, headers=headers, params=params, timeout=15)
        response.raise_for_status()
        
        items = response.json().get("Items", [])
        watched_titles = [item.get("Name") for item in items if item.get("Name")]
        logger.info(f"Successfully fetched {len(watched_titles)} watched titles from Jellyfin")
        
        # Save to database with separation
        username = st.session_state.jellyfin_session['User']['Name']
        db = load_manual_db()
        user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
        user_data["jellyfin_synced_at"] = str(__import__('datetime').datetime.now())
        user_data["jellyfin_total_watched"] = len(watched_titles)
        save_manual_db(db)
        
        return watched_titles
    except requests.exceptions.Timeout:
        logger.error("Jellyfin watch history fetch timeout")
        st.error("❌ Jellyfin-palvelin ei vastaa katseluhistorian haussa.")
        return []
    except requests.exceptions.HTTPError as e:
        logger.error(f"Jellyfin HTTP error fetching watch history: {e.response.status_code}")
        st.error(f"❌ Jellyfin palautoi virheenumeron {e.response.status_code}.")
        return []
    except requests.exceptions.RequestException as e:
        logger.error(f"Jellyfin connection error during watch history fetch: {e}")
        st.error(f"❌ Katseluhistorian haku epäonnistui: {str(e)[:100]}")
        return []
    except Exception as e:
        logger.error(f"Unexpected error fetching Jellyfin watch history: {e}")
        st.error(f"❌ Odottamaton virhe: {e}")
        return []

def _save_jellyfin_watched_to_db(watched_titles):
    """Tallentaa Jellyfin-katseluhistorian tietokantaan."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
    
    # Update watched titles (overwrite with latest from Jellyfin)
    user_data["jellyfin_synced"] = watched_titles
    save_manual_db(db)


# NOTE: AI prompts are localized to Finnish (user's native language) to ensure consistent UX.
# The application creator is Finnish, so prompts are crafted in Finnish.
# If the app is localized to other languages in the future, these prompts should be localized accordingly.
def build_prompt(media_type, genre, watched_list, watchlist, do_not_recommend_list):
    """Rakentaa kehotteen, joka pyytää JSON-vastausta. Huomioi myös 'älä suosittele' -lista."""
    # Normalize media_type for Gemini API to ensure consistent recommendations
    # UI uses "Elokuva"/"TV-sarja", but normalize to lowercase for clarity in prompt
    if media_type.lower() in ["elokuva", "movie"]:
        media_type_normalized = "elokuva"
    elif media_type.lower() in ["tv-sarja", "series", "tv-series"]:
        media_type_normalized = "TV-sarja"
    else:
        media_type_normalized = media_type.lower()
    
    watched_titles_str = ", ".join(watched_list) if watched_list else "ei yhtään"
    watchlist_str = ", ".join(watchlist) if watchlist else "ei yhtään"
    do_not_str = ", ".join(do_not_recommend_list) if do_not_recommend_list else "ei yhtään"

    genre_instruction = f"Kaikkien suositusten tulee kuulua genreen: '{genre}'." if genre != "Kaikki" else "Suosittele monipuolisesti eri genrejä."

    prompt = f"""Anna 5 uutta {media_type_normalized}-suositusta seuraavan profiilin perusteella:

TÄRKEÄ: Sinun tulee suositella AINOASTAAN {media_type_normalized.upper()}, ei muita tyyppejä!
- Jos {media_type_normalized} = "elokuva", suosittele vain elokuvia
- Jos {media_type_normalized} = "TV-sarja", suosittele vain TV-sarjoja

KATSOTTU: {watched_titles_str}
KIINNOSTUS (katselulista): {watchlist_str}
ÄLÄ SUOSITTELE: {do_not_str}
GENRE: {genre_instruction}

VAATIMUKSET:
- TULEE suositella VAIN {media_type_normalized} -tyyppisiä nimikkeitä
- Älä suosittele mitään elokuvia tai sarjoja joka löytyy jo listalta katsottu, kiinnostunut (katselulista) tai älä suosittele
- Tittelit täytyy olla englanninkielisiä
- Jokainen suositus max 80 merkkiä "reason"-kentässä
- Palauta vastauksesi minimoituna JSON-listana ilman rivinvaihtoja tai ylimääräisiä välilyöntejä
- Ainoastaan JSON-lista, ei muuta tekstiä

Vastausmuoto: [{{ "title": "...", "year": 2024, "reason": "..." }}, ...]"""
    return prompt

def get_gemini_recommendations(prompt):
    """Hakee suositukset ja varmistaa, että vastaus on JSON."""
    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY not configured")
        st.error("❌ Gemini API-avainta ei ole asetettu palvelimelle.")
        return None
    try:
        import google.generativeai as genai
        logger.debug("Configuring Google Generative AI")
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        logger.debug("Sending prompt to Gemini API")
        response = model.generate_content(prompt)
        
        if not response or not response.text:
            logger.warning("Gemini returned empty response")
            return None
        
        cleaned_response = response.text.strip().replace("```json", "").replace("```", "")
        recommendations = json.loads(cleaned_response)
        logger.info(f"Successfully received {len(recommendations) if isinstance(recommendations, list) else 'unknown'} recommendations from Gemini")
        return recommendations
    except json.JSONDecodeError as e:
        logger.error(f"Gemini API JSON decode error: {e}")
        st.error("❌ Tekoälyn vastaus ei ole kelvollista JSON:ia. Yritä uudelleen.")
        return None
    except Exception as e:
        # Check if it's a quota/rate limit error
        error_msg = str(e)
        if "quota" in error_msg.lower() or "rate_limit" in error_msg.lower():
            logger.warning(f"Gemini API quota or rate limit: {e}")
            st.error("❌ Gemini API:n käyttörajat saavutettu. Yritä myöhemmin uudelleen.")
        else:
            logger.error(f"Gemini API error: {e}")
            st.error(f"❌ Tekoälyltä suosituksia hakiessa virhe: {str(e)[:100]}")
        return None

# ---------- Jellyseerr helpers ----------
# Headers convenience
JELLYSEERR_HEADERS = {"X-Api-Key": JELLYSEERR_API_KEY} if JELLYSEERR_API_KEY else {}

@st.cache_data(ttl=6*60*60, show_spinner=False)
def search_jellyseerr(title: str):
    """
    Etsii nimikettä Jellyseeristä pelkällä nimellä ja palauttaa
    ensimmäisen osuman ID:n ja media-tyypin (tai (None, None) jos ei löydy).
    Välimuistissa 6 tunnin ajan.
    """
    if not JELLYSEERR_API_KEY:
        logger.debug("Jellyseerr API key not configured")
        return None, None
    if not JELLYSEERR_URL:
        logger.error("JELLYSEERR_URL not configured")
        return None, None
    try:
        encoded_title = quote(title or "")
        base = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
        endpoint = f"{base}/api/v1/search?query={encoded_title}&page=1"
        
        logger.debug(f"Searching Jellyseerr for: {title}")
        resp = st.session_state.jellyseerr_requests_session.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=10)
        resp.raise_for_status()
        
        results = resp.json().get("results", [])
        if not results:
            logger.debug(f"No results found in Jellyseerr for: {title}")
            return None, None
        
        first = results[0]
        media_id = first.get("id")
        media_type = first.get("mediaType")
        logger.debug(f"Found Jellyseerr match for '{title}': ID={media_id}, type={media_type}")
        return media_id, media_type
    except requests.exceptions.Timeout:
        logger.warning(f"Jellyseerr search timeout for title: {title}")
        return None, None
    except requests.exceptions.HTTPError as e:
        logger.warning(f"Jellyseerr HTTP error during search: {e.response.status_code}")
        return None, None
    except requests.exceptions.RequestException as e:
        logger.warning(f"Jellyseerr connection error during search: {e}")
        return None, None
    except Exception as e:
        logger.error(f"Unexpected error searching Jellyseerr: {e}")
        return None, None

@st.cache_data(ttl=6*60*60)
def search_jellyseerr_advanced(query: str):
    """
    Tekee yksityiskohtaisen haun Jellyseerristä.
    Palauttaa listan tuloksia, joissa on poster, rating, vuosi, kuvaus jne.
    Välimuistissa 6 tunnin ajan.
    """
    if not JELLYSEERR_API_KEY or not JELLYSEERR_URL:
        logger.debug("Jellyseerr not configured for advanced search")
        return []
    
    try:
        encoded_query = quote(query or "")
        base = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
        endpoint = f"{base}/api/v1/search?query={encoded_query}&page=1"
        
        logger.debug(f"Advanced Jellyseerr search for: {query}")
        resp = st.session_state.jellyseerr_requests_session.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=10)
        resp.raise_for_status()
        
        results = resp.json().get("results", [])
        logger.debug(f"Found {len(results)} results for '{query}'")
        
        
        if results:
            logger.debug(f"First result keys: {list(results[0].keys())}")
            logger.debug(f"First result: {json.dumps(results[0], indent=2, default=str)[:500]}")
        
        return results
    except Exception as e:
        logger.warning(f"Advanced Jellyseerr search failed for '{query}': {e}")
        return []

@st.cache_data(ttl=6*60*60, show_spinner=False)
def get_jellyseerr_details(title: str):
    """
    Hakee Jellyseerr:stä yksityiskohtaiset tiedot elokuvasta/sarjasta nimen perusteella.
    Palauttaa kaikki tulokset taulukossa. Välimuistissa 6 tunnin ajan.
    """
    if not JELLYSEERR_API_KEY or not JELLYSEERR_URL:
        return []
    
    try:
        encoded_title = quote(title or "")
        base = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
        endpoint = f"{base}/api/v1/search?query={encoded_title}&page=1"
        
        logger.debug(f"Fetching results from Jellyseerr for: {title}")
        resp = st.session_state.jellyseerr_requests_session.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=10)
        resp.raise_for_status()
        
        results = resp.json().get("results", [])
        logger.debug(f"Found {len(results)} results for '{title}'")
        return results
    except Exception as e:
        logger.warning(f"Error fetching Jellyseerr details for '{title}': {e}")
        return []

@retry_with_backoff(max_attempts=2, initial_delay=1)
def request_on_jellyseerr(media_id, media_type):
    """Tekee pyynnön Jellyseerriin."""
    if not JELLYSEERR_API_KEY:
        logger.error("Jellyseerr API key not configured")
        st.error("❌ Jellyseerr API-avainta ei ole asetettu.")
        return False
    
    headers = {"X-Api-Key": JELLYSEERR_API_KEY, "Content-Type": "application/json"}
    endpoint = f"{JELLYSEERR_URL}/api/v1/request"
    body = {"mediaId": media_id, "mediaType": media_type}
    
    try:
        logger.debug(f"Making request to Jellyseerr for media_id={media_id}, type={media_type}")
        response = st.session_state.jellyseerr_requests_session.post(endpoint, headers=headers, json=body, timeout=10)
        response.raise_for_status()
        logger.info(f"Successfully made Jellyseerr request for media_id={media_id}")
        return True
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 400:
            logger.warning(f"Jellyseerr request rejected (already exists?): {media_id}")
            st.toast("📌 Nimike on jo olemassa tai pyyntö on jo tehty.", icon="ℹ️")
        elif e.response.status_code == 401:
            logger.error("Jellyseerr API authentication failed")
            st.toast("❌ Jellyseerr-autentikointivirhe. Tarkista API-avain.", icon="🚨")
        else:
            logger.error(f"Jellyseerr HTTP error: {e.response.status_code}")
            st.toast("❌ Jellyseerr palautoi virheenumeron. Yritä uudelleen.", icon="🚨")
        return False
    except requests.exceptions.Timeout:
        logger.warning("Jellyseerr request timeout")
        st.toast("❌ Jellyseerr-palvelin ei vastaa. Yritä uudelleen.", icon="⏱️")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Jellyseerr connection error: {e}")
        st.toast("❌ Yhteysvirhe Jellyseerr-palvelimeen.", icon="🚨")
        return False
    except Exception as e:
        logger.error(f"Unexpected error making Jellyseerr request: {e}")
        st.toast("❌ Odottamaton virhe pyynnön teossa.", icon="🚨")
        return False

# --- New UI handlers using callbacks ---
def handle_jellyseerr_request(recommendation):
    """Handles a request to Jellyseerr."""
    media_id = recommendation.get("media_id")
    media_type = recommendation.get("media_type")
    title = recommendation.get("title")
    if media_id and media_type:
        if request_on_jellyseerr(media_id, media_type):
            st.toast(f"Pyyntö nimikkeelle '{title}' tehty!", icon="✅")
        # request_on_jellyseerr already shows error toast on failure
    else:
        st.toast(f"Ei löytynyt nimikkeelle '{title}' Jellyseeristä.", icon="⚠️")

def handle_search_result_add_watched(title, media_type):
    """Adds title from search results to watched list."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
    
    type_key = "movies" if media_type.lower() == "movie" else "series"
    if title not in user_data.get(type_key, []):
        user_data.setdefault(type_key, []).append(title)
        save_manual_db(db)
        st.toast(f"✅ '{title}' lisätty katsottuihin!", icon="👁️")
    else:
        st.toast(f"ℹ️ '{title}' on jo listallasi.", icon="✅")

def handle_search_result_request(media_id, media_type):
    """Requests title from Jellyseerr."""
    if request_on_jellyseerr(media_id, media_type):
        st.toast(f"📥 Pyyntö lähetetty Jellyseerriin!", icon="✅")
    else:
        st.toast(f"❌ Pyynnön lähettäminen epäonnistui.", icon="🚨")

def handle_search_result_watchlist(title, media_type):
    """Adds title from search results to watchlist."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
    user_data.setdefault("watchlist", {"movies": [], "series": []})
    
    type_key = "movies" if media_type.lower() == "movie" else "series"
    if title not in user_data["watchlist"].get(type_key, []):
        user_data["watchlist"].setdefault(type_key, []).append(title)
        save_manual_db(db)
        st.toast(f"📋 '{title}' lisätty katselulistalle!", icon="🔖")
    else:
        st.toast(f"ℹ️ '{title}' on jo katselulistallasi.", icon="ℹ️")

def handle_search_result_blacklist(title):
    """Adds title from search results to 'do not recommend' list."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
    
    if title not in user_data.get("do_not_recommend", []):
        user_data.setdefault("do_not_recommend", []).append(title)
        save_manual_db(db)
        st.toast(f"🚫 '{title}' lisätty älä-suosittele listalle!", icon="🚫")
    else:
        st.toast(f"ℹ️ '{title}' on jo älä-suosittele listalla.", icon="ℹ️")

def handle_watched_add(title, media_type_from_radio="Elokuva"):
    """Marks a title as watched in the local DB."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    # Ensure the user entry and all necessary keys exist with the correct type (list)
    user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": []})
    user_data.setdefault("do_not_recommend", [])

    key = "movies" if media_type_from_radio == "Elokuva" else "series"
    if title not in user_data.get(key, []):
        user_data.setdefault(key, []).append(title)
        save_manual_db(db)
        # Remove from current recommendations shown in UI
        st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get("title") != title]
        st.toast(f"'{title}' lisätty katsottuihin!", icon="👁️")
    else:
        st.toast(f"'{title}' on jo listallasi.", icon="✅")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def handle_watchlist_add(title_to_add):
    """Adds a title to the user's watchlist (from recommendations only)."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    media_type_from_radio = st.session_state.get("media_type", "Elokuva")

    # Ensure the user entry and the 'watchlist' key exist with correct structure
    user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
    user_data.setdefault("watchlist", {"movies": [], "series": []})

    key = "movies" if media_type_from_radio == "Elokuva" else "series"
    if title_to_add not in user_data["watchlist"].get(key, []):
        user_data["watchlist"].setdefault(key, []).append(title_to_add)
        save_manual_db(db)
        # Remove from current recommendations shown in UI
        st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get("title") != title_to_add]
        st.toast(f"'{title_to_add}' lisätty katselulistalle!", icon="🔖")
    else:
        st.toast(f"'{title_to_add}' on jo katselulistallasi.", icon="ℹ️")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def handle_watchlist_remove(title_to_remove, media_type_key):
    """Removes a title from the user's watchlist."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()

    user_data = db.get(username, {})
    watchlist = user_data.get("watchlist", {"movies": [], "series": []})
    watchlist_list = watchlist.get(media_type_key, [])

    if title_to_remove in watchlist_list:
        watchlist_list.remove(title_to_remove)
        save_manual_db(db)
        st.toast(f"'{title_to_remove}' poistettu katselulistalta.", icon="🗑️")
    else:
        st.toast(f"'{title_to_remove}' ei ole katselulistallasi.", icon="ℹ️")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def handle_watchlist_mark_watched(title_to_mark, media_type_key):
    """Marks a title from watchlist as watched and removes it from watchlist."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()

    user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
    watchlist = user_data.get("watchlist", {"movies": [], "series": []})
    watchlist_list = watchlist.get(media_type_key, [])

    if title_to_mark in watchlist_list:
        # Remove from watchlist
        watchlist_list.remove(title_to_mark)
        # Add to watched list
        user_data.setdefault(media_type_key, []).append(title_to_mark)
        save_manual_db(db)
        st.toast(f"✅ '{title_to_mark}' merkitty katsotuksi ja poistettu katselulistalta.", icon="👁️")
    else:
        st.toast(f"'{title_to_mark}' ei ole katselulistallasi.", icon="ℹ️")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def handle_blacklist_add(title):
    """Adds a title to the user's 'do not recommend' list and removes from watchlist if present."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    media_type_from_radio = st.session_state.get("media_type", "Elokuva")

    # Ensure the user entry and the 'do_not_recommend' key (as a list) exist
    user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
    user_data.setdefault("do_not_recommend", [])
    user_data.setdefault("watchlist", {"movies": [], "series": []})

    if title not in user_data.get("do_not_recommend", []):
        user_data["do_not_recommend"].append(title)
        # Also remove from watchlist if present
        watchlist = user_data.get("watchlist", {"movies": [], "series": []})
        for media_key in ["movies", "series"]:
            if title in watchlist.get(media_key, []):
                watchlist[media_key].remove(title)
                st.info(f"'{title}' poistettu myös katselulistalta.")
                break
        save_manual_db(db)
        st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get("title") != title]
        st.toast(f"'{title}' lisätty estolistalle.", icon="🚫")
    else:
        st.toast(f"'{title}' on jo estolistallasi.", icon="⚠️")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def fetch_recommendations_callback():
    """Callback function for fetching recommendations with loading state."""
    st.session_state.should_fetch_recommendations = True

# --- Backup & Restore funktiot ---

def export_user_data_as_json(username):
    """Exports user data as JSON string for download."""
    db = load_manual_db()
    user_data = db.get(username, {})
    if not user_data:
        st.error(f"Ei löytynyt tietoja käyttäjälle '{username}'")
        return None
    # Add export timestamp
    export_data = {
        "username": username,
        "exported_at": str(__import__('datetime').datetime.now()),
        "data": user_data
    }
    return json.dumps(export_data, ensure_ascii=False, indent=4)

def merge_user_data_from_json(json_string, username):
    """Merges imported user data with existing data."""
    try:
        logger.debug(f"Attempting to merge user data for: {username}")
        import_data = json.loads(json_string)
        if import_data.get("username") != username:
            logger.warning(f"Merge failed: database belongs to different user")
            st.error("❌ Tietokanta kuuluu eri käyttäjälle!")
            return False
        
        db = load_manual_db()
        current_data = db.get(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
        imported_data = import_data.get("data", {})
        
        # Merge movies (combine lists, remove duplicates)
        merged_movies = list(set(current_data.get("movies", []) + imported_data.get("movies", [])))
        # Merge series (combine lists, remove duplicates)
        merged_series = list(set(current_data.get("series", []) + imported_data.get("series", [])))
        # Merge do_not_recommend (combine lists, remove duplicates)
        merged_blacklist = list(set(current_data.get("do_not_recommend", []) + imported_data.get("do_not_recommend", [])))
        
        # Merge watchlist (combine movies and series separately)
        current_watchlist = current_data.get("watchlist", {"movies": [], "series": []})
        imported_watchlist = imported_data.get("watchlist", {"movies": [], "series": []})
        merged_watchlist = {
            "movies": list(set(current_watchlist.get("movies", []) + imported_watchlist.get("movies", []))),
            "series": list(set(current_watchlist.get("series", []) + imported_watchlist.get("series", [])))
        }
        
        # Update database with merged data
        db[username] = {
            "movies": merged_movies,
            "series": merged_series,
            "do_not_recommend": merged_blacklist,
            "watchlist": merged_watchlist,
            "jellyfin_synced_at": current_data.get("jellyfin_synced_at"),
            "jellyfin_total_watched": current_data.get("jellyfin_total_watched")
        }
        
        save_manual_db(db)
        logger.info(f"Successfully merged user data for: {username}")
        st.success(f"✅ Tietokanta yhdistetty onnistuneesti käyttäjälle '{username}'")
        st.info(f"📊 Yhdistetty: {len(merged_movies)} elokuvaa, {len(merged_series)} sarjaa")
        return True
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error during merge: {e}")
        st.error("❌ Virheellinen JSON-muoto!")
        return False
    except Exception as e:
        logger.error(f"Unexpected error merging user data: {e}")
        st.error(f"❌ Virhe yhdistäessä tietokantaa: {e}")
        return False

def import_user_data_from_json(json_string, username):
    """Imports user data from JSON string (replaces existing data)."""
    try:
        logger.debug(f"Attempting to import user data for: {username}")
        import_data = json.loads(json_string)
        if import_data.get("username") != username:
            logger.warning(f"Import failed: database belongs to different user")
            st.error("❌ Tietokanta kuuluu eri käyttäjälle!")
            return False
        
        db = load_manual_db()
        db[username] = import_data.get("data", {})
        save_manual_db(db)
        logger.info(f"Successfully imported user data for: {username}")
        st.success(f"✅ Tietokanta tuotu onnistuneesti käyttäjälle '{username}'")
        return True
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error during import: {e}")
        st.error("❌ Virheellinen JSON-muoto!")
        return False
    except Exception as e:
        logger.error(f"Unexpected error importing user data: {e}")
        st.error(f"❌ Virhe tuodessa tietokantaa: {e}")
        return False

def _enrich_recommendation_with_jellyseerr(title: str):
    """Helper function for parallel enrichment - no Streamlit calls here."""
    try:
        media_id, m_type = search_jellyseerr(title)
        return {"title": title, "media_id": media_id, "media_type": m_type, "success": True}
    except Exception as e:
        logger.warning(f"Failed to enrich recommendation '{title}': {e}")
        return {"title": title, "media_id": None, "media_type": None, "success": False, "error": str(e)}

# --- MAIN FUNCTION THAT HANDLES RECOMMENDATIONS FETCHING ---
def fetch_and_show_recommendations(media_type, genre):
    """Fetches recommendations using the watchlist as a strong signal."""
    username = st.session_state.jellyfin_session['User']['Name']
    
    try:
        with st.spinner("Haetaan katseluhistoriaa ja asetuksia..."):
            logger.debug(f"Fetching recommendations for user: {username}, media_type: {media_type}, genre: {genre}")
            jellyfin_watched = get_jellyfin_watched_titles()
            db = load_manual_db()
            user_db_entry = db.get(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
            manual_watched = user_db_entry.get("movies", []) + user_db_entry.get("series", [])
            # Correctly read the simple lists
            blacklist = user_db_entry.get("do_not_recommend", [])
            watchlist_dict = user_db_entry.get("watchlist", {"movies": [], "series": []})
            # Flatten watchlist from both movies and series for the prompt
            watchlist = watchlist_dict.get("movies", []) + watchlist_dict.get("series", [])
            full_watched_list = sorted(list(set(jellyfin_watched + manual_watched)))
            
            logger.info(f"Loaded data: watched={len(full_watched_list)}, watchlist={len(watchlist)}, blacklist={len(blacklist)}")

        with st.spinner("Kysytään suosituksia tekoälyltä..."):
            logger.debug(f"Building prompt with: media_type={media_type}, genre={genre}, watched={len(full_watched_list)}, watchlist={len(watchlist)}, blacklist={len(blacklist)}")
            prompt = build_prompt(media_type, genre, full_watched_list, watchlist, blacklist)
            logger.debug(f"Prompt built, calling Gemini...")
            recommendations = get_gemini_recommendations(prompt)
            logger.debug(f"Gemini returned: {type(recommendations)} - {recommendations if recommendations else 'None/Empty'}")

        if recommendations:
            enriched_recommendations = []
            with st.spinner("Tarkistetaan saatavuutta Jellyseeristä..."):
                logger.debug(f"Starting parallel Jellyseerr search for {len(recommendations)} recommendations")
                # Use ThreadPoolExecutor for parallel API calls to Jellyseerr
                # Important: Only pure Python functions in threads, no Streamlit calls
                with ThreadPoolExecutor(max_workers=5) as executor:
                    # Submit all enrichment tasks
                    futures = {
                        executor.submit(_enrich_recommendation_with_jellyseerr, rec['title']): rec 
                        for rec in recommendations
                    }
                    
                    # Process completed tasks as they finish
                    for future in as_completed(futures):
                        rec = futures[future]
                        try:
                            enrichment_result = future.result()
                            if enrichment_result["success"]:
                                rec['media_id'] = enrichment_result["media_id"]
                                rec['media_type'] = enrichment_result["media_type"]
                                logger.debug(f"Enriched recommendation: {rec['title']} (ID: {enrichment_result['media_id']})")
                            else:
                                rec['media_id'] = None
                                rec['media_type'] = None
                                logger.warning(f"Could not enrich '{rec['title']}': {enrichment_result.get('error', 'Unknown error')}")
                            enriched_recommendations.append(rec)
                        except Exception as e:
                            logger.warning(f"Exception processing recommendation '{rec['title']}': {e}")
                            rec['media_id'] = None
                            rec['media_type'] = None
                            enriched_recommendations.append(rec)
                
                logger.info(f"Parallel enrichment completed for {len(enriched_recommendations)} recommendations")
            
            st.session_state.recommendations = enriched_recommendations
            st.session_state.recommendations_fetched = True
            logger.info(f"Successfully generated {len(enriched_recommendations)} recommendations for user: {username}")
        else:
            st.session_state.recommendations = []
            st.session_state.recommendations_fetched = False
            logger.warning(f"No recommendations generated for user: {username} - Gemini returned None or empty")
    except Exception as e:
        logger.error(f"Unexpected error in fetch_and_show_recommendations: {e}")
        st.session_state.recommendations_fetched = False

# --- Streamlit User Interface ---

st.set_page_config(
    page_title="Jellyfin AI Recommender",
    page_icon="🎬",
    layout="wide",
    initial_sidebar_state="expanded",
    menu_items={
        "About": "Jellyfin AI Recommender - Personalized recommendations powered by Google Gemini AI"
    }
)

# Initialize database on first application run
initialize_database()

# Dark theme configuration
st.markdown("""
    <style>
        :root {
            --primary-color: #6366f1;
            --background-color: #0f172a;
            --secondary-background-color: #1e293b;
            --text-color: #f1f5f9;
            --text-secondary: #cbd5e1;
        }
        
        body {
            background-color: #0f172a;
            color: #f1f5f9;
        }
        
        .stApp {
            background-color: #0f172a;
        }
        
        /* Main container */
        .main {
            background-color: #0f172a;
        }
        
        /* Sidebar */
        .sidebar .sidebar-content {
            background-color: #1e293b;
        }
        
        /* Text elements */
        h1, h2, h3, h4, h5, h6 {
            color: #f1f5f9;
        }
        
        p, span, label {
            color: #f1f5f9;
        }
        
        /* Input fields */
        .stTextInput > div > div > input,
        .stPasswordInput > div > div > input,
        .stSelectbox > div > div > div {
            background-color: #1e293b;
            color: #f1f5f9;
            border-color: #64748b;
        }
        
        /* Buttons */
        .stButton > button {
            background-color: #6366f1;
            color: white;
            border: none;
        }
        
        .stButton > button:hover {
            background-color: #7c3aed;
        }
        
        /* Cards and containers */
        .stContainer {
            background-color: #1e293b;
        }
        
        /* Expander */
        .streamlit-expanderHeader {
            background-color: #1e293b;
            color: #f1f5f9;
        }
        
        /* Recommendation cards */
        .recommendation-card {
            background-color: #1e293b;
            border: 1px solid #64748b;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
        }
        
        /* Success/Error messages */
        .stAlert {
            background-color: #1e293b;
            color: #f1f5f9;
        }
        
        /* Section gap */
        .section-gap {
            height: 20px;
        }
    </style>
""", unsafe_allow_html=True)

# Hide Streamlit branding
hide_streamlit_style = """
    <style>
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
    </style>
    """
st.markdown(hide_streamlit_style, unsafe_allow_html=True)

# Set page title with logo
st.markdown(
    """
    <div style='display: flex; align-items: center; justify-content: center; gap: 15px; margin-bottom: 20px;'>
        <div style='font-size: 60px;'>🎬</div>
        <h1 style='margin: 0; text-align: center;'>Jellyfin AI Recommender</h1>
    </div>
    """,
    unsafe_allow_html=True
)

if 'jellyfin_session' not in st.session_state:
    st.session_state.jellyfin_session = None

if not st.session_state.get("jellyfin_session"):
    # Login view
    logger.debug("Displaying login page")
    st.header("🔑 Kirjaudu sisään Jellyfin käyttäjälläsi")
    with st.form("login_form"):
        username = st.text_input("Käyttäjänimi")
        password = st.text_input("Salasana", type="password")
        if st.form_submit_button("Kirjaudu"):
            if jellyfin_login(username, password):
                st.rerun()
else:
    # Main view for logged-in user
    username = st.session_state.get("jellyfin_session", {}).get('User', {}).get('Name', 'Unknown')

    # Compact welcome + logout
    col1, col2 = st.columns([0.8, 0.2])
    with col1:
        st.markdown(f"#### Tervetuloa, **{username}**! 👋")
    with col2:
        if st.button("Kirjaudu ulos", use_container_width=True, type="secondary"):
            for key in list(st.session_state.keys()):
                del st.session_state[key]
            st.rerun()  # Force rerun to display login page
    st.markdown("---")

    st.markdown("<div class='section-gap'></div>", unsafe_allow_html=True)
    
    # Create tabs
    tab1, tab2, tab3, tab4 = st.tabs(["🔍 Suositukset", "📝 Katselulista", "✏️ Merkitse", "💾 Tiedot"])

    # ===== TAB 1: SUOSITUKSET =====
    with tab1:
        st.header("🔎 Hae suosituksia")
        media_type = st.radio("Suositellaanko elokuvia vai sarjoja?", ["Elokuva", "TV-sarja"], horizontal=True, key="media_type")

        # Genre view displays emoji icon using format function (more stable than display labels)
        genre_options = ["Kaikki", "Toiminta", "Komedia", "Draama", "Scifi", "Fantasia", "Kauhu", "Jännitys", "Romantiikka"]
        genre_emoji = {
            "Kaikki": "🌐 Kaikki",
            "Toiminta": "🔫 Toiminta",
            "Komedia": "😂 Komedia",
            "Draama": "🎭 Draama",
            "Scifi": "🪐 Scifi",
            "Fantasia": "🧙 Fantasia",
            "Kauhu": "👻 Kauhu",
            "Jännitys": "🔪 Jännitys",
            "Romantiikka": "❤️ Romantiikka",
        }
        # Display emoji-enriched options in radio and map back to internal value
        display_options = [genre_emoji[g] for g in genre_options]
        # Use vertical radio, it behaves reliably across different browsers and doesn't break visibility when selected
        selected_display = st.radio("Valitse genre", display_options, index=0, key="genre_display_radio")
        # Map the selection back to the internal key
        reverse_map = {v: k for k, v in genre_emoji.items()}
        genre = reverse_map.get(selected_display, "Kaikki")
        # Store the genre in session state for the callback to access
        st.session_state.selected_genre = genre

        # Main button: full width, with purple highlight (CSS styles above)
        if st.button("🎬 Hae suositukset", use_container_width=True, disabled=st.session_state.get("should_fetch_recommendations", False)):
            st.session_state.should_fetch_recommendations = True
        
        # Show loading container with steps
        if st.session_state.get("should_fetch_recommendations", False):
            with st.spinner("🔄 Haetaan suosituksia..."):
                media_type = st.session_state.get("media_type", "Elokuva")
                genre = st.session_state.get("selected_genre", "Kaikki")
                
                username = st.session_state.get("jellyfin_session", {}).get('User', {}).get('Name', 'Unknown')
                
                try:
                    # Reset user-cleared flag when fetching new recommendations
                    st.session_state.recommendations_cleared_by_user = False
                    
                    jellyfin_watched = get_jellyfin_watched_titles()
                    db = load_manual_db()
                    user_db_entry = db.get(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
                    manual_watched = user_db_entry.get("movies", []) + user_db_entry.get("series", [])
                    blacklist = user_db_entry.get("do_not_recommend", [])
                    watchlist_dict = user_db_entry.get("watchlist", {"movies": [], "series": []})
                    watchlist = watchlist_dict.get("movies", []) + watchlist_dict.get("series", [])
                    full_watched_list = sorted(list(set(jellyfin_watched + manual_watched)))
                    
                    logger.info(f"Loaded data: watched={len(full_watched_list)}, watchlist={len(watchlist)}, blacklist={len(blacklist)}")
                    
                    logger.debug(f"Building prompt with: media_type={media_type}, genre={genre}, watched={len(full_watched_list)}, watchlist={len(watchlist)}, blacklist={len(blacklist)}")
                    prompt = build_prompt(media_type, genre, full_watched_list, watchlist, blacklist)
                    logger.debug(f"Prompt built, calling Gemini...")
                    recommendations = get_gemini_recommendations(prompt)
                    logger.debug(f"Gemini returned: {type(recommendations)} - {recommendations if recommendations else 'None/Empty'}")
                    
                    if recommendations:
                        enriched_recommendations = []
                        logger.debug(f"Starting parallel Jellyseerr search for {len(recommendations)} recommendations")
                        with ThreadPoolExecutor(max_workers=5) as executor:
                            futures = {
                                executor.submit(_enrich_recommendation_with_jellyseerr, rec['title']): rec 
                                for rec in recommendations
                            }
                            
                            for future in as_completed(futures):
                                rec = futures[future]
                                try:
                                    enrichment_result = future.result()
                                    if enrichment_result["success"]:
                                        rec['media_id'] = enrichment_result["media_id"]
                                        rec['media_type'] = enrichment_result["media_type"]
                                        logger.debug(f"Enriched recommendation: {rec['title']} (ID: {enrichment_result['media_id']})")
                                    else:
                                        rec['media_id'] = None
                                        rec['media_type'] = None
                                        logger.warning(f"Could not enrich '{rec['title']}': {enrichment_result.get('error', 'Unknown error')}")
                                    enriched_recommendations.append(rec)
                                except Exception as e:
                                    logger.warning(f"Exception processing recommendation '{rec['title']}': {e}")
                                    rec['media_id'] = None
                                    rec['media_type'] = None
                                    enriched_recommendations.append(rec)
                        
                        logger.info(f"Parallel enrichment completed for {len(enriched_recommendations)} recommendations")
                        st.session_state.recommendations = enriched_recommendations
                        st.session_state.recommendations_fetched = True
                        logger.info(f"Successfully generated {len(enriched_recommendations)} recommendations for user: {username}")
                    else:
                        st.session_state.recommendations = []
                        st.session_state.recommendations_fetched = False
                        logger.warning(f"No recommendations generated for user: {username} - Gemini returned None or empty")
                except Exception as e:
                    logger.error(f"Unexpected error in recommendations fetch: {e}")
                    st.session_state.recommendations_fetched = False
                    st.session_state.last_error = str(e)
                finally:
                    st.session_state.should_fetch_recommendations = False
        
        # Show success/error/warning messages after the button
        if st.session_state.get("recommendations_fetched", False) and st.session_state.get("recommendations"):
            st.success(f"✅ {len(st.session_state.get('recommendations', []))} suositusta haettu onnistuneesti!")
        elif st.session_state.get("recommendations_fetched", False) and not st.session_state.get("recommendations") and not st.session_state.get("recommendations_cleared_by_user", False):
            st.warning("⚠️ Gemini ei palauttanut suosituksia. Yritä uudelleen.")
        
        if st.session_state.get("last_error"):
            st.error(f"❌ Virhe suositusten haussa: {st.session_state.get('last_error', '')[:150]}")
            st.session_state.last_error = None
        
        st.divider()
        
        # DISPLAYING RECOMMENDATIONS (better details from Jellyseerr)
        if st.session_state.get("recommendations"):
            st.subheader("✨ Tässä sinulle suosituksia:")
            
            # Load database once before the loop
            username = st.session_state.get("jellyfin_session", {}).get('User', {}).get('Name', 'Unknown')
            db = load_manual_db()
            user_data_default = {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}}
            user_data = db.get(username, user_data_default)
            
            for idx, rec in enumerate(st.session_state.get("recommendations", [])[:]):
                title = rec.get('title', 'N/A')
                year = rec.get('year', 'N/A')
                reason = rec.get('reason', 'N/A')
                media_id = rec.get('media_id')
                media_type = rec.get('media_type', 'unknown')
                # Normalize media_type to Jellyseerr format (movie/tv) for API calls
                # If media_type is from Jellyseerr (movie/tv), keep as-is
                # If not available, use normalized version of radio selection
                media_type_from_radio = st.session_state.get("media_type", "Elokuva")
                if media_type not in ["movie", "tv"]:
                    # Convert UI values (Elokuva/TV-sarja) to Jellyseerr format
                    media_type = "movie" if media_type_from_radio.lower() in ["elokuva", "movie"] else "tv"

                # Fetch Jellyseerr details (must be on main thread for @st.cache_data to work)
                jellyseerr_details = None
                if JELLYSEERR_API_KEY and JELLYSEERR_URL:
                    # Extract year as integer for validation
                    gemini_year = None
                    if isinstance(year, str) and year.isdigit():
                        gemini_year = int(year)
                    elif isinstance(year, int):
                        gemini_year = year
                    
                    # Get all search results and validate against Gemini data
                    all_results = get_jellyseerr_details(title)
                    
                    # Find best match by validating year and media type
                    for result in all_results:
                        result_title = result.get("title", "").lower()
                        result_year_str = result.get("releaseDate") or result.get("firstAirDate")
                        result_media_type = result.get("mediaType", "").lower()
                        
                        # Parse year from result (YYYY-MM-DD format)
                        result_year_int = None
                        if result_year_str:
                            try:
                                result_year_int = int(result_year_str.split("-")[0])
                            except:
                                pass
                        
                        # Normalize media types for comparison
                        normalized_media_type = "movie" if media_type.lower() in ["elokuva", "movie"] else "tv"
                        
                        # Match title (case-insensitive, partial match acceptable)
                        title_matches = title.lower() in result_title or result_title in title.lower()
                        
                        # Match year (within 1 year tolerance for date differences)
                        year_matches = True
                        if gemini_year and result_year_int:
                            year_matches = abs(gemini_year - result_year_int) <= 1
                        
                        # Match media type
                        type_matches = normalized_media_type == result_media_type
                        
                        logger.debug(f"Validating result '{result_title}' ({result_year_int}, {result_media_type}): title_match={title_matches}, year_match={year_matches}, type_match={type_matches}")
                        
                        # If all match, use this result
                        if title_matches and year_matches and type_matches:
                            jellyseerr_details = result
                            logger.debug(f"Found validated match: {result_title}")
                            break
                    
                    # If no validated match found, use first result as fallback
                    if not jellyseerr_details and all_results:
                        jellyseerr_details = all_results[0]
                        logger.debug(f"No validated match found, using first result: {all_results[0].get('title')}")

                
                with st.container(border=True):
                    col1, col2, col3 = st.columns([1, 3, 1])
                    
                    # Poster
                    with col1:
                        poster_path = None
                        if jellyseerr_details and isinstance(jellyseerr_details, dict):
                            poster_path = jellyseerr_details.get("posterPath")
                        
                        if poster_path and JELLYSEERR_URL:
                            base_url = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
                            poster_url = f"{base_url}/imageproxy/tmdb/t/p/w300_and_h450_face{poster_path}"
                            logger.debug(f"Poster URL: {poster_url}")
                            
                            try:
                                poster_response = st.session_state.jellyseerr_requests_session.get(poster_url, headers=JELLYSEERR_HEADERS, timeout=5)
                                logger.debug(f"Response status: {poster_response.status_code}, content type: {poster_response.headers.get('content-type')}")
                                if poster_response.status_code == 200:
                                    image = Image.open(BytesIO(poster_response.content))
                                    st.image(image, use_container_width=True)
                                else:
                                    st.write("📷 Ei julistetta")
                            except Exception as e:
                                logger.debug(f"Could not load poster: {e}")
                                st.write("📷 Ei julistetta")
                        else:
                            st.write("📷 Ei julistetta")
                    
                    # Details
                    with col2:
                        st.markdown(f"**{title}** ({year})")
                        
                        if jellyseerr_details and isinstance(jellyseerr_details, dict):
                            rating = jellyseerr_details.get("voteAverage", "N/A")
                            overview = jellyseerr_details.get("overview", "")
                            
                            if rating != "N/A":
                                st.caption(f"⭐ {rating}/10")
                            if overview:
                                st.write(overview[:300] + "..." if len(overview) > 300 else overview)
                        else:
                            st.caption(f"📅 Vuosi: {year}")
                        
                        st.caption(f"💡 {reason[:300]}..." if len(reason) > 300 else f"💡 {reason}")
                    
                    # Buttons (4 options)
                    with col3:
                        st.write("**Toiminnot:**")
                        
                        # Use pre-loaded user data from outside the loop
                        type_key = "movies" if media_type and media_type.lower() == "movie" else "series"
                        
                        # Tarkista statukset
                        is_watched = title in user_data.get(type_key, [])
                        is_in_watchlist = title in user_data.get("watchlist", {}).get(type_key, [])
                        is_blacklisted = title in user_data.get("do_not_recommend", [])
                        
                        # Row 1: Add to watched
                        watched_label = "✅ Katsottu" if is_watched else "📽️ Katsottu"
                        watched_disabled = is_watched
                        if st.button(watched_label, key=f"add_watched_{media_id}_{idx}", use_container_width=True,
                                      disabled=watched_disabled,
                                      help="Lisää katsottuihin elokuviin/sarjoihin" if not watched_disabled else "Tämä on jo katsottu"):
                            handle_search_result_add_watched(title, media_type if media_type else media_type_from_radio)
                            if st.session_state.get("recommendations"):
                                st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get('title') != title]
                                if not st.session_state.recommendations:
                                    st.session_state.recommendations_cleared_by_user = True
                            st.rerun()
                        
                        # Row 2: Request from Jellyseerr
                        if st.button("📥 Pyydä", key=f"request_{media_id}_{idx}", use_container_width=True,
                                      help="Pyydä Jellyseerristä ladattavaksi"):
                            handle_search_result_request(media_id, media_type if media_type else media_type_from_radio)
                            if st.session_state.get("recommendations"):
                                st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get('title') != title]
                                if not st.session_state.recommendations:
                                    st.session_state.recommendations_cleared_by_user = True
                            st.rerun()
                        
                        # Row 3: Add to watchlist
                        watchlist_label = "✅ Katselulista" if is_in_watchlist else "📋 Katselulista"
                        watchlist_disabled = is_in_watchlist
                        if st.button(watchlist_label, key=f"add_watchlist_{media_id}_{idx}", use_container_width=True,
                                      disabled=watchlist_disabled,
                                      help="Lisää katselulistalle" if not watchlist_disabled else "Tämä on jo katselulistallasi"):
                            handle_search_result_watchlist(title, media_type if media_type else media_type_from_radio)
                            if st.session_state.get("recommendations"):
                                st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get('title') != title]
                                if not st.session_state.recommendations:
                                    st.session_state.recommendations_cleared_by_user = True
                            st.rerun()
                        
                        # Row 4: Do not recommend
                        blacklist_label = "✅ Estetty" if is_blacklisted else "🚫 Älä suosittele"
                        blacklist_disabled = is_blacklisted
                        if st.button(blacklist_label, key=f"blacklist_{media_id}_{idx}", use_container_width=True,
                                      disabled=blacklist_disabled,
                                      help="Lisää älä-suosittele listalle" if not blacklist_disabled else "Tämä on jo estolistalla"):
                            handle_search_result_blacklist(title)
                            if st.session_state.get("recommendations"):
                                st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get('title') != title]
                                if not st.session_state.recommendations:
                                    st.session_state.recommendations_cleared_by_user = True
                            st.rerun()

    # ===== TAB 2: KATSELULISTA =====
    with tab2:
        st.header("📝 Oma katselulistani")
        db = load_manual_db()
        user_data = db.get(username, {})
        watchlist = user_data.get("watchlist", {"movies": [], "series": []})
        
        # Handle migration: if watchlist is a list, convert to dict structure
        if isinstance(watchlist, list):
            watchlist = {"movies": [], "series": []}
            user_data["watchlist"] = watchlist
            save_manual_db(db)
        
        watchlist_movies = watchlist.get("movies", [])
        watchlist_series = watchlist.get("series", [])

        if not watchlist_movies and not watchlist_series:
            st.info("Katselulistasi on tyhjä. Lisää nimikkeitä suosituksista!")
        else:
            # Movies section
            if watchlist_movies:
                st.write("**🎬 Elokuvat:**")
                for idx, wl_title in enumerate(watchlist_movies):
                    col1, col2, col3, col4 = st.columns([0.5, 0.2, 0.15, 0.15])
                    with col1:
                        st.write(f"• {wl_title}")
                    with col2:
                        if st.button("Pyydä", key=f"request_watchlist_movie_{idx}",
                                     on_click=handle_jellyseerr_request, args=({"title": wl_title},), use_container_width=True):
                            pass  # Callback handles the request
                    with col3:
                        if st.button("Katsottu", key=f"watched_watchlist_movie_{idx}",
                                     on_click=handle_watchlist_mark_watched, args=(wl_title, "movies"), use_container_width=True):
                            pass  # Callback handles marking as watched
                    with col4:
                        if st.button("Poista", key=f"remove_watchlist_movie_{idx}",
                                     on_click=handle_watchlist_remove, args=(wl_title, "movies"), use_container_width=True):
                            pass  # Callback handles the removal
                st.markdown("")  # spacing

            # Series section
            if watchlist_series:
                st.write("**📺 Sarjat:**")
                for idx, wl_title in enumerate(watchlist_series):
                    col1, col2, col3, col4 = st.columns([0.5, 0.2, 0.15, 0.15])
                    with col1:
                        st.write(f"• {wl_title}")
                    with col2:
                        if st.button("Pyydä", key=f"request_watchlist_series_{idx}",
                                     on_click=handle_jellyseerr_request, args=({"title": wl_title},), use_container_width=True):
                            pass  # Callback handles the request
                    with col3:
                        if st.button("Katsottu", key=f"watched_watchlist_series_{idx}",
                                     on_click=handle_watchlist_mark_watched, args=(wl_title, "series"), use_container_width=True):
                            pass  # Callback handles marking as watched
                    with col4:
                        if st.button("Poista", key=f"remove_watchlist_series_{idx}",
                                     on_click=handle_watchlist_remove, args=(wl_title, "series"), use_container_width=True):
                            pass  # Callback handles the removal

    # ===== TAB 3: MERKITSE =====
    with tab3:
        if not st.session_state.get("jellyfin_session"):
            st.warning("⚠️ Kirjaudu sisään jatkaaksesi.")
        else:
            st.header("✏️ Merkitse nimike katsottuksi manuaalisesti")
            st.write("Hae Jellyseerrista tai lisää nimikkeitä, joita et ole katsellut Jellyfinissä.")
            
            # Jellyseerr search section
            st.subheader("🔍 Hae Jellyseerrista")
            search_col1, search_col2 = st.columns([3, 1])
            with search_col1:
                search_query = st.text_input("Elokuvan tai sarjan nimi", key="jellyseerr_search_input", placeholder="Kirjoita nimike...")
            with search_col2:
                search_button = st.button("🔎 Hae", use_container_width=True)
            
            if search_button and search_query:
                with st.spinner("🔍 Etsitään Jellyseerrista..."):
                    results = search_jellyseerr_advanced(search_query)
                    if results:
                        st.session_state.search_results = results
                        st.success(f"✅ Löytyi {len(results)} tulosta!")
                    else:
                        st.warning(f"❌ Ei löytynyt tuloksia haulle: '{search_query}'")
            
            # Display search results
            if st.session_state.search_results:
                st.divider()
                st.subheader("📺 Hakutulokset")
                
                for idx, result in enumerate(st.session_state.search_results):
                    with st.container(border=True):
                        col1, col2, col3 = st.columns([1, 3, 1])
                        
                        # Poster
                        with col1:
                            poster_path = result.get("posterPath")
                            if poster_path and JELLYSEERR_URL:
                                base_url = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
                                poster_url = f"{base_url}/imageproxy/tmdb/t/p/w300_and_h450_face{poster_path}"
                                logger.debug(f"Poster URL: {poster_url}")
                                
                                try:
                                    poster_response = st.session_state.jellyseerr_requests_session.get(poster_url, headers=JELLYSEERR_HEADERS, timeout=5)
                                    logger.debug(f"Response status: {poster_response.status_code}, content type: {poster_response.headers.get('content-type')}")
                                    if poster_response.status_code == 200:
                                        image = Image.open(BytesIO(poster_response.content))
                                        st.image(image, use_container_width=True)
                                    else:
                                        st.write("📷 Ei julistetta")
                                except Exception as e:
                                    logger.debug(f"Could not load poster: {e}")
                                    st.write("📷 Ei julistetta")
                            else:
                                st.write("📷 Ei julistetta")
                        
                        # Details
                        with col2:
                            title = result.get("name") or result.get("title", "N/A")
                            media_type = result.get("mediaType", "unknown")
                            release_date = result.get("firstAirDate") or result.get("releaseDate", "")
                            year = release_date[:4] if release_date else "N/A"
                            overview = result.get("overview", "")
                            vote_average = result.get("voteAverage", "N/A")
                            
                            st.markdown(f"**{title}** ({year})")
                            if media_type:
                                type_badge = "🎬 Elokuva" if media_type.lower() == "movie" else "📺 Sarja"
                                st.caption(f"{type_badge} • ⭐ {vote_average}/10")
                            if overview:
                                st.write(overview[:300] + "..." if len(overview) > 300 else overview)
                        
                        # Buttons (4 options)
                        with col3:
                            media_id = result.get("id")
                            st.write("**Toiminnot:**")
                            
                            # Fetch current user data
                            username = st.session_state.get("jellyfin_session", {}).get('User', {}).get('Name', 'Unknown')
                            db = load_manual_db()
                            user_data = db.get(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
                            type_key = "movies" if media_type.lower() == "movie" else "series"
                            
                            # Check statuses
                            is_watched = title in user_data.get(type_key, [])
                            is_in_watchlist = title in user_data.get("watchlist", {}).get(type_key, [])
                            is_blacklisted = title in user_data.get("do_not_recommend", [])
                            
                            # Row 1: Add to watched
                            watched_label = "✅ Katsottu" if is_watched else "📽️ Katsottu"
                            watched_disabled = is_watched
                            if st.button(watched_label, key=f"add_watched_{media_id}_{idx}", use_container_width=True,
                                          disabled=watched_disabled,
                                          help="Lisää katsottuihin elokuviin/sarjoihin" if not watched_disabled else "Tämä on jo katsottu"):
                                handle_search_result_add_watched(title, media_type)
                                st.rerun()
                            
                            # Row 2: Request from Jellyseerr
                            if st.button("📥 Pyydä", key=f"request_{media_id}_{idx}", use_container_width=True,
                                          help="Pyydä Jellyseerristä ladattavaksi"):
                                handle_search_result_request(media_id, media_type)
                            
                            # Row 3: Add to watchlist
                            watchlist_label = "✅ Katselulista" if is_in_watchlist else "📋 Katselulista"
                            watchlist_disabled = is_in_watchlist
                            if st.button(watchlist_label, key=f"add_watchlist_{media_id}_{idx}", use_container_width=True,
                                          disabled=watchlist_disabled,
                                          help="Lisää katselulistalle" if not watchlist_disabled else "Tämä on jo katselulistallasi"):
                                handle_search_result_watchlist(title, media_type)
                                st.rerun()
                            
                            # Row 4: Do not recommend
                            blacklist_label = "✅ Estetty" if is_blacklisted else "🚫 Älä suosittele"
                            blacklist_disabled = is_blacklisted
                            if st.button(blacklist_label, key=f"blacklist_{media_id}_{idx}", use_container_width=True,
                                          disabled=blacklist_disabled,
                                          help="Lisää älä-suosittele listalle" if not blacklist_disabled else "Tämä on jo estolistalla"):
                                handle_search_result_blacklist(title)
                                st.rerun()

    # ===== TAB 4: TIEDOT =====
    with tab4:
        st.header("💾 Tietokannan Varmuuskopio & Tiedot")
        st.write("Vie ja palauta tietokantasi tai tarkastele tilastoja.")
        
        st.subheader("📊 Tilastot")
        db = load_manual_db()
        user_data = db.get(username, {})
        
        stat_col1, stat_col2, stat_col3 = st.columns(3)
        with stat_col1:
            movies_count = len(user_data.get("movies", []))
            st.metric("🎬 Elokuvat", movies_count)
        with stat_col2:
            series_count = len(user_data.get("series", []))
            st.metric("📺 Sarjat", series_count)
        with stat_col3:
            blacklist_count = len(user_data.get("do_not_recommend", []))
            st.metric("🚫 Estetyt", blacklist_count)
        
        st.divider()
        st.subheader("📥/📤 Varmuuskopio")
        st.write("Vie tietokantasi varmuuskopioksi tai palauta aiemmin viety varmuuskopio.")
        
        col1, col2 = st.columns([1, 1])
        
        # Export
        with col1:
            st.write("**📥 Vie varmuuskopio**")
            if st.button("⬇️ Lataa varmuuskopio", use_container_width=True):
                backup_json = export_user_data_as_json(username)
                if backup_json:
                    st.download_button(
                        label="💾 Lataa JSON-tiedosto",
                        data=backup_json,
                        file_name=f"jellyfin_ai_recommender_backup_{username}_{__import__('datetime').datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
                        mime="application/json",
                        use_container_width=True
                    )
        
        # Import
        with col2:
            st.write("**📤 Palauta varmuuskopio**")
            uploaded_file = st.file_uploader(
                "Valitse varmuuskopiotiedosto",
                type=["json"],
                key="backup_uploader",
                help="Valitse aiemmin viety .json-tiedosto"
            )
            
            if uploaded_file is not None:
                try:
                    backup_content = uploaded_file.read().decode("utf-8")
                    
                    # Ask user whether to merge or replace
                    st.write("**Valitse toiminto:**")
                    col_replace, col_merge = st.columns(2)
                    
                    with col_replace:
                        if st.button("🔄 Korvaa tietokanta", use_container_width=True, key="btn_replace"):
                            if import_user_data_from_json(backup_content, username):
                                st.rerun()
                    
                    with col_merge:
                        if st.button("🔗 Yhdistä tietokannat", use_container_width=True, key="btn_merge"):
                            if merge_user_data_from_json(backup_content, username):
                                st.rerun()
                except Exception as e:
                    st.error(f"Virhe tiedostoa luettaessa: {e}")

# --- Application Footer ---
st.divider()
footer_col1, footer_col2, footer_col3 = st.columns([1, 2, 1])
with footer_col2:
    st.markdown(
        f"""
        <div style='text-align: center; padding: 10px 0; border-top: 1px solid #e0e0e0; border-bottom: 1px solid #e0e0e0;'>
            <span style='font-size: 11px; color: #666;'>
            🔖 <b style='color: #0066cc;'>v{APP_VERSION}</b> • 
            <a href='https://github.com/jessepesse/jellyfin-ai-recommender' target='_blank' style='color: #0066cc; text-decoration: none; font-weight: bold; transition: color 0.3s;'>💻 Jellyfin AI Recommender</a> • 
            🚀 <b style='color: #27ae60;'>Open Source</b>
            </span>
        </div>
        """,
        unsafe_allow_html=True
    )

