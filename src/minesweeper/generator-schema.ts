const string = { type: "string" };
function record(properties: Record<string, unknown>): unknown {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
export const generatorSchema = record({
  title: string,
  intent: string,
  initial: record({
    prompt: string,
    displayed: string,
    clean: string,
    intended: string,
    explanation: string,
  }),
  followup: record({ prompt: string, answer: string, explanation: string }),
  mutation: {
    anyOf: [
      { type: "null" },
      record({
        path: string,
        line: { type: "integer" },
        clean: string,
        replacement: string,
        category: string,
        trigger: string,
        expected: string,
        explanation: string,
        evidence: string,
      }),
    ],
  },
  clue: { anyOf: [string, { type: "null" }] },
});
