/**
 * TaskPlanner — LLM-backed intent classification and plan creation.
 *
 * classify(): decides chat fast-path vs. agent task. Cheap single call on a
 * fast-tier route; conservative — when uncertain, prefers 'chat' so the UX
 * stays identical to the proven pipeline.
 *
 * createPlan(): produces a bounded plan (≤ MAX_STEPS) with tool intents and
 * permission tags derived from the ToolRegistry (never trusts the model to
 * self-declare permissions).
 */

import { Type } from '@google/genai';
import { AIBrain } from '../../src/core/ai/brain';
import { ModelRouter } from '../../src/core/ai/router';
import { AgentPlanDTO, AgentStepDTO } from '../../src/core/agent/eventTypes';
import { toolRegistry } from '../tools/registry';

export const MAX_PLAN_STEPS = 8;

export interface ClassificationResult {
  mode: 'chat' | 'task';
  reason: string;
}

export class TaskPlanner {
  constructor(private brain: AIBrain, private router: ModelRouter) {}

  async classify(userMessage: string, clientToolIds: string[]): Promise<ClassificationResult> {
    const toolList = toolRegistry
      .toProviderSpecs({ clientToolIds })
      .map((t) => `- ${t.name.replace(/__/g, '.')}: ${t.description.slice(0, 100)}`)
      .join('\n');

    const route = this.router.resolve('title_gen');
    try {
      const { text } = await this.brain.generateText(
        route.modelId,
        [
          {
            role: 'user',
            content: `Classify this user message for an AI assistant that has these tools available:\n${toolList}\n\nUser message:\n"""${userMessage.slice(0, 1000)}"""\n\nRespond with JSON: {"mode": "chat" | "task", "reason": "..."}.\n- "chat": conversational reply, opinion, explanation, creative writing, coding advice — anything answerable directly from knowledge.\n- "task": the request genuinely requires using one or more of the listed tools (current time/date lookups, calculations, reading a URL, saving/searching user memory, device actions).\nWhen uncertain, choose "chat".`,
          },
        ],
        {
          systemInstruction: 'You are a precise intent classifier. Respond only with the JSON object.',
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mode: { type: Type.STRING, description: 'Either "chat" or "task"' },
              reason: { type: Type.STRING, description: 'One-line justification' },
            },
            required: ['mode', 'reason'],
          },
        }
      );
      const parsed = JSON.parse(text || '{}');
      const mode = parsed.mode === 'task' ? 'task' : 'chat';
      return { mode, reason: String(parsed.reason || '') };
    } catch {
      // Classification failure must never break the user experience.
      return { mode: 'chat', reason: 'Classifier unavailable; defaulting to chat.' };
    }
  }

  async createPlan(
    userMessage: string,
    clientToolIds: string[]
  ): Promise<AgentPlanDTO> {
    const specs = toolRegistry.toProviderSpecs({ clientToolIds });
    const toolCatalog = specs
      .map((t) => `- id: ${t.name.replace(/__/g, '.')}\n  description: ${t.description}`)
      .join('\n');

    const route = this.router.resolve('agent_planning');
    const { text } = await this.brain.generateText(
      route.modelId,
      [
        {
          role: 'user',
          content: `Create a short execution plan for this request.\n\nAvailable tools:\n${toolCatalog}\n\nUser request:\n"""${userMessage.slice(0, 2000)}"""\n\nRules:\n- At most ${MAX_PLAN_STEPS} steps.\n- Each step: {"description": "...", "toolId": "<exact tool id or empty string for a reasoning/response step>"}.\n- The final step should always produce the answer for the user (toolId: "").\n- Only reference tool ids from the list above.`,
        },
      ],
      {
        systemInstruction: 'You are a task planner. Respond only with the JSON object.',
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            goal: { type: Type.STRING },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING },
                  toolId: { type: Type.STRING },
                },
                required: ['description', 'toolId'],
              },
            },
          },
          required: ['goal', 'steps'],
        },
      }
    );

    let parsed: { goal?: string; steps?: Array<{ description?: string; toolId?: string }> };
    try {
      parsed = JSON.parse(text || '{}');
    } catch {
      parsed = {};
    }

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps.slice(0, MAX_PLAN_STEPS) : [];
    const steps: AgentStepDTO[] = rawSteps.map((s, i) => {
      const toolId = (s.toolId || '').trim();
      const tool = toolId ? toolRegistry.get(toolId) : undefined;
      return {
        id: `step_${i + 1}`,
        description: String(s.description || `Step ${i + 1}`).slice(0, 300),
        toolIntent: tool ? tool.id : undefined,
        // Permission comes from the REGISTRY, never from the model's output.
        permission: tool ? tool.permission : 'SAFE',
        status: 'pending',
      };
    });

    if (steps.length === 0) {
      steps.push({
        id: 'step_1',
        description: 'Answer the user directly.',
        permission: 'SAFE',
        status: 'pending',
      });
    }

    return {
      goal: String(parsed.goal || userMessage.slice(0, 120)),
      steps,
    };
  }
}
