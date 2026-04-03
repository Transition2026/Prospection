# Prospection B2B — Guide d'installation

Ce guide explique comment installer et lancer l'application sur un nouveau PC.

---

## Ce dont tu as besoin avant de commencer

1. **Les fichiers du projet** — le dossier complet de l'application (copié depuis le PC d'origine ou récupéré depuis GitHub)
2. **Le fichier `.env`** — un fichier de configuration contenant les clés API (voir section dédiée plus bas)
3. **Une connexion internet** — nécessaire pour l'installation et l'utilisation de l'app

---

## Etape 1 — Installer Node.js

Node.js est le moteur qui fait tourner l'application. Il faut l'installer une seule fois sur le PC.

1. Va sur le site **https://nodejs.org**
2. Clique sur **"LTS"** (c'est la version stable recommandée)
3. Télécharge le fichier `.msi` et double-clique dessus
4. Clique sur "Suivant" jusqu'à la fin de l'installation, sans rien changer
5. Une fois installé, **redémarre ton PC**

> Pour vérifier que ça marche : appuie sur `Windows + R`, tape `cmd`, appuie sur Entrée, puis tape `node -v` et appuie sur Entrée. Tu dois voir un numéro de version comme `v20.11.0`.

---

## Etape 2 — Récupérer les fichiers du projet

# Télécharger depuis GitHub

1. Va sur la page GitHub du projet : **https://github.com/Transition2026/Prospection**
2. Clique sur le bouton vert **"Code"**
3. Clique sur **"Download ZIP"**
4. Une fois téléchargé, fais un clic droit sur le ZIP → **"Extraire tout..."**
5. Choisis un emplacement (par exemple `C:\Users\TonNom\Documents\`) et clique sur "Extraire"

> Pour mettre à jour plus tard : retélécharge le ZIP, extrait-le et remplace les fichiers — sans toucher au `.env`.

> Le dossier doit contenir : `start.bat`, un dossier `backend`, un dossier `frontend`


## Etape 3 — Créer le fichier de configuration (.env)

Le fichier `.env` contient les clés API qui permettent à l'application de fonctionner. **Ce fichier n'est pas sur GitHub** (pour des raisons de sécurité) — il faut le créer à la main.

### Comment créer ce fichier :

1. Ouvre le dossier `backend` dans le projet
2. Fais un clic droit dans le dossier → **Nouveau** → **Document texte**
3. Nomme-le exactement `.env` *(avec un point au début, sans `.txt` à la fin)*
   - Si Windows te dit que le nom est invalide, ouvre le Bloc-notes, colle le contenu ci-dessous, puis fais **Fichier → Enregistrer sous**, sélectionne "Tous les fichiers" dans le type, et nomme-le `.env`
4. Colle exactement ce contenu dans le fichier :

```
DROPCONTACT_API_KEY=ta_cle_dropcontact
BRAVE_API_KEY=ta_cle_brave
PORT=3001
DATABASE_URL="postgresql://..."
```

> **Demande au responsable du projet** de te fournir les vraies valeurs de ces clés — elles sont confidentielles et ne doivent pas être partagées publiquement.

### A quoi servent ces clés :

| Clé | Service | Utilité |
|-----|---------|---------|
| `DROPCONTACT_API_KEY` | Dropcontact | Recherche d'emails professionnels |
| `BRAVE_API_KEY` | Brave Search | Recherche de sites web et contacts RH |
| `PORT` | — | Port du serveur (ne pas modifier, laisser 3001) |
| `DATABASE_URL` | Supabase (PostgreSQL) | Base de données pour l'historique des exports |

---

## Etape 4 — Lancer l'application

1. Va dans le dossier du projet
2. Double-clique sur le fichier **`start.bat`**
3. Une fenêtre noire (invite de commandes) va s'ouvrir — c'est normal, **ne la ferme pas**
4. L'installation des dépendances se lance automatiquement (peut prendre 1 à 3 minutes la première fois)
5. Ton navigateur s'ouvre automatiquement sur `http://localhost:3001`

> Si le navigateur ne s'ouvre pas tout seul, ouvre-le manuellement et tape `http://localhost:3001` dans la barre d'adresse.

**Pour fermer l'application :** ferme la fenêtre noire (ou appuie sur `Ctrl + C` dedans).

**Les fois suivantes :** le lancement sera plus rapide (30 secondes environ) car les dépendances sont déjà installées.

---

## En cas de problème

### "Node.js n'est pas installé"
Recommence l'étape 1. Assure-toi d'avoir redémarré le PC après l'installation.

### "ERREUR lors du build du frontend"
Vérifie que tu as bien internet et que le dossier `frontend` est bien présent dans le projet.

### L'application s'ouvre mais ne trouve pas d'entreprises
Vérifie que le fichier `.env` est bien présent dans le dossier `backend` et que les clés API sont correctes.

### L'historique des exports ne fonctionne pas
Vérifie la valeur de `DATABASE_URL` dans le `.env` — elle doit être identique sur tous les PC pour partager le même historique.

---

## Comment fonctionne l'application

L'application est un outil de prospection B2B qui permet de :

- **Rechercher des entreprises** par secteur d'activité, département, taille
- **Trouver le site web** d'une entreprise via Brave Search
- **Chercher un contact RH** via Brave Search (LinkedIn)
- **Récupérer l'email et le téléphone** du dirigeant via Dropcontact
- **Exclure les entreprises déjà contactées** grâce à l'historique en base de données
- **Exporter en CSV** pour Excel

---

## Architecture technique (pour les curieux)

```
Appli searchPDG/
├── start.bat              ← double-clic pour lancer
├── backend/               ← serveur Node.js/Express
│   ├── .env               ← clés API (à créer, non partagé)
│   ├── server.js          ← point d'entrée du serveur
│   ├── routes/            ← API : entreprises, dropcontact, brave...
│   └── public/            ← frontend buildé (généré automatiquement)
└── frontend/              ← interface React
    └── src/               ← code source (modifié par les développeurs)
```

Le `start.bat` compile automatiquement le frontend dans `backend/public/`, puis le serveur Express sert à la fois l'API et l'interface sur le port 3001.