import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse


ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        app.state.http_client = client
        yield


app = FastAPI(title="fire-proof tts proxy", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/tts")
async def tts(text: str = Query(..., min_length=1, max_length=1000)):
    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY is not configured.")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}/stream"
    headers = {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
    }
    payload = {
        "text": text,
        "model_id": ELEVENLABS_MODEL_ID,
        "voice_settings": {
            "stability": 0.35,
            "similarity_boost": 0.75,
            "speed": 1.05,
        },
    }

    request = app.state.http_client.build_request("POST", url, headers=headers, json=payload)
    response = await app.state.http_client.send(request, stream=True)

    if response.status_code >= 400:
        error_body = await response.aread()
        await response.aclose()
        raise HTTPException(
            status_code=502,
            detail=error_body.decode("utf-8", errors="ignore") or "ElevenLabs request failed.",
        )

    async def stream_audio():
        try:
            async for chunk in response.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            await response.aclose()

    return StreamingResponse(stream_audio(), media_type="audio/mpeg")
