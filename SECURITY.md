# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Jellyfin AI Recommender, please report it responsibly and do not publicly disclose it until it has been addressed.

### How to Report

**Please email security concerns to:**
- 📧 [Create a private security advisory on GitHub](https://github.com/jessepesse/jellyfin-ai-recommender/security/advisories)

**Or contact:**
- GitHub Issues with security tag (mark as private if available)
- Email directly if GitHub is not accessible

### What to Include

When reporting a vulnerability, please include:

1. **Description** - What is the vulnerability?
2. **Location** - Which file/function/component is affected?
3. **Steps to Reproduce** - How can the vulnerability be triggered?
4. **Impact** - What is the potential damage?
5. **Suggested Fix** - If you have a solution, please share it
6. **Your Contact Info** - How can we reach you for follow-up?

### Response Timeline

- **Initial Response:** Within 48 hours
- **Assessment:** Within 1 week
- **Fix/Patch:** Depends on severity (critical: days, high: 1-2 weeks, medium: 1 month, low: next release)
- **Public Disclosure:** After fix is released or 90 days from report, whichever comes first

## Security Considerations

### Current Version: v0.2.5-alpha

This is a **pre-release (alpha)** version. Security issues may exist. Use in production at your own risk.

### Known Security Considerations

1. **API Keys & Credentials**
   - Store all API keys (Jellyfin, Jellyseerr, Google Gemini) in `.env` file
   - Never commit credentials to git repository
   - Use strong, unique API keys
   - Rotate keys periodically

2. **Database Security**
   - `database.json` contains user-specific data
   - Store in a secure location with appropriate file permissions (600 or 0o600)
   - Regular backups recommended (use database export feature)
   - Consider encrypting at rest in production

3. **Authentication**
   - Uses Jellyfin authentication (inherit Jellyfin's security model)
   - No additional authentication layer in this application
   - Secure your Jellyfin instance first

4. **API Communication**
   - Requires HTTPS for all external API calls (Jellyfin, Jellyseerr, Google Gemini)
   - Verify SSL certificates
   - Use environment variable validation

5. **Dependency Security**
   - Keep dependencies updated: `pip install --upgrade -r requirements.txt`
   - Monitor security advisories for Streamlit, requests, google-generativeai
   - Use Python 3.9+ (security patches)

### Recommended Security Practices

- **Network**
  - Run behind a reverse proxy (nginx, Caddy)
  - Use HTTPS/TLS encryption
  - Implement rate limiting at proxy level
  - Restrict access to trusted networks only

- **Container Security** (Docker)
  - Run with `--read-only` flag where possible
  - Use non-root user
  - Limit resource consumption (memory, CPU)
  - Keep Docker images updated

- **Monitoring**
  - Monitor `app.log` for suspicious activity
  - Set up alerts for failed authentication attempts
  - Track API rate limiting triggers
  - Review database.json modifications

- **Access Control**
  - Use strong Jellyfin admin passwords
  - Implement network-level access controls
  - Use VPN for remote access
  - Regular security audits

## Vulnerability Disclosure

We follow responsible disclosure practices. Once a vulnerability is fixed:

1. Security patch is released
2. GitHub Security Advisory is published
3. Detailed explanation provided (without exploitation details)
4. Reporters credited (unless they prefer anonymity)

## Security Updates

Security patches are released as soon as possible when vulnerabilities are discovered. Subscribe to releases to be notified:

- 🔔 **GitHub Notifications:** Watch releases on [this repository](https://github.com/jessepesse/jellyfin-ai-recommender)
- 📧 **Email Alerts:** Use GitHub notification settings

## Third-Party Security

This project depends on external services:

- **Jellyfin** - Media server (secure your instance)
- **Jellyseerr** - Media request service (secure your instance)
- **Google Gemini** - AI API (use official API keys only)

Ensure all external services are properly secured and up to date.

## Comments on this Policy

If you have suggestions to improve this security policy, please open an issue or discussion.

---

**Last Updated:** 2025-11-16  
**Version:** 1.0  
**Status:** Active
