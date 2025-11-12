# Favicon Setup Guide

## Overview

Streamlit doesn't natively support favicon configuration through code. However, you can add a favicon by manually placing it in the correct location.

## Setup Instructions

### Step 1: Prepare Your Favicon

1. **Convert logo.png to favicon.ico:**
   - Use an online converter: [favicon-generator.org](https://www.favicon-generator.org/)
   - Or use ImageMagick locally:
     ```bash
     convert images/logo.png -define icon:auto-resize=256,128,96,64,48,32,16 images/favicon.ico
     ```

2. **Place favicon in Streamlit config directory:**

   **For Docker:**
   - Favicon is served automatically from `images/favicon.ico`
   - Add to `.streamlit/config.toml` (create if needed)

   **For Local Development:**
   - Create `.streamlit/` directory in project root
   - Create `config.toml` file with:
     ```toml
     [client]
     showErrorDetails = true
     
     [logger]
     level = "info"
     ```

### Step 2: Add Favicon to Docker

Update `Dockerfile`:

```dockerfile
# ...existing code...
COPY images/favicon.ico /app/images/favicon.ico
# ...existing code...
```

Update `docker-compose.yml` if using volumes:

```yaml
volumes:
  - ./images:/app/images
  - ./database.json:/app/database.json
```

### Step 3: Streamlit Cloud Deployment (Optional)

For Streamlit Cloud, add to `.streamlit/config.toml`:

```toml
[client]
showErrorDetails = true

[theme]
primaryColor = "#FF6B35"
backgroundColor = "#FFFFFF"
secondaryBackgroundColor = "#F0F2F6"
textColor = "#262730"
font = "sans serif"
```

## Troubleshooting

**Favicon not showing in browser:**
1. Clear browser cache (Ctrl+Shift+Del / Cmd+Shift+Del)
2. Hard refresh page (Ctrl+F5 / Cmd+Shift+R)
3. Check that `images/favicon.ico` exists and is readable
4. Check browser console for errors (F12)

**Different favicon in different browsers:**
- Some browsers cache favicons aggressively
- Try in an incognito/private window
- Ensure `.ico` file format (not `.png`)

## File Locations

```
project-root/
├── images/
│   ├── logo.png
│   ├── favicon.ico          ← Add here
│   └── screenshot.png
├── .streamlit/              ← Create this directory
│   └── config.toml          ← Create this file
└── Dockerfile
```

---

**Note:** Streamlit's favicon support is limited. For full customization, consider using a reverse proxy (nginx/Traefik) in production.