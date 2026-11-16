// Escape user text before building a RegExp, so searches like "+91 98…" or "C++" match literally
// instead of throwing (500) or running an attacker-shaped pattern.
export const escapeRegex = (text) => String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
