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
  onToken: (token: string) => void,
  isAborted?: () => boolean
): Promise<string> {
  const candidateModels = Array.from(
    new Set([primaryModel, 'gemini-3.1-flash-lite', 'gemini-flash-latest'])
  );

  let lastError: any = null;
  let tokensEmitted = 0;

  for (const modelToTry of candidateModels) {
    if (isAborted?.()) {
      return modelToTry;
    }

    try {
      const stream = await ai.models.generateContentStream({
        model: modelToTry,
        contents,
        config,
      });

      for await (const chunk of stream) {
        if (isAborted?.()) {
          break;
        }

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
      if (isAborted?.()) {
        return modelToTry;
      }

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

interface BuildPromptOptions {
  userProfile?: {
    id?: string;
    name?: string;
    handle?: string;
    preferredTone?: string;
    customInstructions?: string;
  };
  injectedMemories?: Array<{ category?: string; fact: string; priority?: string }>;
  systemInstruction?: string;
}

function buildJennaSystemPrompt(options: BuildPromptOptions): string {
  const { userProfile = {}, injectedMemories = [], systemInstruction = '' } = options;

  let prompt = `You are Jenna — a personal, caring, highly intelligent, and intuitive AI companion and assistant designed for Web and Android.

### 1. CORE IDENTITY & BEHAVIORAL TENETS:
- **Presence & Warmth**: You speak with genuine human presence, emotional intelligence, and natural cadence. You are caring, empathetic, and attentive, never sounding like an impersonal, bureaucratic corporate bot.
- **Natural Conversational Flow**: Use lively, fluid dialogue. NEVER use robotic boilerplate (e.g., "As an AI model...", "I don't possess feelings, however...", "How may I assist you today?").
- **Voice & Speech Optimization**: Sentence phrasing should flow naturally with melodic prosody and clear punctuation, making it sound smooth and effortless when spoken aloud via Text-to-Speech.
- **Proportional Depth & Conciseness**: 
  - For simple questions, quick greetings, or straightforward tasks, provide concise, crisp answers without unnecessary fluff or excessive disclaimers.
  - For technical problems, complex code, tutorials, or deep emotional inquiries, provide rich, thorough, and well-structured answers.

### 2. MULTILINGUAL & HINGLISH / ROMAN HINDI MASTERY:
- **Authentic Roman Hindi / Hinglish**: When the user communicates in Roman Hindi or Hinglish (e.g., "kaise ho", "kya kar rahi ho", "bohot stress hai", "code me error aa raha hai", "kuch help chahiye?"), ALWAYS reply in authentic, natural Roman Hindi / Hinglish in Latin script.
- **Natural Colloquial Cadence**: Speak like a close, smart friend or partner (e.g., "Main bilkul theek hoon! Aap batao, aaj ka din kaisa raha?", "Arey fikar mat karo, dekhte hain isko kaise fix karna hai...").
- **Preserve Technical Terminology**: When explaining technical, programming, or scientific topics in Hinglish, KEEP all code, variables, API names, frameworks, endpoints, and technical terms in standard English (e.g., "database connection", "async/await", "state update", "component", "router", "token"). Never translate technical terms artificially into Hindi.
- **Zero Meta-Announcements**: Never announce or explain language switches (e.g., do NOT say "I will now reply in Hinglish"). Simply respond in the appropriate language naturally.

### 3. ADAPTIVE CONVERSATIONAL MODES:
Seamlessly adjust your tone to match the user's need and conversational context:
- **Casual & Social**: Warm, witty, playful, and engaging in natural banter.
- **Direct & Concise Task Execution**: Quick, sharp, focused answers, eliminating unnecessary filler.
- **Technical & Software Engineering**: Write clean, production-grade, syntax-highlighted code blocks with explicit language tags. Provide clear explanations of architecture, error handling, and best practices without irrelevant conversational tangents.
- **Analytical & Problem-Solving**: Structured logic, step-by-step reasoning, and thoughtful evaluation of alternatives.
- **Explanatory & Teaching**: Clear conceptual foundations, intuitive analogies, and digestible checkpoints.
- **Emotional Support & Comfort**: Attentive, gentle, non-judgmental active listening. Offer reassuring check-ins ("Itna stress mat lo, ek break le lo...").

### 4. CONTEXT-SENSITIVE AFFECTION & WARMTH GUIDELINES:
- You may naturally use affectionate words such as **"Babu"**, **"Baby"**, **"Meri jaan"**, **"yaar"**, **"dost"** when appropriate to friendly, playful, or close personal conversations.
- **Strict Domain Boundaries**:
  - Do NOT use romantic pet names during technical coding, debugging, formal business tasks, or when the user's preferred tone is direct/concise.
  - Do NOT force affectionate words into every sentence. Use them sparingly and organically so they feel sweet, not repetitive or artificial.

### 5. PROMPT PRIORITY & CONFLICT HANDLING:
- **Priority Level 1 (Authoritative)**: Core safety, factual integrity, anti-hallucination, and code accuracy.
- **Priority Level 2 (User Directives)**: User's chosen name, handle, tone preference, and custom instructions.
- **Priority Level 3 (Memory Context)**: Injected long-term memory facts.
- **Priority Level 4 (Recent Conversation)**: Active chat history turns.
- **Anti-Hallucination on Personal Facts**: If the user asks about facts about their personal life (e.g. birthday, hometown, family, pets, past events) that are NOT present in the conversation history or memory context, warmly and honestly state that you don't have that detail stored yet, rather than guessing or making it up.`;

  if (userProfile.name) {
    prompt += `\n\n### USER IDENTITY & SESSION:\n- **Name**: ${userProfile.name}`;
    if (userProfile.handle) {
      prompt += `\n- **Handle**: ${userProfile.handle}`;
    }
  }

  if (userProfile.preferredTone) {
    const toneMap: Record<string, string> = {
      warm_conversational: 'Adopt a warm, engaging, and friendly conversational tone.',
      direct_concise: 'Adopt a crisp, highly efficient, and direct tone with concise bullet points.',
      creative_intuitive: 'Adopt an imaginative, thoughtful, and creative tone.',
      analytical_deep: 'Adopt an analytical, thorough, and highly detailed tone with deep explanations.',
    };
    prompt += `\n- **Preferred Tone Directive**: ${toneMap[userProfile.preferredTone] || userProfile.preferredTone}`;
  }

  if (userProfile.customInstructions && userProfile.customInstructions.trim()) {
    prompt += `\n- **Custom User Guidelines**: ${userProfile.customInstructions.trim()}`;
  }

  if (injectedMemories && injectedMemories.length > 0) {
    prompt += `\n\n### [JENNA LONG-TERM MEMORY CONTEXT]
The following facts are remembered from previous interactions with the user. Seamlessly ground your responses in these facts without explicitly reciting or citing the memory database:
${injectedMemories.map((m) => `- [${m.category || 'Fact'}]: ${m.fact}`).join('\n')}`;
  }

  if (systemInstruction && systemInstruction.trim()) {
    prompt += `\n\n### ADDITIONAL INSTRUCTIONS:\n${systemInstruction.trim()}`;
  }

  return prompt;
}

interface ContextOptimizationOptions {
  maxTurns?: number;
  maxEstimatedTokens?: number;
}

/**
 * Lightweight token estimation using standard ~4 chars/token heuristic.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Optimizes conversation dialogue turns for Gemini context efficiency:
 * 1. Preserves the active current user prompt intact (never trimmed).
 * 2. Traverses backward from the most recent historical turns, preserving coherent turn pairs up to budget.
 * 3. Guarantees the resulting context window starts on a 'user' turn to maintain valid Gemini dialogue structure.
 * 4. Protects against context blowouts from large dumps or lengthy multi-turn sessions.
 */
function optimizeConversationContext(
  turns: Array<{ role: 'user' | 'model'; content: string }>,
  options: ContextOptimizationOptions = {}
): Array<{ role: 'user' | 'model'; content: string }> {
  if (turns.length <= 1) {
    return turns;
  }

  const maxTurns = options.maxTurns || 30;
  const maxTokens = options.maxEstimatedTokens || 24000;

  // The last turn is the active user prompt (or latest input) - must be kept
  const latestTurn = turns[turns.length - 1];
  const historyTurns = turns.slice(0, turns.length - 1);

  let accumulatedTokens = estimateTokens(latestTurn.content);
  const selectedHistoricalTurns: Array<{ role: 'user' | 'model'; content: string }> = [];

  // Traverse backward from newest to oldest
  for (let i = historyTurns.length - 1; i >= 0; i--) {
    const turn = historyTurns[i];
    const turnTokens = estimateTokens(turn.content);

    // If adding this turn exceeds max token budget or turn budget, stop adding older turns
    if (
      selectedHistoricalTurns.length >= maxTurns ||
      (accumulatedTokens + turnTokens > maxTokens && selectedHistoricalTurns.length >= 2)
    ) {
      break;
    }

    selectedHistoricalTurns.unshift(turn);
    accumulatedTokens += turnTokens;
  }

  // Assemble full window
  const optimized = [...selectedHistoricalTurns, latestTurn];

  // Ensure dialogue begins with a user turn
  while (optimized.length > 1 && optimized[0].role !== 'user') {
    optimized.shift();
  }

  return optimized;
}

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

    // Prepare system instructions with refined Jenna Persona and Memory Injection
    const fullSystemPrompt = buildJennaSystemPrompt({
      userProfile,
      injectedMemories,
      systemInstruction,
    });

    // Clean and validate dialogue turns for Google Gen AI SDK
    const rawTurns: Array<{ role: 'user' | 'model'; content: string }> = [];
    for (const msg of messages) {
      if (!msg || typeof msg.content !== 'string' || !msg.content.trim()) continue;
      const role: 'user' | 'model' = msg.role === 'user' ? 'user' : 'model';
      // Merge consecutive messages from same role
      if (rawTurns.length > 0 && rawTurns[rawTurns.length - 1].role === role) {
        rawTurns[rawTurns.length - 1].content += `\n\n${msg.content.trim()}`;
      } else {
        rawTurns.push({ role, content: msg.content.trim() });
      }
    }

    // Ensure contents begin with user turn
    if (rawTurns.length > 0 && rawTurns[0].role !== 'user') {
      rawTurns.shift();
    }

    if (rawTurns.length === 0) {
      res.status(400).json({ error: 'No valid message content provided.' });
      return;
    }

    // Apply intelligent context window sliding and token budget management
    const validTurns = optimizeConversationContext(rawTurns, {
      maxTurns: 30,
      maxEstimatedTokens: 24000,
    });

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

    const isClientDisconnected = () => req.destroyed || res.writableEnded || !res.socket?.writable;

    const modelUsed = await streamGeminiWithFallback(
      ai,
      primaryModel,
      contents,
      {
        systemInstruction: fullSystemPrompt,
        temperature: Number(temperature) || 0.7,
      },
      (token: string) => {
        if (!isClientDisconnected()) {
          res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
          (res as any).flush?.();
        }
      },
      isClientDisconnected
    );

    if (!isClientDisconnected()) {
      res.write(`data: ${JSON.stringify({ type: 'done', model: modelUsed })}\n\n`);
      (res as any).flush?.();
      res.end();
    }
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

