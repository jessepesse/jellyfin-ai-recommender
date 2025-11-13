# Setup Guide

## Prerequisites

- Docker & Docker Compose installed
- Running Jellyfin instance
- (Optional) Running Jellyseerr instance
- Google Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

## Step 1: Environment Configuration

### Create `.env` file:

```bash
cp .env.example .env
```

### Fill in your credentials:

```env
# Jellyfin Configuration
JELLYFIN_URL=http://your-jellyfin-ip:8096
JELLYFIN_USERNAME=your_username
JELLYFIN_PASSWORD=your_password

# Jellyseerr Configuration (optional)
JELLYSEERR_URL=http://your-jellyseerr-ip:5055
JELLYSEERR_API_KEY=your_jellyseerr_api_key

# Google Gemini Configuration
GEMINI_API_KEY=your_google_gemini_api_key
```

## Step 2: Obtain API Keys

### Google Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the key to your `.env` file

### Jellyseerr API Key

1. Open Jellyseerr web interface
2. Go to Settings → API
3. Copy your API key

## Step 3: Docker Compose Configuration

Update `docker-compose.yml` if needed:

```yaml
services:
  recommender:
    build: .
    ports:
      - "8501:8501"
    environment:
      - JELLYFIN_URL=${JELLYFIN_URL}
      - JELLYSEERR_URL=${JELLYSEERR_URL}
      - JELLYSEERR_API_KEY=${JELLYSEERR_API_KEY}
      - GEMINI_API_KEY=${GEMINI_API_KEY}
    volumes:
      - ./database.json:/app/database.json
    restart: unless-stopped
```

**Important:** The `./database.json:/app/database.json` volume mount ensures your data persists across container updates. See [DATABASE_PERSISTENCE.md](DATABASE_PERSISTENCE.md) for detailed information about data persistence and backup strategies.

## Step 4: Start Application

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f recommender

# Stop
docker-compose down
```

## Step 5: First Login

1. Access `http://localhost:8501`
2. Login with your Jellyfin credentials
3. App will fetch your watch history automatically

## Troubleshooting

### Connection Issues

**Error: "Yhteys Jellyfin-palvelimeen epäonnistui"**
- Verify `JELLYFIN_URL` is correct (e.g., `http://192.168.1.x:8096`)
- Check Jellyfin is running and accessible
- Verify firewall allows connections

**Error: "Ei löytynyt sopivaa mediaa"**
- Jellyseerr might not be configured
- Check `JELLYSEERR_API_KEY` is correct
- Verify Jellyseerr has media library indexed

### API Key Issues

**Error: "Gemini API-avainta ei ole asetettu"**
- `GEMINI_API_KEY` is missing in `.env`
- Verify key is valid (test in Google AI Studio)

**Error: "JSON-muunnos epäonnistui"**
- Gemini API response format issue
- Check your prompt tokens usage quota

### Database Issues

**Error: "Tietokanta ei vastaa"**
- Ensure `database.json` has write permissions
- Check Docker volume mounts in `docker-compose.yml`

---

## Development Setup

If developing locally (without Docker):

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run app
streamlit run app.py
```

---

## Production Deployment

For production, consider:

1. **Use reverse proxy** (nginx/Traefik) for HTTPS
2. **Secure `.env`** — never commit to git
3. **Database backup** — regularly backup `database.json`
4. **Monitor logs** — use `docker-compose logs`
5. **Update regularly** — pull latest changes periodically

Example Traefik config:

```yaml
# traefik.yml
services:
  recommender:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.recommender.rule=Host(`recommender.example.com`)"
      - "traefik.http.routers.recommender.entrypoints=websecure"
      - "traefik.http.routers.recommender.tls.certresolver=letsencrypt"
```
