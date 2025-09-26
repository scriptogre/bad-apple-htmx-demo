import asyncio
from contextlib import asynccontextmanager
from typing import Generator
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sse_starlette.sse import EventSourceResponse

# Pre-load all frames into memory
frames_cache = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Load frames into memory
    frames_dir = Path("frames")
    frame_files = sorted(frames_dir.glob("out*.jpg.txt")) if frames_dir.exists() else []

    for frame_file in frame_files:
        with open(frame_file, "r", encoding="utf-8") as f:
            frames_cache.append(f.read())

    yield  # Application runs here

    # Shutdown: Clean up
    frames_cache.clear()
    print("Frames cache cleared")


app = FastAPI(title="Bad Apple HTMX Demo", lifespan=lifespan)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Templates
templates = Jinja2Templates(directory="templates")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/bad-apple-stream")
async def bad_apple_stream():
    """SSE endpoint for Bad Apple animation"""

    async def generate_bad_apple_stream() -> Generator[str, None, None]:
        """Generate SSE stream for Bad Apple animation"""
        if not frames_cache:
            yield '<htmx target="#frames" swap="innerHTML">No frames loaded. Please add frames to frames/ directory.</htmx>'
            return

        frame_duration = 1.0 / 60.0  # 60 FPS

        for i, frame_content in enumerate(frames_cache):
            # Send progress updates
            progress = (i + 1) / len(frames_cache) * 100
            yield (
                f'<htmx target="#progress" swap="outerHTML">'
                f'   <div id="progress" style="--progress: {progress:.2f}%"></div>'
                f"</htmx>"
            )
            yield f'<htmx target="#progress-text" swap="textContent">{progress:.2f}% / 100%</htmx>'

            # Send frame update
            yield f'<htmx target="#frames" swap="textContent">{frame_content}</htmx>'

            # Wait for next frame
            await asyncio.sleep(frame_duration)

    return EventSourceResponse(generate_bad_apple_stream())
