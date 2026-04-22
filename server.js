import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    app: "zhuxin-ai-backend",
    message: "Backend is running"
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(OPENAI_API_KEY)
  });
});

app.post("/api/ai", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing on the server"
      });
    }

    const {
      prompt = "",
      mode = "answer",
      style = "clear",
      density = "balanced"
    } = req.body || {};

    if (!prompt.trim()) {
      return res.status(400).json({
        error: "Prompt is required"
      });
    }

    const instructions = [
      "You are Zhuxin Assistant.",
      "Be helpful, accurate, and structured.",
      `Mode: ${mode}`,
      `Style: ${style}`,
      `Density: ${density}`,
      "Return plain text only."
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5",
        instructions,
        input: prompt
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: errorText
      });
    }

    const data = await response.json();

    res.json({
      output: data.output_text || ""
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || "Server error"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Zhuxin AI backend listening on port ${PORT}`);
});
