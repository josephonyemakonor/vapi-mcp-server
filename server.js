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
        phoneNumberId: { type: "string", description: "Phone number ID to call from (default: 9d3011b9-ac34-44f8-b7f8-235581752106)" },
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
      const body = {
        assistantId: args.assistantId || "903d4d91-9735-4b6e-8f95-3d1283dd0e61",
        phoneNumberId: args.phoneNumberId || "9d3011b9-ac34-44f8-b7f8-235581752106",
        customer: { number: args.customerNumber },
      };
      if (args.scheduledAt) body.scheduledAt = args.scheduledAt;
      if (args.task || args.taskIntro) {
        body.assistantOverrides = {
          variableValues: {
            task: args.task || "Help the person with whatever they need.",
            task_intro: args.taskIntro || "I was hoping you could help me with something.",
          },
        };
      }
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

app.get("/health", (req, res) => {
  res.json({ status: "ok", tools: TOOLS.length });
});

app.listen(PORT, () => {
  console.log(`Vapi Full MCP server running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
});
