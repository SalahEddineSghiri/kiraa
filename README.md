# Kiraa - Zero-Hallucination Rental Agent

Kiraa is a TypeScript/Next.js implementation of the notebook's deterministic vehicle-rental logic. LLMs may classify intent, extract structured data, and phrase explanations only; eligibility, availability, price, discounts, deposit, mileage, and booking state remain deterministic TypeScript decisions.

## Local evaluation

1. Add the missing variables from `.env.example` to your existing `.env`, preserving your current API keys. Set `POSTGRES_PASSWORD` to a strong URL-safe value (letters, numbers, `-`, `_`) because Compose builds the database URL from it. Do not commit `.env`.
2. `docker compose up --build` starts PostgreSQL/pgvector, the internal Next.js application, and Nginx. In local HTTP mode, open `http://localhost`; the app port is intentionally not exposed.
3. Database migrations and seed are separate application tasks; this Compose does not run them automatically. The existing scripts must be validated before initializing a fresh database. Infrastructure startup alone does not demonstrate a working rental workflow.
4. Run `npm test`. The health endpoint is `GET /api/health`.

The three services share one Docker bridge network. Only Nginx publishes ports (80/443); it forwards pages and API calls to `app:3000`, and the application connects to `db:5432`. The browser calls `/api/chat` on the same origin. LangGraph executes inside the application container. PostgreSQL data persists in `postgres_data`.

Nginx accepts at most **10 MiB for the entire request**, including all files and multipart overhead. `/api/chat` allows 300 seconds without an upstream response; other routes use the default 60 seconds. This proxy timeout does not cancel the agent. API traffic is limited to 30 requests/minute/IP with a burst of 20 and HTTP 429 on excess; `/api/health` is excluded. The application and its business behavior are unchanged.

The application image is built in two stages and runs as the non-root `node` user. Build tools remain in the build stage; migrations/seed tooling is not included in the runtime image. No secrets or notebooks are copied into the build context. The database healthcheck verifies password-authenticated TCP access and the pgvector type, `/api/health` checks app plus database connectivity, and `/nginx-health` checks Nginx only. They do not verify business tables, the LLM or the RAG corpus. Restart policies restart stopped processes, not containers merely marked unhealthy.

### PostgreSQL seul : installation et verification

Prerequis : Docker avec conteneurs Linux. Ajouter `POSTGRES_DB=kiraa`, `POSTGRES_USER=kiraa` et un `POSTGRES_PASSWORD` fort dans le `.env` existant, sans remplacer les cles API. Le mot de passe n'a aucune valeur par defaut. Utiliser uniquement des lettres, chiffres, `-` et `_` pour rester compatible avec l'URL construite par Compose.

```sh
docker compose config --quiet
docker compose up -d db
docker compose ps db
docker compose logs --tail=100 db
docker compose exec db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 -c "SELECT current_database(); TABLE pg_extension;"'
```

Le service utilise PostgreSQL 16 avec pgvector et pgcrypto, l'authentification TCP SCRAM-SHA-256, un volume persistant, un arret gracieux de 60 secondes et un redemarrage `unless-stopped`. Aucun port PostgreSQL n'est publie sur la machine. Next.js se connecte a `db:5432` sur le reseau Docker existant ; Nginx ne traite pas le SQL. Le compte initialise par l'image est administrateur PostgreSQL : ce Compose ne met pas encore en place un role applicatif aux permissions restreintes.

Sur un **volume neuf**, `docker/postgres/init/01-pgvector.sql` active uniquement l'extension `vector`. Aucun schema metier ni jeu de donnees n'est cree. Next.js attend que le controle de sante de la base reussisse.

Sur un **volume deja initialise**, Docker ne rejoue pas les scripts d'initialisation. Si pgvector n'est pas encore active, executer explicitement la commande suivante (non destructive), puis attendre le prochain healthcheck :

```sh
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/01-pgvector.sql'
```

Ne pas supprimer le volume pour corriger un mot de passe. Les variables `POSTGRES_*` doivent correspondre au compte et a la base deja presents ; leur modification ne renomme pas la base et ne change pas le mot de passe stocke.

Pour sauvegarder sans corrompre le fichier binaire dans PowerShell, creer le dump dans le conteneur puis le copier (choisir un nouveau nom de fichier a chaque sauvegarde) :

```sh
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/kiraa-backup.dump'
docker compose cp db:/tmp/kiraa-backup.dump ./kiraa-backup.dump
```

Pour tester une restauration, copier le dump dans le conteneur et le restaurer dans une **nouvelle base vide**, sans ecraser la base active :

```sh
docker compose cp ./kiraa-backup.dump db:/tmp/kiraa-restore.dump
docker compose exec db sh -c 'createdb -U "$POSTGRES_USER" kiraa_restore'
docker compose exec db sh -c 'pg_restore -U "$POSTGRES_USER" -d kiraa_restore --exit-on-error --no-owner /tmp/kiraa-restore.dump'
```

Les sauvegardes contiennent des donnees sensibles : les conserver hors du depot, avec un acces restreint. La configuration reste a valider sur un hote Docker ; un service `healthy` ne signifie pas que les migrations metier ou l'agent sont fonctionnels.

### Local HTTP

Set `TLS_ENABLED=false` in `.env`, then run from the project directory:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose exec nginx nginx -t
curl -f http://localhost/nginx-health
curl -f http://localhost/api/health
docker compose logs --tail=100 nginx app db
```

Port 443 is published but has no listener in HTTP mode. Docker must be installed and running with Linux containers. If only the app is recreated later, restart Nginx so it resolves the new container address: `docker compose restart nginx`.

### Production HTTPS

Point your domain's DNS at the server. Obtain a certificate for that domain from your certificate provider and put `fullchain.pem` and `privkey.pem` in a host directory. Configure:

```env
TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TLS_CERT_FILE=/etc/nginx/certs/fullchain.pem
TLS_KEY_FILE=/etc/nginx/certs/privkey.pem
```

The directory is mounted read-only into Nginx. Mount the complete certificate tree if your certificate files use symlinks outside their directory. Run `docker compose up -d --build nginx`, then check `https://YOUR_DOMAIN/api/health`. HTTP redirects to HTTPS, except for `/nginx-health`. Startup fails if certificates are missing or Nginx configuration is invalid. Security headers apply to HTTP and HTTPS; HSTS applies only to HTTPS.

Certificate issuance/renewal is handled by your provider or host tooling. After renewing the mounted files, run `docker compose exec nginx nginx -t` and, if successful, `docker compose exec nginx nginx -s reload`. This configuration assumes Nginx terminates public HTTPS directly.

Use `docker compose down` to stop the stack while preserving database storage. Do not add `--volumes` unless you explicitly intend to delete the database volume. The initial `POSTGRES_PASSWORD` initializes a new volume; changing that variable does not rotate an existing PostgreSQL user's password.

## Architecture

`lib/agent/graph.ts` defines the seven required LangGraph nodes: ingestor, extractor, intent, validator, calculator, explainer, reporter. Its routing matches the notebook: policy -> calculator/RAG, eligibility -> validator, cost/reservation -> validator -> calculator, then explanation and reporter. Node paths are retained in `graphTrace`. `intentOverride` exists in the state contract only for test harnesses and is not accepted by the production chat endpoint.

Operational tables are `fleet_catalog`, `customer_profiles`, `booking_logs`, and `seasonal_pricing_matrix`. `rental_policies_vectors` is isolated for the pgvector RAG corpus only. It uses 1536-dimensional `text-embedding-3-small` vectors and cosine distance (`<=>`); run a vetted policy-ingestion job with the configured embedding provider before production traffic. The policy source is solely `data/rental_policies.md`. `lib/reporter` renders a PDF quote exclusively from validated deterministic output.

## Remote HTTPS deployment runbook

Deploy the three-service Compose stack to a Docker host and configure direct Nginx HTTPS as described above. Keep credentials outside version control. Archive the previous release image and back up PostgreSQL before upgrades; rolling back application code does not necessarily require restoring the database. The existing application still needs its own functional validation and access controls; the proxy does not implement admin authentication. A responding `/api/health` is a connectivity check, not a production-readiness certificate.

## Five-minute demonstration

Start the stack, seed the database, open the UI, then demonstrate: 19-year-old rejection; expired-license rejection; a 22-year-old Premium request yielding `PENDING_REVIEW` and 22,500 MAD deposit; `SUMMER20` capped at 15%; and a cancellation question returning only a cited policy passage. Inspect `graphTrace` and health JSON to show routing and service status.

Remote URL: deployment credentials/hosting were not supplied, so this repository intentionally does not claim a live URL. After deployment, record the URL and the output of all five E2E scenarios in a release readiness report.
