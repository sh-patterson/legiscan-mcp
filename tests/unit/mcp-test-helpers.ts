import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { createServer } from "../../src/server.js";

export function createLinkedTransportPair(): [Transport, Transport] {
  let onMessageA: Transport["onmessage"];
  let onMessageB: Transport["onmessage"];

  const transportA: Transport = {
    async start() {},
    async send(message: JSONRPCMessage) {
      onMessageB?.(message);
    },
    async close() {
      transportA.onclose?.();
    },
    set onmessage(handler) {
      onMessageA = handler;
    },
    get onmessage() {
      return onMessageA;
    },
  };

  const transportB: Transport = {
    async start() {},
    async send(message: JSONRPCMessage) {
      onMessageA?.(message);
    },
    async close() {
      transportB.onclose?.();
    },
    set onmessage(handler) {
      onMessageB = handler;
    },
    get onmessage() {
      return onMessageB;
    },
  };

  return [transportA, transportB];
}

export async function createConnectedClient(
  apiKey = "fake-api-key-for-testing"
): Promise<Client> {
  const server = createServer(apiKey);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = createLinkedTransportPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return client;
}

export function getTextContent(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> })
    .content;
  if (!Array.isArray(content)) {
    throw new Error("Expected tool result content");
  }

  const textContent = content.find(
    (item): item is { type: string; text: string } => item.type === "text" && !!item.text
  );

  if (!textContent) {
    throw new Error("Expected text tool content");
  }

  return textContent.text;
}

export function parseToolJson(result: unknown) {
  return JSON.parse(getTextContent(result));
}
