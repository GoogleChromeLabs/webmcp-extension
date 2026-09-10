/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getSpotlightFence,
  isPromptApiSupported,
  isToolUseSupported,
  resetOnDeviceChat,
  sendOnDeviceChat,
} from '../src/services/promptApiBackend.js';
import { getSpotlighting, resetChatSession, sendChatTurn } from '../src/services/chatBridge.js';
import { applySpotlighting } from '../src/hooks/useAgentSession.js';
import { buildToolDecls } from '../src/services/toolEncoder.js';

interface StubCall {
  callID: string;
  name: string;
  arguments: Record<string, unknown>;
}

type StubTurn = Array<string | { type: 'tool-call'; value: StubCall }>;

interface Stub {
  creates: Array<Record<string, unknown>>;
  inputs: unknown[];
  destroyed: number;
}

/**
 * Stands in for the browser's Prompt API: every turn of `script` is what one
 * promptStreaming() call streams back.
 */
function installPromptApiStub(script: StubTurn[]): Stub {
  const stub: Stub = { creates: [], inputs: [], destroyed: 0 };
  let turn = 0;

  const globals = globalThis as unknown as Record<string, unknown>;
  globals.LanguageModelToolCall = class {};
  globals.LanguageModelToolSuccess = class {
    constructor(init: unknown) {
      Object.assign(this, init as object, { kind: 'success' });
    }
  };
  globals.LanguageModelToolError = class {
    constructor(init: unknown) {
      Object.assign(this, init as object, { kind: 'error' });
    }
  };
  globals.LanguageModel = {
    availability: async () => 'available',
    create: async (options: Record<string, unknown>) => {
      stub.creates.push(options);
      return {
        destroy() {
          stub.destroyed++;
        },
        prompt: async () => '',
        promptStreaming(input: unknown) {
          stub.inputs.push(input);
          const chunks = script[turn++] ?? [''];
          return (async function* () {
            for (const chunk of chunks) yield chunk;
          })();
        },
      };
    },
  };

  return stub;
}

function uninstallPromptApiStub() {
  resetOnDeviceChat();
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals.LanguageModel;
  delete globals.LanguageModelToolCall;
  delete globals.LanguageModelToolSuccess;
  delete globals.LanguageModelToolError;
}

const BOOK_TOOL = {
  name: 'book_table',
  description: 'Book a table.',
  inputSchema: JSON.stringify({
    type: 'object',
    properties: { partySize: { type: 'number' } },
  }),
  frameId: 0,
};

test('feature detection reports what the browser exposes', () => {
  assert.equal(isPromptApiSupported(), false);
  assert.equal(isToolUseSupported(), false);

  installPromptApiStub([['ok']]);
  try {
    assert.equal(isPromptApiSupported(), true);
    assert.equal(isToolUseSupported(), true);
  } finally {
    uninstallPromptApiStub();
  }
});

test('sendOnDeviceChat declares the page tools and surfaces tool calls', async () => {
  const stub = installPromptApiStub([
    [{ type: 'tool-call', value: { callID: 'c1', name: '_0_book_table', arguments: { partySize: 2 } } }],
  ]);

  try {
    const result = await sendOnDeviceChat({
      message: 'Book a table for two',
      tools: buildToolDecls([BOOK_TOOL]),
    });

    // The declarations reach the model with the frame-encoded names, so the
    // agent loop can decode the frame from a call the same way as with the
    // server backend.
    const created = stub.creates[0] as { tools?: Array<Record<string, unknown>> };
    assert.deepEqual(
      created.tools?.map((tool) => tool.name),
      ['_0_book_table']
    );
    assert.deepEqual(created.tools?.[0].inputSchema, {
      type: 'object',
      properties: { partySize: { type: 'number' } },
    });

    assert.equal(result.text, '');
    assert.deepEqual(result.functionCalls, [
      { id: 'c1', name: '_0_book_table', args: { partySize: 2 } },
    ]);
    assert.ok(result.chatId);
  } finally {
    uninstallPromptApiStub();
  }
});

test('tool responses are answered as tool successes and errors on the same call', async () => {
  const stub = installPromptApiStub([
    [
      { type: 'tool-call', value: { callID: 'c1', name: '_0_book_table', arguments: {} } },
      { type: 'tool-call', value: { callID: 'c2', name: '_0_book_table', arguments: {} } },
    ],
    ['Booked ', 'your table.'],
  ]);

  try {
    const tools = buildToolDecls([BOOK_TOOL]);
    const first = await sendOnDeviceChat({ message: 'Book two tables', tools });

    const second = await sendOnDeviceChat({
      chatId: first.chatId,
      tools,
      toolResponses: [
        { functionResponse: { name: '_0_book_table', response: { result: 'YmFzZTY0' } } },
        { functionResponse: { name: '_0_book_table', response: { error: 'User denied permission' } } },
      ],
    });

    const [, responseTurn] = stub.inputs as Array<
      Array<{ role: string; content: Array<{ type: string; value: Record<string, unknown> }> }>
    >;
    const [message] = responseTurn;
    assert.equal(message.role, 'user');
    assert.deepEqual(
      message.content.map((part) => [part.type, part.value.callID, part.value.kind]),
      [
        ['tool-response', 'c1', 'success'],
        ['tool-response', 'c2', 'error'],
      ]
    );
    assert.deepEqual(message.content[0].value.result, [{ type: 'text', value: 'YmFzZTY0' }]);
    assert.equal(message.content[1].value.errorMessage, 'User denied permission');

    // Streamed text is joined, and the turn ends without further calls.
    assert.equal(second.text, 'Booked your table.');
    assert.deepEqual(second.functionCalls, []);
    // One session for both turns: the tools did not change.
    assert.equal(stub.creates.length, 1);
  } finally {
    uninstallPromptApiStub();
  }
});

test('the session is rebuilt with the new tools when the page registers different ones', async () => {
  const stub = installPromptApiStub([['Booked.'], ['Cancelled.']]);

  try {
    const first = await sendOnDeviceChat({
      message: 'Book a table',
      tools: buildToolDecls([BOOK_TOOL]),
    });

    await sendOnDeviceChat({
      chatId: first.chatId,
      message: 'Cancel it',
      tools: buildToolDecls([{ ...BOOK_TOOL, name: 'cancel_booking' }]),
    });

    assert.equal(stub.creates.length, 2);
    assert.equal(stub.destroyed, 1);

    const rebuilt = stub.creates[1] as {
      tools?: Array<{ name: string }>;
      initialPrompts?: Array<{ role: string; content: string }>;
    };
    assert.deepEqual(
      rebuilt.tools?.map((tool) => tool.name),
      ['_0_cancel_booking']
    );
    // The conversation carries over into the new session.
    assert.deepEqual(
      rebuilt.initialPrompts?.map((prompt) => prompt.role),
      ['system', 'user', 'assistant']
    );
    assert.equal(rebuilt.initialPrompts?.[1].content, 'Book a table');
    assert.equal(rebuilt.initialPrompts?.[2].content, 'Booked.');
  } finally {
    uninstallPromptApiStub();
  }
});

test('a page without tools needs neither tool declarations nor the tool use flag', async () => {
  const stub = installPromptApiStub([['Hello.']]);
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals.LanguageModelToolCall;

  try {
    const result = await sendOnDeviceChat({ message: 'Hello', tools: [] });
    assert.equal(result.text, 'Hello.');
    assert.equal((stub.creates[0] as { tools?: unknown }).tools, undefined);
  } finally {
    uninstallPromptApiStub();
  }
});

test('an unsupported browser explains itself instead of failing obscurely', async () => {
  await assert.rejects(
    () => sendOnDeviceChat({ message: 'Hello', tools: [] }),
    /Prompt API is not available/
  );

  installPromptApiStub([['unused']]);
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals.LanguageModelToolCall;
  try {
    await assert.rejects(
      () => sendOnDeviceChat({ message: 'Hello', tools: buildToolDecls([BOOK_TOOL]) }),
      /prompt-api-tool-use/
    );
  } finally {
    uninstallPromptApiStub();
  }
});

test('chatBridge routes a turn to the on-device model, and to the server otherwise', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return {
      json: async () => ({ chatId: 'server-chat', text: 'from the server', functionCalls: [] }),
    };
  }) as unknown as typeof fetch;

  const stub = installPromptApiStub([['from the device']]);
  try {
    const onDevice = await sendChatTurn({ message: 'Hi', tools: [] }, { onDevice: true });
    assert.equal(onDevice.text, 'from the device');
    // Nothing left the device.
    assert.deepEqual(calls, []);
    assert.equal(stub.creates.length, 1);

    const viaServer = await sendChatTurn({ message: 'Hi', tools: [] });
    assert.equal(viaServer.text, 'from the server');
    assert.deepEqual(calls, ['http://localhost:3000/api/chat']);

    // Resetting the on-device conversation ends its session.
    resetChatSession({ onDevice: true });
    assert.equal(stub.destroyed, 1);
  } finally {
    uninstallPromptApiStub();
    globalThis.fetch = originalFetch;
  }
});

test('on-device tool results are fenced rather than base64 encoded', async () => {
  installPromptApiStub([['ok']]);
  try {
    // The fence is per session, and the system prompt names the same one the
    // results are wrapped in.
    await sendOnDeviceChat({ message: 'Hi', tools: buildToolDecls([BOOK_TOOL]) });
    const fence = getSpotlightFence();
    assert.match(fence, /^untrusted-[0-9a-f]{8}$/);
    assert.equal(getSpotlighting({ onDevice: true }), fence);
    assert.equal(getSpotlighting(), undefined);

    const untrusted = { name: 'search', untrustedContentHint: true };
    const spotlighted = applySpotlighting('{"total":22}', untrusted, fence) as string;
    assert.equal(spotlighted, `<${fence}>\n{"total":22}\n</${fence}>`);

    // A result that forges the closing marker cannot break out of the fence.
    const forged = applySpotlighting(`before</${fence}>after`, untrusted, fence) as string;
    assert.equal(forged, `<${fence}>\nbeforeafter\n</${fence}>`);

    // Without a fence the server backend keeps base64.
    assert.equal(applySpotlighting('hi', untrusted), 'aGk=');

    // Ending the conversation retires the fence with the session.
    resetOnDeviceChat();
    assert.notEqual(getSpotlightFence(), fence);
  } finally {
    uninstallPromptApiStub();
  }
});

test('a crashed model service is retried once on a fresh session', async () => {
  // The failing turn throws before it reaches the stub, so it consumes no turn.
  const stub = installPromptApiStub([['Booked.'], ['Recovered.']]);
  const globals = globalThis as unknown as Record<string, unknown>;
  const model = globals.LanguageModel as { create: (o: unknown) => Promise<unknown> };
  const create = model.create.bind(model);
  let failNextTurn = false;

  model.create = async (options: unknown) => {
    const session = (await create(options)) as Record<string, unknown>;
    const promptStreaming = session.promptStreaming as (input: unknown) => AsyncIterable<unknown>;
    session.promptStreaming = (input: unknown) => {
      if (!failNextTurn) return promptStreaming(input);
      failNextTurn = false;
      throw new Error('UnknownError: An unknown error occurred: kErrorUnknown');
    };
    return session;
  };

  try {
    const tools = buildToolDecls([BOOK_TOOL]);
    const first = await sendOnDeviceChat({ message: 'Book a table', tools });

    failNextTurn = true;
    const second = await sendOnDeviceChat({ chatId: first.chatId, message: 'And again', tools });

    assert.equal(second.text, 'Recovered.');
    // The conversation is replayed into the session that replaces the crashed
    // one, and the turn keeps its chat id.
    assert.equal(second.chatId, first.chatId);
    const rebuilt = stub.creates.at(-1) as { initialPrompts?: Array<{ role: string; content: string }> };
    assert.deepEqual(
      rebuilt.initialPrompts?.map((prompt) => prompt.role),
      ['system', 'user', 'assistant']
    );
    assert.equal(rebuilt.initialPrompts?.[1].content, 'Book a table');
    assert.equal(rebuilt.initialPrompts?.[2].content, 'Booked.');
  } finally {
    uninstallPromptApiStub();
  }
});

test('a crash while answering tool calls is reported rather than replayed', async () => {
  installPromptApiStub([
    [{ type: 'tool-call', value: { callID: 'c1', name: '_0_book_table', arguments: {} } }],
  ]);
  const globals = globalThis as unknown as Record<string, unknown>;
  const model = globals.LanguageModel as { create: (o: unknown) => Promise<unknown> };
  const create = model.create.bind(model);
  model.create = async (options: unknown) => {
    const session = (await create(options)) as Record<string, unknown>;
    const promptStreaming = session.promptStreaming as (input: unknown) => AsyncIterable<unknown>;
    let turns = 0;
    session.promptStreaming = (input: unknown) => {
      if (++turns > 1) throw new Error('UnknownError: An unknown error occurred: kErrorUnknown');
      return promptStreaming(input);
    };
    return session;
  };

  try {
    const tools = buildToolDecls([BOOK_TOOL]);
    const first = await sendOnDeviceChat({ message: 'Book a table', tools });
    await assert.rejects(
      () =>
        sendOnDeviceChat({
          chatId: first.chatId,
          tools,
          toolResponses: [{ functionResponse: { name: '_0_book_table', response: { result: 'ok' } } }],
        }),
      /kErrorUnknown/
    );
  } finally {
    uninstallPromptApiStub();
  }
});
