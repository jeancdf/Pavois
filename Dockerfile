# Utilise une image Python légère
FROM python:3.10-slim

# Définit le dossier de travail dans le conteneur
WORKDIR /app

# Copie le fichier de dépendances et l'installe
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copie le script Python dans le conteneur
COPY udp_listener.py .

# Expose les ports :
# 5000 pour l'UDP (détection)
# 3000 pour le TCP (WebSocket pour le front)
EXPOSE 5000/udp
EXPOSE 3000/tcp

# Lance le script
CMD ["python", "-u", "udp_listener.py"]
