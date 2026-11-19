// Node-RED 5 API v2 adapter. Existing Node-RED remains authoritative.
export class GraphTransportError extends Error {
  constructor(code) { super(code); this.name = 'GraphTransportError'; this.code = code; }
}
const fail = code => { throw new GraphTransportError(code); };
function loopback(url) {
  if (typeof url !== 'string') fail('missing_explicit_endpoint');
  let parsed;
  try { parsed = new URL(url); } catch { fail('invalid_endpoint'); }
  if (parsed.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/^[0-9]+$/.test(parsed.port) ||
      Number(parsed.port) < 1024 || Number(parsed.port) > 65535 ||
      parsed.pathname !== '/' || parsed.search || parsed.hash ||
      parsed.username || parsed.password) fail('loopback_only_endpoint');
  return parsed;
}
export class NodeRedV2 {
  #base;
  #token;
  #fetch;
  constructor({baseURL, bearerToken, fetchImpl=fetch}) {
    this.#base = loopback(baseURL);
    if (typeof bearerToken !== 'string' || bearerToken.length < 24 ||
        bearerToken.length > 2048 || /[\r\n]/.test(bearerToken))
      fail('bearer_token_required');
    this.#token = bearerToken;
    this.#fetch = fetchImpl;
  }
  async #request(method, path, body) {
    // Redirects, responses and bearer credentials must never escape loopback.
    const url = new URL(path, this.#base);
    if (url.origin !== this.#base.origin) fail('invalid_request_path');
    const json = body === undefined ? undefined : JSON.stringify(body);
    if (json && Buffer.byteLength(json) > 256 * 1024)
      fail('request_too_large');
    let response;
    try {
      response = await this.#fetch(url, {
        method,
        headers: {
          'Accept': 'application/json',
          'Node-RED-API-Version': 'v2',
          ...(body === undefined ? {} : {
            'Content-Type': 'application/json',
            'Node-RED-Deployment-Type': 'nodes'
          }),
          'Authorization': 'Bearer ' + this.#token,
          'Cache-Control': 'no-store'
        },
        body: json,
        redirect: 'error',
        signal: AbortSignal.timeout(3500)
      });
    } catch {
      fail('node_red_unreachable');
    }
    if (response.status === 409) fail('stale_revision');
    if (response.status === 401 || response.status === 403)
      fail('node_red_authorization_denied');
    if (!response.ok) fail('node_red_http_' + response.status);
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
      fail('invalid_node_red_content_type');
    if (Number(response.headers.get('content-length') || '0') > 512 * 1024)
      fail('node_red_response_too_large');
    if (!response.body) fail('empty_node_red_reply');
    const reader = response.body.getReader();
    let total = 0;
    const parts = [];
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 512 * 1024) fail('node_red_response_too_large');
        parts.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    let result;
    try { result = JSON.parse(Buffer.concat(parts, total).toString('utf8')); }
    catch { fail('invalid_node_red_json'); }
    return result;
  }
  async getFlows() {
    const result = await this.#request('GET', '/flows');
    if (!result || typeof result.rev !== 'string' ||
        !/^[\x21-\x7e]{1,128}$/.test(result.rev) ||
        !Array.isArray(result.flows) || result.flows.length > 256)
      fail('invalid_node_red_v2_snapshot');
    return {rev:result.rev, flows:result.flows};
  }
  async setFlows({rev, flows}) {
    if (typeof rev !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(rev) ||
        !Array.isArray(flows)) fail('invalid_revision_or_flows');
    const result = await this.#request('POST', '/flows', {rev,flows});
    if (typeof result?.rev !== 'string' || !result.rev)
      fail('invalid_node_red_commit_receipt');
    return {rev:result.rev};
  }
}
