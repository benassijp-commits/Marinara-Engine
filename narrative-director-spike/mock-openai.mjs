import { createServer } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const logPath = resolve(root, "evidence", "provider-requests.jsonl");
const port = Number(process.env.MOCK_PORT || 18081);
const PRIVATE_MARKER = "SPIKE_PRIVATE_ORCHID_731";
const FILTERED_DIRECTION = "Faça surgir uma chave de latão discreta, sem explicar sua origem.";

await mkdir(dirname(logPath), { recursive: true });

function responseFor(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt = messages.map((message) => `${message.role}: ${message.content ?? ""}`).join("\n\n");
  const isTracker =
    prompt.includes("<agents>") && prompt.includes("current_stage") && prompt.includes("revealed_events");
  const isDirector = prompt.includes(PRIVATE_MARKER);

  const batchTypes = Array.from(prompt.matchAll(/<agent_task id="([^"]+)"/g), (match) => match[1]);
  if (batchTypes.length > 1) {
    return JSON.stringify(
      Object.fromEntries(
        batchTypes.map((type) => [
          type,
          type === "spike-filtered-director" ? FILTERED_DIRECTION : "BATCH_PROBE_OK",
        ]),
      ),
    );
  }

  if (isDirector) return FILTERED_DIRECTION;
  if (isTracker) {
    return JSON.stringify({
      fields: [
        { name: "current_stage", value: "key_discovered" },
        { name: "revealed_events", value: "brass_key_appeared" },
      ],
    });
  }
  return "Uma pequena chave de latão aparece junto à soleira, refletindo a luz por um instante.";
}

function writeJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/v1/models" || req.url === "/models")) {
    return writeJson(res, 200, { object: "list", data: [{ id: "spike-model", object: "model" }] });
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    return writeJson(res, 404, { error: { message: "Not found" } });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const content = responseFor(body);
  await appendFile(
    logPath,
    `${JSON.stringify({ at: new Date().toISOString(), url: req.url, body, response: content })}\n`,
    "utf8",
  );

  if (body.stream === true) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(
      `data: ${JSON.stringify({ id: "spike", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ id: "spike", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
    return;
  }

  writeJson(res, 200, {
    id: "spike",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`mock-openai listening on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
