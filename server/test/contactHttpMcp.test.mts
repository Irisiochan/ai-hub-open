import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contactHttpMcpServers, isConfiguredMcpApproval } from '../src/backends/contactHttpMcp.js';
import { codexAppServerArgs } from '../src/backends/codexAppServer.js';
import { BackendFactory } from '../src/runtime/backendFactory.js';

const config = JSON.stringify({ mcpServers: { devices: { type: 'http', url: 'http://127.0.0.1:8766/mcp' } } });
const allowed = ['mcp__devices__*'];
const servers = contactHttpMcpServers(config, process.cwd(), allowed);
assert.equal(servers[0].name, 'devices');
assert.equal(servers[0].defaultToolsApprovalMode, 'auto');
assert.ok(codexAppServerArgs(servers).includes('mcp_servers.devices.default_tools_approval_mode="auto"'));
assert.deepEqual(contactHttpMcpServers(undefined, process.cwd(), allowed), []);
assert.equal(contactHttpMcpServers(config, process.cwd(), [])[0].defaultToolsApprovalMode, 'approve');
assert.equal(isConfiguredMcpApproval('mcp/tool/requestApproval', { serverName: 'devices' }, servers), true);
assert.equal(isConfiguredMcpApproval('mcpServer/elicitation/request', { serverName: 'devices' }, servers), true);
for (const method of ['execCommandApproval', 'applyPatchApproval', 'item/commandExecution/requestApproval', 'sandbox/requestApproval']) {
  assert.equal(isConfiguredMcpApproval(method, { serverName: 'devices' }, servers), false);
}
assert.equal(isConfiguredMcpApproval('mcp/tool/requestApproval', { serverName: 'devices' }, []), false);
assert.equal(isConfiguredMcpApproval('mcp/tool/requestApproval', { serverName: 'devices-other' }, servers), false);
assert.equal(isConfiguredMcpApproval('mcp/tool/requestApproval', { text: 'devices' }, servers), false);
assert.equal(isConfiguredMcpApproval('mcp/tool/requestApproval', { serverName: 'devices' }, contactHttpMcpServers(config, process.cwd(), [])), false);
for (const entry of [{ type: 'stdio', command: 'node' }, { type: 'http', url: 'file:///tmp/private' },
  { type: 'http', url: 'http://secret:secret@localhost' }, { type: 'http', url: 'http://localhost', headers: [] }]) {
  assert.throws(() => contactHttpMcpServers(JSON.stringify({ mcpServers: { devices: entry } }), process.cwd(), allowed));
}
for (const name of ['hub', 'memory_vault', 'memory-vault', 'bad.name']) {
  assert.throws(() => contactHttpMcpServers(JSON.stringify({ mcpServers: { [name]: { type: 'http', url: 'http://localhost' } } }), process.cwd(), allowed));
}
assert.deepEqual(contactHttpMcpServers(JSON.stringify({ mcpServers: { devices: { enabled: false } } }), process.cwd(), allowed), []);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-hub-contact-mcp-'));
try {
  const factory = new BackendFactory({
    db: {} as any, vault: null, jobStore: null,
    config: { agentsDir: temp, codex: { cliPath: 'codex' }, memory: {} } as any,
    prompts: { composeStart: async () => ({ preamble: '' }) } as any,
  });
  const build = async (id: string, cfg: object) => factory.build({
    agent: { id, name: id, kind: 'dm', backend: 'codex', config: JSON.stringify({ heartbeat: { enabled: false }, ...cfg }) },
    log: () => {}, memory: {}, resumeToken: null,
  } as any) as Promise<any>;
  const codex = await build('codex', { mcpConfig: config, allowedTools: allowed });
  assert.equal(codex.opts.mcpServers[0].name, 'devices');
  assert.equal(codex.opts.mcpServers[0].defaultToolsApprovalMode, 'auto');
  const other = await build('other', {});
  assert.equal(other.opts.mcpServers, undefined, 'contact MCP authority must not leak to the next backend');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('contact HTTP MCP isolation and approval tests: ok');
