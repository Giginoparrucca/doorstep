// Round 54 canonical origin contract; Round 55 copy/QR interactions use host-share tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {readEnvironment,PRODUCTION_ORIGIN} from '../lib/environment.mjs';
for(const stale of ['https://welcomebnb.vercel.app','https://old-preview.vercel.app'])assert.equal(readEnvironment({APP_BASE_URL:stale}).appOrigin,PRODUCTION_ORIGIN);
const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');assert.ok(admin.includes('href="${APP_CONFIG.appOrigin}/?p=${encodeURIComponent(p.id)}"'));
for(const name of ['host-console.html','admin.html','index.html'])for(const m of fs.readFileSync(new URL('../'+name,import.meta.url),'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
console.log('PASS canonical production origin despite stale overrides; admin link and all inline syntax.');
