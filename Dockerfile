# Käytä virallista Python 3.11 slim -pohjaista imagea
FROM python:3.11-slim

# Aseta työskentelykansio kontin sisällä
WORKDIR /app

# Kopioi riippuvuustiedosto ja asenna kirjastot
# Tämä hyödyntää Dockerin välimuistia: asennus ajetaan vain jos tiedosto muuttuu
COPY requirements.txt .
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt

# Kopioi sovelluksen tiedostot
COPY app.py .
COPY images/ images/
COPY .streamlit/ .streamlit/

# Luo .streamlit asetuskansio, jos sitä ei ole
RUN mkdir -p .streamlit

# Kopioi .streamlit/config.toml tiedosto
COPY .streamlit/config.toml .streamlit/config.toml

# Kerro Dockerille, että kontti kuuntelee porttia 8501
EXPOSE 8501

# Terveys tarkistus
HEALTHCHECK CMD curl --fail http://localhost:8501/_stcore/health || exit 1

# Komento, joka ajetaan kontin käynnistyessä
# --server.address=0.0.0.0 on tärkeä, jotta palveluun pääsee käsiksi kontin ulkopuolelta
CMD ["streamlit", "run", "app.py", "--client.showErrorDetails=false", "--client.toolbarMode=minimal"]