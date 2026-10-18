const LIVE_ORIGIN = 'https://apiv2.shiprocket.in';

// Pure validation shared by boot and every provider entry point. Never infer a
// test API host from a documentation hostname or reuse live credentials.
export const shiprocketEnvironment = (env = process.env) => {
  const mode = env.SHIPROCKET_MODE;
  if (mode === 'mock') return { mode, webhookSecret: env.SHIPROCKET_WEBHOOK_SECRET };
  if (!['live', 'sandbox'].includes(mode)) throw new Error('Set SHIPROCKET_MODE=mock for isolated development, or explicitly configure live/sandbox');
  const sandbox = mode === 'sandbox';
  const prefix = sandbox ? 'SHIPROCKET_SANDBOX_' : 'SHIPROCKET_';
  const missing = ['EMAIL', 'PASSWORD', 'WEBHOOK_SECRET'].filter(key => !env[prefix + key]);
  if (sandbox && !env.SHIPROCKET_SANDBOX_BASE_URL) missing.push('BASE_URL');
  if (missing.length) throw new Error(`${mode} Shiprocket configuration missing: ${missing.map(key => prefix + key).join(', ')}. Use SHIPROCKET_MODE=mock until account setup is confirmed.`);
  if (sandbox && env.SHIPROCKET_SANDBOX_CONFIRMED !== 'true') throw new Error('Sandbox requires SHIPROCKET_SANDBOX_CONFIRMED=true only after Shiprocket confirms the isolated endpoint and account. Otherwise use mock.');
  let url;
  try { url = new URL(sandbox ? env.SHIPROCKET_SANDBOX_BASE_URL : env.SHIPROCKET_BASE_URL || LIVE_ORIGIN); }
  catch { throw new Error('Shiprocket base URL must be a valid HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Shiprocket base URL must be an HTTPS origin without credentials, path, query or fragment');
  const hostname = url.hostname.replace(/\.$/, '');
  if (sandbox && (hostname === 'apiv2.shiprocket.in' || /(^|\.)apidocs(?:-test)?\.shiprocket\.in$/i.test(hostname))) throw new Error('Sandbox cannot use the live Shiprocket API or a documentation portal. Use a provider-confirmed isolated endpoint or mock.');
  if (!sandbox && url.origin !== LIVE_ORIGIN) throw new Error('Live Shiprocket must use the standard API origin; configure sandbox separately');
  return { mode, baseUrl: url.origin, email: env[prefix + 'EMAIL'], password: env[prefix + 'PASSWORD'], webhookSecret: env[prefix + 'WEBHOOK_SECRET'] };
};
