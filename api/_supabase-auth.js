// Supabase API keys identify the application; user JWTs identify the caller.
// Modern API keys are opaque strings, so never use one as a bearer JWT.
// This builds headers only: callers must retain their existing authorization.
export function supabaseAuthHeaders(apiKey, bearer = apiKey) {
  const headers = { apikey: apiKey };
  const modernKey = typeof apiKey === 'string' && /^(sb_secret_|sb_publishable_)/.test(apiKey);
  if (!(modernKey && bearer === apiKey)) headers.Authorization = `Bearer ${bearer}`;
  return headers;
}
