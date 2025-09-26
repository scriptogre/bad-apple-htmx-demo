# - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
# BUILD STAGE: Create venv with all dependencies and the app
# - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
FROM ghcr.io/astral-sh/uv:python3.12-bookworm AS builder

ARG ENVIRONMENT
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Disable Python downloads, because we want to use the existing system interpreter across both images
ENV UV_PYTHON_DOWNLOADS=0

# Install the venv in /usr/local (rather than app's /code) to fix issues during bind mounts
ENV UV_PROJECT_ENVIRONMENT=/usr/local

WORKDIR /code

# Install dependencies
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync \
      # Fail if lock file didn't change
      --frozen \
      # Don't include dev dependencies in production
      $([ "$ENVIRONMENT" = "local" ] && echo "" || echo "--no-dev") \
      # Don't install the project
      --no-install-project

COPY . /code

# Install project
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen $([ "$ENVIRONMENT" = "local" ] && echo "" || echo "--no-dev")


# - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
# RUNTIME STAGE: Copy venv & app from builder, create non-root user and switch to it
# - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
FROM python:3.12-slim-bookworm

# Copy venv & app from builder
COPY --from=builder /usr/local /usr/local
COPY --from=builder /code /code

ARG ENVIRONMENT
ENV ENVIRONMENT=${ENVIRONMENT}
ENV PATH="/usr/local/bin:$PATH" PYTHONPATH="/code" PYTHONUNBUFFERED=1

WORKDIR /code

# Create non-root user and switch to it
RUN addgroup --system non-root \
  && adduser --system --ingroup non-root non-root

USER non-root
