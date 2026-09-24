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
