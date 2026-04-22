# Zhuxin AI Backend

## Setup

1. Install dependencies:
   npm install

2. Create your env file:
   copy .env.example to .env

3. Put your real OpenAI API key in `.env`

4. Start the server:
   npm start

## Test

Health check:
GET /health

AI endpoint:
POST /api/ai

Example JSON body:
{
  "prompt": "What are you?",
  "mode": "answer",
  "style": "clear",
  "density": "balanced"
}
