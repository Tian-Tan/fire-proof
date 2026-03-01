from fastapi import FastAPI
from pydantic import BaseModel


app = FastAPI(title="fire-proof mock llm")


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/chat")
async def chat(payload: ChatRequest):
    normalized_message = payload.message.strip()

    if not normalized_message:
        reply_text = "没有收到有效消息。请再说一次。"
    elif "出口" in normalized_message:
        reply_text = "最近的安全出口在你西侧。不要向东走。"
    elif "火" in normalized_message or "烟" in normalized_message:
        reply_text = "检测到火情风险。请立即远离危险区域，改走楼梯。"
    elif "help" in normalized_message.lower():
        reply_text = "Emergency guidance is active. Stay low and move toward the nearest safe exit."
    else:
        reply_text = f"收到你的消息：{normalized_message}。请保持冷静并等待下一步指示。"

    return {
        "reply_text": reply_text,
        "session_id": payload.session_id,
    }
