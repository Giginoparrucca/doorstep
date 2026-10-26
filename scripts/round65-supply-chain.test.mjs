import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pkg=JSON.parse(read('package.json')),lock=JSON.parse(read('package-lock.json'));
for(const kind of ['dependencies','devDependencies']){
 assert.deepEqual(lock.packages[''][kind],pkg[kind]);
 for(const [name,version]of Object.entries(pkg[kind])){assert.match(version,/^\d+\.\d+\.\d+$/);assert.equal(lock.packages['node_modules/'+name].version,version);}
}
for(const [name,entry]of Object.entries(lock.packages))if(name){assert.match(entry.integrity,/^sha512-/);assert.match(entry.resolved,/^https:\/\/registry\.npmjs\.org\//);}
const version=pkg.devDependencies['@supabase/supabase-js'],url='/vendor/supabase-'+version+'.js';
const bytes=fs.readFileSync(new URL('..'+url,import.meta.url));const sri='sha384-'+createHash('sha384').update(bytes).digest('base64');
for(const name of ['index.html','host-console.html','admin.html','demo-launch.html']){
 const html=read(name),tags=[...html.matchAll(/<script\b[^>]*>/g)].map(x=>x[0]).filter(x=>x.includes('supabase'));
 assert.equal(tags.length,1,name);assert.ok(tags[0].includes('src="'+url+'"'));assert.ok(tags[0].includes('integrity="'+sri+'"'));assert.ok(tags[0].includes('crossorigin="anonymous"'));
 assert.ok(!html.includes('supabase-js@'),name+' cannot load a floating CDN SDK');
}
const ci=read('.github/workflows/regression.yml');
const uses=[...ci.matchAll(/uses:\s+(\S+)/g)].map(x=>x[1]);assert.equal(uses.length,2);assert.ok(uses.every(x=>/@[0-9a-f]{40}$/.test(x)));
assert.match(ci,/run: npm ci/);assert.ok(!ci.includes('npm install'));assert.match(ci,/\.\/node_modules\/\.bin\/playwright install/);
assert.ok(!read('.gitignore').split('\n').includes('package-lock.json'));
const dependabot=read('.github/dependabot.yml');for(const ecosystem of ['npm','github-actions'])assert.ok(dependabot.includes('package-ecosystem: '+ecosystem));
console.log('PASS exact direct/locked dependencies and registry integrity, all four self-hosted SDK/SRI entry points, immutable Actions, npm ci and Dependabot ecosystems');
