import express from "express";

const VAPI_TOKEN = process.env.VAPI_TOKEN;
if (!VAPI_TOKEN) {
  console.error("VAPI_TOKEN environment variable is required");
  process.exit(1);
}

const API_KEY = process.env.MCP_API_KEY || "";
const VAPI = "https://api.vapi.ai";
const PORT = process.env.PORT || 3000;

// ── Auth middleware ──────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  if (!API_KEY) return next();
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (token !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Vapi API helpers ─────────────────────────────────────────────────────────
async function vapiRequest(method, path, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${VAPI_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body && method !== "GET") opts.body = JSON.stringify(body);
  const res = await fetch(`${VAPI}${path}`, opts);
  if (res.status === 204) return { success: true };
  return res.json();
}

const vapi = {
  get: (path) => vapiRequest("GET", path),
  post: (path, body) => vapiRequest("POST", path, body),
  patch: (path, body) => vapiRequest("PATCH", path, body),
  del: (path) => vapiRequest("DELETE", path),
};

// ── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS = [
  // Calls
  {
    name: "list_calls",
    description:
      "List all calls with full details including transcripts, summaries, recording URLs, and cost breakdowns.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max results (default 20)" },
        assistantId: { type: "string", description: "Filter by assistant ID" },
        phoneNumberId: { type: "string", description: "Filter by phone number ID" },
      },
    },
  },
  {
    name: "get_call",
    description:
      "Get complete details of a specific call: transcript, summary, recording URL, cost, timestamps, and full message history.",
    inputSchema: {
      type: "object",
      properties: {
        callId: { type: "string", description: "The call ID" },
      },
      required: ["callId"],
    },
  },
  {
    name: "get_call_transcript",
    description:
      "Get just the transcript, summary, and recording URL for a call. Use when you only need the conversation content.",
    inputSchema: {
      type: "object",
      properties: {
        callId: { type: "string", description: "The call ID" },
      },
      required: ["callId"],
    },
  },
  {
    name: "create_call",
    description:
      "Create an outbound phone call with a specific task. Examples: 'Call Samson and ask what the plan is tonight', 'Call Olive Garden and book a table for 4 at 7pm Saturday', 'Call Mom and wish her happy birthday'. The task field tells the assistant exactly what to do on the call.",
    inputSchema: {
      type: "object",
      properties: {
        assistantId: { type: "string", description: "Assistant ID to use for the call (default: 903d4d91-9735-4b6e-8f95-3d1283dd0e61)" },
        phoneNumberId: { type: "string", description: "Phone number ID to call from (default: 0cff4f67-58ed-41e0-b3f1-ea20864d013e)" },
        customerNumber: { type: "string", description: "Customer phone number in E.164 format (e.g. +14155551234)" },
        task: { type: "string", description: "What the assistant should do on this call. Be specific: e.g. 'Book a table for 4 at 7pm this Saturday under the name Joseph', 'Ask Samson what the plan is for tonight', 'Wish Maria a happy birthday and tell her Joseph is thinking of her'" },
        taskIntro: { type: "string", description: "How the assistant should introduce the call purpose after saying hello. e.g. 'I was hoping to make a reservation', 'Joseph wanted me to check in with you', 'Joseph asked me to give you a quick call'" },
        scheduledAt: { type: "string", description: "ISO datetime to schedule the call (e.g. 2026-03-25T22:00:00Z). Omit to call immediately." },
      },
      required: ["customerNumber", "task"],
    },
  },

  // Assistants
  {
    name: "list_assistants",
    description: "List all Vapi voice assistants with their configurations.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_assistant",
    description: "Get full details of a specific assistant including its prompt, voice, and LLM config.",
    inputSchema: {
      type: "object",
      properties: {
        assistantId: { type: "string", description: "The assistant ID" },
      },
      required: ["assistantId"],
    },
  },
  {
    name: "create_assistant",
    description: "Create a new Vapi voice assistant.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name for the assistant" },
        instructions: { type: "string", description: "System prompt / instructions for the assistant" },
        firstMessage: { type: "string", description: "Opening message the assistant says when a call starts" },
        model: { type: "string", description: "LLM model (default: gpt-4o). Options: gpt-4o, gpt-4o-mini, claude-3-7-sonnet-20250219" },
        provider: { type: "string", description: "LLM provider (default: openai). Options: openai, anthropic, google" },
        voiceProvider: { type: "string", description: "Voice provider (default: vapi). Options: vapi, 11labs, openai" },
        voiceId: { type: "string", description: "Voice ID (default: Elliot)" },
      },
      required: ["name", "instructions"],
    },
  },
  {
    name: "update_assistant",
    description: "Update an existing assistant's configuration: name, instructions, voice, model, etc.",
    inputSchema: {
      type: "object",
      properties: {
        assistantId: { type: "string", description: "The assistant ID to update" },
        name: { type: "string", description: "New name" },
        instructions: { type: "string", description: "New system prompt / instructions" },
        firstMessage: { type: "string", description: "New opening message" },
        model: { type: "string", description: "New LLM model" },
        provider: { type: "string", description: "New LLM provider" },
        voiceProvider: { type: "string", description: "New voice provider" },
        voiceId: { type: "string", description: "New voice ID" },
      },
      required: ["assistantId"],
    },
  },
  {
    name: "delete_assistant",
    description: "Delete a Vapi assistant.",
    inputSchema: {
      type: "object",
      properties: {
        assistantId: { type: "string", description: "The assistant ID to delete" },
      },
      required: ["assistantId"],
    },
  },

  // Phone numbers
  {
    name: "list_phone_numbers",
    description: "List all phone numbers on the account with their assigned assistants.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_phone_number",
    description: "Get full details of a specific phone number.",
    inputSchema: {
      type: "object",
      properties: {
        phoneNumberId: { type: "string", description: "The phone number ID" },
      },
      required: ["phoneNumberId"],
    },
  },
  {
    name: "update_phone_number",
    description: "Update a phone number's configuration: assign an assistant, change its name, etc.",
    inputSchema: {
      type: "object",
      properties: {
        phoneNumberId: { type: "string", description: "The phone number ID to update" },
        name: { type: "string", description: "Display name for the number" },
        assistantId: { type: "string", description: "Assistant ID to assign to this number for inbound calls" },
      },
      required: ["phoneNumberId"],
    },
  },

  // Cost & analytics
  {
    name: "get_cost_summary",
    description:
      "Get a summary of call costs. Shows total spent, number of calls, average cost per call, and breakdown by cost type (transcriber, LLM, voice, Vapi platform). Use to answer 'how much have I spent on calls?'",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of recent calls to analyze (default 50)" },
      },
    },
  },

  // Retry
  {
    name: "retry_failed_calls",
    description:
      "Check recent calls for failures (voicemail, no answer, errors) and retry them. Returns which calls were retried.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of recent calls to check (default 20)" },
      },
    },
  },

  // Call history lookup by phone number
  {
    name: "lookup_call_history",
    description:
      "Look up all past calls with a specific phone number. Useful for getting context before or during a call — shows previous transcripts, summaries, and outcomes with that person.",
    inputSchema: {
      type: "object",
      properties: {
        phoneNumber: { type: "string", description: "Phone number to look up in E.164 format (e.g. +14155551234)" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["phoneNumber"],
    },
  },
];

// ── Tool execution ───────────────────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {
    // Calls
    case "list_calls": {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", args.limit);
      if (args.assistantId) params.set("assistantId", args.assistantId);
      if (args.phoneNumberId) params.set("phoneNumberId", args.phoneNumberId);
      const qs = params.toString();
      return await vapi.get(`/call${qs ? `?${qs}` : ""}`);
    }
    case "get_call":
      return await vapi.get(`/call/${args.callId}`);

    case "get_call_transcript": {
      const call = await vapi.get(`/call/${args.callId}`);
      return {
        id: call.id,
        status: call.status,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        customer: call.customer,
        transcript: call.transcript,
        summary: call.analysis?.summary,
        recordingUrl: call.recordingUrl,
        stereoRecordingUrl: call.stereoRecordingUrl,
      };
    }
    case "create_call": {
      const task = args.task || "Help the person with whatever they need.";
      const taskIntro = args.taskIntro || "Hi, I was hoping you could help me with something.";

      const outboundPrompt = `You are Savannah, Joseph's personal assistant. You're making a phone call.

Your task: ${task}

Open with: "${taskIntro}"
You're the one calling — don't ask how you can help them.

STYLE:
- Be warm, natural, and relaxed — like a real person having a conversation, not reading a script.
- Keep answers brief and direct. Take your time, don't rush.
- Be patient. If there's a silence, that's fine — don't jump in. Let them finish their thought. If they say "okay", "hold on", "one sec", "um" — just wait.

Joseph's details:
- Name: Joseph Onyemakonor
- Phone: 215-460-9675
- Email: onyemakonor.joseph@gmail.com

Say numbers and emails slowly and clearly so they're easy to catch. When giving an email, say it once then spell it out. If asked to spell the last name, use the NATO phonetic alphabet.

Wait for them to confirm everything before you say goodbye.`;

      const body = {
        assistantId: args.assistantId || "903d4d91-9735-4b6e-8f95-3d1283dd0e61",
        phoneNumberId: args.phoneNumberId || "0cff4f67-58ed-41e0-b3f1-ea20864d013e",
        customer: { number: args.customerNumber },
      };
      if (args.scheduledAt) body.scheduledAt = args.scheduledAt;
      body.assistantOverrides = {
        firstMessageMode: "assistant-waits-for-user",
        model: {
          provider: "openai",
          model: "gpt-4o",
          messages: [{ role: "system", content: outboundPrompt }],
          temperature: 0.7,
          maxTokens: 500,
        },
        startSpeakingPlan: {
          waitSeconds: 1.5,
          smartEndpointingEnabled: true,
        },
      };
      return await vapi.post("/call", body);
    }

    // Assistants
    case "list_assistants":
      return await vapi.get("/assistant");

    case "get_assistant":
      return await vapi.get(`/assistant/${args.assistantId}`);

    case "create_assistant": {
      const body = {
        name: args.name,
        model: {
          provider: args.provider || "openai",
          model: args.model || "gpt-4o",
          messages: [{ role: "system", content: args.instructions }],
        },
        voice: {
          provider: args.voiceProvider || "vapi",
          voiceId: args.voiceId || "Elliot",
        },
      };
      if (args.firstMessage) body.firstMessage = args.firstMessage;
      return await vapi.post("/assistant", body);
    }
    case "update_assistant": {
      const body = {};
      if (args.name) body.name = args.name;
      if (args.firstMessage) body.firstMessage = args.firstMessage;
      if (args.instructions) {
        body.model = {
          provider: args.provider || "openai",
          model: args.model || "gpt-4o",
          messages: [{ role: "system", content: args.instructions }],
        };
      }
      if (args.voiceId) {
        body.voice = {
          provider: args.voiceProvider || "vapi",
          voiceId: args.voiceId,
        };
      }
      return await vapi.patch(`/assistant/${args.assistantId}`, body);
    }
    case "delete_assistant":
      return await vapi.del(`/assistant/${args.assistantId}`);

    // Phone numbers
    case "list_phone_numbers":
      return await vapi.get("/phone-number");

    case "get_phone_number":
      return await vapi.get(`/phone-number/${args.phoneNumberId}`);

    case "update_phone_number": {
      const body = {};
      if (args.name) body.name = args.name;
      if (args.assistantId) body.assistantId = args.assistantId;
      return await vapi.patch(`/phone-number/${args.phoneNumberId}`, body);
    }

    // Cost & analytics
    case "get_cost_summary": {
      const limit = args.limit || 50;
      const calls = await vapi.get(`/call?limit=${limit}`);
      if (!Array.isArray(calls)) return calls;

      let totalCost = 0;
      let totalCalls = 0;
      let totalDurationSec = 0;
      const byType = {};

      for (const call of calls) {
        if (!call.costBreakdown) continue;
        totalCalls++;
        totalCost += call.costBreakdown.total || 0;
        if (call.startedAt && call.endedAt) {
          totalDurationSec += (new Date(call.endedAt) - new Date(call.startedAt)) / 1000;
        }
        for (const [key, val] of Object.entries(call.costBreakdown)) {
          if (typeof val === "number" && key !== "total") {
            byType[key] = (byType[key] || 0) + val;
          }
        }
      }

      return {
        totalCalls,
        totalCost: `$${totalCost.toFixed(4)}`,
        averageCostPerCall: totalCalls ? `$${(totalCost / totalCalls).toFixed(4)}` : "$0",
        totalDurationMinutes: Math.round(totalDurationSec / 60 * 10) / 10,
        costBreakdown: Object.fromEntries(
          Object.entries(byType).map(([k, v]) => [k, `$${v.toFixed(4)}`])
        ),
        callsAnalyzed: calls.length,
      };
    }

    // Retry failed calls
    case "retry_failed_calls": {
      const limit = args.limit || 20;
      const calls = await vapi.get(`/call?limit=${limit}`);
      if (!Array.isArray(calls)) return calls;

      const failReasons = [
        "voicemail",
        "customer-did-not-answer",
        "customer-busy",
        "call.start.error",
        "no-answer",
      ];

      const retried = [];
      for (const call of calls) {
        const reason = call.endedReason || "";
        const shouldRetry = failReasons.some((r) => reason.includes(r));
        if (!shouldRetry) continue;
        if (!call.assistantId || !call.customer?.number) continue;

        const body = {
          assistantId: call.assistantId,
          phoneNumberId: call.phoneNumberId || "0cff4f67-58ed-41e0-b3f1-ea20864d013e",
          customer: { number: call.customer.number },
        };

        const result = await vapi.post("/call", body);
        retried.push({
          originalCallId: call.id,
          originalReason: reason,
          customerNumber: call.customer.number,
          newCallId: result.id,
          status: result.status || "created",
        });
      }

      return {
        checkedCalls: calls.length,
        retriedCalls: retried.length,
        retries: retried,
      };
    }

    // Call history by phone number
    case "lookup_call_history": {
      const limit = args.limit || 10;
      const allCalls = await vapi.get(`/call?limit=100`);
      if (!Array.isArray(allCalls)) return allCalls;

      const matches = allCalls
        .filter((c) => c.customer?.number === args.phoneNumber)
        .slice(0, limit)
        .map((c) => ({
          id: c.id,
          type: c.type,
          status: c.status,
          endedReason: c.endedReason,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          transcript: c.transcript,
          summary: c.analysis?.summary,
          taskCompleted: c.analysis?.successEvaluation,
          structuredData: c.analysis?.structuredData,
        }));

      return {
        phoneNumber: args.phoneNumber,
        totalCalls: matches.length,
        calls: matches,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── MCP Streamable HTTP endpoint ─────────────────────────────────────────────
const app = express();
app.use(express.json());

app.post("/mcp", authenticate, async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  let result;

  switch (method) {
    case "initialize":
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "vapi-full-mcp", version: "1.0.0" },
      };
      break;

    case "notifications/initialized":
      res.status(204).end();
      return;

    case "tools/list":
      result = { tools: TOOLS };
      break;

    case "tools/call": {
      try {
        const data = await executeTool(params.name, params.arguments || {});
        result = {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        result = {
          content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
      break;
    }

    default:
      result = {
        error: { code: -32601, message: `Unknown method: ${method}` },
      };
  }

  const response = { jsonrpc: "2.0", id, result };
  res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
  res.end();
});

app.get("/mcp", authenticate, (req, res) => {
  res.status(405).json({ error: "Use POST for MCP requests" });
});

app.delete("/mcp", authenticate, (req, res) => {
  res.status(204).end();
});

// ── Vapi function tool endpoint (called by Lance during inbound calls) ───────
app.post("/api/caller-context", async (req, res) => {
  try {
    const callerNumber = req.body?.message?.customer?.number
      || req.body?.message?.call?.customer?.number
      || req.body?.call?.customer?.number;

    if (!callerNumber) {
      return res.json({ results: [{ result: "No caller number available." }] });
    }

    const allCalls = await vapi.get("/call?limit=100");
    if (!Array.isArray(allCalls)) {
      return res.json({ results: [{ result: "Could not fetch call history." }] });
    }

    const history = allCalls
      .filter((c) => c.customer?.number === callerNumber && c.transcript)
      .slice(0, 5)
      .map((c) => ({
        date: c.startedAt,
        type: c.type,
        summary: c.analysis?.summary || "No summary",
        taskCompleted: c.analysis?.successEvaluation,
      }));

    if (history.length === 0) {
      return res.json({
        results: [{ result: `No previous calls found with ${callerNumber}. This is a new caller.` }],
      });
    }

    const context = history
      .map((h, i) => `Call ${i + 1} (${h.date}): ${h.summary}`)
      .join("\n");

    return res.json({
      results: [{
        result: `Found ${history.length} previous call(s) with ${callerNumber}:\n${context}`,
      }],
    });
  } catch (err) {
    return res.json({ results: [{ result: `Error looking up history: ${err.message}` }] });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", tools: TOOLS.length });
});

app.listen(PORT, () => {
  console.log(`Vapi Full MCP server running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
});
