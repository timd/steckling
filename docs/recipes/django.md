# Recipe: Django

## `steckling.yml`

```yaml
version: 1
worktrees:
  copyOnCreate:
    - .env # gitignored secrets a fresh worktree needs
services:
  compose: ./compose.steckling.yml
  expose:
    postgres:
      container: 5432
      env: DATABASE_URL
      url: "postgres://app:app@localhost:{port}/app"
app:
  run: "python manage.py runserver 0.0.0.0:$PORT"
  port:
    env: PORT
    base: 8000
hooks:
  provision: "python manage.py migrate && python manage.py loaddata seed"
```

## `compose.steckling.yml`

```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app }
    ports: ["${STECKLING_PORT_POSTGRES:?}:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U app"], interval: 2s, retries: 15 }
volumes:
  pgdata:
```

## Notes

- Use `dj-database-url` (or read `DATABASE_URL` yourself) in `settings.py`:
  ```python
  import dj_database_url, os
  DATABASES = {"default": dj_database_url.parse(os.environ["DATABASE_URL"])}
  ```
- The virtualenv lives on the host (app-on-host model) — activate it in your shell before
  `steck up`, or wrap the run command: `run: ".venv/bin/python manage.py runserver 0.0.0.0:$PORT"`.
- Add Celery as a second service + a `steck exec -- celery -A app worker` invocation.
