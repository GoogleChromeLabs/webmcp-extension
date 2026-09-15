/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DownloadProgress,
  getSpotlightFence,
  isPromptApiSupported,
  isToolUseSupported,
  resetOnDeviceChat,
  sendOnDeviceChat,
  setOnDeviceModelUi,
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

interface StubSession extends EventTarget {
  contextUsage: number;
  contextWindow: number;
  promptStreaming: (input: unknown, options?: { signal?: AbortSignal }) => ReadableStream<unknown>;
  destroy: () => void;
}

interface Stub {
  creates: Array<Record<string, unknown>>;
  inputs: unknown[];
  sessions: StubSession[];
  destroyed: number;
  availability: string;
  /** How many tokens of context each prompt takes up. */
  usagePerTurn: number;
  /** The prompt, counted from 1, during which the context overflows. */
  overflowOnTurn: number;
}

/**
 * Stands in for the browser's Prompt API: every turn of `script` is what one
 * promptStreaming() call streams back. A turn that is `null` never ends, until
 * it is aborted.
 */
function installPromptApiStub(script: Array<StubTurn | null>): Stub {
  const stub: Stub = { creates: [], inputs: [], sessions: [], destroyed: 0, availability: 'available', usagePerTurn: 0, overflowOnTurn: 0 };
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
    availability: async () => stub.availability,
    create: async (options: Record<string, unknown>) => {
      // A snapshot: the wrapper goes on to keep its history in the same array.
      const initialPrompts = options.initialPrompts as unknown[] | undefined;
      stub.creates.push({ ...options, ...(initialPrompts && { initialPrompts: [...initialPrompts] }) });
      const monitor = new EventTarget();
      (options.monitor as ((m: EventTarget) => void) | undefined)?.(monitor);
      if (stub.availability !== 'available') {
        for (const loaded of [0, 0.5, 1]) {
          monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded, total: 1 }));
        }
      }

      const session = Object.assign(new EventTarget(), {
        contextUsage: 0,
        contextWindow: 1000,
        destroy() {
          stub.destroyed++;
        },
        promptStreaming(input: unknown, { signal }: { signal?: AbortSignal } = {}) {
          stub.inputs.push(input);
          session.contextUsage += stub.usagePerTurn;
          if (++turn === stub.overflowOnTurn) session.dispatchEvent(new Event('contextoverflow'));
          const chunks = script[turn - 1];
          if (chunks === null) {
            return new ReadableStream({
              start(controller) {
                signal?.addEventListener('abort', () => controller.error(signal.reason));
              },
            });
          }
          return new ReadableStream({
            start(controller) {
              for (const chunk of chunks ?? ['']) controller.enqueue(chunk);
              controller.close();
            },
          });
        },
      });
      stub.sessions.push(session);
      return session;
    },
  };

  return stub;
}

function uninstallPromptApiStub() {
  resetOnDeviceChat();
  setOnDeviceModelUi();
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals.LanguageModel;
  delete globals.LanguageModelToolCall;
  delete globals.LanguageModelToolSuccess;
  delete globals.LanguageModelToolError;
  delete globals.Summarizer;
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

type ResponseTurn = Array<{
  role: string;
  content: Array<{ type: string; value: Record<string, unknown> }>;
}>;

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
    // server backend. Tool use needs the tool content types, which the wrapper
    // adds.
    const created = stub.creates[0] as {
      tools?: Array<Record<string, unknown>>;
      expectedOutputs?: Array<{ type: string }>;
    };
    assert.deepEqual(
      created.tools?.map((tool) => tool.name),
      ['_0_book_table']
    );
    assert.deepEqual(created.tools?.[0].inputSchema, {
      type: 'object',
      properties: { partySize: { type: 'number' } },
    });
    // The model is shown declarations only: execute() stays on this side.
    assert.equal(created.tools?.[0].execute, undefined);
    assert.ok(created.expectedOutputs?.some((expected) => expected.type === 'tool-call'));

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
      'Booking. ',
      { type: 'tool-call', value: { callID: 'c1', name: '_0_book_table', arguments: { partySize: 2 } } },
      { type: 'tool-call', value: { callID: 'c2', name: '_0_book_table', arguments: { partySize: 4 } } },
    ],
    ['Booked ', 'your table.'],
  ]);

  try {
    const tools = buildToolDecls([BOOK_TOOL]);
    const first = await sendOnDeviceChat({ message: 'Book two tables', tools });
    assert.equal(first.text, 'Booking. ');
    assert.equal(first.functionCalls?.length, 2);

    const second = await sendOnDeviceChat({
      chatId: first.chatId,
      tools,
      toolResponses: [
        { functionResponse: { name: '_0_book_table', response: { result: { total: 22, note: null } } } },
        { functionResponse: { name: '_0_book_table', response: { error: 'User denied permission' } } },
      ],
    });

    const [message] = stub.inputs[1] as ResponseTurn;
    assert.equal(message.role, 'user');
    assert.deepEqual(
      message.content.map((part) => [part.type, part.value.callID, part.value.kind]),
      [
        ['tool-response', 'c1', 'success'],
        ['tool-response', 'c2', 'error'],
      ]
    );
    // The wrapper picks the result type from the value, and strips the nulls
    // the Prompt API rejects.
    assert.deepEqual(message.content[0].value.result, [{ type: 'object', value: { total: 22 } }]);
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

test('a call the wrapper refuses never reaches the agent loop', async () => {
  const stub = installPromptApiStub([
    [{ type: 'tool-call', value: { callID: 'c1', name: '_0_invented_tool', arguments: {} } }],
    ['There is no such tool.'],
  ]);
  const warn = console.warn;
  console.warn = () => {};

  try {
    const result = await sendOnDeviceChat({ message: 'Do something', tools: buildToolDecls([BOOK_TOOL]) });
    assert.equal(result.text, 'There is no such tool.');
    assert.deepEqual(result.functionCalls, []);

    const [message] = stub.inputs[1] as ResponseTurn;
    assert.equal(message.content[0].value.kind, 'error');
  } finally {
    console.warn = warn;
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

test('a turn stopped while a tool call is in flight leaves no dangling call behind', async () => {
  const stub = installPromptApiStub([
    ['Booked.'],
    [{ type: 'tool-call', value: { callID: 'c1', name: '_0_book_table', arguments: {} } }],
    ['Hello again.'],
  ]);

  try {
    const tools = buildToolDecls([BOOK_TOOL]);
    const first = await sendOnDeviceChat({ message: 'Book a table', tools });

    const controller = new AbortController();
    await sendOnDeviceChat({ chatId: first.chatId, message: 'Book another', tools }, { signal: controller.signal });
    controller.abort();

    const third = await sendOnDeviceChat({ chatId: first.chatId, message: 'Hello', tools });
    assert.equal(third.text, 'Hello again.');

    // The model of the stopped turn is still waiting on its call, so the next
    // message goes to a new session, without the turn that never finished.
    assert.equal(stub.creates.length, 2);
    const rebuilt = stub.creates[1] as { initialPrompts?: Array<{ role: string; content: string }> };
    assert.deepEqual(
      rebuilt.initialPrompts?.slice(1).map((prompt) => prompt.content),
      ['Book a table', 'Booked.']
    );
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

  const stub = installPromptApiStub([['unused']]);
  const globals = globalThis as unknown as Record<string, unknown>;
  delete globals.LanguageModelToolCall;
  try {
    await assert.rejects(
      () => sendOnDeviceChat({ message: 'Hello', tools: buildToolDecls([BOOK_TOOL]) }),
      /prompt-api-tool-use/
    );

    stub.availability = 'unavailable';
    await assert.rejects(
      () => sendOnDeviceChat({ message: 'Hello', tools: [] }),
      /unavailable on this device/
    );
  } finally {
    uninstallPromptApiStub();
  }
});

test('the model download is reported to the side panel', async () => {
  const stub = installPromptApiStub([['Hello.']]);
  stub.availability = 'downloadable';
  const reported: DownloadProgress[] = [];
  setOnDeviceModelUi({ onDownloadProgress: (progress) => reported.push(progress) });

  try {
    await sendOnDeviceChat({ message: 'Hello', tools: [] });
    assert.deepEqual(
      reported.map(({ resource, percent }) => [resource, percent]),
      [
        ['language-model', 0],
        ['language-model', 50],
        ['language-model', 100],
      ]
    );
  } finally {
    uninstallPromptApiStub();
  }
});

/**
 * Stands in for the Summarizer API, which compacting uses. When `downloadable`,
 * creating one reports a download first.
 */
function installSummarizerStub(summarize: (text: string) => Promise<string>, { downloadable = false } = {}) {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.Summarizer = {
    availability: async () => (downloadable ? 'downloadable' : 'available'),
    create: async (options: { monitor?: (m: EventTarget) => void }) => {
      const monitor = new EventTarget();
      options.monitor?.(monitor);
      if (downloadable) {
        for (const loaded of [0, 0.5, 1]) {
          monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded, total: 1 }));
        }
      }
      return { summarize, destroy() {} };
    },
  };
}

test('a conversation that overflows the context is compacted before the next turn', async () => {
  const stub = installPromptApiStub([['A long answer about booking.'], ['Another long answer.'], ['Done.']]);
  // Nearly full after the first turn, which is no reason to compact yet.
  stub.usagePerTurn = 900;
  stub.overflowOnTurn = 2;
  const summarized: string[] = [];
  installSummarizerStub(async (text) => {
    summarized.push(text);
    return 'Short.';
  });
  const compacting: Array<string | null> = [];
  setOnDeviceModelUi({ onCompacting: (status) => compacting.push(status) });
  const info = console.info;
  console.info = () => {};

  try {
    const first = await sendOnDeviceChat({ message: 'Tell me all about booking', tools: [] });
    assert.deepEqual(compacting, []);

    await sendOnDeviceChat({ chatId: first.chatId, message: 'Tell me even more', tools: [] });
    // The turn that overflowed starts compacting once it has ended.
    assert.equal(compacting[0], 'Compacting the conversation…');

    const third = await sendOnDeviceChat({ chatId: first.chatId, message: 'Thanks', tools: [] });
    assert.equal(third.text, 'Done.');
    // The side panel follows along message by message, since the next turn
    // waits, and hears when it is done. The system prompt is kept as it is.
    assert.deepEqual(compacting, [
      'Compacting the conversation…',
      'Compacting message 2 of 5…',
      'Compacting message 3 of 5…',
      'Compacting message 4 of 5…',
      'Compacting message 5 of 5…',
      null,
    ]);

    // The conversation was summarized into a new session, which answered the
    // next turn.
    assert.deepEqual(summarized, [
      'Tell me all about booking',
      'A long answer about booking.',
      'Tell me even more',
      'Another long answer.',
    ]);
    assert.equal(stub.creates.length, 2);
    const compacted = stub.creates[1] as { initialPrompts?: Array<{ role: string; content: string }> };
    assert.deepEqual(
      compacted.initialPrompts?.slice(1).map((prompt) => [prompt.role, prompt.content]),
      [
        ['user', 'Short.'],
        ['assistant', 'Short.'],
        ['user', 'Short.'],
        ['assistant', 'Short.'],
      ]
    );
    assert.equal(stub.inputs.length, 3);
    assert.equal(stub.sessions[1].contextUsage, stub.usagePerTurn);
  } finally {
    console.info = info;
    uninstallPromptApiStub();
  }
});

test('the models compacting needs are reported as they download', async () => {
  const stub = installPromptApiStub([['An answer long enough to be summarized.'], ['Done.']]);
  stub.overflowOnTurn = 1;
  installSummarizerStub(async () => 'Short.', { downloadable: true });
  const reported: DownloadProgress[] = [];
  setOnDeviceModelUi({ onDownloadProgress: (progress) => reported.push(progress) });
  const info = console.info;
  console.info = () => {};

  try {
    const first = await sendOnDeviceChat({ message: 'A question long enough to be summarized', tools: [] });
    await sendOnDeviceChat({ chatId: first.chatId, message: 'Go on', tools: [] });
    assert.deepEqual(
      reported.map(({ resource, percent }) => [resource, percent]),
      [
        ['summarizer', 0],
        ['summarizer', 50],
        ['summarizer', 100],
      ]
    );
  } finally {
    console.info = info;
    uninstallPromptApiStub();
  }
});

test('starting a new chat while compacting is no failure', async () => {
  const stub = installPromptApiStub([['An answer long enough to be summarized.'], ['Hello.']]);
  stub.overflowOnTurn = 1;
  let release = () => {};
  installSummarizerStub(
    () =>
      new Promise((resolve) => {
        release = () => resolve('Short.');
      })
  );
  const warnings: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);

  try {
    await sendOnDeviceChat({ message: 'A question long enough to be summarized', tools: [] });
    // Let compacting reach the Summarizer.
    await new Promise((resolve) => setTimeout(resolve, 10));
    resetOnDeviceChat();
    release();

    const fresh = await sendOnDeviceChat({ message: 'Hello', tools: [] });
    assert.equal(fresh.text, 'Hello.');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(warnings, []);
    // The session compacting made belongs to no conversation, and is not left
    // behind: every session but the fresh one is destroyed.
    assert.equal(stub.destroyed, stub.creates.length - 1);
  } finally {
    console.warn = warn;
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

/** Makes the next promptStreaming() calls of every session throw a crash. */
function crashTurns(shouldCrash: (turn: number) => boolean) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const model = globals.LanguageModel as { create: (o: unknown) => Promise<unknown> };
  const create = model.create.bind(model);
  let turns = 0;
  model.create = async (options: unknown) => {
    const session = (await create(options)) as StubSession;
    const promptStreaming = session.promptStreaming.bind(session);
    session.promptStreaming = (input, streamOptions) => {
      if (shouldCrash(++turns)) throw new Error('UnknownError: An unknown error occurred: kErrorUnknown');
      return promptStreaming(input, streamOptions);
    };
    return session;
  };
}

test('a crashed model service is retried once on a fresh session', async () => {
  // The failing turn throws before it reaches the stub, so it consumes no turn.
  const stub = installPromptApiStub([['Booked.'], ['Recovered.']]);
  crashTurns((turn) => turn === 2);

  try {
    const tools = buildToolDecls([BOOK_TOOL]);
    const first = await sendOnDeviceChat({ message: 'Book a table', tools });
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
  crashTurns((turn) => turn > 1);

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
