import asyncio
import gzip
import io
import zlib
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


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


@app.get("/stream")
async def bad_apple_stream():
    """SSE endpoint for Bad Apple animation"""

    async def generate():
        """Generate SSE stream for Bad Apple animation"""

        buffer = io.BytesIO()
        gzip_file = gzip.GzipFile(fileobj=buffer, mode="wb")

        def sse(html: str) -> bytes:
            """Format HTML as SSE event and compress it"""

            payload = "".join(f"data: {line}\n" for line in html.splitlines()) + "\n"
            gzip_file.write(payload.encode("utf-8"))
            gzip_file.flush(zlib.Z_SYNC_FLUSH)
            compressed = buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()
            return compressed

        frame_duration = 1.0 / 60.0  # 60 FPS
        total = len(frames_cache)

        for i, frame in enumerate(frames_cache):
            progress = (i + 1) / total * 100

            yield sse(
                f'<htmx target="#frames" swap="textContent">'
                f'{frame}'
                f'</htmx>',
            )
            yield sse(
                f'<htmx target="#progress" swap="outerHTML">'
                f'<div id="progress" style="--progress: {progress:.2f}%"></div>'
                f'</htmx>',
            )
            yield sse(
                f'<htmx target="#progress-text" swap="textContent">'
                f'{progress:.2f}% / 100%'
                f'</htmx>',
            )

            await asyncio.sleep(frame_duration)

        gzip_file.close()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Content-Encoding": "gzip",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx/proxy buffering
        },
    )
