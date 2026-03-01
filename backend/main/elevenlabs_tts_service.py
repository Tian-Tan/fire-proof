# Loads environment variables from the current process.
import os
# Resolves filesystem paths for loading the local .env file.
from pathlib import Path
# Builds binary file payloads for multipart uploads.
from io import BytesIO
# Encodes text safely for use in query strings.
from urllib.parse import quote
# Provides an async lifecycle wrapper for FastAPI startup and shutdown.
from contextlib import asynccontextmanager

# HTTP client used to call the ElevenLabs API.
import httpx
# Core FastAPI classes for defining the app and request validation.
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
# Middleware that allows the mobile app to call this API from another origin.
from fastapi.middleware.cors import CORSMiddleware
# Response type that streams MP3 bytes back to the caller.
from fastapi.responses import StreamingResponse
# Data models used to validate incoming and outgoing JSON payloads.
from pydantic import BaseModel


# Loads key-value pairs from a local .env file into the process environment.
def load_local_env():
    # Points to the repository root based on this file's location.
    repo_root = Path(__file__).resolve().parents[2]
    # Lists supported .env file locations in load order.
    env_paths = [
        # Loads the repository-level .env file first.
        repo_root / ".env",
        # Also supports a backend-local .env file when present.
        repo_root / "backend" / ".env",
    ]

    # Iterates over each supported .env path.
    for env_path in env_paths:
        # Skips missing files.
        if not env_path.is_file():
            continue

        # Reads the file contents line by line.
        for raw_line in env_path.read_text().splitlines():
            # Removes surrounding whitespace from the current line.
            line = raw_line.strip()

            # Skips blank lines, comments, and malformed lines.
            if not line or line.startswith("#") or "=" not in line:
                continue

            # Splits the line into an environment variable name and value.
            key, value = line.split("=", 1)
            # Normalizes the variable name by trimming whitespace.
            normalized_key = key.strip()
            # Normalizes the value by trimming whitespace and common wrapping quotes.
            normalized_value = value.strip().strip("'").strip('"')

            # Ignores empty keys.
            if not normalized_key:
                continue

            # Sets the variable only if it is not already exported in the shell.
            os.environ.setdefault(normalized_key, normalized_value)


# Loads .env values before module-level settings are read.
load_local_env()


# Reads the ElevenLabs API key from the server environment.
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")
# Reads the selected ElevenLabs voice ID, or falls back to a default demo voice.
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
# Reads the TTS model ID, or falls back to a low-latency model.
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")
# Reads the upstream LLM endpoint that this service will call for replies.
UPSTREAM_LLM_URL = os.getenv("UPSTREAM_LLM_URL")
# Reads an optional API key for the upstream LLM service.
UPSTREAM_LLM_API_KEY = os.getenv("UPSTREAM_LLM_API_KEY")
# Reads the base URL for a direct OpenAI-compatible LLM integration.
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
# Reads the API key for a direct OpenAI-compatible LLM integration.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
# Reads the model name for a direct OpenAI-compatible LLM integration.
OPENAI_MODEL = os.getenv("OPENAI_MODEL")
# Reads an optional system prompt for the direct LLM integration.
LLM_SYSTEM_PROMPT = os.getenv(
    "LLM_SYSTEM_PROMPT",
    "You are an emergency evacuation assistant. Give short, actionable safety guidance.",
)


# Defines the JSON payload sent by the frontend chat form.
class ChatRequest(BaseModel):
    # Holds the user's typed message that should be sent to the LLM.
    message: str
    # Optionally carries a session identifier for multi-turn context.
    session_id: str | None = None


# Defines the JSON payload returned to the frontend after the LLM responds.
class ChatResponse(BaseModel):
    # Stores the text returned by the upstream LLM.
    reply_text: str
    # Stores the final text that was sent to the upstream LLM.
    user_text: str
    # Exposes a ready-to-play local TTS URL for the frontend audio player.
    audio_path: str


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
    # Allows both GET and POST requests for speech and chat.
    allow_methods=["GET", "POST"],
    # Allows all request headers from the client.
    allow_headers=["*"],
)


# Defines a simple health check endpoint.
@app.get("/health")
# Returns a fixed status payload so you can verify the service is running.
async def health():
    # Sends a small JSON success response.
    return {"status": "ok"}


# Converts a chat-completions content payload into plain text.
def extract_text_from_openai_message(content):
    # Returns plain string content directly when the provider already uses a string.
    if isinstance(content, str):
        # Normalizes surrounding whitespace.
        return content.strip()

    # Handles multimodal-style content arrays used by some compatible providers.
    if isinstance(content, list):
        # Collects text fragments in their original order.
        text_parts: list[str] = []

        # Iterates through each part in the content array.
        for part in content:
            # Skips non-dict entries.
            if not isinstance(part, dict):
                continue

            # Reads a direct text field when available.
            text_value = part.get("text")
            # Accepts non-empty text fragments.
            if isinstance(text_value, str) and text_value.strip():
                # Preserves the content in order.
                text_parts.append(text_value.strip())

        # Joins all collected text fragments into one reply.
        return "\n".join(text_parts).strip()

    # Falls back to an empty string for unsupported content shapes.
    return ""


# Calls a direct OpenAI-compatible chat completions endpoint.
async def fetch_openai_compatible_reply(message: str, session_id: str | None):
    # Stops early if the API key is missing.
    if not OPENAI_API_KEY:
        # Returns a server error that explains the missing direct LLM configuration.
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")

    # Stops early if the model name is missing.
    if not OPENAI_MODEL:
        # Returns a server error that explains the missing model configuration.
        raise HTTPException(status_code=500, detail="OPENAI_MODEL is not configured.")

    # Builds the OpenAI-compatible chat completions URL.
    openai_url = f"{OPENAI_BASE_URL.rstrip('/')}/chat/completions"
    # Prepares the request headers for the direct LLM call.
    headers = {
        # Declares that the outgoing body is JSON.
        "Content-Type": "application/json",
        # Sends bearer auth for OpenAI-compatible providers.
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }
    # Prepares the standard chat-completions payload.
    payload = {
        # Selects the configured model.
        "model": OPENAI_MODEL,
        # Sends a concise safety-focused system prompt and the current user message.
        "messages": [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            {"role": "user", "content": message},
        ],
    }

    # Includes session metadata when the provider preserves custom fields.
    if session_id:
        # Passes session context as metadata for tracing.
        payload["metadata"] = {"session_id": session_id}

    # Calls the direct LLM backend and waits for the JSON response.
    response = await app.state.http_client.post(openai_url, headers=headers, json=payload)

    # Handles direct LLM errors before parsing the response body.
    if response.status_code >= 400:
        # Raises a gateway error with the upstream error text.
        raise HTTPException(
            # Uses 502 because the upstream dependency failed.
            status_code=502,
            # Includes the upstream response body to help debugging.
            detail=response.text or "Direct LLM request failed.",
        )

    # Parses the direct LLM JSON response body.
    response_json = response.json()
    # Reads the choice list from the response payload.
    choices = response_json.get("choices") or []

    # Rejects responses that do not include any choices.
    if not choices:
        # Returns a gateway error when the provider response is malformed.
        raise HTTPException(status_code=502, detail="Direct LLM response did not include choices.")

    # Reads the first chat message returned by the provider.
    message_payload = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    # Extracts the assistant text from the provider-specific content format.
    reply_text = extract_text_from_openai_message(message_payload.get("content"))

    # Rejects empty assistant replies because there is nothing to display or speak.
    if not reply_text:
        # Returns a gateway error when the provider response has no usable text.
        raise HTTPException(status_code=502, detail="Direct LLM response did not include message content.")

    # Returns the assistant text.
    return reply_text


# Calls the configured LLM backend and normalizes its reply text.
async def fetch_llm_reply(message: str, session_id: str | None):
    # Removes leading and trailing whitespace from the user's message.
    normalized_message = message.strip()

    # Rejects blank messages before calling the upstream LLM.
    if not normalized_message:
        # Returns a validation-style error for an empty message.
        raise HTTPException(status_code=400, detail="message must not be empty.")

    # Calls the legacy upstream bridge when it is configured.
    if UPSTREAM_LLM_URL:
        # Prepares the JSON body expected by your teammate's backend.
        upstream_payload = {
            # Sends the user message as plain text.
            "message": normalized_message,
            # Preserves the optional session identifier for multi-turn chat state.
            "session_id": session_id,
        }
        # Starts with a JSON content header for the upstream request.
        upstream_headers = {
            # Declares that the outgoing body is JSON.
            "Content-Type": "application/json",
        }

        # Adds bearer authentication when the upstream LLM requires it.
        if UPSTREAM_LLM_API_KEY:
            # Passes the optional LLM API key to the upstream backend.
            upstream_headers["Authorization"] = f"Bearer {UPSTREAM_LLM_API_KEY}"

        # Calls the upstream LLM backend and waits for a JSON reply.
        upstream_response = await app.state.http_client.post(
            # Uses the configured teammate LLM endpoint.
            UPSTREAM_LLM_URL,
            # Sends the headers prepared above.
            headers=upstream_headers,
            # Sends the JSON request body.
            json=upstream_payload,
        )

        # Handles upstream LLM errors before trying to parse the response.
        if upstream_response.status_code >= 400:
            # Raises a gateway error with the upstream error text.
            raise HTTPException(
                # Uses 502 because the upstream dependency failed.
                status_code=502,
                # Includes the upstream response body to help debugging.
                detail=upstream_response.text or "Upstream LLM request failed.",
            )

        # Parses the upstream JSON response body.
        upstream_json = upstream_response.json()
        # Reads the main reply text from the expected field name.
        reply_text = str(upstream_json.get("reply_text", "")).strip()

        # Falls back to a generic field if the teammate backend uses a different key.
        if not reply_text:
            # Tries a second common response field name.
            reply_text = str(upstream_json.get("answer", "")).strip()

        # Rejects empty LLM replies because there is nothing to speak.
        if not reply_text:
            # Returns a gateway error when the upstream payload is missing usable text.
            raise HTTPException(status_code=502, detail="Upstream LLM response did not include reply_text.")

        # Returns the normalized user text and the LLM reply text together.
        return normalized_message, reply_text

    # Falls back to a direct OpenAI-compatible integration when no upstream bridge is configured.
    reply_text = await fetch_openai_compatible_reply(normalized_message, session_id)

    # Returns the normalized user text and the LLM reply text together.
    return normalized_message, reply_text


# Builds the standard JSON payload returned to the frontend.
def build_chat_response(user_text: str, reply_text: str):
    # Builds a local URL path that the frontend can hand to the audio player.
    audio_path = f"/tts?text={quote(reply_text)}"

    # Returns both the normalized user text, the LLM text, and the local TTS path.
    return ChatResponse(
        # Includes the text that was actually sent to the LLM.
        user_text=user_text,
        # Includes the raw reply text for UI display.
        reply_text=reply_text,
        # Includes the local audio path for immediate playback.
        audio_path=audio_path,
    )


# Converts uploaded speech audio into text using ElevenLabs STT.
async def transcribe_speech(audio: UploadFile):
    # Stops early if the ElevenLabs API key is missing.
    if not ELEVENLABS_API_KEY:
        # Returns a server error that explains the missing configuration.
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY is not configured.")

    # Reads the full uploaded audio file into memory.
    audio_bytes = await audio.read()

    # Rejects empty uploads because they cannot be transcribed.
    if not audio_bytes:
        # Returns a validation error for empty audio uploads.
        raise HTTPException(status_code=400, detail="audio must not be empty.")

    # Uses the original filename when available, otherwise falls back to a default.
    filename = audio.filename or "recording.m4a"
    # Uses the uploaded content type when available, otherwise falls back to a common mobile audio type.
    content_type = audio.content_type or "audio/m4a"
    # Prepares the multipart file tuple required by the ElevenLabs STT endpoint.
    files = {
        # Sends the uploaded bytes as a file-like object to ElevenLabs.
        "file": (filename, BytesIO(audio_bytes), content_type),
    }
    # Prepares the form fields for the ElevenLabs STT request.
    data = {
        # Requests the default speech-to-text model.
        "model_id": "scribe_v1",
    }
    # Prepares the authentication header for the STT request.
    headers = {
        # Sends the ElevenLabs API key securely from the server.
        "xi-api-key": ELEVENLABS_API_KEY,
    }

    # Calls the ElevenLabs speech-to-text endpoint.
    response = await app.state.http_client.post(
        # Uses the documented ElevenLabs STT HTTP endpoint.
        "https://api.elevenlabs.io/v1/speech-to-text",
        # Sends the API key header.
        headers=headers,
        # Sends the form fields.
        data=data,
        # Sends the uploaded audio file.
        files=files,
    )

    # Handles upstream STT errors before parsing JSON.
    if response.status_code >= 400:
        # Raises a gateway error with the upstream STT response body.
        raise HTTPException(
            # Uses 502 because the upstream dependency failed.
            status_code=502,
            # Includes the upstream error body to help debugging.
            detail=response.text or "Speech-to-text request failed.",
        )

    # Parses the STT JSON response body.
    response_json = response.json()
    # Reads the transcription text from the expected ElevenLabs field.
    transcript = str(response_json.get("text", "")).strip()

    # Rejects empty transcriptions because there is nothing to send to the LLM.
    if not transcript:
        # Returns a gateway error when the STT response has no usable text.
        raise HTTPException(status_code=502, detail="Speech-to-text response did not include text.")

    # Returns the normalized transcript text.
    return transcript


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


# Defines the backend chat endpoint that bridges the frontend and the upstream LLM.
@app.post("/chat", response_model=ChatResponse)
# Accepts the user's typed message, forwards it to the LLM, and returns text plus a local audio path.
async def chat(payload: ChatRequest):
    # Calls the shared helper that forwards text to the upstream LLM.
    user_text, reply_text = await fetch_llm_reply(payload.message, payload.session_id)
    # Returns the standard response payload used by the frontend.
    return build_chat_response(user_text, reply_text)


# Defines the backend voice-chat endpoint that accepts recorded speech.
@app.post("/voice-chat", response_model=ChatResponse)
# Accepts uploaded audio, transcribes it, calls the LLM, and returns text plus a local audio path.
async def voice_chat(
    # Receives the recorded audio file from the mobile client.
    audio: UploadFile = File(...),
    # Receives an optional session identifier for multi-turn chat state.
    session_id: str | None = Form(None),
):
    # Converts the uploaded speech audio into text.
    transcript = await transcribe_speech(audio)
    # Calls the shared helper that forwards text to the upstream LLM.
    user_text, reply_text = await fetch_llm_reply(transcript, session_id)
    # Returns the standard response payload used by the frontend.
    return build_chat_response(user_text, reply_text)
