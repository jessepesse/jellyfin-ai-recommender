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

load_dotenv()

# --- Logging Configuration ---
LOG_FILE = "app.log"
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

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
        response = requests.post(endpoint, json=body, headers=headers, timeout=10)
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

@retry_with_backoff(max_attempts=3, initial_delay=1)
def get_jellyfin_watched_titles():
    """Hakee katsotut nimikkeet käyttäen tallennettua sessiota ja tallentaa ne tietokantaan."""
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
        response = requests.get(endpoint, headers=headers, params=params, timeout=15)
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


def build_prompt(media_type, genre, watched_list, watchlist, do_not_recommend_list):
	"""Rakentaa kehotteen, joka pyytää JSON-vastausta. Huomioi myös 'älä suosittele' -lista."""
	watched_titles_str = ", ".join(watched_list) if watched_list else "ei yhtään"
	watchlist_str = ", ".join(watchlist) if watchlist else "ei yhtään"
	do_not_str = ", ".join(do_not_recommend_list) if do_not_recommend_list else "ei yhtään"

	genre_instruction = f"Kaikkien suositusten tulee kuulua genreen: '{genre}'." if genre != "Kaikki" else "Suosittele monipuolisesti eri genrejä makuni mukaan."

	prompt = f"""
Olet elokuvien ja TV-sarjojen suosittelun asiantuntija. Tehtäväsi on antaa 5 uutta {media_type}-suositusta katseluprofiilini perusteella.

**Katseluprofiilini:**
1.  **Katsottu historia:** Nimikkeet, jotka olen jo nähnyt: {watched_titles_str}
2.  **Katselulista (Korkea kiinnostus):** Nimikkeet, joita olen kiinnostunut katsomaan. Käytä näitä vahvana signaalina sen *tyypin* sisällöstä, jota etsin juuri nyt: {watchlist_str}
3.  **Estolista (Alhainen kiinnostus):** Näistä nimikkeistä en ole kiinnostunut. Käytä näitä negatiivisena signaalina välttääksesi samanlaisia teemoja tai genrejä: {do_not_str}

**Tehtäväsi:**
- Anna 5 uutta {media_type} suositusta.
- **ÄLÄ** suosittele mitään katsotusta historiastani, katselulistaltani tai estolistaltani.
- {genre_instruction}
- Kaikkien `title`-arvojen **täytyy** olla alkuperäisessä englanninkielisessä muodossaan API-yhteensopivuutta varten.
- Palauta vastauksesi **VAIN** voimassa olevan JSON-listan objekteista, joissa on avaimet: "title", "year" ja "reason".

Esimerkk JSON-muoto:
[
	{{"title": "Dune: Part Two", "year": 2024, "reason": "Koska lisäsit Blade Runner 2049:n katselulistallesi, tämän elokuvan upea visuaalinen maailma ja syvällinen scifi-kerronta vastaavat todennäköisesti nykyisiä kiinnostuksen kohteitasi."}},
	{{"title": "Severance", "year": 2022, "reason": "Katselulistasi viittaa kiinnostukseen ajatuksia herättäviä mysteerejä kohtaan; tämä sarja tarjoaa samankaltaista kiehtovuutta ainutlaatuisella premissillä."}}
]
"""
	return prompt

@retry_with_backoff(max_attempts=2, initial_delay=2)
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

@st.cache_data(ttl=6 * 60 * 60, show_spinner=False)
def search_jellyseerr(title: str):
    """
    Etsii nimikettä Jellyseeristä pelkällä nimellä ja palauttaa
    ensimmäisen osuman ID:n ja media-tyypin (tai (None, None) jos ei löydy).
    """
    if not JELLYSEERR_API_KEY:
        logger.debug("Jellyseerr API key not configured")
        return None, None
    if not JELLYSEERR_URL:
        logger.error("JELLYSEERR_URL not configured")
        st.error("❌ JELLYSEERR_URL ei ole asetettu ympäristömuuttujissa.")
        return None, None
    try:
        encoded_title = quote(title or "")
        base = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
        endpoint = f"{base}/api/v1/search?query={encoded_title}&page=1"
        
        logger.debug(f"Searching Jellyseerr for: {title}")
        resp = requests.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=10)
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

def get_jellyseerr_details(title: str):
    """Hakee Jellyseerr:stä yksityiskohtaiset tiedot elokuvasta/sarjasta."""
    if not JELLYSEERR_API_KEY or not JELLYSEERR_URL:
        return None
    
    try:
        encoded_title = quote(title or "")
        base = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
        endpoint = f"{base}/api/v1/search?query={encoded_title}&page=1"
        
        logger.debug(f"Fetching details from Jellyseerr for: {title}")
        resp = requests.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=10)
        resp.raise_for_status()
        
        results = resp.json().get("results", [])
        if not results:
            return None
        
        result = results[0]
        logger.debug(f"Full Jellyseerr response for '{title}': {json.dumps(result, indent=2)[:200]}")
        return result
    except Exception as e:
        logger.warning(f"Error fetching Jellyseerr details for '{title}': {e}")
        return None

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
        response = requests.post(endpoint, headers=headers, json=body, timeout=10)
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

def import_user_data_from_json(json_string, username):
	"""Imports user data from JSON string."""
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

# --- PÄÄFUNKTIO, JOKA HOITAA SUOSITUSTEN HAUN ---
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
			prompt = build_prompt(media_type, genre, full_watched_list, watchlist, blacklist)
			recommendations = get_gemini_recommendations(prompt)

		if recommendations:
			enriched_recommendations = []
			with st.spinner("Tarkistetaan saatavuutta Jellyseeristä..."):
				for rec in recommendations:
					media_id, m_type = search_jellyseerr(rec['title'])
					rec['media_id'] = media_id
					rec['media_type'] = m_type
					enriched_recommendations.append(rec)
			st.session_state.recommendations = enriched_recommendations
			logger.info(f"Successfully generated {len(enriched_recommendations)} recommendations for user: {username}")
		else:
			st.session_state.recommendations = None
			logger.warning(f"No recommendations generated for user: {username}")
	except Exception as e:
		logger.error(f"Unexpected error in fetch_and_show_recommendations: {e}")
		st.error(f"❌ Virhe suositusten haussa: {str(e)[:150]}")

# --- Streamlit Käyttöliittymä ---

st.set_page_config(
    page_title="Jellyfin AI Recommender",
    layout="wide",
    initial_sidebar_state="expanded",
    menu_items={
        "About": "Jellyfin AI Recommender - Personalized recommendations powered by Google Gemini AI"
    }
)

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
col1, col2 = st.columns([0.1, 0.9])
with col1:
    try:
        st.image("images/logo.png", width=60)
    except:
        st.write("🎬")
with col2:
    st.title("Jellyfin AI Recommender")

if 'jellyfin_session' not in st.session_state:
    st.session_state.jellyfin_session = None

if not st.session_state.jellyfin_session:
    # Kirjautumisnäkymä
    logger.debug("Displaying login page")
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

	# Compact welcome + logout
	col1, col2 = st.columns([0.8, 0.2])
	with col1:
		st.markdown(f"#### Tervetuloa, **{username}**! 👋")
	with col2:
		if st.button("Kirjaudu ulos", use_container_width=True, type="secondary"):
			for key in list(st.session_state.keys()):
				del st.session_state[key]
			# Removed st.rerun() here — state change triggers rerun automatically
	st.markdown("---")

	st.markdown("<div class='section-gap'></div>", unsafe_allow_html=True)
	
	# Create tabs
	tab1, tab2, tab3, tab4 = st.tabs(["🔍 Suositukset", "📝 Katselulista", "✏️ Merkitse", "💾 Tiedot"])
	
	# ===== TAB 1: SUOSITUKSET =====
	with tab1:
		st.header("🔎 Hae suosituksia")
		media_type = st.radio("Suositellaanko elokuvia vai sarjoja?", ["Elokuva", "TV-sarja"], horizontal=True, key="media_type")

		# Genre-näkymässä näytetään emoji-ikoni käyttäen format_funcia (vakaampi kuin näyttötunnisteet)
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
		# Näytetään emojeilla rikastetut vaihtoehdot radiossa ja kartoitetaan takaisin sisäiseen arvoon
		display_options = [genre_emoji[g] for g in genre_options]
		# Käytetään pystyradiota, se käyttäytyy luotettavasti eri selaimissa ja ei riko valituksi näkyvyyttä
		selected_display = st.radio("Valitse genre", display_options, index=0, key="genre_display_radio")
		# Käännetään valinta takaisin sisäiseksi avaimeksi
		reverse_map = {v: k for k, v in genre_emoji.items()}
		genre = reverse_map.get(selected_display, "Kaikki")

		# Pääpainike: täysleveä, violetilla korostuksella (CSS-tyylit yllä)
		if st.button("🎬 Hae suositukset", use_container_width=True):
			fetch_and_show_recommendations(media_type, genre)
		
		st.divider()
		
		# SUOSITUSTEN NÄYTTÄMINEN (paremmat tiedot Jellyseerr:stä)
		if 'recommendations' in st.session_state and st.session_state.recommendations:
			st.subheader("✨ Tässä sinulle suosituksia:")
			
			for rec in st.session_state.recommendations[:]:
				title = rec.get('title', 'N/A')
				year = rec.get('year', 'N/A')
				reason = rec.get('reason', 'N/A')

				safe_key = f"{title}_{year}".replace(" ", "_")

				st.markdown(f"<div class='recommendation-card' id='rec_{safe_key}'>", unsafe_allow_html=True)

				# Hae yksityiskohtaiset tiedot Jellyseerr:stä
				jellyseerr_details = get_jellyseerr_details(title)
				
				# Responsive layout: pieni ruutu (mobiilit) vs iso ruutu (desktop)
				col_poster, col_info = st.columns([0.8, 2.2])
				
				# Poster
				with col_poster:
					if jellyseerr_details and "posterPath" in jellyseerr_details and jellyseerr_details["posterPath"] and JELLYSEERR_URL:
						poster_path = jellyseerr_details["posterPath"]
						base_url = JELLYSEERR_URL.rstrip('/') if isinstance(JELLYSEERR_URL, str) else JELLYSEERR_URL
						poster_url = f"{base_url}/imageproxy/tmdb/t/p/w300_and_h450_face{poster_path}"
						
						try:
							poster_response = requests.get(poster_url, headers=JELLYSEERR_HEADERS, timeout=5)
							if poster_response.status_code == 200:
								image = Image.open(BytesIO(poster_response.content))
								st.image(image, width=130)
							else:
								st.info("📷")
						except:
							st.info("📷")
					else:
						st.info("📷")
				
				# Tiedot
				with col_info:
					# Otsikko
					st.subheader(title)
					
					# Kompakti rivittäin: vuosi ja rating
					info_cols = st.columns([1, 1])
					
					with info_cols[0]:
						if jellyseerr_details:
							release_date = jellyseerr_details.get("releaseDate") or jellyseerr_details.get("firstAirDate") or "N/A"
							display_year = release_date[:4] if release_date != "N/A" else year
						else:
							display_year = year
						st.caption(f"📅 **{display_year}**")
					
					with info_cols[1]:
						if jellyseerr_details and jellyseerr_details.get("voteAverage"):
							rating = jellyseerr_details.get("voteAverage")
							st.caption(f"⭐ **{rating:.1f}/10**")
					
					# Kuvaus
					if jellyseerr_details:
						overview = jellyseerr_details.get("overview", "")
						if overview:
							st.caption(f"_{overview[:120]}..._" if len(overview) > 120 else f"_{overview}_")
					
					# Perustelu AI:lta (pienellä koolla)
					st.caption(f"💡 {reason[:150]}..." if len(reason) > 150 else f"💡 {reason}")
				
				st.markdown("</div>", unsafe_allow_html=True)
				
				# Toimintonapit - kompaktit
				b1, b2, b3, b4 = st.columns([1, 1, 1, 1])

				with b1:
					b1.button("Pyydä Jellyseerristä", key=f"request_{safe_key}",
								  on_click=handle_jellyseerr_request, args=(rec,), use_container_width=True)

				media_type_from_radio = st.session_state.get("media_type", "Elokuva")
				with b2:
					b2.button("👁️ Katsottu", key=f"watched_{safe_key}",
								  on_click=handle_watched_add, args=(title, media_type_from_radio), use_container_width=True)

				with b3:
					b3.button("🚫 Älä suosittele", key=f"block_{safe_key}",
								  on_click=handle_blacklist_add, args=(title,), use_container_width=True)

				with b4:
					b4.button("🔖 Lisää katselulistalle", key=f"watchlist_{safe_key}",
								  on_click=handle_watchlist_add, args=(title,), use_container_width=True)

				st.divider()
	
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
					col1, col2, col3 = st.columns([0.6, 0.2, 0.2])
					with col1:
						st.write(f"• {wl_title}")
					with col2:
						if st.button("Pyydä", key=f"request_watchlist_movie_{idx}",
									 on_click=handle_jellyseerr_request, args=({"title": wl_title},), use_container_width=True):
							pass  # Callback handles the request
					with col3:
						if st.button("Poista", key=f"remove_watchlist_movie_{idx}",
									 on_click=handle_watchlist_remove, args=(wl_title, "movies"), use_container_width=True):
							pass  # Callback handles the removal
				st.markdown("")  # spacing

			# Series section
			if watchlist_series:
				st.write("**📺 Sarjat:**")
				for idx, wl_title in enumerate(watchlist_series):
					col1, col2, col3 = st.columns([0.6, 0.2, 0.2])
					with col1:
						st.write(f"• {wl_title}")
					with col2:
						if st.button("Pyydä", key=f"request_watchlist_series_{idx}",
									 on_click=handle_jellyseerr_request, args=({"title": wl_title},), use_container_width=True):
							pass  # Callback handles the request
					with col3:
						if st.button("Poista", key=f"remove_watchlist_series_{idx}",
									 on_click=handle_watchlist_remove, args=(wl_title, "series"), use_container_width=True):
							pass  # Callback handles the removal
	
	# ===== TAB 3: MERKITSE =====
	with tab3:
		st.header("✏️ Merkitse nimike katsottuksi manuaalisesti")
		st.write("Lisää nimikkeitä, joita et ole katsellut Jellyfinissä.")
		
		with st.form("manual_add_form", clear_on_submit=True):
			manual_title = st.text_input("Elokuvan tai sarjan nimi")
			manual_type = st.radio("Tyyppi", ["Elokuva", "Sarja"], key="manual_type", horizontal=True)
			if st.form_submit_button("Lisää katsottuihin"):
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
					if st.button("🔄 Palauta tietokanta", use_container_width=True):
						if import_user_data_from_json(backup_content, username):
							st.rerun()
				except Exception as e:
					st.error(f"Virhe tiedostoa luettaessa: {e}")

