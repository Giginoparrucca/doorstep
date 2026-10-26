// Browser diagnostics only: never log a document URL, query, source sample,
// referrer, IP, user agent or arbitrary report text (guest links contain tokens).
import {ALLOWED_ORIGINS,rejectInvalidEnvironment} from './_environment.js';
const directives=new Set(['default-src','script-src','script-src-elem','script-src-attr','connect-src','img-src',
 'style-src','style-src-elem','style-src-attr','font-src','worker-src','frame-src','object-src','frame-ancestors','base-uri','form-action']);
let windowStart=0,accepted=0;
export function summarizeReport(body){
 const report=body?.['csp-report'];if(!report||typeof report!=='object')return null;
 let document;try{document=new URL(report['document-uri']);}catch{return null;}
 if(!ALLOWED_ORIGINS.includes(document.origin))return null;
 const directive=report['effective-directive'];if(!directives.has(directive))return null;
 const routes={'/':'guest','/index.html':'guest','/host-console.html':'host','/admin.html':'admin'};
 const blocked=report['blocked-uri'];let resource='other';
 if(['inline','eval','data','blob'].includes(blocked))resource=blocked;
 else try{const u=new URL(blocked);resource=u.origin===document.origin?'self':
  u.hostname==='cdn.jsdelivr.net'?'cdn':u.hostname.endsWith('.supabase.co')?'supabase':
  ['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname)?'fonts':'external';}catch{}
 return {page:routes[document.pathname]||'other',directive,resource};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(rejectInvalidEnvironment(res))return;
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end();}
 if(req.headers?.['sec-fetch-site']==='cross-site')return res.status(403).end();
 const origin=req.headers?.origin;if(origin&&!ALLOWED_ORIGINS.includes(origin))return res.status(403).end();
 const type=String(req.headers?.['content-type']||'').split(';')[0];
 if(!['application/csp-report','application/json'].includes(type))return res.status(415).end();
 if(Number(req.headers?.['content-length'])>4096)return res.status(413).end();
 let body=req.body;
 try{
  if(body==null){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>4096)return res.status(413).end();chunks.push(Buffer.from(chunk));}body=Buffer.concat(chunks).toString('utf8');}
  if(Buffer.isBuffer(body))body=body.toString('utf8');
  if(typeof body==='string'){if(Buffer.byteLength(body)>4096)return res.status(413).end();body=JSON.parse(body);}
  else if(Buffer.byteLength(JSON.stringify(body))>4096)return res.status(413).end();
 }catch{return res.status(400).end();}
 const summary=summarizeReport(body);if(!summary)return res.status(400).end();
 const now=Date.now();if(now-windowStart>=60000){windowStart=now;accepted=0;}
 // Bound per-instance diagnostic volume; this is not an authentication or WAF gate.
 if(accepted++<60)console.info('[csp-report]',summary);
 return res.status(204).end();
}
