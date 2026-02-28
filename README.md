# fire-proof
A Hack 4 Humanity 2026 project

## ElevenLabs TTS bridge

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ELEVENLABS_API_KEY=your_key
export ELEVENLABS_VOICE_ID=your_voice_id
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npx expo install expo-audio
npm start
```

Update `API_BASE_URL` in `/Users/xxiellan/fire-proof/frontend/App.tsx` so your device can reach the FastAPI server on the same network.
