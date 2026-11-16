// Round 65 Phase 5a shipped the full resource policy report-only.
// Round 74 Phase 6 (audit WBNB-Y004, decision D3, 16 Nov 2026): enforced after
// the synthetic guest/host/admin flow run passed under enforcement
// (scripts/round74-csp-enforced-browser.test.mjs). The only production reports
// in the watch window came from the Vercel Toolbar shown to the owner
// (vercel.live script/frame/fonts), deliberately not allowed. Reporting stays
// on (report-uri). Inline scripts remain allowed ('unsafe-inline') until the
// gradual inline-handler removal (Round 65 Phase 5c).
export const resourcePolicy = [
 "default-src 'self'",
 "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
 "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
 "img-src 'self' blob: data: https:",
 "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
 "font-src 'self' https://fonts.gstatic.com",
 "worker-src 'self' blob:",
 "frame-src 'self' blob: https://www.google.com https://maps.google.com",
 "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'",
 "form-action 'self'", 'report-uri /api/csp-report',
].join('; ');
export const securityHeaders = [
 {key:'Content-Security-Policy',value:resourcePolicy},
 {key:'X-Frame-Options',value:'DENY'},
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains; preload'},
 {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
 {key:'Permissions-Policy',value:'camera=(self), microphone=(), geolocation=(self), payment=()'},
];
