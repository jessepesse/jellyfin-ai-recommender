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
# Optional image proxy: if set, poster URLs will be routed through this proxy.
# The proxy URL can contain the literal string '{url}' where the target image URL will be
# substituted. If '{url}' is not present, the helper will append '?url=<encoded>' to the
# proxy base.
# POSTER_PROXY_URL = os.environ.get("POSTER_PROXY_URL", "")

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


def build_prompt(media_type, genre, watched_list, do_not_recommend_list=None):
	"""Rakentaa kehotteen, joka pyytää JSON-vastausta. Huomioi myös 'älä suosittele' -lista."""
	watched_titles_str = ", ".join(watched_list) if watched_list else "ei mitään"
	do_not_str = ", ".join(do_not_recommend_list) if do_not_recommend_list else "ei mitään"
	genre_instruction = f"Suositusten tulee kuulua genreen: '{genre}'." if genre != "Kaikki" else "Suosittele nimikkeitä monipuolisesti eri genreistä."
	prompt = f"""
Olet elokuvien ja TV-sarjojen suosittelun asiantuntija. Tehtäväsi on antaa 5 {media_type}-suositusta.
Tässä on lista nimikkeistä, jotka olen jo katsonut: {watched_titles_str}
Tässä on lista nimikkeistä, joista en halua suosituksia: {do_not_str}
ÄLÄ suosittele ikinä mitään yllä olevien listojen nimikkeistä.

Käyttäjän vaatimukset:
1. Mediatyyppi: {media_type}
2. Genre: {genre_instruction}

Palauta vastauksesi AINOASTAAN JSON-muodossa olevana listana objekteja. Älä laita mitään muuta tekstiä vastaukseesi.
Jokaisen objektin tulee sisältää seuraavat avaimet: "title", "year", "reason".

Palauta kaikki nimet (`title`) aina englanninkielisellä nimellä. Tämä on kriittistä jatkokäsittelyä varten.

Esimerkki JSON-muodosta:
[
    {{"title": "Dune: Part Two", "year": 2024, "reason": "Koska pidit Blade Runner 2049:stä, tämän elokuvan visuaalinen maailma ja syvällinen scifi-tarina todennäköisesti vetoavat sinuun."}},
    {{"title": "Severance", "year": 2022, "reason": "Jos pidit Black Mirrorin ajatuksia herättävistä konsepteista, tämä sarja tarjoaa samankaltaisen mysteerin ja yhteiskuntakritiikin."}}
]
"""
	return prompt

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
        return None

# ---------- Jellyseerr helpers (images) ----------
# Headers convenience
JELLYSEERR_HEADERS = {"X-Api-Key": JELLYSEERR_API_KEY} if JELLYSEERR_API_KEY else {}

@st.cache_data(ttl=6 * 60 * 60, show_spinner=False)
def search_jellyseerr(title: str):
    """
    Etsii nimikettä Jellyseeristä pelkällä nimellä ja palauttaa
    ensimmäisen osuman ID:n ja media-tyypin (tai (None, None) jos ei löydy).
    Tämä korjaa NameErrorin, kun funktiota kutsutaan fetch_and_show_recommendationsissa.
    """
    if not JELLYSEERR_API_KEY:
        return None, None
    try:
        encoded_title = requests.utils.quote(title or "")
        endpoint = f"{JELLYSEERR_URL.rstrip('/')}/api/v1/search?query={encoded_title}&page=1"
        resp = requests.get(endpoint, headers=JELLYSEERR_HEADERS, timeout=10)
        resp.raise_for_status()
        results = resp.json().get("results", [])
        if not results:
            return None, None
        first = results[0]
        return first.get("id"), first.get("mediaType")
    except requests.exceptions.RequestException:
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

# --- New UI handlers using callbacks ---
def handle_jellyseerr_request(recommendation):
	"""Handles a request to Jellyseerr."""
	media_id = recommendation.get("media_id")
	media_type = recommendation.get("media_type")
	title = recommendation.get("title")
	if media_id and media_type:
		if request_on_jellyseerr(media_id, media_type):
			st.success(f"Pyyntö nimikkeelle '{title}' tehty onnistuneesti!")
		# request_on_jellyseerr already shows error on failure
	else:
		st.warning(f"Ei löytynyt sopivaa mediaa nimikkeelle '{title}' Jellyseeristä.")

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

def handle_blacklist_add(title):
	"""Adds a title to the user's 'do not recommend' list (which is a simple list)."""
	username = st.session_state.jellyfin_session['User']['Name']
	db = load_manual_db()

	# Ensure the user entry and the 'do_not_recommend' key (as a list) exist
	user_data = db.setdefault(username, {"movies": [], "series": [], "do_not_recommend": []})
	user_data.setdefault("do_not_recommend", [])

	if title not in user_data.get("do_not_recommend", []):
		user_data["do_not_recommend"].append(title)
		save_manual_db(db)
		st.session_state.recommendations = [r for r in st.session_state.get("recommendations", []) if r.get("title") != title]
		st.toast(f"'{title}' lisätty estolistalle.", icon="🚫")
	else:
		st.toast(f"'{title}' on jo estolistallasi.", icon="⚠️")
	# Note: no explicit st.rerun() — Streamlit reruns after callback automatically

# --- PÄÄFUNKTIO, JOKA HOITAA SUOSITUSTEN HAUN ---
def fetch_and_show_recommendations(media_type, genre):
	"""Fetches recommendations and correctly uses the simple 'do_not_recommend' list."""
	username = st.session_state.jellyfin_session['User']['Name']

	with st.spinner("Haetaan katseluhistoriaa ja asetuksia..."):
		jellyfin_watched = get_jellyfin_watched_titles()
		db = load_manual_db()
		user_db_entry = db.get(username, {"movies": [], "series": [], "do_not_recommend": []})
		manual_watched = user_db_entry.get("movies", []) + user_db_entry.get("series", [])
		# Correctly read the simple list
		blacklist = user_db_entry.get("do_not_recommend", [])
		full_watched_list = sorted(list(set(jellyfin_watched + manual_watched)))

	with st.spinner("Kysytään suosituksia tekoälyltä..."):
		prompt = build_prompt(media_type, genre, full_watched_list, blacklist)
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
	else:
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

	st.markdown("<div class='section-gap'></div>", unsafe_allow_html=True)
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

# SUOSITUSTEN NÄYTTÄMINEN (teksti-only)
if 'recommendations' in st.session_state and st.session_state.recommendations:
    st.header("✨ Tässä sinulle suosituksia:")
    
    for rec in st.session_state.recommendations[:]:
        title = rec.get('title', 'N/A')
        year = rec.get('year', 'N/A')
        reason = rec.get('reason', 'N/A')

        safe_key = f"{title}_{year}".replace(" ", "_")

        st.markdown(f"<div class='recommendation-card' id='rec_{safe_key}'>", unsafe_allow_html=True)

        # Text-only layout: otsikko + vuosiluku + perustelu
        st.subheader(f"{title} ({year})")
        st.caption(reason)

        # Toimintonapit vaakasuoraan
        b1, b2, b3 = st.columns([1,1,1])

        # Request button uses recommendation object (which contains media_id/media_type)
        b1.button("Pyydä Jellyseeristä", key=f"request_{safe_key}",
                  on_click=handle_jellyseerr_request, args=(rec,), help=f"Pyydä nimike {title}")

        media_type_from_radio = st.session_state.get("media_type", "Elokuva")
        b2.button("👁️ Merkitse katsotuksi", key=f"watched_{safe_key}",
                  on_click=handle_watched_add, args=(title, media_type_from_radio), help="Merkitse tämä nimike katsotuksi")

        b3.button("🚫 Älä suosittele", key=f"block_{safe_key}",
                  on_click=handle_blacklist_add, args=(title,), help="Lisää tämä nimike 'älä suosittele' -listalle")

        st.markdown("</div>", unsafe_allow_html=True)
        st.markdown("<div style='height:20px;'></div><hr style='margin:8px 0'/>", unsafe_allow_html=True)

