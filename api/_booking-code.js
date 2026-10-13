// Shared walk-in mint path (Round 48); onboarding reuses the same code shape.
export function mintWalkinCode(test = false) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = test ? 'TEST' : '';
  for (let i = s.length; i < 8; i++) s += alphabet[Math.floor(Math.random() * 32)];
  // Reserve the test prefix so deleted/expired links cannot mint a real token.
  if (!test && s.startsWith('TEST')) return mintWalkinCode(false);
  return 'WB-' + s;
}
