import os
import requests
import streamlit as st
import json
import logging
import warnings
import time
from dotenv import load_dotenv
from urllib.parse import quote
from functools import wraps
from PIL import Image
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed
from streamlit.runtime.scriptrunner import get_script_run_ctx
from threading import Thread, Lock
from datetime import datetime

load_dotenv()

# --- Logging Configuration ---
LOG_FILE = "app.log"
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Suppress Streamlit's ScriptRunContext warnings from threaded code
logging.getLogger("streamlit.runtime.scriptrunner").setLevel(logging.ERROR)
logging.getLogger("streamlit.runtime.state").setLevel(logging.ERROR)

# Also suppress warnings at the root level for cleaner output
logging.captureWarnings(True)
warnings_logger = logging.getLogger("py.warnings")
warnings_logger.setLevel(logging.ERROR)

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
APP_VERSION = "0.2.6-alpha"

# --- Rate Limiter for Gemini Recommendations ---
# Prevents API spam and excessive costs using session state
# Simple but effective: track last request time in session state
def init_rate_limiter():
    """Initialize rate limiter and in-flight state in session state if not exists"""
    if "gemini_last_request_time" not in st.session_state:
        st.session_state.gemini_last_request_time = 0
    if "gemini_busy" not in st.session_state:
        st.session_state.gemini_busy = False
    if "gemini_prev_results_displayed" not in st.session_state:
        st.session_state.gemini_prev_results_displayed = True
    # Track whether Gemini returned empty on the last fetch (for distinguishing API_empty vs user_filtered_empty)
    if "api_empty_last_fetch" not in st.session_state:
        st.session_state.api_empty_last_fetch = False
    # Track if list is empty due to user filtering/removals (not API_empty)
    if "user_filtered_empty" not in st.session_state:
        st.session_state.user_filtered_empty = False

def check_rate_limit(cooldown_seconds=5):
    """Check if rate limit allows the request. Returns (allowed, wait_seconds)"""
    now = time.time()
    elapsed = now - st.session_state.gemini_last_request_time
    if elapsed >= cooldown_seconds:
        return True, 0
    else:
        wait_time = cooldown_seconds - elapsed
        return False, int(wait_time) + 1

def update_rate_limit_timestamp():
    """Update the rate limit timestamp after a request is made"""
    st.session_state.gemini_last_request_time = time.time()

@st.fragment(run_every=0.5)
def display_cooldown_countdown(wait_time: int):
    """Display cooldown countdown that auto-updates every 0.5 seconds"""
    is_allowed, current_wait = check_rate_limit()
    if not is_allowed:
        st.caption(f"⏳ Odota {current_wait}s ennen seuraavaa hakua")
    else:
        # Cooldown finished - trigger parent rerun to enable button
        st.rerun()
    
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
    """Fetches watched titles from Jellyfin with media_type info and saves to database. Cached for 2 hours.
    Returns list of tuples: (title, media_type) to support new schema format."""
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
        
        # Extract titles with media_type info for new schema
        watched_with_type = []
        for item in items:
            title = item.get("Name")
            item_type = item.get("Type")  # "Movie" or "Series" from Jellyfin
            
            if title and item_type:
                # Convert Jellyfin type to standard media_type
                media_type = "movie" if item_type == "Movie" else "tv"
                watched_with_type.append((title, media_type))
                logger.debug(f"Fetched from Jellyfin: {title} ({media_type})")
        
        logger.info(f"Successfully fetched {len(watched_with_type)} watched titles from Jellyfin with media types")
        
        # Save to database with metadata
        username = st.session_state.jellyfin_session['User']['Name']
        db = load_manual_db()
        user_data = db.setdefault(username, {
            "movies": [], 
            "series": [], 
            "do_not_recommend": [], 
            "watchlist": {"movies": [], "series": []},
            "available_but_unwatched": [],
            "jellyseerr_available": {"movies": [], "series": []}
        })
        user_data["jellyfin_synced_at"] = str(__import__('datetime').datetime.now())
        user_data["jellyfin_total_watched"] = len(watched_with_type)
        save_manual_db(db)
        
        # Return list of (title, media_type) tuples for use in recommendations
        return watched_with_type
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
    user_data = db.setdefault(username, {
        "movies": [], 
        "series": [], 
        "do_not_recommend": [], 
        "watchlist": {"movies": [], "series": []},
        "available_but_unwatched": [],
        "jellyseerr_available": {"movies": [], "series": []}
    })
    
    # Update watched titles (overwrite with latest from Jellyfin)
    user_data["jellyfin_synced"] = watched_titles
    save_manual_db(db)

def sync_jellyseerr_available_titles():
    """
    Hakee Jellyseerristä kaikki saatavilla olevat elokuvat ja sarjat.
    Suodattaa pois jo katsotut ja tallentaa loput 'available_but_unwatched'-kenttään.
    """
    try:
        available_movies, available_series = get_jellyseerr_available_titles()
        
        if not available_movies and not available_series:
            logger.warning("[AVAIL] No available titles found from Jellyseerr")
            return available_movies, available_series
        
        # Get username and database
        username = st.session_state.jellyfin_session['User']['Name']
        db = load_manual_db()
        user_data = db.setdefault(username, {
            "movies": [],
            "series": [],
            "do_not_recommend": [],
            "watchlist": {"movies": [], "series": []},
            "available_but_unwatched": []
        })
        
        # Ensure structure exists
        if "available_but_unwatched" not in user_data:
            user_data["available_but_unwatched"] = []
        
        # Get already watched titles (using get_media_title to handle both formats)
        watched_movies = [get_media_title(entry) for entry in user_data.get("movies", [])]
        watched_series = [get_media_title(entry) for entry in user_data.get("series", [])]
        watched_titles = set(watched_movies + watched_series)
        
        # Extract titles from available media entries (now objects with {title, media_type, tmdb_id})
        available_movie_titles = [get_media_title(entry) for entry in available_movies]
        available_series_titles = [get_media_title(entry) for entry in available_series]
        
        # Filter: only keep available titles that are NOT already watched
        unwatched_movies = [entry for entry in available_movies if get_media_title(entry) not in watched_titles]
        unwatched_series = [entry for entry in available_series if get_media_title(entry) not in watched_titles]
        
        logger.info(f"[AVAIL] Available: {len(available_movie_titles)} movies, {len(available_series_titles)} series. Already watched: {len(watched_titles)}. Unwatched available: {len(unwatched_movies)} movies, {len(unwatched_series)} series")
        
        # Create media entries for unwatched available titles
        available_list = user_data.get("available_but_unwatched", [])
        
        for entry in unwatched_movies:
            # entry is already {title, media_type, tmdb_id}, just add noted_at
            title = get_media_title(entry)
            # Check if already in available_but_unwatched to avoid duplicates
            if not any(get_media_title(item) == title for item in available_list):
                new_entry = {
                    "title": entry["title"],
                    "media_type": entry.get("media_type", "movie"),
                    "tmdb_id": entry.get("tmdb_id"),
                    "noted_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
                available_list.append(new_entry)
                logger.debug(f"[AVAIL] Added unwatched available movie: {title} (TMDB ID: {entry.get('tmdb_id')})")
        
        for entry in unwatched_series:
            # entry is already {title, media_type, tmdb_id}, just add noted_at
            title = get_media_title(entry)
            # Check if already in available_but_unwatched to avoid duplicates
            if not any(get_media_title(item) == title for item in available_list):
                new_entry = {
                    "title": entry["title"],
                    "media_type": entry.get("media_type", "tv"),
                    "tmdb_id": entry.get("tmdb_id"),
                    "noted_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
                available_list.append(new_entry)
                logger.debug(f"[AVAIL] Added unwatched available series: {title} (TMDB ID: {entry.get('tmdb_id')})")
        
        user_data["available_but_unwatched"] = available_list
        user_data["jellyseerr_synced_at"] = str(datetime.now())
        
        # Store jellyseerr_available as required by DATABASE_SCHEMA.md
        user_data["jellyseerr_available"] = {
            "movies": available_movies,
            "series": available_series
        }
        
        save_manual_db(db)
        logger.info(f"[AVAIL] Synced {len(unwatched_movies)} unwatched available movies and {len(unwatched_series)} unwatched available series to available_but_unwatched, and stored all available titles in jellyseerr_available")
        
        return available_movies, available_series
    
    except Exception as e:
        logger.error(f"[AVAIL] Error syncing Jellyseerr available titles to database: {e}", exc_info=True)
        return [], []

# NOTE: AI prompts are localized to Finnish (user's native language) to ensure consistent UX.
# The application creator is Finnish, so prompts are crafted in Finnish.
# If the app is localized to other languages in the future, these prompts should be localized accordingly.
def build_prompt(media_type, genre, watched_list, watchlist, do_not_recommend_list, available_but_unwatched_list=None):
    """Rakentaa kehotteen, joka pyytää JSON-vastausta. Huomioi myös 'älä suosittele' -lista ja saatavilla-lista.
    Accepts flexible input formats: strings, tuples, or dicts."""
    # Extract titles from flexible input formats
    def extract_titles_from_flexible_list(items_list):
        """Extract titles from list of: strings, (title, type) tuples, or {title, media_type, tmdb_id} dicts"""
        titles = []
        if not items_list:
            return titles
        for item in items_list:
            if isinstance(item, dict) and "title" in item:
                titles.append(item["title"])
            elif isinstance(item, tuple) and len(item) >= 1:
                titles.append(item[0])  # First element is title
            elif isinstance(item, str):
                titles.append(item)
        return titles
    
    # Normalize media_type for Gemini API to ensure consistent recommendations
    # UI uses "Elokuva"/"TV-sarja", but normalize to lowercase for clarity in prompt
    if media_type.lower() in ["elokuva", "movie"]:
        media_type_normalized = "elokuva"
    elif media_type.lower() in ["tv-sarja", "series", "tv-series"]:
        media_type_normalized = "TV-sarja"
    else:
        media_type_normalized = media_type.lower()
    
    # Extract titles from flexible formats
    watched_titles = extract_titles_from_flexible_list(watched_list)
    watchlist_titles = extract_titles_from_flexible_list(watchlist)
    do_not_titles = extract_titles_from_flexible_list(do_not_recommend_list)
    available_titles = extract_titles_from_flexible_list(available_but_unwatched_list)
    
    watched_titles_str = ", ".join(watched_titles) if watched_titles else "ei yhtään"
    watchlist_str = ", ".join(watchlist_titles) if watchlist_titles else "ei yhtään"
    do_not_str = ", ".join(do_not_titles) if do_not_titles else "ei yhtään"
    available_str = ", ".join(available_titles) if available_titles else "ei yhtään"

    # Map UI-normalized media type to a model-friendly token (e.g. MOVIE / TV SERIES)
    mt_norm = media_type_normalized.lower() if isinstance(media_type_normalized, str) else ""
    if mt_norm in ["elokuva", "movie"]:
        model_media_type = "MOVIE"
    elif mt_norm in ["tv-sarja", "series", "tv-series", "tv series"]:
        model_media_type = "TV SERIES"
    else:
        model_media_type = str(media_type_normalized).upper()

    # Genre instruction: support both Finnish "Kaikki" and English "All"
    if isinstance(genre, str) and genre not in ("Kaikki", "All"):
        genre_instruction = f"The genre MUST be: '{genre}'."
    else:
        genre_instruction = "Select recommendations from a diverse range of genres."

    # Specify which language the "reason" field should be in (UI-specific decision)
    reason_language = "Finnish"

    # Build an English prompt for Gemini that enforces strict JSON output
    # model_media_type is mapped earlier to a model-friendly token (e.g. MOVIE / TV SERIES)
    prompt = f"""Act as a movie and TV series expert. Your task is to recommend new content to the user in JSON format.

### TASK
Provide exactly 5 new recommendations.
MEDIA TYPE: {model_media_type} (Do not recommend other types).
GENRE: {genre_instruction}

### CONSTRAINTS (NO GO LIST)
Under no circumstances recommend titles that appear in the lists below. These have already been seen or rejected:
<excluded_titles>
{watched_titles_str}
{watchlist_str}
{do_not_str}
{available_str}
</excluded_titles>

### INSTRUCTIONS
1. Recommendations must be of type {model_media_type}.
2. The "title" field must be the original English title.
3. The "reason" field must be in the language: {reason_language}.
4. The "reason" field length: keep it concise (max 15 words) but engaging.
5. The "year" field must be the release year (number).

### OUTPUT FORMAT
Return the response as a raw JSON list without Markdown formatting (like ```json).
Example structure:
[
  {{ "title": "Movie Name", "year": 2023, "reason": "Short reasoning here." }}
]
"""
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
        genai.api_key = GEMINI_API_KEY
        
        logger.debug("Sending prompt to Gemini API")
        model = genai.GenerativeModel('gemini-2.5-flash-lite')
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        
        if not response or not getattr(response, "text", None):
            logger.warning("Gemini returned empty response")
            return None
        
        # JSON parsing is now more direct
        recommendations = json.loads(response.text)
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

def search_jellyseerr(title: str, session=None):
    """
    Etsii nimikettä Jellyseeristä pelkällä nimellä ja palauttaa
    ensimmäisen osuman ID:n ja media-tyypin (tai (None, None) jos ei löydy).
    session: requests.Session object for making HTTP calls (needed for thread safety)
    Välimuistissa 6 tunnin ajan.
    """
    if not JELLYSEERR_API_KEY:
        logger.debug("Jellyseerr API key not configured")
        return None, None
    if not JELLYSEERR_URL:
        logger.error("JELLYSEERR_URL not configured")
        return None, None
    
    # Use provided session or fall back to st.session_state (for backwards compatibility)
    if session is None:
        logger.warning(f"[SEARCH] No session provided for '{title}'")
        if hasattr(st.session_state, 'jellyseerr_requests_session'):
            session = st.session_state.jellyseerr_requests_session
            logger.info(f"[SEARCH] Using st.session_state session for '{title}'")
        else:
            logger.error(f"[SEARCH] No session available for '{title}'")
            return None, None
    
    try:
        encoded_title = quote(title or "")
        base = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
        endpoint = f"{base}/api/v1/search?query={encoded_title}&page=1"
        
        logger.info(f"[SEARCH] Jellyseerr search endpoint: {endpoint}")
        resp = session.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=10)
        resp.raise_for_status()
        
        results = resp.json().get("results", [])
        if not results:
            logger.info(f"[SEARCH] No results found in Jellyseerr for: {title}")
            return None, None
        
        first = results[0]
        media_id = first.get("id")
        media_type = first.get("mediaType")
        logger.info(f"[SEARCH] Found Jellyseerr match for '{title}': ID={media_id}, type={media_type}")
        return media_id, media_type
    except requests.exceptions.Timeout:
        logger.warning(f"[SEARCH] Jellyseerr search timeout for title: {title}")
        return None, None
    except requests.exceptions.HTTPError as e:
        logger.warning(f"[SEARCH] Jellyseerr HTTP error during search for '{title}': {e.response.status_code}")
        return None, None
    except requests.exceptions.RequestException as e:
        logger.warning(f"[SEARCH] Jellyseerr connection error during search for '{title}': {e}")
        return None, None
    except Exception as e:
        logger.error(f"[SEARCH] Unexpected error searching Jellyseerr for '{title}': {e}", exc_info=True)
        return None, None

def get_tmdb_title(tmdb_id: int, media_type: str, session=None):
    """
    Hakee elokuvan tai sarjan nimen Jellyseerr API:sta TMDB ID:n perusteella.
    media_type: "movie" tai "tv"
    Palauttaa (title, media_type) tai (None, None) jos haku epäonnistuu.
    """
    if not JELLYSEERR_API_KEY or not JELLYSEERR_URL:
        logger.debug("[TMDB] Jellyseerr not configured for TMDB title fetch")
        return None, None
    
    if not tmdb_id:
        logger.warning("[TMDB] No TMDB ID provided")
        return None, None
    
    try:
        # Use provided session or create new one
        if session is None:
            session = requests.Session()
        
        # Determine endpoint based on media_type
        endpoint_type = "tv" if media_type.lower() == "tv" else "movie"
        base = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
        endpoint = f"{base}/api/v1/{endpoint_type}/{tmdb_id}"
        
        logger.debug(f"[TMDB] Fetching title from: {endpoint}")
        resp = session.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=10)
        resp.raise_for_status()
        
        data = resp.json()
        title = data.get("title") or data.get("name")
        
        if not title:
            logger.warning(f"[TMDB] No title found for TMDB ID {tmdb_id}")
            return None, None
        
        logger.info(f"[TMDB] Found title for TMDB ID {tmdb_id}: {title}")
        return title, endpoint_type
        
    except requests.exceptions.Timeout:
        logger.warning(f"[TMDB] Jellyseerr TMDB title fetch timeout for ID {tmdb_id}")
        return None, None
    except requests.exceptions.HTTPError as e:
        logger.warning(f"[TMDB] Jellyseerr HTTP error fetching title for TMDB ID {tmdb_id}: {e.response.status_code}")
        return None, None
    except requests.exceptions.RequestException as e:
        logger.warning(f"[TMDB] Jellyseerr connection error fetching title for TMDB ID {tmdb_id}: {e}")
        return None, None
    except Exception as e:
        logger.error(f"[TMDB] Unexpected error fetching TMDB title for ID {tmdb_id}: {e}", exc_info=True)
        return None, None

def get_jellyseerr_available_titles():
    """
    Hakee kaikki saatavilla olevat elokuvat ja sarjat Jellyseerristä /api/v1/request endpointista.
    Palauttaa kaksi listaa: (elokuvat, sarjat), joissa vain AVAILABLE-statuksella olevat mediat.
    Each item in lists is a dict: {title, media_type, tmdb_id} matching DATABASE_SCHEMA.md format.
    """
    logger.info(f"[AVAIL] Starting available titles fetch. JELLYSEERR_API_KEY set: {bool(JELLYSEERR_API_KEY)}, JELLYSEERR_URL: {JELLYSEERR_URL}")
    
    if not JELLYSEERR_API_KEY or not JELLYSEERR_URL:
        logger.warning("[AVAIL] Jellyseerr not configured for available titles fetch")
        return [], []
    
    try:
        session = st.session_state.get("jellyseerr_requests_session")
        if not session:
            logger.warning("[AVAIL] No session in st.session_state, creating new requests.Session()")
            session = requests.Session()
        
        base = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
        endpoint = f"{base}/api/v1/request"
        
        logger.info(f"[AVAIL] Fetching from endpoint: {endpoint}")
        resp = session.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=15)
        logger.info(f"[AVAIL] Response status: {resp.status_code}")
        resp.raise_for_status()
        
        response_json = resp.json()
        logger.debug(f"[AVAIL] Response keys: {response_json.keys() if isinstance(response_json, dict) else 'not a dict'}")
        
        # Jellyseerr returns 'results' not 'data'
        requests_data = response_json.get("results", response_json.get("data", []))
        logger.info(f"[AVAIL] Received {len(requests_data)} total requests from Jellyseerr API")
        
        available_movies = []
        available_series = []
        available_count = 0
        
        # Use ThreadPoolExecutor for parallel TMDB title fetches
        from concurrent.futures import ThreadPoolExecutor, as_completed
        
        # Collect all AVAILABLE requests first
        available_requests = []
        for idx, request_item in enumerate(requests_data):
            status = request_item.get("status")
            logger.debug(f"[AVAIL] Item {idx}: status={status} (type: {type(status).__name__})")
            
            # Status 5 = AVAILABLE (integer comparison)
            if status != 5:
                continue
            
            available_count += 1
            media = request_item.get("media", {})
            tmdb_id = media.get("tmdbId")
            media_type = media.get("mediaType")
            
            if not tmdb_id or not media_type:
                logger.debug(f"[AVAIL] Skipping item {idx} - missing tmdbId or mediaType")
                continue
            
            available_requests.append((tmdb_id, media_type))
            logger.info(f"[AVAIL] Found AVAILABLE status item {idx}: tmdbId={tmdb_id}, type={media_type}")
        
        logger.info(f"[AVAIL] Total AVAILABLE status items: {available_count}, to fetch titles for: {len(available_requests)}")
        
        # Parallel fetch of TMDB titles using ThreadPoolExecutor
        if available_requests:
            with ThreadPoolExecutor(max_workers=5) as executor:
                # Submit all TMDB title fetch tasks
                futures = {
                    executor.submit(get_tmdb_title, tmdb_id, media_type, session=session): (tmdb_id, media_type)
                    for tmdb_id, media_type in available_requests
                }
                
                # Process completed tasks as they finish
                for future in as_completed(futures):
                    tmdb_id, media_type = futures[future]
                    try:
                        title, fetched_type = future.result()
                        if title:
                            # Create media entry object with TMDB ID as required by DATABASE_SCHEMA.md
                            media_entry = {
                                "title": title,
                                "media_type": fetched_type or media_type,
                                "tmdb_id": tmdb_id
                            }
                            if media_type == "movie" or fetched_type == "movie":
                                available_movies.append(media_entry)
                            elif media_type == "tv" or fetched_type == "tv":
                                available_series.append(media_entry)
                            logger.info(f"[AVAIL] Added {fetched_type}: {title} (TMDB ID: {tmdb_id})")
                        else:
                            logger.warning(f"[AVAIL] Failed to fetch title for TMDB ID {tmdb_id}")
                    except Exception as e:
                        logger.error(f"[AVAIL] Error fetching title for TMDB ID {tmdb_id}: {e}")
        
        # Remove duplicates by TMDB ID while preserving order
        def deduplicate_by_tmdb_id(items):
            seen_ids = {}
            for item in items:
                tmdb_id = item.get("tmdb_id")
                if tmdb_id not in seen_ids:
                    seen_ids[tmdb_id] = item
            return list(seen_ids.values())
        
        available_movies = deduplicate_by_tmdb_id(available_movies)
        available_series = deduplicate_by_tmdb_id(available_series)
        
        logger.info(f"[AVAIL] After dedup - movies: {len(available_movies)}, series: {len(available_series)}")
        
        return available_movies, available_series
        
    except requests.exceptions.Timeout:
        logger.error("[AVAIL] Jellyseerr available titles fetch timeout")
        return [], []
    except requests.exceptions.HTTPError as e:
        logger.error(f"[AVAIL] Jellyseerr HTTP error fetching available titles: {e.response.status_code}")
        return [], []
    except requests.exceptions.RequestException as e:
        logger.error(f"[AVAIL] Jellyseerr connection error during available titles fetch: {e}")
        return [], []
    except Exception as e:
        logger.error(f"[AVAIL] Unexpected error fetching Jellyseerr available titles: {e}", exc_info=True)
        return [], []

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

def get_jellyseerr_media_status(media_id: int, media_type: str, session=None):
    """
    Fetch media availability status from Jellyseerr.
    media_type: 'movie' or 'tv'
    session: requests.Session object (if None, uses st.session_state)
    
    Jellyseerr API endpoints:
    - GET /api/v1/movie/{id} -> returns mediaInfo with status
    - GET /api/v1/tv/{id} -> returns mediaInfo with status
    - Status values: UNKNOWN, REQUESTED, APPROVED, AVAILABLE, PARTIALLY_AVAILABLE
    
    Returns: 'AVAILABLE', 'PARTIALLY_AVAILABLE', 'PENDING', 'PROCESSING', or None if not found/error
    """
    endpoint_type = "movie" if media_type and media_type.lower() == "movie" else "tv"
    if not JELLYSEERR_API_KEY or not JELLYSEERR_URL or not media_id:
        return None

    # Use provided session or fall back to st.session_state
    if session is None:
        if hasattr(st.session_state, 'jellyseerr_requests_session'):
            session = st.session_state.jellyseerr_requests_session
        else:
            logger.error("No session provided and st.session_state.jellyseerr_requests_session not available")
            return None

    try:
        # Construct endpoint based on media type
        endpoint = f"{JELLYSEERR_URL}/api/v1/{endpoint_type}/{media_id}"

        logger.info(f"[AVAIL] Fetching media status from: {endpoint}")
        response = session.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=5)
        response.raise_for_status()

        data = response.json()
        logger.info(f"[AVAIL] Response keys: {list(data.keys())}")
        
        # Jellyseerr returns mediaInfo object with status field
        # Structure: { "id": 123, "mediaInfo": { "status": "AVAILABLE", ... }, ... }
        status = None
        if "mediaInfo" in data:
            status = data.get("mediaInfo", {}).get("status")
            logger.info(f"[AVAIL] Found status via mediaInfo: {status}")
        else:
            logger.info(f"[AVAIL] No mediaInfo in response. Top-level keys: {list(data.keys())}")
            # Try other possible paths
            if "status" in data:
                status = data.get("status")
                logger.info(f"[AVAIL] Found status at top level: {status}")

        logger.info(f"[AVAIL] Media {endpoint_type}/{media_id} final status: {status}")
        return status
    except requests.exceptions.Timeout:
        logger.warning(f"[AVAIL] Timeout fetching media status for {endpoint_type}/{media_id}")
        return None
    except requests.exceptions.HTTPError as e:
        logger.warning(f"[AVAIL] HTTP error {e.response.status_code} for {endpoint_type}/{media_id}")
        return None
    except requests.exceptions.RequestException as e:
        logger.warning(f"[AVAIL] Connection error fetching status: {e}")
        return None
    except Exception as e:
        logger.error(f"[AVAIL] Unexpected error fetching Jellyseerr media status: {e}", exc_info=True)
        return None

def check_and_add_available_unwatched(title: str, media_type: str, tmdb_id: int, jellyfin_watched: list, db: dict, username: str, session=None) -> bool:
    """
    Check if a recommendation is available on Jellyseerr but not watched on Jellyfin.
    If so, add it to available_but_unwatched list in database.
    
    Parameters:
    - title: Media title (string)
    - media_type: "movie" or "tv"
    - tmdb_id: TMDB ID for the media
    - jellyfin_watched: List of STRINGS containing watched titles (NOT tuples). Extract titles from tuples before calling.
    - db: Database dictionary reference
    - username: Jellyfin username for database storage
    - session: requests.Session object (if None, uses st.session_state)
    
    Returns: True if item was added, False otherwise.
    """
    try:
        logger.info(f"[AVAIL] Checking availability for '{title}' (id={tmdb_id}, type={media_type})")
        
        # Normalize media_type for database keys
        db_type_key = "movies" if media_type.lower() == "movie" else "series"
        
        # Get media status from Jellyseerr
        status = get_jellyseerr_media_status(tmdb_id, media_type, session=session)
        logger.info(f"[AVAIL] Status for '{title}': {status}")
        
        # Check if status indicates availability
        if status not in ["AVAILABLE", "PARTIALLY_AVAILABLE"]:
            logger.info(f"[AVAIL] '{title}' status {status} not available - skipping")
            return False
        
        # Check if already watched on Jellyfin
        if title in jellyfin_watched:
            logger.info(f"[AVAIL] '{title}' is available but already watched on Jellyfin - skipping")
            return False
        
        # Initialize user data and available_but_unwatched if needed
        if username not in db:
            db[username] = {
                "movies": [], 
                "series": [], 
                "do_not_recommend": [], 
                "watchlist": {"movies": [], "series": []}, 
                "available_but_unwatched": [],
                "jellyseerr_available": {"movies": [], "series": []}
            }
        
        if "available_but_unwatched" not in db[username]:
            db[username]["available_but_unwatched"] = []
        
        # Check for duplicates
        available_list = db[username]["available_but_unwatched"]
        if any(item["title"] == title for item in available_list):
            logger.info(f"[AVAIL] '{title}' already in available_but_unwatched list - skipping duplicate")
            return False
        
        # Add to available_but_unwatched
        new_item = {
            "title": title,
            "media_type": media_type,
            "tmdb_id": tmdb_id,
            "noted_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        available_list.append(new_item)
        logger.info(f"[AVAIL] ✅ Added '{title}' to available_but_unwatched for user {username}")
        return True
    except Exception as e:
        logger.error(f"[AVAIL] Error checking/adding available_unwatched for '{title}': {e}", exc_info=True)
        return False

# --- Helper Functions for Media Entry Creation ---
def create_media_entry(title: str, media_type: str, tmdb_id: int | None = None) -> dict:
    """
    Creates a standardized media entry object with title, media_type, and tmdb_id.
    Used for all collections: movies, series, do_not_recommend, watchlist, etc.
    
    Args:
        title: Media title (string)
        media_type: "movie" or "tv" (from Jellyseerr)
        tmdb_id: TMDB ID (optional, can be added later)
    
    Returns:
        Dictionary: {"title": str, "media_type": str, "tmdb_id": int or None}
    """
    return {
        "title": title,
        "media_type": media_type,
        "tmdb_id": tmdb_id
    }

def is_media_entry_dict(entry) -> bool:
    """Check if an entry is the new dict format vs old string format."""
    return isinstance(entry, dict) and "title" in entry and "media_type" in entry

def get_media_title(entry) -> str:
    """Extract title from either new dict format or old string format."""
    if isinstance(entry, dict):
        return entry.get("title", "")
    return entry

def find_media_in_list(title: str, media_list: list) -> tuple:
    """
    Find media in list by title. Handles both old (string) and new (dict) formats.
    Returns (index, entry) or (None, None) if not found.
    """
    for idx, entry in enumerate(media_list):
        if get_media_title(entry) == title:
            return idx, entry
    return None, None

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

def handle_search_result_add_watched(title, media_type, tmdb_id=None):
    """Adds title from search results to watched list using new schema format."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    user_data = db.setdefault(username, {
        "movies": [], 
        "series": [], 
        "do_not_recommend": [], 
        "watchlist": {"movies": [], "series": []},
        "available_but_unwatched": [],
        "jellyseerr_available": {"movies": [], "series": []}
    })
    
    type_key = "movies" if media_type.lower() == "movie" else "series"
    
    # Check for duplicate using new helper function
    idx, existing = find_media_in_list(title, user_data.get(type_key, []))
    
    if idx is None:
        # Create new media entry with enriched data from search result
        media_entry = create_media_entry(title, media_type.lower(), tmdb_id)
        user_data.setdefault(type_key, []).append(media_entry)
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

def handle_search_result_watchlist(title, media_type, tmdb_id=None):
    """Adds title from search results to watchlist using new schema format."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    user_data = db.setdefault(username, {
        "movies": [], 
        "series": [], 
        "do_not_recommend": [], 
        "watchlist": {"movies": [], "series": []},
        "available_but_unwatched": [],
        "jellyseerr_available": {"movies": [], "series": []}
    })
    user_data.setdefault("watchlist", {"movies": [], "series": []})
    
    type_key = "movies" if media_type.lower() == "movie" else "series"
    
    # Check for duplicate using new helper function
    idx, existing = find_media_in_list(title, user_data["watchlist"].get(type_key, []))
    
    if idx is None:
        # Create new media entry with enriched data from search result
        media_entry = create_media_entry(title, media_type.lower(), tmdb_id)
        user_data["watchlist"].setdefault(type_key, []).append(media_entry)
        save_manual_db(db)
        st.toast(f"📋 '{title}' lisätty katselulistalle!", icon="🔖")
    else:
        st.toast(f"ℹ️ '{title}' on jo katselulistallasi.", icon="ℹ️")

def handle_search_result_blacklist(title, media_type=None, tmdb_id=None):
    """Adds title from search results to 'do not recommend' list using new schema format."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    user_data = db.setdefault(username, {
        "movies": [], 
        "series": [], 
        "do_not_recommend": [], 
        "watchlist": {"movies": [], "series": []},
        "available_but_unwatched": [],
        "jellyseerr_available": {"movies": [], "series": []}
    })
    
    # Use provided media_type or default based on context
    if media_type is None:
        media_type = st.session_state.get("media_type", "Elokuva")
    
    media_type_standard = "movie" if media_type.lower() in ["movie", "elokuva"] else "tv"
    
    # Check for duplicate using new helper function
    idx, existing = find_media_in_list(title, user_data.get("do_not_recommend", []))
    
    if idx is None:
        # Create new media entry with enriched data from search result
        media_entry = create_media_entry(title, media_type_standard, tmdb_id)
        user_data.setdefault("do_not_recommend", []).append(media_entry)
        save_manual_db(db)
        st.toast(f"🚫 '{title}' lisätty älä-suosittele listalle!", icon="🚫")
    else:
        st.toast(f"ℹ️ '{title}' on jo älä-suosittele listalla.", icon="ℹ️")

def handle_watched_add(title, media_type_from_radio="Elokuva", tmdb_id=None):
    """Marks a title as watched in the local DB using new schema format."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    # Ensure the user entry and all necessary keys exist with the correct type (list)
    user_data = db.setdefault(username, {
        "movies": [], 
        "series": [], 
        "do_not_recommend": [],
        "watchlist": {"movies": [], "series": []},
        "available_but_unwatched": [],
        "jellyseerr_available": {"movies": [], "series": []}
    })
    user_data.setdefault("do_not_recommend", [])

    key = "movies" if media_type_from_radio == "Elokuva" else "series"
    
    # Convert media_type_from_radio (Finnish) to standard format
    media_type_standard = "movie" if media_type_from_radio == "Elokuva" else "tv"
    
    # Check for duplicate using new helper function
    idx, existing = find_media_in_list(title, user_data.get(key, []))
    
    if idx is None:
        # Create new media entry with standard schema
        media_entry = create_media_entry(title, media_type_standard, tmdb_id)
        user_data.setdefault(key, []).append(media_entry)
        save_manual_db(db)
        # Remove from current recommendations shown in UI
        st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get("title") != title]
        st.toast(f"'{title}' lisätty katsottuihin!", icon="👁️")
    else:
        st.toast(f"'{title}' on jo listallasi.", icon="✅")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def handle_watchlist_add(title_to_add):
    """Adds a title to the user's watchlist (from recommendations only) using new schema format."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    media_type_from_radio = st.session_state.get("media_type", "Elokuva")

    # Ensure the user entry and the 'watchlist' key exist with correct structure
    user_data = db.setdefault(username, {
        "movies": [], 
        "series": [], 
        "do_not_recommend": [], 
        "watchlist": {"movies": [], "series": []},
        "available_but_unwatched": [],
        "jellyseerr_available": {"movies": [], "series": []}
    })
    user_data.setdefault("watchlist", {"movies": [], "series": []})

    key = "movies" if media_type_from_radio == "Elokuva" else "series"
    
    # Convert media_type_from_radio (Finnish) to standard format
    media_type_standard = "movie" if media_type_from_radio == "Elokuva" else "tv"
    
    # Try to find recommendation to get enriched data (media_type, tmdb_id)
    tmdb_id = None
    actual_media_type = media_type_standard
    for rec in st.session_state.get("recommendations", []):
        if rec.get("title") == title_to_add:
            actual_media_type = rec.get("media_type", media_type_standard)
            tmdb_id = rec.get("media_id")  # This is the TMDB ID from enrichment
            break
    
    # Check for duplicate using new helper function
    idx, existing = find_media_in_list(title_to_add, user_data["watchlist"].get(key, []))
    
    if idx is None:
        # Create new media entry with standard schema
        media_entry = create_media_entry(title_to_add, actual_media_type, tmdb_id)
        user_data["watchlist"].setdefault(key, []).append(media_entry)
        save_manual_db(db)
        # Remove from current recommendations shown in UI
        st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get("title") != title_to_add]
        st.toast(f"'{title_to_add}' lisätty katselulistalle!", icon="🔖")
    else:
        st.toast(f"'{title_to_add}' on jo katselulistallasi.", icon="ℹ️")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def handle_watchlist_remove(title_to_remove, media_type_key):
    """Removes a title from the user's watchlist using new schema format."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()

    user_data = db.get(username, {})
    watchlist = user_data.get("watchlist", {"movies": [], "series": []})
    watchlist_list = watchlist.get(media_type_key, [])

    # Use new helper function to find by title (handles both old and new formats)
    idx, found_entry = find_media_in_list(title_to_remove, watchlist_list)
    
    if idx is not None:
        watchlist_list.pop(idx)
        save_manual_db(db)
        st.toast(f"'{title_to_remove}' poistettu katselulistalta.", icon="🗑️")
    else:
        st.toast(f"'{title_to_remove}' ei ole katselulistallasi.", icon="ℹ️")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def handle_watchlist_mark_watched(title_to_mark, media_type_key):
    """Marks a title from watchlist as watched and removes it from watchlist using new schema format."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()

    user_data = db.setdefault(username, {
        "movies": [], 
        "series": [], 
        "do_not_recommend": [], 
        "watchlist": {"movies": [], "series": []},
        "available_but_unwatched": [],
        "jellyseerr_available": {"movies": [], "series": []}
    })
    watchlist = user_data.get("watchlist", {"movies": [], "series": []})
    watchlist_list = watchlist.get(media_type_key, [])

    # Use new helper function to find by title (handles both old and new formats)
    idx, found_entry = find_media_in_list(title_to_mark, watchlist_list)
    
    if idx is not None:
        # Extract the entry to preserve tmdb_id and media_type during move
        entry_to_move = watchlist_list.pop(idx)
        
        # If it's already in new format, use it as-is; if old format, convert it
        if is_media_entry_dict(entry_to_move):
            media_entry = entry_to_move
        else:
            # Old format (string) - create new entry with media_type
            media_type_standard = "movie" if media_type_key == "movies" else "tv"
            media_entry = create_media_entry(entry_to_move, media_type_standard, None)
        
        # Add to watched list
        user_data.setdefault(media_type_key, []).append(media_entry)
        save_manual_db(db)
        st.toast(f"✅ '{title_to_mark}' merkitty katsotuksi ja poistettu katselulistalta.", icon="👁️")
    else:
        st.toast(f"'{title_to_mark}' ei ole katselulistallasi.", icon="ℹ️")
    # Note: no explicit st.rerun() — Streamlit reruns after callback automatically

def handle_blacklist_add(title):
    """Adds a title to the user's 'do not recommend' list using new schema format and removes from watchlist if present."""
    username = st.session_state.jellyfin_session['User']['Name']
    db = load_manual_db()
    media_type_from_radio = st.session_state.get("media_type", "Elokuva")

    # Ensure the user entry and the 'do_not_recommend' key (as a list) exist
    user_data = db.setdefault(username, {
        "movies": [], 
        "series": [], 
        "do_not_recommend": [], 
        "watchlist": {"movies": [], "series": []},
        "available_but_unwatched": [],
        "jellyseerr_available": {"movies": [], "series": []}
    })
    user_data.setdefault("do_not_recommend", [])
    user_data.setdefault("watchlist", {"movies": [], "series": []})

    # Convert media_type_from_radio (Finnish) to standard format
    media_type_standard = "movie" if media_type_from_radio == "Elokuva" else "tv"
    
    # Check for duplicate using new helper function
    idx, existing = find_media_in_list(title, user_data.get("do_not_recommend", []))
    
    if idx is None:
        # Try to find recommendation to get enriched data (media_type, tmdb_id)
        tmdb_id = None
        actual_media_type = media_type_standard
        for rec in st.session_state.get("recommendations", []):
            if rec.get("title") == title:
                actual_media_type = rec.get("media_type", media_type_standard)
                tmdb_id = rec.get("media_id")  # This is the TMDB ID from enrichment
                break
        
        # Create new media entry with standard schema
        media_entry = create_media_entry(title, actual_media_type, tmdb_id)
        user_data["do_not_recommend"].append(media_entry)
        
        # Also remove from watchlist if present using new helper function
        watchlist = user_data.get("watchlist", {"movies": [], "series": []})
        for media_key in ["movies", "series"]:
            idx_in_watchlist, _ = find_media_in_list(title, watchlist.get(media_key, []))
            if idx_in_watchlist is not None:
                watchlist[media_key].pop(idx_in_watchlist)
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
    """Merges imported user data with existing data. Handles both old (string) and new (dict) formats."""
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
        
        # Helper to deduplicate lists containing both strings and dicts
        def deduplicate_list(items_list):
            """Remove duplicates based on title, keeping new dict format when possible."""
            seen_titles = {}
            for item in items_list:
                title = get_media_title(item)
                if title not in seen_titles:
                    seen_titles[title] = item
            return list(seen_titles.values())
        
        # Merge movies (combine lists, remove duplicates)
        merged_movies = deduplicate_list(current_data.get("movies", []) + imported_data.get("movies", []))
        # Merge series (combine lists, remove duplicates)
        merged_series = deduplicate_list(current_data.get("series", []) + imported_data.get("series", []))
        # Merge do_not_recommend (combine lists, remove duplicates)
        merged_blacklist = deduplicate_list(current_data.get("do_not_recommend", []) + imported_data.get("do_not_recommend", []))
        
        # Merge watchlist (combine movies and series separately)
        current_watchlist = current_data.get("watchlist", {"movies": [], "series": []})
        imported_watchlist = imported_data.get("watchlist", {"movies": [], "series": []})
        merged_watchlist = {
            "movies": deduplicate_list(current_watchlist.get("movies", []) + imported_watchlist.get("movies", [])),
            "series": deduplicate_list(current_watchlist.get("series", []) + imported_watchlist.get("series", []))
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

def _enrich_recommendation_with_jellyseerr(title: str, session=None):
    """Helper function for parallel enrichment - no Streamlit calls here."""
    try:
        logger.info(f"[ENRICH] Starting enrichment for: {title}, session={session is not None}")
        media_id, m_type = search_jellyseerr(title, session=session)
        logger.info(f"[ENRICH] Result for '{title}': media_id={media_id}, media_type={m_type}")
        return {"title": title, "media_id": media_id, "media_type": m_type, "success": True}
    except Exception as e:
        logger.error(f"[ENRICH] Failed to enrich recommendation '{title}': {e}", exc_info=True)
        return {"title": title, "media_id": None, "media_type": None, "success": False, "error": str(e)}

# --- MAIN FUNCTION THAT HANDLES RECOMMENDATIONS FETCHING ---
def fetch_and_show_recommendations(media_type, genre):
    """Fetches recommendations using the watchlist as a strong signal."""
    username = st.session_state.jellyfin_session['User']['Name']
    
    try:
        with st.spinner("Haetaan katseluhistoriaa ja asetuksia..."):
            logger.debug(f"Fetching recommendations for user: {username}, media_type: {media_type}, genre: {genre}")
            jellyfin_watched = get_jellyfin_watched_titles()
            # Also sync Jellyseerr available titles to database
            available_movies, available_series = sync_jellyseerr_available_titles()
            db = load_manual_db()
            user_db_entry = db.get(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
            # Extract titles using the compatibility helper (handles both string and dict formats)
            manual_watched_movies = [get_media_title(entry) for entry in user_db_entry.get("movies", [])]
            manual_watched_series = [get_media_title(entry) for entry in user_db_entry.get("series", [])]
            manual_watched = manual_watched_movies + manual_watched_series
            # Correctly read the simple lists
            blacklist_raw = user_db_entry.get("do_not_recommend", [])
            blacklist = [get_media_title(entry) for entry in blacklist_raw]
            watchlist_dict = user_db_entry.get("watchlist", {"movies": [], "series": []})
            # Flatten watchlist from both movies and series for the prompt, extracting titles
            watchlist_movies = [get_media_title(entry) for entry in watchlist_dict.get("movies", [])]
            watchlist_series = [get_media_title(entry) for entry in watchlist_dict.get("series", [])]
            watchlist = watchlist_movies + watchlist_series
            # Get available_but_unwatched list and extract titles
            available_raw = user_db_entry.get("available_but_unwatched", [])
            available_but_unwatched = [get_media_title(entry) for entry in available_raw]
            
            # Extract titles from jellyfin_watched tuples to match with manual_watched format
            jellyfin_titles = [title for title, _ in jellyfin_watched] if jellyfin_watched else []
            full_watched_list = sorted(list(set(jellyfin_titles + manual_watched)))
            
            logger.info(f"Loaded data: watched={len(full_watched_list)}, watchlist={len(watchlist)}, blacklist={len(blacklist)}, available_unwatched={len(available_but_unwatched)}")

        with st.spinner("Kysytään suosituksia tekoälyltä..."):
            logger.debug(f"Building prompt with: media_type={media_type}, genre={genre}, watched={len(full_watched_list)}, watchlist={len(watchlist)}, blacklist={len(blacklist)}")
            prompt = build_prompt(media_type, genre, full_watched_list, watchlist, blacklist, available_but_unwatched)
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
            
            # Check availability on Jellyseerr and add to available_but_unwatched if applicable
            logger.debug("Checking Jellyseerr availability for recommendations...")
            jellyfin_watched_titles = [title for title, _ in jellyfin_watched] if jellyfin_watched else []
            for rec in enriched_recommendations:
                if rec.get('media_id') and rec.get('media_type'):
                    check_and_add_available_unwatched(
                        title=rec['title'],
                        media_type=rec['media_type'],
                        tmdb_id=rec['media_id'],
                        jellyfin_watched=jellyfin_watched_titles,
                        db=db,
                        username=username
                    )
            
            # Save database with updated available_but_unwatched entries
            save_manual_db(db)
            logger.debug("Database saved with available_but_unwatched updates")
            
            st.session_state.recommendations = enriched_recommendations
            st.session_state.recommendations_fetched = True
            logger.info(f"Successfully generated {len(enriched_recommendations)} recommendations for user: {username}")
        else:
            st.session_state.recommendations = []
            st.session_state.recommendations_fetched = False
            logger.warning(f"No recommendations generated for user: {username} - Gemini returned None or empty")
    except Exception as e:
        logger.error(f"Unexpected error in fetch_and_show_recommendations: {e}", exc_info=True)
        st.session_state.recommendations_fetched = False
        st.error(f"❌ Virhe suositusten haussa: {str(e)}")

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

    # Sidebar navigation and settings
    with st.sidebar:
        st.title("⚙️ Valikko")
        
        # Page navigation buttons
        st.write("**Navigaatio:**")
        if st.button("🔍 Suositukset", width="stretch", key="btn_page_recommendations"):
            st.session_state.current_page = "recommendations"
        if st.button("📝 Katselulista", width="stretch", key="btn_page_watchlist"):
            st.session_state.current_page = "watchlist"
        if st.button("✏️ Merkitse", width="stretch", key="btn_page_mark"):
            st.session_state.current_page = "mark"
        if st.button("💾 Tiedot", width="stretch", key="btn_page_info"):
            st.session_state.current_page = "info"
        
        st.divider()
        
        # User info
        st.caption(f"👤 {username}")
        
        # Spacer to push logout to bottom
        st.markdown("<div style='height: 400px;'></div>", unsafe_allow_html=True)
        
        # Logout button at the bottom
        if st.button("🚪 Kirjaudu ulos", width="stretch", type="secondary"):
            for key in list(st.session_state.keys()):
                del st.session_state[key]
            st.rerun()  # Force rerun to display login page
    
    # Initialize current_page if not exists
    if "current_page" not in st.session_state:
        st.session_state.current_page = "recommendations"
    
    # Welcome header
    st.markdown("---")

    st.markdown("<div class='section-gap'></div>", unsafe_allow_html=True)
    
    # Page content based on sidebar selection
    current_page = st.session_state.current_page

    # ===== PAGE 1: SUOSITUKSET =====
    if current_page == "recommendations":
        st.header("🔎 Hae suosituksia")
        
        # Section 1: Content Type Selection
        st.subheader("📺 Sisältötyyppi")
        st.write("**Mistä haluat suosituksia?**")
        media_type = st.radio("Suositellaanko elokuvia vai sarjoja?", ["Elokuva", "TV-sarja"], horizontal=True, key="media_type", label_visibility="collapsed")
        
        st.divider()
        
        # Section 2: Genre Selection
        st.subheader("🎬 Lajityyppi")
        st.write("**Valitse genre:**")
        
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
        
        # Define genre groups for better organization
        genre_options = ["Kaikki", "Toiminta", "Komedia", "Draama", "Scifi", "Fantasia", "Kauhu", "Jännitys", "Romantiikka"]
        
        # Display emoji-enriched options
        display_options = [genre_emoji[g] for g in genre_options]
        
        # Radio button with improved clarity
        selected_display = st.radio(
            "Valitse genre",
            display_options,
            index=st.session_state.get("genre_index", 0),
            key="genre_display_radio",
            label_visibility="collapsed",
            horizontal=False
        )
        
        # Map the selection back to the internal key
        reverse_map = {v: k for k, v in genre_emoji.items()}
        genre = reverse_map.get(selected_display, "Kaikki") if selected_display else "Kaikki"
        
        # Store the genre and index in session state
        st.session_state.selected_genre = genre
        if selected_display:
            st.session_state.genre_index = display_options.index(selected_display)
        
        st.divider()

        # Section 3: Fetch Recommendations with Rate Limiting
        st.subheader("🚀 Hae")
        
        # Initialize rate limiter on first run
        init_rate_limiter()
        
        # Init flags (in case missing from session state)
        if "gemini_busy" not in st.session_state:
            st.session_state.gemini_busy = False
        if "gemini_prev_results_displayed" not in st.session_state:
            st.session_state.gemini_prev_results_displayed = True  # allow first run
        if "should_fetch_recommendations" not in st.session_state:
            st.session_state.should_fetch_recommendations = False
        
        # Check rate limit status before showing button
        is_allowed, wait_time = check_rate_limit(cooldown_seconds=5)
        
        # Single status message with strict priority: busy > prev_results > rate_limit > nothing
        # This ensures only ONE message is ever displayed
        if st.session_state.gemini_busy:
            # Priority 1: Show busy message
            st.info("🔄 Haku on jo käynnissä — odota tuloksia.")
        elif not st.session_state.gemini_prev_results_displayed:
            # Priority 2: Show finishing display message
            st.info("🕒 Viimeisimmät tulokset viimeistellään näkyviin.")
        # Priority 3: No message (cooldown handled by button disabled state)
        
        # Get rate limit status
        is_allowed, wait_time = check_rate_limit()
        btn_disabled = st.session_state.gemini_busy or not is_allowed
        
        # Show rate-limited button
        button_clicked = st.button(
            "🎬 Hae suositukset",
            key="fetch_recommendations", 
            disabled=btn_disabled,
            use_container_width=True
        )
        
        # Show cooldown countdown only AFTER fetch is done (not during busy)
        if not is_allowed and not st.session_state.gemini_busy:
            display_cooldown_countdown(wait_time)
        
        # Check if button was clicked and allowed
        if button_clicked and is_allowed:
            # Button click was accepted - start recommendation fetch
            st.session_state.should_fetch_recommendations = True
            st.session_state.gemini_prev_results_displayed = False
            st.session_state.recommendations = []
            st.session_state.recommendations_fetched = False
            st.session_state.last_error = None
        
        if st.session_state.get("should_fetch_recommendations", False):
            st.session_state.gemini_busy = True
            try:
                with st.spinner("🔄 Haetaan suosituksia..."):
                    media_type = st.session_state.get("media_type", "Elokuva")
                    genre = st.session_state.get("selected_genre", "Kaikki")
                    
                    username = st.session_state.get("jellyfin_session", {}).get('User', {}).get('Name', 'Unknown')
                    
                    # Reset user-cleared flag when fetching new recommendations
                    # (removed this flag as it's no longer needed - prev_results_displayed now controls gate)
                    
                    jellyfin_watched = get_jellyfin_watched_titles()
                    # Also sync Jellyseerr available titles to database
                    available_movies, available_series = sync_jellyseerr_available_titles()
                    db = load_manual_db()
                    user_db_entry = db.get(username, {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}})
                    # Extract titles using the compatibility helper (handles both string and dict formats)
                    manual_watched_movies = [get_media_title(entry) for entry in user_db_entry.get("movies", [])]
                    manual_watched_series = [get_media_title(entry) for entry in user_db_entry.get("series", [])]
                    manual_watched = manual_watched_movies + manual_watched_series
                    # Correctly read the simple lists
                    blacklist_raw = user_db_entry.get("do_not_recommend", [])
                    blacklist = [get_media_title(entry) for entry in blacklist_raw]
                    watchlist_dict = user_db_entry.get("watchlist", {"movies": [], "series": []})
                    # Flatten watchlist from both movies and series for the prompt, extracting titles
                    watchlist_movies = [get_media_title(entry) for entry in watchlist_dict.get("movies", [])]
                    watchlist_series = [get_media_title(entry) for entry in watchlist_dict.get("series", [])]
                    watchlist = watchlist_movies + watchlist_series
                    # Get available_but_unwatched list and extract titles
                    available_raw = user_db_entry.get("available_but_unwatched", [])
                    available_but_unwatched = [get_media_title(entry) for entry in available_raw]
                    
                    # Extract titles from jellyfin_watched tuples to match with manual_watched format
                    jellyfin_titles = [title for title, _ in jellyfin_watched] if jellyfin_watched else []
                    full_watched_list = sorted(list(set(jellyfin_titles + manual_watched)))
                    
                    logger.info(f"Loaded data: watched={len(full_watched_list)}, watchlist={len(watchlist)}, blacklist={len(blacklist)}, available_unwatched={len(available_but_unwatched)}")
                    
                    logger.debug(f"Building prompt with: media_type={media_type}, genre={genre}, watched={len(full_watched_list)}, watchlist={len(watchlist)}, blacklist={len(blacklist)}")
                    prompt = build_prompt(media_type, genre, full_watched_list, watchlist, blacklist, available_but_unwatched)
                    logger.debug(f"Prompt built, calling Gemini...")
                    recommendations = get_gemini_recommendations(prompt)
                    logger.debug(f"Gemini returned: {type(recommendations)} - {recommendations if recommendations else 'None/Empty'}")
                    
                    if recommendations:
                        # Mark as non-empty for later display logic
                        st.session_state.api_empty_last_fetch = False
                        enriched_recommendations = []
                        logger.debug(f"Starting parallel Jellyseerr search for {len(recommendations)} recommendations")
                        
                        # Get session object for thread pool workers (they can't access st.session_state)
                        jellyseerr_session = st.session_state.get("jellyseerr_requests_session")
                        
                        def enrichment_wrapper(title: str):
                            """Wrapper to handle ScriptRunContext for thread pool workers
                            Note: The 'missing ScriptRunContext' warning is expected and safe to ignore
                            in ThreadPoolExecutor workers. Streamlit documentation confirms this is normal
                            behavior when running Streamlit operations in threads."""
                            try:
                                # Pass session to enrichment function for thread-safe API calls
                                return _enrich_recommendation_with_jellyseerr(title, session=jellyseerr_session)
                            except Exception as e:
                                logger.warning(f"Wrapper error for '{title}': {e}")
                                return {"title": title, "media_id": None, "media_type": None, "success": False, "error": str(e)}
                        
                        with ThreadPoolExecutor(max_workers=5) as executor:
                            futures = {
                                executor.submit(enrichment_wrapper, rec['title']): rec 
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
                        
                        # Check availability on Jellyseerr and add to available_but_unwatched if applicable
                        logger.debug("Checking Jellyseerr availability for recommendations...")
                        jellyseerr_session = st.session_state.get("jellyseerr_requests_session")
                        # Extract titles from full_watched_list (which are plain strings after combining jellyfin_titles + manual_watched)
                        for rec in enriched_recommendations:
                            if rec.get('media_id') and rec.get('media_type'):
                                check_and_add_available_unwatched(
                                    title=rec['title'],
                                    media_type=rec['media_type'],
                                    tmdb_id=rec['media_id'],
                                    jellyfin_watched=full_watched_list,
                                    db=db,
                                    username=username,
                                    session=jellyseerr_session
                                )
                        
                        # Save database with updated available_but_unwatched entries
                        save_manual_db(db)
                        logger.debug("Database saved with available_but_unwatched updates")
                        
                        st.session_state.recommendations = enriched_recommendations
                        st.session_state.recommendations_fetched = True
                        logger.info(f"Successfully generated {len(enriched_recommendations)} recommendations for user: {username}")
                    else:
                        # Mark as empty from API
                        st.session_state.api_empty_last_fetch = True
                        st.session_state.recommendations = []
                        st.session_state.recommendations_fetched = False
                        logger.warning(f"No recommendations generated for user: {username} - Gemini returned None or empty")
            except Exception as e:
                logger.error(f"Unexpected error in recommendations fetch: {e}")
                st.session_state.recommendations_fetched = False
                st.session_state.last_error = str(e)
            finally:
                # Mark attempt and release in-flight lock (busy must always flip to False)
                st.session_state.should_fetch_recommendations = False
                st.session_state.gemini_busy = False
                # Set rate limit timestamp after fetch is complete so cooldown starts now
                update_rate_limit_timestamp()
                # Trigger immediate UI update to display cooldown timer
                st.rerun()
                # NOTE: recommendations_fetched is set during try block (True/False based on success)
                # and will control whether status messages are shown
        
        # After-fetch messages and gates
        # Set flags BEFORE rendering messages so they take effect immediately on next render
        if st.session_state.get("recommendations_fetched", False) and st.session_state.get("recommendations"):
            # Mark results as displayed before showing the message
            st.session_state.gemini_prev_results_displayed = True
            st.session_state.gemini_busy = False
            st.success(f"✅ {len(st.session_state.get('recommendations', []))} suositusta haettu onnistuneesti!")
        elif st.session_state.get("recommendations_fetched", False) and not st.session_state.get("recommendations") and st.session_state.get("api_empty_last_fetch", False):
            # Gemini returned empty (not user-filtered empty) - show warning and mark display done
            st.session_state.gemini_prev_results_displayed = True
            st.session_state.gemini_busy = False
            st.warning("⚠️ Gemini ei palauttanut suosituksia. Yritä uudelleen.")
        
        if st.session_state.get("last_error"):
            # Mark results as displayed before showing the message
            st.session_state.gemini_prev_results_displayed = True
            st.session_state.gemini_busy = False
            st.error(f"❌ Virhe suositusten haussa: {st.session_state.get('last_error', '')[:150]}")
            st.session_state.last_error = None
        
        st.divider()
        
        # DISPLAYING RECOMMENDATIONS (better details from Jellyseerr)
        # Clear user_filtered_empty at the start of this section
        st.session_state.user_filtered_empty = False
        
        # Determine displayed list (currently just st.session_state.recommendations, but placeholder for any future filtering)
        displayed_recommendations = st.session_state.get("recommendations", [])
        
        # Check if list is empty due to user filtering (not API_empty)
        if not displayed_recommendations and st.session_state.get("recommendations_fetched", False) and not st.session_state.get("api_empty_last_fetch", False):
            st.session_state.user_filtered_empty = True
        
        # Display recommendations if any
        if displayed_recommendations:
            st.subheader("✨ Tässä sinulle suosituksia:")
            
            # Load database once before the loop
            username = st.session_state.get("jellyfin_session", {}).get('User', {}).get('Name', 'Unknown')
            db = load_manual_db()
            user_data_default = {"movies": [], "series": [], "do_not_recommend": [], "watchlist": {"movies": [], "series": []}}
            user_data = db.get(username, user_data_default)
            
            for idx, rec in enumerate(displayed_recommendations[:]):
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
                                    st.image(image, width="stretch")
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
                            # Round rating to 1 decimal place if it's a number
                            if rating != "N/A" and isinstance(rating, (int, float)):
                                rating = round(rating, 1)
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
                        
                        # Check statuses using new helper function (handles both dict and string formats)
                        idx_watched, _ = find_media_in_list(title, user_data.get(type_key, []))
                        is_watched = idx_watched is not None
                        
                        idx_watchlist, _ = find_media_in_list(title, user_data.get("watchlist", {}).get(type_key, []))
                        is_in_watchlist = idx_watchlist is not None
                        
                        idx_blacklist, _ = find_media_in_list(title, user_data.get("do_not_recommend", []))
                        is_blacklisted = idx_blacklist is not None
                        
                        # Row 1: Add to watched
                        watched_label = "✅ Katsottu" if is_watched else "📽️ Katsottu"
                        watched_disabled = is_watched
                        if st.button(watched_label, key=f"add_watched_{media_id}_{idx}", width="stretch",
                                      disabled=watched_disabled,
                                      help="Lisää katsottuihin elokuviin/sarjoihin" if not watched_disabled else "Tämä on jo katsottu"):
                            handle_search_result_add_watched(title, media_type if media_type else media_type_from_radio, tmdb_id=media_id)
                            if st.session_state.get("recommendations"):
                                st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get('title') != title]
                            st.rerun()
                        
                        # Row 2: Request from Jellyseerr
                        if st.button("📥 Pyydä", key=f"request_{media_id}_{idx}", width="stretch",
                                      help="Pyydä Jellyseerristä ladattavaksi"):
                            handle_search_result_request(media_id, media_type if media_type else media_type_from_radio)
                            if st.session_state.get("recommendations"):
                                st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get('title') != title]
                            st.rerun()
                        
                        # Row 3: Add to watchlist
                        watchlist_label = "✅ Katselulista" if is_in_watchlist else "📋 Katselulista"
                        watchlist_disabled = is_in_watchlist
                        if st.button(watchlist_label, key=f"add_watchlist_{media_id}_{idx}", width="stretch",
                                      disabled=watchlist_disabled,
                                      help="Lisää katselulistalle" if not watchlist_disabled else "Tämä on jo katselulistallasi"):
                            handle_search_result_watchlist(title, media_type if media_type else media_type_from_radio, tmdb_id=media_id)
                            if st.session_state.get("recommendations"):
                                st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get('title') != title]
                            st.rerun()
                        
                        # Row 4: Do not recommend
                        blacklist_label = "✅ Estetty" if is_blacklisted else "🚫 Älä suosittele"
                        blacklist_disabled = is_blacklisted
                        if st.button(blacklist_label, key=f"blacklist_{media_id}_{idx}", width="stretch",
                                      disabled=blacklist_disabled,
                                      help="Lisää älä-suosittele listalle" if not blacklist_disabled else "Tämä on jo estolistalla"):
                            handle_search_result_blacklist(title, tmdb_id=media_id)
                            if st.session_state.get("recommendations"):
                                st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get('title') != title]
                            st.rerun()
        
        # Show neutral message if list is empty due to user filtering (not API_empty)
        if st.session_state.get("user_filtered_empty", False):
            st.info("ℹ️ Ei näytettäviä suosituksia. Hae uudet suositukset.")
        
        # Set prev_results_displayed = True at the end of this DISPLAYING section (regardless of list state)
        # This decouples button enablement from list content
        if st.session_state.get("recommendations_fetched", False):
            st.session_state.gemini_prev_results_displayed = True

    # ===== PAGE 2: KATSELULISTA =====
    if current_page == "watchlist":
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
                st.subheader("🎬 Elokuvat")
                for idx, entry in enumerate(watchlist_movies):
                    wl_title = get_media_title(entry)  # Handles both dict and string formats
                    col1, col2, col3, col4 = st.columns([0.5, 0.2, 0.15, 0.15])
                    with col1:
                        st.write(f"• {wl_title}")
                    with col2:
                        if st.button("📥 Pyydä", key=f"request_watchlist_movie_{idx}",
                                     on_click=handle_jellyseerr_request, args=({"title": wl_title},), width="stretch"):
                            pass  # Callback handles the request
                    with col3:
                        if st.button("✅ Katsottu", key=f"watched_watchlist_movie_{idx}",
                                     on_click=handle_watchlist_mark_watched, args=(wl_title, "movies"), width="stretch"):
                            pass  # Callback handles marking as watched
                    with col4:
                        if st.button("🗑️ Poista", key=f"remove_watchlist_movie_{idx}",
                                     on_click=handle_watchlist_remove, args=(wl_title, "movies"), width="stretch"):
                            pass  # Callback handles the removal
                st.markdown("")  # spacing
                st.divider()

            # Series section
            if watchlist_series:
                st.subheader("📺 Sarjat")
                for idx, entry in enumerate(watchlist_series):
                    wl_title = get_media_title(entry)  # Handles both dict and string formats
                    col1, col2, col3, col4 = st.columns([0.5, 0.2, 0.15, 0.15])
                    with col1:
                        st.write(f"• {wl_title}")
                    with col2:
                        if st.button("📥 Pyydä", key=f"request_watchlist_series_{idx}",
                                     on_click=handle_jellyseerr_request, args=({"title": wl_title},), width="stretch"):
                            pass  # Callback handles the request
                    with col3:
                        if st.button("✅ Katsottu", key=f"watched_watchlist_series_{idx}",
                                     on_click=handle_watchlist_mark_watched, args=(wl_title, "series"), width="stretch"):
                            pass  # Callback handles marking as watched
                    with col4:
                        if st.button("🗑️ Poista", key=f"remove_watchlist_series_{idx}",
                                     on_click=handle_watchlist_remove, args=(wl_title, "series"), width="stretch"):
                            pass  # Callback handles the removal

    # ===== PAGE 3: MERKITSE =====
    if current_page == "mark":
        if not st.session_state.get("jellyfin_session"):
            st.warning("⚠️ Kirjaudu sisään jatkaaksesi.")
        else:
            st.header("✏️ Merkitse nimike katsottuksi manuaalisesti")
            
            # Jellyseerr search section
            st.subheader("🔍 Hae Jellyseerrista")
            st.write("Hae Jellyseerrista ja lisää nimikkeitä katsottuihin.")
            search_col1, search_col2 = st.columns([4, 1], gap="small", vertical_alignment="bottom")
            with search_col1:
                search_query = st.text_input("Elokuvan tai sarjan nimi", key="jellyseerr_search_input", placeholder="Kirjoita nimike...", label_visibility="collapsed")
            with search_col2:
                search_button = st.button("🔎 Hae", width="stretch", key="search_button")
            
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
                st.subheader("📋 Hakutulokset")
                
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
                                        st.image(image, width="stretch")
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
                            # Round rating to 1 decimal place if it's a number
                            if vote_average != "N/A" and isinstance(vote_average, (int, float)):
                                vote_average = round(vote_average, 1)
                            
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
                            
                            # Check statuses using new helper function (handles both dict and string formats)
                            idx_watched, _ = find_media_in_list(title, user_data.get(type_key, []))
                            is_watched = idx_watched is not None
                            
                            idx_watchlist, _ = find_media_in_list(title, user_data.get("watchlist", {}).get(type_key, []))
                            is_in_watchlist = idx_watchlist is not None
                            
                            idx_blacklist, _ = find_media_in_list(title, user_data.get("do_not_recommend", []))
                            is_blacklisted = idx_blacklist is not None
                            
                            # Row 1: Add to watched
                            watched_label = "✅ Katsottu" if is_watched else "📽️ Katsottu"
                            watched_disabled = is_watched
                            if st.button(watched_label, key=f"add_watched_{media_id}_{idx}", width="stretch",
                                          disabled=watched_disabled,
                                          help="Lisää katsottuihin elokuviin/sarjoihin" if not watched_disabled else "Tämä on jo katsottu"):
                                handle_search_result_add_watched(title, media_type)
                                st.rerun()
                            
                            # Row 2: Request from Jellyseerr
                            if st.button("📥 Pyydä", key=f"request_{media_id}_{idx}", width="stretch",
                                          help="Pyydä Jellyseerristä ladattavaksi"):
                                handle_search_result_request(media_id, media_type)
                            
                            # Row 3: Add to watchlist
                            watchlist_label = "✅ Katselulista" if is_in_watchlist else "📋 Katselulista"
                            watchlist_disabled = is_in_watchlist
                            if st.button(watchlist_label, key=f"add_watchlist_{media_id}_{idx}", width="stretch",
                                          disabled=watchlist_disabled,
                                          help="Lisää katselulistalle" if not watchlist_disabled else "Tämä on jo katselulistallasi"):
                                handle_search_result_watchlist(title, media_type)
                                st.rerun()
                            
                            # Row 4: Do not recommend
                            blacklist_label = "✅ Estetty" if is_blacklisted else "🚫 Älä suosittele"
                            blacklist_disabled = is_blacklisted
                            if st.button(blacklist_label, key=f"blacklist_{media_id}_{idx}", width="stretch",
                                          disabled=blacklist_disabled,
                                          help="Lisää älä-suosittele listalle" if not blacklist_disabled else "Tämä on jo estolistalla"):
                                handle_search_result_blacklist(title)
                                st.rerun()

    # ===== PAGE 4: TIEDOT =====
    if current_page == "info":
        st.header("💾 Tietokannan Varmuuskopio & Tiedot")
        
        st.subheader("📊 Tilastot")
        st.write("Yhteenveto katsotusta sisällöstä ja estoista.")
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
        
        st.subheader("💾 Varmuuskopio")
        st.write("Vie tietokantasi varmuuskopioksi tai palauta aiemmin viety varmuuskopio.")
        
        col1, col2 = st.columns([1, 1])
        
        # Export
        with col1:
            st.write("**📥 Vie tietokantasi**")
            if st.button("⬇️ Lataa varmuuskopio", width="stretch"):
                backup_json = export_user_data_as_json(username)
                if backup_json:
                    st.download_button(
                        label="💾 Lataa JSON-tiedosto",
                        data=backup_json,
                        file_name=f"jellyfin_ai_recommender_backup_{username}_{__import__('datetime').datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
                        mime="application/json",
                        width="stretch"
                    )
        
        st.divider()
        
        # Import
        with col2:
            st.write("**📤 Palauta tietokantasi**")
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
                        if st.button("🔄 Korvaa tietokanta", width="stretch", key="btn_replace"):
                            if import_user_data_from_json(backup_content, username):
                                st.rerun()
                    
                    with col_merge:
                        if st.button("🔗 Yhdistä tietokannat", width="stretch", key="btn_merge"):
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


