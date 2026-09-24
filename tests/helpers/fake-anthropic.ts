import type Anthropic from "@anthropic-ai/sdk";

/** A stand-in Anthropic client: returns queued parsed outputs and records requests. No network, no cost. */
export function fakeAnthropic(outputs: unknown[]) {
  const calls: { model: string; system: unknown; content: unknown }[] = [];
  const client = {
    messages: {
      parse: async (req: { model: string; system: unknown; messages: { content: unknown }[] }) => {
        calls.push({ model: req.model, system: req.system, content: req.messages[0].content });
        const next = outputs.shift();
        if (next === undefined) throw new Error("fakeAnthropic: no more outputs queued");
        return {
          parsed_output: next,
          stop_reason: "end_turn",
          stop_details: null,
          content: [],
          usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: null },
        };
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

type FakeTurn = { text?: string; tools?: { name: string; input: unknown }[] };

/** A stand-in for tool-use calls (messages.create): each turn returns text and/or tool calls. Records requests. */
export function fakeAgent(turns: FakeTurn[]) {
  const requests: { messages: unknown[]; tools: { name: string }[] }[] = [];
  let n = 0;
  const client = {
    messages: {
      create: async (req: { messages: unknown[]; tools: { name: string }[] }) => {
        requests.push({ messages: JSON.parse(JSON.stringify(req.messages)), tools: req.tools });
        const t = turns.shift();
        if (!t) throw new Error("fakeAgent: no more turns queued");
        const content = [
          ...(t.text ? [{ type: "text", text: t.text }] : []),
          ...(t.tools ?? []).map(x => ({ type: "tool_use", id: `tu_${++n}`, name: x.name, input: x.input })),
        ];
        return { content, stop_reason: t.tools?.length ? "tool_use" : "end_turn", usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: null } };
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}
