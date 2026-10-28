// Execute the real access card and lockbox renderer at IT/EN mobile/desktop.
// Fictional server projections only; this is not an authenticated live pilot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf("      try {\n        const er = r?.data?.entry_release");
const end = html.indexOf('      // Round 60 Phase 4 — show the Your-room card', start);
assert.ok(start > 0 && end > start);
const card = html.slice(start, end);
function fn(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start > 0);
  return html.slice(start, html.indexOf('\n}\n', start) + 2);
}
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) for (const language of ['it', 'en']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.abort());
    await page.route('https://entry.example.invalid/', route => route.fulfill({
      contentType: 'text/html', body: '<main><div id="accessMethod"></div><div id="lockboxCodesWrap"></div><div id="checkinInstructionsText"></div></main>',
    }));
    await page.goto('https://entry.example.invalid/');
    await page.addScriptTag({ content: `let lang=${JSON.stringify(language)},propertyData=null,reservationKeyboxCode='',existingCheckins=[];const T={en:{},it:{}};
      ${fn('_isLockboxPlaceholder')}
      ${fn('_resolveLockboxCodes')}
      ${fn('refreshLockboxDisplay')}
      function renderResponse(r){
        propertyData=r.data.property;
        const el=id=>document.getElementById(id);
        el('accessMethod').textContent=propertyData.access_method||'Self check-in';
        ${card}
        refreshLockboxDisplay();
      }` });
    const manual = { data: { property: { keybox_code: 'FIXED-FICTIONAL', access_method: 'Fictional access' },
      entry_release: { state: 'manual', allow_entry: true } } };
    await page.evaluate(r => renderResponse(r), manual);
    assert.equal(await page.locator('#lockboxCodesWrap').isVisible(), true);
    assert.match(await page.locator('#lockboxCodesWrap').textContent(), /FIXED-FICTIONAL/);
    assert.match(await page.locator('.entry-released-note').textContent(), language === 'it'
      ? /Il tuo host ha rilasciato il codice di accesso/ : /Your host has released the access code/);
    await page.evaluate(r => renderResponse(r), manual);
    assert.equal(await page.locator('.entry-released-note').count(), 1);
    for (const state of ['locked', 'scheduled', 'unavailable', 'invalid']) {
      await page.evaluate(state => renderResponse({ data: { property: {},
        entry_release: { state, allow_entry: false, release_at: '2099-01-01T14:00:00Z' } } }), state);
      assert.equal(await page.locator('#lockboxCodesWrap').isVisible(), false);
      assert.equal(await page.locator('.entry-released-note').count(), 0);
      assert.ok(!(await page.locator('body').innerHTML()).includes('FIXED-FICTIONAL'));
      assert.ok((await page.locator('#accessMethod').textContent()).length > 20);
    }
    // Releasing again after restore must work without a fresh link.
    await page.evaluate(r => renderResponse(r), manual);
    assert.equal(await page.locator('#lockboxCodesWrap').isVisible(), true);
    const hidden = structuredClone(manual);
    hidden.data.property.show_fixed_lockbox_to_guest = false;
    delete hidden.data.property.keybox_code;
    await page.evaluate(r => renderResponse(r), hidden);
    assert.equal(await page.locator('#lockboxCodesWrap').isVisible(), false);
    assert.ok(!(await page.locator('body').innerHTML()).includes('FIXED-FICTIONAL'));
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS actual guest access card/renderer IT/EN 390/1440: fixed-code release and confirmation, repeat render, restore/deny removes code and chip, re-release and host-hidden code. Synthetic projections, no live pilot.');
} finally { await browser.close(); }
