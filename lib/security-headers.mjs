// Round 65 Phase 5a. Keep the full resource policy report-only until the
// seven-day observation/review gate. Framing/base/object protections enforce now.
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
 {key:'Content-Security-Policy-Report-Only',value:resourcePolicy},
 {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'none'; object-src 'none'"},
 {key:'X-Frame-Options',value:'DENY'},
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains; preload'},
 {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
 {key:'Permissions-Policy',value:'camera=(self), microphone=(), geolocation=(self), payment=()'},
];
