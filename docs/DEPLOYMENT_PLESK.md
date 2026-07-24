# CI/CD: GitHub Actions to Plesk

The `main` branch is verified and deployed to:

- Host: `118.27.146.122`
- SSH user: `admin_lebedu`
- Application root: `/var/www/vhosts/labedu.tech/api.labedu.tech`
- URL: `https://api.labedu.tech`

## 1. Configure the Plesk Node.js application

In **Websites & Domains > api.labedu.tech > Node.js**, use:

| Setting | Value |
|---|---|
| Node.js version | 24 |
| Package manager | npm |
| Document root | `public` |
| Application mode | Production |
| Application root | `/var/www/vhosts/labedu.tech/api.labedu.tech` |
| Application startup file | `app.js` |

The Node.js Toolkit must be installed and Node.js 24 must be enabled on the
server. Enable the application after the first successful deployment.

## 2. Create the production environment file

Create this file on the server:

```text
/var/www/vhosts/labedu.tech/api.labedu.tech/.env
```

Start from `.env.example` and set at least:

```dotenv
NODE_ENV=production
DATABASE_URL="mysql://USER:URL_ENCODED_PASSWORD@127.0.0.1:3306/DATABASE"
JWT_SECRET="GENERATE_A_LONG_RANDOM_SECRET"
CORS_ORIGINS="https://labedu.tech,https://www.labedu.tech"
AI_MOCK_MODE=true
```

Use the actual frontend origins, separated by commas. Change `AI_MOCK_MODE` to
`false` only after adding the AI credentials. Restrict the file to the SSH user:

```bash
chmod 600 /var/www/vhosts/labedu.tech/api.labedu.tech/.env
```

The deployment runs `prisma migrate deploy`; do not run `prisma migrate dev` on
production.

## 3. Authorize the GitHub deploy key

Add the generated public key to the SSH user's authorized keys in Plesk, or
append it to:

```text
~/.ssh/authorized_keys
```

The repository's `production` environment must contain:

- `PLESK_SSH_PRIVATE_KEY`
- `PLESK_SSH_KNOWN_HOSTS`
- variable `PLESK_DEPLOY_ENABLED` set to `true` after the server is ready

The host-key fingerprints observed during setup were:

```text
ED25519 SHA256:zoxACkj4j0iMxJCxrD/41UsKV7+oDkMe1mhI/UoImwY
ECDSA   SHA256:dam6HhR0NiHu7XomAH8N3Q0jcMp9RQ97vMb4BGHKnE8
RSA     SHA256:dS5nSeFo+MdxoOwm6WuNhPC9HnkGvJdJBS9gLZ+OYw0
```

Verify these fingerprints using the Plesk console or with the server
administrator before the first deployment.

## 4. Enable and run the first deployment

After the public key, `.env`, and Plesk Node.js settings are ready, open
**Settings > Secrets and variables > Actions > Variables** and create a
repository variable:

```text
PLESK_DEPLOY_ENABLED=true
```

Push or manually run **Actions > CI/CD to Plesk > Run workflow**. The workflow:

1. installs locked dependencies;
2. builds, tests, and lints;
3. uploads a release over SSH;
4. generates Prisma Client and applies pending migrations;
5. installs production dependencies and restarts Plesk Passenger;
6. checks `https://api.labedu.tech/api/v1`.

Deployment stops before restart if dependency installation, build, or migration
fails. Previous release directories remain under `.releases` for investigation
or manual rollback.

## Troubleshooting

- `Permission denied (publickey)`: add the generated public key for
  `admin_lebedu`.
- `Node.js was not found`: enable Node.js 24 in Plesk or update
  `PLESK_NODE_BIN_DIR` in `.github/workflows/ci-cd.yml`.
- `Create .../.env before the first deployment`: create the production `.env`.
- Health check fails: open **Websites & Domains > api.labedu.tech > Logs** and
  inspect the Node.js/Passenger logs.
