# Loads environment variables from the current process.
import os
# Provides an async lifecycle wrapper for FastAPI startup and shutdown.
from contextlib import asynccontextmanager

# HTTP client used to call the ElevenLabs API.
import httpx
# Core FastAPI classes for defining the app and request validation.
from fastapi import FastAPI, HTTPException, Query
# Middleware that allows the mobile app to call this API from another origin.
from fastapi.middleware.cors import CORSMiddleware
# Response type that streams MP3 bytes back to the caller.
from fastapi.responses import StreamingResponse


# Reads the ElevenLabs API key from the server environment.
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
# Reads the selected ElevenLabs voice ID, or falls back to a default demo voice.
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
# Reads the TTS model ID, or falls back to a low-latency model.
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")


# Creates a shared async HTTP client when the app starts and closes it on shutdown.
@asynccontextmanager
# Declares the FastAPI lifespan handler signature.
async def lifespan(_: FastAPI):
    # Opens one reusable HTTP client for all ElevenLabs requests.
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        # Stores the client on the app state so route handlers can reuse it.
        app.state.http_client = client
        # Hands control back to FastAPI while the app is running.
        yield


# Creates the FastAPI application instance for the TTS proxy.
app = FastAPI(title="fire-proof tts proxy", lifespan=lifespan)
# Adds CORS so the Expo app can call this backend during development.
app.add_middleware(
    # Uses the standard CORS middleware implementation.
    CORSMiddleware,
    # Allows requests from any origin while prototyping.
    allow_origins=["*"],
    # Disables credentialed cross-origin requests because they are not needed here.
    allow_credentials=False,
    # Allows GET requests, which is how the app requests speech right now.
    allow_methods=["GET"],
    # Allows all request headers from the client.
    allow_headers=["*"],
)


# Defines a simple health check endpoint.
@app.get("/health")
# Returns a fixed status payload so you can verify the service is running.
async def health():
    # Sends a small JSON success response.
    return {"status": "ok"}


# Defines the text-to-speech endpoint used by the mobile client.
@app.get("/tts")
# Accepts the text query string and validates its size.
async def tts(text: str = Query(..., min_length=1, max_length=1000)):
    # Stops the request early if the ElevenLabs API key is missing.
    if not ELEVENLABS_API_KEY:
        # Returns a server error that explains the missing configuration.
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY is not configured.")

    # Builds the ElevenLabs streaming endpoint URL for the selected voice.
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}/stream"
    # Prepares the required authentication and content headers.
    headers = {
        # Sends the ElevenLabs API key securely from the server.
        "xi-api-key": ELEVENLABS_API_KEY,
        # Requests MP3 audio bytes in the response.
        "Accept": "audio/mpeg",
        # Declares that the outgoing body is JSON.
        "Content-Type": "application/json",
    }
    # Prepares the TTS request body sent to ElevenLabs.
    payload = {
        # Passes through the caller's text exactly as received.
        "text": text,
        # Selects the configured TTS model.
        "model_id": ELEVENLABS_MODEL_ID,
        # Tunes the generated voice for emergency guidance playback.
        "voice_settings": {
            # Keeps the voice reasonably stable across phrases.
            "stability": 0.35,
            # Preserves the selected voice's identity.
            "similarity_boost": 0.75,
            # Speeds up speech slightly for lower-latency instructions.
            "speed": 1.05,
        },
    }

    # Builds the outbound HTTP request once before sending it.
    request = app.state.http_client.build_request("POST", url, headers=headers, json=payload)
    # Sends the request in streaming mode so audio can pass through as it arrives.
    response = await app.state.http_client.send(request, stream=True)

    # Checks whether ElevenLabs returned an error.
    if response.status_code >= 400:
        # Reads the full error body from the upstream response.
        error_body = await response.aread()
        # Closes the upstream response before raising an error.
        await response.aclose()
        # Returns a gateway error with the upstream error text when available.
        raise HTTPException(
            # Uses 502 because the upstream provider failed.
            status_code=502,
            # Includes the upstream message to make debugging easier.
            detail=error_body.decode("utf-8", errors="ignore") or "ElevenLabs request failed.",
        )

    # Defines the async generator that relays audio bytes to the client.
    async def stream_audio():
        # Ensures the upstream response is always closed.
        try:
            # Iterates over streaming MP3 chunks from ElevenLabs.
            async for chunk in response.aiter_bytes():
                # Skips empty chunks and forwards non-empty audio data.
                if chunk:
                    # Yields each audio chunk to the mobile client immediately.
                    yield chunk
        # Runs cleanup even if the client disconnects early.
        finally:
            # Closes the upstream streaming response.
            await response.aclose()

    # Returns a streaming MP3 response to the caller.
    return StreamingResponse(stream_audio(), media_type="audio/mpeg")
