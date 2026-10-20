import path from 'node:path';

// Accept private launch metadata; return only boolean comparisons and safe
// process metadata. Do not return key material or a fingerprint of any key.
export function auditJwtProcesses(workers, { script, secret: intendedSecret, expiry: intendedExpiry = '30d' }) {
  const report = workers.map(p => {
    const env = p.pm2_env || {};
    const explicitSecret = env.JWT_SECRET ?? env.env?.JWT_SECRET;
    const secret = explicitSecret ?? intendedSecret;
    const expiry = env.JWT_EXPIRES_IN ?? env.env?.JWT_EXPIRES_IN ?? intendedExpiry;
    return { id: p.pm_id, status: env.status,
      correctEntrypoint: path.resolve(env.pm_exec_path || '') === path.resolve(script),
      production: env.NODE_ENV === 'production', secretConfigured: Boolean(typeof secret === 'string' && secret.trim()),
      secretMatchesIntended: Boolean(intendedSecret && secret === intendedSecret), expiryMatchesIntended: expiry === intendedExpiry,
      configurationSource: explicitSecret !== undefined ? 'pm2-environment' : 'backend-environment-file',
      runningKeyVerified: false };
  });
  return { launchConfigurationConsistent: Boolean(workers.length && intendedSecret?.trim()) && report.every(r => r.correctEntrypoint && r.production && r.secretConfigured && r.secretMatchesIntended && r.expiryMatchesIntended), workers: report };
}
