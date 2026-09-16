# Kiraa — Next.js, Groq, PostgreSQL et pgvector

Kiraa utilise Groq pour extraire les paramètres, classifier les intentions et
choisir une formulation contrôlée. Le moteur TypeScript décide de l'éligibilité,
des prix et de la disponibilité. Les réservations confirmées sont enregistrées
dans PostgreSQL après un contrôle de stock transactionnel.

## Docker et VPS

Voir [DEPLOYMENT.md](DEPLOYMENT.md) pour le VPS avec un Nginx conteneurisé existant,
les certificats, le réseau partagé, les migrations et les commandes de test.

Le Compose contient db, init, app et nginx. init exécute les migrations et le
seed avant app. Les CSV sont importés sans écraser les lignes existantes.
Le seed et les migrations utilisent des transactions ; une erreur bloque le
démarrage applicatif. Ne jamais supprimer le volume pour résoudre une erreur.

Le port local est http://127.0.0.1:8080. PostgreSQL et Next.js ne publient pas de
ports hôte. Le proxy public existant gère kiraa.souki.io et TLS.

## Configuration

Copier les variables manquantes de .env.example dans le .env, en conservant les
clés et les identifiants existants. GROQ_API_KEY, LLM_PROVIDER, LLM_MODEL,
LLM_TEMPERATURE, LLM_TIMEOUT_SECONDS configurent le client Groq côté serveur.
POSTGRES_PASSWORD doit être renseigné. Aucun secret n'est inclus dans l'image.

## Données et garanties

- Lectures SQL paramétrées : catalogue, réservations, saisonnalité et profils
  clients correspondant exactement aux informations validées.
- Aucune réservation confirmée avant insertion. Stock revérifié sous verrou.
- Les données manquantes ou contradictoires demandent une clarification.
- Le seuil de confiance est 0,85 ; les cas humains ne sont pas confirmés.
- Les politiques seules alimentent le RAG pgvector : vecteurs lexicaux locaux
  normalisés 1536D, distance cosinus, version lexical-hash-v1. Ce n'est pas un
  modèle d'embeddings sémantiques ; les synonymes peuvent ne pas être retrouvés.
- OCR français/anglais avec Tesseract et conversion PDF via Poppler dans Docker.
  Maximum 5 fichiers, 10 MiB et 5 pages par PDF.
- Devis PDF téléchargeable uniquement après validation du résultat.
- Les checkpoints officiels utilisent le schéma kiraa_checkpoints.

## Vérifications

```sh
npm run typecheck
npm test
npm run build
```

Ces commandes peuvent être exécutées dans l'image tooling comme documenté.
Le test base s'active explicitement avec RUN_DB_TESTS=true après initialisation.
Le contrôle Groq se lance avec `node --env-file=.env --import tsx scripts/check-groq.ts`
hors conteneur, ou `npx tsx scripts/check-groq.ts` dans tooling où .env est injecté.

Un healthcheck réussi vérifie les tables, le corpus et la configuration Groq ;
il ne remplace pas un test de réservation sur le VPS ni un appel Groq réel.
Les notebooks sont des références et ne sont pas modifiés.
