/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { WebMCPTool, ActivityEntry } from '../types/index.js';

export interface ToolsInspectorScreenProps {
  tools?: WebMCPTool[];
  activityLog?: ActivityEntry[];
  domain?: string;
  onBackToChat?: () => void;
  onClearActivity?: () => void;
  onExecuteTool: (name: string, inputArgs: string, location?: string) => Promise<unknown>;
}

type ExecutionResultState =
  | string
  | { success: true; data: unknown }
  | { success: false; error: string }
  | null;

/**
 * ToolsInspectorScreen Component
 * Provides full inspection of WebMCP registered tools, activity history, and manual tool execution.
 */
export function ToolsInspectorScreen({
  tools = [],
  activityLog = [],
  domain = '',
  onBackToChat,
  onClearActivity,
  onExecuteTool,
}: ToolsInspectorScreenProps) {
  const [selectedToolName, setSelectedToolName] = useState<string>('');
  const [inputArgs, setInputArgs] = useState<string>('{}');
  const [executionResult, setExecutionResult] = useState<ExecutionResultState>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [copySuccessMsg, setCopySuccessMsg] = useState<string>('');

  useEffect(() => {
    if (tools.length > 0 && !selectedToolName) {
      const defaultTool = tools[0];
      setSelectedToolName(defaultTool.name);
      updateDefaultArgsForTool(defaultTool);
    }
  }, [tools, selectedToolName]);

  const handleToolChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    setSelectedToolName(name);
    const tool = tools.find((t) => t.name === name);
    if (tool) {
      updateDefaultArgsForTool(tool);
    }
  };

  const updateDefaultArgsForTool = (tool: WebMCPTool) => {
    try {
      const schema =
        typeof tool.inputSchema === 'string'
          ? JSON.parse(tool.inputSchema)
          : tool.inputSchema || {};
      const template = generateTemplateFromSchema(schema);
      setInputArgs(JSON.stringify(template, null, 2));
    } catch {
      setInputArgs('{}');
    }
  };

  const generateTemplateFromSchema = (schema: unknown): unknown => {
    if (!schema || typeof schema !== 'object') return {};
    const schemaObj = schema as Record<string, unknown>;

    if (schemaObj.hasOwnProperty('const')) return schemaObj.const;
    if (Array.isArray(schemaObj.oneOf) && schemaObj.oneOf.length > 0)
      return generateTemplateFromSchema(schemaObj.oneOf[0]);
    if (schemaObj.hasOwnProperty('default')) return schemaObj.default;
    if (Array.isArray(schemaObj.examples) && schemaObj.examples.length > 0)
      return schemaObj.examples[0];

    switch (schemaObj.type) {
      case 'object': {
        const obj: Record<string, unknown> = {};
        if (schemaObj.properties && typeof schemaObj.properties === 'object') {
          const props = schemaObj.properties as Record<string, unknown>;
          Object.keys(props).forEach((key) => {
            obj[key] = generateTemplateFromSchema(props[key]);
          });
        }
        return obj;
      }
      case 'array':
        return schemaObj.items ? [generateTemplateFromSchema(schemaObj.items)] : [];
      case 'string':
        return (schemaObj.enum as string[])?.[0] || 'example_string';
      case 'number':
      case 'integer':
        return (schemaObj.minimum as number) ?? 0;
      case 'boolean':
        return false;
      default:
        return {};
    }
  };

  const handleManualExecute = async () => {
    if (!selectedToolName) return;
    setIsExecuting(true);
    setExecutionResult('Executing tool…');
    try {
      const selectedTool = tools.find((t) => t.name === selectedToolName);
      const location = selectedTool?.location;
      const res = await onExecuteTool(selectedToolName, inputArgs, location);
      setExecutionResult({ success: true, data: res });
    } catch (err) {
      setExecutionResult({ success: false, error: String(err) });
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCopyScriptConfig = async () => {
    const code = generateScriptToolConfig(tools);
    await navigator.clipboard.writeText(code);
    setCopySuccessMsg('Copied ScriptToolConfig!');
    setTimeout(() => setCopySuccessMsg(''), 2500);
  };

  const handleCopyJSON = async () => {
    await navigator.clipboard.writeText(JSON.stringify(tools, null, 2));
    setCopySuccessMsg('Copied JSON!');
    setTimeout(() => setCopySuccessMsg(''), 2500);
  };

  const generateScriptToolConfig = (toolList: WebMCPTool[]) => {
    return toolList
      .map((t) => {
        let schemaStr = typeof t.inputSchema === 'string' ? t.inputSchema : JSON.stringify(t.inputSchema || {});
        try {
          schemaStr = JSON.stringify(JSON.parse(schemaStr), null, 2);
        } catch {}
        return `// Tool: ${t.name}\nnavigator.modelContext.registerTool({\n  name: "${t.name}",\n  description: "${t.description || ''}",\n  inputSchema: ${schemaStr}\n});`;
      })
      .join('\n\n');
  };

  const KEYS: (keyof WebMCPTool)[] = ['description', 'inputSchema', 'readOnlyHint', 'untrustedContentHint', 'name'];
  const activeKeys = KEYS.filter((key) => tools.some((tool) => key in tool));

  return (
    <section className="view tools-view">
      <div className="tools-view-header">
        <button className="pill-btn secondary small" onClick={onBackToChat}>
          ← Back to Chat
        </button>
        <h2>Tools Inspector</h2>
      </div>

      {/* Panel 1: Registered Tools */}
      <section className="panel">
        <h3 className="panel-title">
          Registered tools {domain ? `(${domain})` : ''}
        </h3>
        {tools.length === 0 ? (
          <div className="empty-tools-note">
            <i>No WebMCP tools registered on this page.</i>
          </div>
        ) : (
          <>
            <div className="table-container">
              <table id="resultsTable">
                <thead>
                  <tr>
                    {activeKeys.map((k) => (
                      <th key={k}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tools.map((tool, idx) => (
                    <tr key={idx}>
                      {activeKeys.map((key) => {
                        const rawVal = tool[key];
                        const val = key === 'inputSchema' ? (rawVal as string) || '{}' : String(rawVal ?? '');
                        let formatted = val;
                        try {
                          formatted = JSON.stringify(JSON.parse(val), null, 2);
                        } catch {}
                        return (
                          <td key={key}>
                            <pre>{formatted}</pre>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div id="copyToClipboard" className="copy-action-row">
              <button className="link-btn" onClick={handleCopyScriptConfig}>
                Copy as ScriptToolConfig
              </button>
              <button className="link-btn" onClick={handleCopyJSON}>
                Copy as JSON
              </button>
              {copySuccessMsg && <span className="copy-success-badge">{copySuccessMsg}</span>}
            </div>
          </>
        )}
      </section>

      {/* Panel 2: Activity Log */}
      <section className="panel">
        <h3 className="panel-title">
          Activity
          {activityLog.length > 0 && (
            <button className="link-btn panel-action" onClick={onClearActivity}>
              Clear
            </button>
          )}
        </h3>
        <div className="activity-log">
          {activityLog.length === 0 ? (
            <div className="activity-empty">No tool calls yet.</div>
          ) : (
            activityLog.map((entry) => (
              <details
                key={entry.id}
                className={`activity-entry ${entry.status === 'running' ? 'running' : entry.error ? 'err' : 'ok'}`}
              >
                <summary>
                  <span className="act-time">{entry.time}</span>
                  <span className="act-name">{entry.name}</span>
                  <span className="act-status">
                    {entry.status === 'running' ? '…' : entry.error ? 'error' : `${entry.durationMs}ms`}
                  </span>
                </summary>
                <div className="act-body">
                  <pre className="act-args">{formatJsonOrStr(entry.args)}</pre>
                  <pre className="act-result">
                    {entry.status === 'running'
                      ? 'pending…'
                      : entry.error
                      ? `Error: ${entry.error}`
                      : formatJsonOrStr(entry.result)}
                  </pre>
                </div>
              </details>
            ))
          )}
        </div>
      </section>

      {/* Panel 3: Manual Execution */}
      <section className="panel">
        <h3 className="panel-title">Manual call</h3>
        <div className="form-group">
          <label htmlFor="toolSelect">Tool</label>
          <select
            id="toolSelect"
            className="select"
            value={selectedToolName}
            onChange={handleToolChange}
            disabled={tools.length === 0}
          >
            {tools.map((t) => (
              <option key={t.name} value={t.name}>
                "{t.name}" {t.location ? `| ${t.location}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="inputArgsText">Input arguments (JSON)</label>
          <textarea
            id="inputArgsText"
            className="textarea"
            rows={5}
            value={inputArgs}
            onChange={(e) => setInputArgs(e.target.value)}
            disabled={tools.length === 0}
          />
        </div>

        <div className="form-group">
          <button
            className="pill-btn primary"
            onClick={handleManualExecute}
            disabled={tools.length === 0 || isExecuting}
          >
            {isExecuting ? 'Executing…' : 'Execute tool'}
          </button>
        </div>

        {executionResult && (
          <div className="manual-result-box">
            <pre className={typeof executionResult === 'object' && executionResult !== null && 'success' in executionResult && executionResult.success ? 'ok-text' : 'err-text'}>
              {typeof executionResult === 'string'
                ? executionResult
                : executionResult?.success
                ? formatJsonOrStr(executionResult.data)
                : `⚠️ ${executionResult?.error}`}
            </pre>
          </div>
        )}
      </section>
    </section>
  );
}

function formatJsonOrStr(data: unknown): string {
  if (typeof data === 'string') {
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  }
  return JSON.stringify(data, null, 2);
}

export default ToolsInspectorScreen;
