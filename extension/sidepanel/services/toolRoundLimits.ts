/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserFacingError } from '../types/index.js';

/**
 * How many rounds of tool calls one request may take. A round is one reply
 * from the model that asks for tools, however many it asks for at once.
 */
export interface ToolRoundLimits {
  /** After this many rounds, the agent asks the user once whether it may go on. */
  readonly askAfter: number;
  /** The most rounds one request may take. There the agent stops and says so. */
  readonly max: number;
}

export const DEFAULT_TOOL_ROUND_LIMITS: ToolRoundLimits = Object.freeze({ askAfter: 10, max: 100 });

/**
 * A request that used up its rounds of tool calls. The agent loop counts them,
 * and so does the on-device model, against the same `max`. Whichever gets
 * there first ends the request with this.
 */
export class ToolRoundLimitError extends UserFacingError {
  constructor(max: number) {
    super(
      `The agent stopped after using tools ${max} times, the most allowed for one request. Try asking again, or split the task into smaller steps.`
    );
    this.name = 'ToolRoundLimitError';
  }
}
