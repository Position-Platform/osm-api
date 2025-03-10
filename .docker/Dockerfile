# Utiliser l'image Node.js officielle en tant que base
FROM node:20-buster

# Définir le répertoire de travail de l'application
WORKDIR /var/www/html

# Mettre à jour les packages et installer les dépendances nécessaires
RUN apt-get update && apt-get install -y \
    nano \
    sed \
    curl \
    git \
    iproute2 \
    software-properties-common \
    gnupg \
    lsb-release \
    wget

# Copier les fichiers du projet dans le répertoire de travail
COPY . .

# Installer les dépendances de l'application
RUN npm install

# Compiler le projet TypeScript
RUN npm run build

# Exposer le port 3000 sur le conteneur
EXPOSE 3000

# Définir la commande par défaut pour l'exécution de l'application
CMD ["npm", "start"]
