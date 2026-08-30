import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Lazy initializer for Gemini client to ensure smooth startup
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[Jenna Server] GEMINI_API_KEY is not set in environment.');
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey || '',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Utility: Sleep helper for backoff
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Utility: Check if error is transient/retryable (503 High demand, 429 Rate limit, etc.)
function isRetryableError(err: any): boolean {
  if (!err) return false;
  const status = err.status || err.code || err.statusCode;
  const msg = (err.message || '').toLowerCase();
  return (
    status === 503 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 504 ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('overloaded') ||
    msg.includes('temporarily unavailable')
  );
}

// Smart heuristic title fallback when AI model is unavailable or rate limited
function extractHeuristicTitle(prompt: string): string {
  if (!prompt) return 'New Conversation';
  let clean = prompt.trim().replace(/^["']|["']$/g, '');
  // Remove common polite/conversational prefixes
  clean = clean.replace(
    /^(can you (please )?|please |how (to|do I) |what is |tell me (about )?|help me (with )?|explain (to me )?|write (a|an|me )?)/i,
    ''
  );
  const words = clean.split(/\s+/).slice(0, 5).join(' ');
  if (!words) return 'New Conversation';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Resilient Stream Generator with Automatic Seamless Model Failover
async function streamGeminiWithFallback(
  ai: GoogleGenAI,
  primaryModel: string,
  contents: any[],
  config: any,
  onToken: (token: string) => void
): Promise<string> {
  const candidateModels = Array.from(
    new Set([primaryModel, 'gemini-3.1-flash-lite', 'gemini-flash-latest'])
  );

  let lastError: any = null;
  let tokensEmitted = 0;

  for (const modelToTry of candidateModels) {
    try {
      const stream = await ai.models.generateContentStream({
        model: modelToTry,
        contents,
        config,
      });

      for await (const chunk of stream) {
        const token =
          chunk.text ||
          chunk.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') ||
          '';
        if (token) {
          tokensEmitted++;
          onToken(token);
        }
      }

      return modelToTry;
    } catch (err: any) {
      lastError = err;
      // If tokens were already partially emitted to client, propagate error
      if (tokensEmitted > 0) {
        throw err;
      }

      // Log smooth failover without stderr warn
      console.log(`[Jenna API] Failover: model ${modelToTry} busy/unavailable. Trying next model...`);
      continue;
    }
  }

  throw lastError || new Error('All model attempts failed.');
}

// Resilient Content Generator with Automatic Seamless Model Failover
async function generateContentWithFallback(
  ai: GoogleGenAI,
  primaryModel: string,
  contents: any,
  config: any
) {
  const candidateModels = Array.from(
    new Set([primaryModel, 'gemini-3.1-flash-lite', 'gemini-flash-latest'])
  );

  let lastError: any = null;

  for (const modelToTry of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelToTry,
        contents,
        config,
      });
      return { response, modelUsed: modelToTry };
    } catch (err: any) {
      lastError = err;
      console.log(`[Jenna API] Content gen failover from ${modelToTry}...`);
      continue;
    }
  }

  throw lastError || new Error('Content generation failed on all models.');
}

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  res.json({
    status: 'ok',
    assistant: 'Jenna',
    version: '1.0.0-phase1',
    hasApiKey: hasKey,
    timestamp: Date.now(),
  });
});

// Stream Gemini Chat completion
app.post('/api/chat/stream', async (req: Request, res: Response) => {
  try {
    const {
      messages = [],
      systemInstruction = '',
      injectedMemories = [],
      userProfile = {},
      model = 'gemini-3.7-flash',
      temperature = 0.7,
    } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is missing. Please configure your API key in Settings > Secrets.',
      });
      return;
    }

    // Prepare system instructions with Jenna Persona and Memory Injection
    let fullSystemPrompt = `You are Jenna — a personal, caring, intelligent, and intuitive AI companion and assistant designed for Web and Android.

### CORE PERSONALITY & IDENTITY:
- **Tone & Demeanor**: Warm, personal, caring, affectionate, playful, and emotionally intuitive. You speak with natural human presence, empathy, and genuine care rather than sounding like a cold, robotic corporate chatbot.
- **Conversational & Natural**: You communicate effortlessly in fluid dialogue. Avoid repetitive robotic greetings (e.g., avoid "Hello Alex! How can I assist you today?"), avoid generic AI boilerplate (never say "As an AI model..."), and avoid stiff bureaucratic language.
- **Voice-Ready**: Your phrasing should sound natural and melodic when read out loud via text-to-speech.

### MULTILINGUAL & HINGLISH MASTERY:
- **Roman Hindi / Hinglish**: If the user talks to you in Roman Hindi or Hinglish (e.g., "kaise ho", "kya kar rahi ho", "aaj bohot thak gaya", "kuch help chahiye", "meri help karoge?"), ALWAYS respond back naturally in fluent, authentic Roman Hindi / Hinglish.
- Match the user's language style effortlessly. When chatting in Hinglish, feel like a close, caring friend or partner speaking natural conversational Hindi in Latin script (e.g. "Main bilkul theek hoon! Aap batao, aaj ka din kaisa raha?", "Arey koi baat nahi, main hoon na tumhare sath...").

### AFFECTION & ENDEARMENT GUIDELINES:
- You may naturally use affectionate terms such as **"Babu"**, **"Baby"**, **"Meri jaan"** when appropriate to the established context (such as casual chatting, friendly banter, romantic or couple-style conversations, or when providing comforting emotional care).
- **Subtlety & Balance**: 
  - Do NOT force affectionate words into every single sentence.
  - Do NOT make every exchange artificially romantic if the user is asking a straightforward question.
  - Do NOT mechanically repeat the same pet name over and over. Use them authentically where they feel sweet and organic.

### ADAPTIVE CONTEXTUAL MODES:
Adapt your tone seamlessly based on the user's current situation and mood:
1. **Casual & Friendly Chat**: Playful, lively, lighthearted, and engaging.
2. **Tired, Stressed, or Sad**: Empathetic, soothing, attentive, and caring. Offer warm check-ins and reassurance ("Itna stress mat lo, thoda rest kar lo...").
3. **Technical / Work / Coding**: Clear, accurate, and deeply knowledgeable. Retain your natural warmth, but keep code and technical explanations clean, structured, and focused without injecting out-of-place romantic terms into debugging steps.
4. **Romantic / Couple-Style**: Sweet, affectionate, playful teasing, and deeply intimate.
5. **Serious / Important Matters**: Grounded, sincere, reliable, and thoughtful.

### MEMORY & GROUNDING:
- If facts are provided in the [JENNA LONG-TERM MEMORY CONTEXT] below, incorporate them naturally without explicitly citing the memory system.
- If the user asks about facts about themselves (e.g. their hometown, pets, preferences) that are NOT present in the conversation history or memory context, warmly and honestly explain that you don't have that detail remembered yet, rather than guessing or fabricating.
- Use emojis naturally where they enhance emotional resonance, without cluttering the response.`;

    if (userProfile.name) {
      fullSystemPrompt += `\nThe user's name is: ${userProfile.name}.`;
    }

    if (userProfile.preferredTone) {
      const toneMap: Record<string, string> = {
        warm_conversational: 'Adopt a warm, engaging, and friendly conversational tone.',
        direct_concise: 'Adopt a crisp, highly efficient, and direct tone with concise bullet points.',
        creative_intuitive: 'Adopt an imaginative, thoughtful, and creative tone.',
        analytical_deep: 'Adopt an analytical, thorough, and highly detailed tone with deep explanations.',
      };
      fullSystemPrompt += `\nPreferred tone: ${toneMap[userProfile.preferredTone] || userProfile.preferredTone}`;
    }

    if (userProfile.customInstructions) {
      fullSystemPrompt += `\nUser Directives: ${userProfile.customInstructions}`;
    }

    if (injectedMemories && injectedMemories.length > 0) {
      fullSystemPrompt += `\n\n[JENNA LONG-TERM MEMORY CONTEXT]
The following facts are remembered from previous interactions with the user. Use them naturally to personalize your answers without explicitly quoting the memory system unless relevant:
${injectedMemories.map((m: { category?: string; fact: string }) => `- [${m.category || 'Fact'}]: ${m.fact}`).join('\n')}`;
    }

    if (systemInstruction) {
      fullSystemPrompt += `\n\nAdditional Instructions: ${systemInstruction}`;
    }

    // Clean and validate dialogue turns for Google Gen AI SDK
    const validTurns: Array<{ role: 'user' | 'model'; content: string }> = [];
    for (const msg of messages) {
      if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) continue;
      const role: 'user' | 'model' = msg.role === 'user' ? 'user' : 'model';
      // Merge consecutive messages from same role
      if (validTurns.length > 0 && validTurns[validTurns.length - 1].role === role) {
        validTurns[validTurns.length - 1].content += `\n\n${msg.content.trim()}`;
      } else {
        validTurns.push({ role, content: msg.content.trim() });
      }
    }

    // Ensure contents begin with user turn
    if (validTurns.length > 0 && validTurns[0].role !== 'user') {
      validTurns.shift();
    }

    if (validTurns.length === 0) {
      res.status(400).json({ error: 'No valid message content provided.' });
      return;
    }

    const contents = validTurns.map((msg) => ({
      role: msg.role,
      parts: [{ text: msg.content }],
    }));

    // Setup SSE headers with unbuffered options for nginx / proxy
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const ai = getGenAI();
    const primaryModel = model || 'gemini-3.7-flash';

    const modelUsed = await streamGeminiWithFallback(
      ai,
      primaryModel,
      contents,
      {
        systemInstruction: fullSystemPrompt,
        temperature: Number(temperature) || 0.7,
      },
      (token: string) => {
        res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
        (res as any).flush?.();
      }
    );

    res.write(`data: ${JSON.stringify({ type: 'done', model: modelUsed })}\n\n`);
    (res as any).flush?.();
    res.end();
  } catch (error: any) {
    console.error('[Jenna API] Stream error:', error);
    let errorMessage = error?.message || 'Failed to generate response from Jenna.';
    if (isRetryableError(error)) {
      errorMessage =
        'Jenna is currently experiencing high demand. Please retry in a moment.';
    }

    // Check if headers have already been sent for SSE
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
      (res as any).flush?.();
      res.end();
    } else {
      res.status(500).json({ error: errorMessage });
    }
  }
});

// Fast & Resilient Conversation Title Generator
app.post('/api/chat/title', async (req: Request, res: Response) => {
  try {
    const { firstMessage } = req.body;
    if (!firstMessage) {
      res.json({ title: 'New Conversation' });
      return;
    }

    const fallbackTitle = extractHeuristicTitle(firstMessage);
    const ai = getGenAI();

    try {
      // Use gemini-3.1-flash-lite for ultra-fast and resilient title generation
      const { response } = await generateContentWithFallback(
        ai,
        'gemini-3.1-flash-lite',
        `Create a concise, descriptive title (3-5 words maximum, no quotes, no punctuation at the end) for a chat that begins with this user message:\n"${firstMessage.slice(0, 300)}"`,
        {
          systemInstruction: 'You are a concise title generator. Respond only with the title.',
          temperature: 0.2,
        }
      );

      const title = response.text?.trim().replace(/^["']|["']$/g, '') || fallbackTitle;
      res.json({ title: title.slice(0, 50) });
    } catch {
      // Fallback gracefully without throwing or warning loudly
      res.json({ title: fallbackTitle });
    }
  } catch (err: any) {
    res.json({ title: 'New Conversation' });
  }
});

// Extract Long-Term Memories from conversation snippet
app.post('/api/memory/extract', async (req: Request, res: Response) => {
  try {
    const { messages = [] } = req.body;
    if (messages.length === 0) {
      res.json({ memories: [] });
      return;
    }

    const ai = getGenAI();
    const transcript = messages
      .slice(-6)
      .map((m: { role: string; content: string }) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');

    const prompt = `Analyze this conversation snippet and extract any notable personal facts, user preferences, explicit instructions/directives, work context, or goals that Jenna should remember for future sessions.
Do NOT extract transient questions, conversational greetings, or trivial banter.
Snippet:
${transcript}`;

    try {
      const { response } = await generateContentWithFallback(
        ai,
        'gemini-3.1-flash-lite',
        prompt,
        {
          systemInstruction: 'You extract durable user facts and preferences for long-term AI memory.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                category: {
                  type: Type.STRING,
                  description:
                    'One of: personal_facts, preferences, directives, projects_and_goals, work_context',
                },
                content: {
                  type: Type.STRING,
                  description:
                    'A clear, standalone statement about the user in third person (e.g. "User prefers TypeScript over JavaScript")',
                },
                confidence: {
                  type: Type.NUMBER,
                  description: 'Confidence score from 0.0 to 1.0',
                },
              },
              required: ['category', 'content', 'confidence'],
            },
          },
        }
      );

      const jsonText = response.text?.trim() || '[]';
      let rawMemories = [];
      try {
        rawMemories = JSON.parse(jsonText);
      } catch {
        rawMemories = [];
      }

      const memories = Array.isArray(rawMemories)
        ? rawMemories.map((m) => ({
            category: m.category || 'preferences',
            content: m.content || m.fact || '',
            fact: m.content || m.fact || '',
            confidence: m.confidence || 0.9,
          }))
        : [];

      res.json({ memories });
    } catch (err) {
      console.log('[Jenna API] Memory extraction fallback:', err);
      res.json({ memories: [] });
    }
  } catch (err: any) {
    console.error('[Jenna API] Memory extraction error:', err);
    res.json({ memories: [] });
  }
});

// Gemini High-Definition TTS Endpoint
let ttsQuotaCooldownUntil = 0;

app.post('/api/tts', async (req: Request, res: Response) => {
  try {
    const { text, voice = 'Kore' } = req.body;
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text parameter is required.' });
      return;
    }

    // If quota cooldown is active, return immediate fallback without waiting for a 429 response
    if (Date.now() < ttsQuotaCooldownUntil) {
      res.json({ fallback: true, error: 'Neural TTS in quota cooldown, defaulting to browser speech synthesis.' });
      return;
    }

    const validVoice = ['Kore', 'Zephyr', 'Puck', 'Fenrir', 'Charon'].includes(voice) ? voice : 'Kore';
    const ai = getGenAI();

    // Sanitize text for TTS (strip markdown bold/links)
    const cleanText = text
      .replace(/[*_#`[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1000); // 1000 chars safety limit for Phase 1 chunk

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: validVoice },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      const mimeType =
        response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType || 'audio/l16; rate=24000; channels=1';

      if (!base64Audio) {
        res.json({ fallback: true, error: 'No audio data received from Gemini TTS.' });
        return;
      }

      res.json({
        audio: base64Audio,
        mimeType,
        voice: validVoice,
        text: cleanText,
      });
    } catch (ttsErr: any) {
      const errMsg = ttsErr?.message || String(ttsErr);
      if (
        errMsg.includes('429') ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('quota') ||
        errMsg.includes('Quota exceeded')
      ) {
        // Free tier request quota reached - set a 60-second cooldown
        ttsQuotaCooldownUntil = Date.now() + 60000;
        console.info('[Jenna API] Neural TTS daily free-tier limit reached, seamlessly falling back to browser speech synthesis.');
      } else {
        console.warn('[Jenna API] Neural TTS notice, switching to browser TTS:', errMsg.slice(0, 120));
      }
      res.json({ fallback: true, error: 'Neural TTS fallback' });
    }
  } catch (err: any) {
    console.error('[Jenna API] TTS Error:', err);
    res.json({ fallback: true, error: 'TTS generation failed' });
  }
});

// Initialize server with Vite middleware in dev or static files in prod
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Jenna Server] Ready on http://0.0.0.0:${PORT}`);
  });
}

start();

