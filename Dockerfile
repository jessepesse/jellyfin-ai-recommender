# Käytä virallista Python 3.11 slim -pohjaista imagea
FROM python:3.11-slim

# Aseta työskentelykansio kontin sisällä
WORKDIR /app

# Kopioi riippuvuustiedosto ja asenna kirjastot
# Tämä hyödyntää Dockerin välimuistia: asennus ajetaan vain jos tiedosto muuttuu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kopioi loput sovelluksen tiedostoista konttiin
# Tämä sisältää app.py:n
COPY . .

# Kerro Dockerille, että kontti kuuntelee porttia 8501
EXPOSE 8501

# Komento, joka ajetaan kontin käynnistyessä
# --server.address=0.0.0.0 on tärkeä, jotta palveluun pääsee käsiksi kontin ulkopuolelta
CMD ["streamlit", "run", "app.py", "--server.port=8501", "--server.address=0.0.0.0"]