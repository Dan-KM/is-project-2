# Database Setup and Verification

This document covers the prerequisites, setup steps, and verification procedures for the database component. Commands use bash syntax (macOS, Linux, WSL, or Git Bash). PowerShell differences are noted where relevant.

---

## 1. Prerequisites

Ensure the following are installed and available:

- **Docker Desktop** — installed and running.
  - Verify with: `docker --version` and `docker compose version`
- **Node.js** — Prisma 8 requires:
  - Node.js `22.18+` on the 22 line, or
  - Node.js `24.11+` on the 24 line, or
  - Node.js `26+`
  - Verify with: `node -v`
- **Prisma** — required for database tooling.
- **tsx** — used for running the check script. Install once from `app/system`:
  ```bash
  npm install --save-dev tsx
  ```

---

## 2. Commands (in order)

### Step 1: Create the env file (one-time)

From `app/database`:

```bash
cp .env.example .env
```

> **PowerShell:** use `Copy-Item .env.example .env`

Then edit `.env` and insert the real passwords.

### Step 2: Start the container (first time and every time after)

From `app/database`:

```bash
docker compose up -d
```

The `-d` flag runs it in the background. On the first run this also initializes the database. Afterwards it just starts Postgres.

### Step 3: Check that it's healthy (repeatable)

From `app/database`:

```bash
docker compose ps
```

Wait until the `STATUS` column shows `healthy`.

### Step 4: Confirm the init scripts ran (first start only)

From `app/database`:

```bash
docker compose logs postgres
```

Look for lines like:

- `running /docker-entrypoint-initdb.d/01-roles.sh`
- `.../02-schema.sql`

If you instead see `Skipping initialization`, the volume already had data (see error 2 in section 10).

---

## 3. Verify the Database, Users, and Table

All of these are repeatable and run from `app/database`.

### The roles exist

```bash
docker compose exec postgres psql -U postgres -d system_db -c "\du"
```

You should see `postgres`, `system_owner`, and `system_app`.

### The table exists and `system_owner` owns it

```bash
docker compose exec postgres psql -U postgres -d system_db -c "\dt"
docker compose exec postgres psql -U postgres -d system_db -c "\d users"
```

### The permissions are correct

```bash
docker compose exec postgres psql -U postgres -d system_db -c "\dp users"
```

The app role's entry should show `system_app=arwd/system_owner`. The letters mean:

- `a` — append (INSERT)
- `r` — read (SELECT)
- `w` — write (UPDATE)
- `d` — delete

### The app user can log in with its password and use rows, but not change structure

```bash
docker compose exec postgres sh -c 'PGPASSWORD="$APP_DB_PASSWORD" psql -h 127.0.0.1 -U system_app -d system_db'
```

The single quotes make the container (not your shell) expand `$APP_DB_PASSWORD`, and `-h 127.0.0.1` forces a real password check.

Inside `psql`, run:

```sql
INSERT INTO users (username, password_hash) VALUES ('testuser', 'placeholder-not-a-real-hash');
SELECT id, username, created_at FROM users;   -- works
CREATE TABLE should_fail (id int);            -- ERROR: permission denied for schema public  ✅
\q
```

That permission error is the proof that least privilege works.