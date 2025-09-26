# Start containers
up *args: format
    docker compose up {{ args }}


# Stop & remove containers
down *args:
    docker compose down {{ args }}


# Re-build docker images
build *args:
    docker compose build {{ args }}


# Run `{cmd}` in django container
exec +cmd:
    docker compose run --rm fastapi {{ cmd }}


# Run formatting using uv tool
format:
    uvx ruff format .
    uvx ruff check . --fix
