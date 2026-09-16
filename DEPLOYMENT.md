# Kiraa : VPS avec un Nginx public existant

Le proxy existant conserve 80/443 et le certificat de kiraa.souki.io.
Kiraa écoute en HTTP derrière lui. Le Compose de base publie seulement
127.0.0.1:8080 pour les diagnostics, pas les ports publics.

## Configuration

Conserver la clé Groq dans le .env non suivi. Ajouter POSTGRES_DB,
POSTGRES_USER et POSTGRES_PASSWORD depuis .env.example. Pour une base existante,
utiliser son mot de passe actuel. Le mot de passe doit être compatible URL
(lettres, chiffres, tiret, underscore). DATABASE_URL est construit par Compose.
Ne pas remplacer le .env du VPS par celui du dépôt.

Avant une mise à jour : sauvegarder PostgreSQL. Les contraintes ajoutées refusent
les données incohérentes ou les doublons saisonniers existants ; elles ne les
suppriment pas. Une erreur du service init bloque app : consulter ses logs.

## Démarrage

Créer une fois le réseau partagé, puis y connecter le proxy existant :

```sh
docker network create kiraa_edge
docker network connect kiraa_edge NOM_DU_CONTENEUR_NGINX_EXISTANT
docker compose -f docker-compose.yml -f docker-compose.vps.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
docker compose logs --tail=100 init app nginx
curl -f http://127.0.0.1:8080/api/health
```

Si le réseau existe déjà, ne pas le recréer. Déclarer aussi le réseau externe
dans le Compose du proxy existant pour conserver la connexion après recréation.
Le service init applique les migrations puis importe les CSV et politiques,
sans écraser les lignes existantes. app attend sa réussite.

Ajouter nginx/kiraa.edge.conf.example dans les configurations montées de TON
proxy existant, en adaptant les chemins des certificats. Pointer le DNS A de
kiraa.souki.io vers le VPS ; vérifier aussi tout enregistrement AAAA.
Tester et recharger ce proxy :

```sh
docker exec NOM_DU_CONTENEUR_NGINX_EXISTANT nginx -t
docker exec NOM_DU_CONTENEUR_NGINX_EXISTANT nginx -s reload
curl -f https://kiraa.souki.io/api/health
```

## Tests dans Docker

```sh
docker compose run --rm --no-deps init npm run typecheck
docker compose run --rm --no-deps init npm test
docker compose run --rm --no-deps -e RUN_DB_TESTS=true init npm run test:integration
```

Le test d'intégration lit les tables et vérifie les vecteurs/checkpoints.
Il ne simule pas à lui seul une réservation utilisateur complète.
Tester ensuite le chat, un devis et une réservation dans une base de test.
Ne pas utiliser docker compose down --volumes sur la base à conserver.

## Limites explicites

Groq réalise extraction, classification et sélection de formulation.
Les résultats financiers, statuts et extraits de politique sont affichés sans
réécriture libre par le LLM. Les réponses JSON sont validées avec Zod.
Le RAG utilise des vecteurs lexicaux locaux 1536D (lexical-hash-v1), pas un
modèle sémantique : il peut manquer les synonymes. Aucun fournisseur OpenAI
n'est appelé. Les anciens vecteurs restent conservés mais sont exclus.

Les checkpoints officiels sont dans kiraa_checkpoints pour ne pas toucher aux
éventuelles anciennes tables incompatibles dans public.
Un cas PENDING_REVIEW n'est pas une réservation confirmée et ne bloque pas
le stock. Un opérateur doit le traiter ; aucune interface opérateur n'est fournie.
L'application reste une démonstration publique sans comptes clients : avant
une ouverture commerciale, définir authentification, validation d'identité
et traitement des demandes humaines. /api/health ne teste pas Groq en direct.
