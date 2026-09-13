#!/usr/bin/env node
/*
 * Minimal stand-in for Huawei's ace-server, used by the proxy end-to-end test.
 * It speaks LSP JSON-RPC over stdio and implements just enough of the private
 * `aceProject/*` protocol for the proxy to be exercised:
 *
 *   - initialize               -> capabilities + aceProject/onModuleInitFinish
 *   - aceProject/onAsyncHover  -> replies (as a notification) with a private
 *                                 hover payload string the proxy must normalise
 *   - aceProject/onAsyncDidOpen-> publishes diagnostics
 *   - any other onAsync*       -> replies with an empty result
 */
import process from 'node:process';

let buffer = Buffer.alloc(0);

function send(message) {
  const json = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function handle(message) {
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { hoverProvider: true, completionProvider: {} } } });
    send({ jsonrpc: '2.0', method: 'aceProject/onModuleInitFinish', params: { success: true } });
    return;
  }
  if (message.method === 'initialized') return;

  if (message.method === 'aceProject/onAsyncDidOpen') {
    const uri = message.params?.params?.textDocument?.uri;
    send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } });
    return;
  }

  if (typeof message.method === 'string' && message.method.startsWith('aceProject/onAsync')) {
    const requestId = message.params?.requestId;
    let result = null;
    if (message.method === 'aceProject/onAsyncHover') {
      result = {
        contents: JSON.stringify({
          code: { value: 'let x: string', language: 'typescript' },
          data: [{ document: 'The x value.' }],
        }),
      };
    }
    send({ jsonrpc: '2.0', method: message.method, params: { requestId, result } });
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const sep = buffer.indexOf('\r\n\r\n');
    if (sep === -1) break;
    const header = buffer.subarray(0, sep).toString('ascii');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.subarray(sep + 4);
      continue;
    }
    const length = Number.parseInt(match[1], 10);
    if (buffer.length < sep + 4 + length) break;
    const body = buffer.subarray(sep + 4, sep + 4 + length).toString('utf8');
    buffer = buffer.subarray(sep + 4 + length);
    try {
      handle(JSON.parse(body));
    } catch {
      /* ignore malformed */
    }
  }
});
