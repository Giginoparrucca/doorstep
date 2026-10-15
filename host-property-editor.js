// Round 57: property draft, original-photo framing and guarded navigation.
(function() {
  'use strict';
  window.HostPropertyEditor = {create};
  function create({root, lang, canEdit}) {
    let baseline = null, file = null, objectUrl = null, uploadedUrl = null;
    let coverUrl = '', layout = CoverLayout.normalize(), editing = false, navigating = false, decoding = false;
    let generation = 0;
    const el = id => document.getElementById(id);
    const text = (it, en) => lang() === 'it' ? it : en;
    function snapshot() {
      const values = [...root.querySelectorAll('input,select,textarea')].filter(e => e.type !== 'file').map(e => {
        if (e.hasAttribute('data-i18n-field')) {
          const current = e.getAttribute('data-lang') || (lang() === 'it' ? 'it' : 'en');
          return [e.id, ...['it','en'].map(lg => current === lg ? e.value : (e.getAttribute('data-lang-' + lg) || ''))];
        }
        return [e.id, e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value];
      });
      return JSON.stringify([values, coverUrl, layout]);
    }
    function dirty() { return editing && (Boolean(file) || (baseline !== null && snapshot() !== baseline)); }
    function release() { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; }
    function paint() {
      const image = el('coverPhotoPreview');
      image.src = objectUrl || coverUrl || '';
      image.style.display = image.src && (objectUrl || coverUrl) ? 'block' : 'none';
      el('coverPhotoPlaceholder').style.display = objectUrl || coverUrl ? 'none' : '';
      el('coverPhotoZone').classList.toggle('has-photo', Boolean(objectUrl || coverUrl));
      el('coverFrameControls').hidden = !(objectUrl || coverUrl);
      for (const key of ['zoom','x','y']) el('coverFrame-' + key).value = layout[key];
      CoverLayout.apply(image, layout);
      el('coverZoomValue').textContent = Math.round(layout.zoom * 100) + '%';
    }
    function reset(data) {
      generation++; decoding = false; release(); file = null; uploadedUrl = null; editing = false;
      coverUrl = data?.hero_image_url || ''; layout = CoverLayout.normalize(data?.hero_image_layout);
      el('coverPhotoInput').value = ''; el('coverPhotoStatus').textContent = ''; paint(); baseline = snapshot();
    }
    function begin() { if (!editing) { baseline = snapshot(); editing = true; } }
    function adjust(key, value) {
      if (!editing || !canEdit()) return;
      layout = CoverLayout.normalize({...layout, [key]: Number(value)}); paint();
    }
    async function stage(input) {
      if (!editing || !canEdit() || !input.files?.length) return;
      const candidate = input.files[0], status = el('coverPhotoStatus');
      input.value = '';
      if (!/^image\/(jpeg|png|webp)$/.test(candidate.type) || candidate.size > 10 * 1024 * 1024) {
        status.textContent = text('Scegli JPG, PNG o WebP, massimo 10 MB.', 'Choose JPG, PNG or WebP, up to 10 MB.'); return;
      }
      const token = ++generation, url = URL.createObjectURL(candidate);
      decoding = true;
      try {
        const image = new Image(); image.src = url; await image.decode();
        if (token !== generation || !editing || !canEdit()) { URL.revokeObjectURL(url); return; }
        release(); objectUrl = url; file = candidate; uploadedUrl = null;
        layout = CoverLayout.normalize(); paint();
        status.textContent = text('Foto pronta — premi Salva Dettagli Proprietà.', 'Photo ready — press Save Property Details.');
      } catch (_) {
        URL.revokeObjectURL(url);
        if (token === generation) status.textContent = text('Impossibile aprire la foto. Scegli un altro file.', 'Cannot open this photo. Choose another file.');
      } finally { if (token === generation) decoding = false; }
    }
    async function prepareCover(sb, propertyId) {
      if (!editing) return {};
      if (decoding) throw Error(text('Attendi il caricamento della foto.', 'Wait for the photo to load.'));
      if (file && !uploadedUrl) {
        const ext = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[file.type];
        const path = `covers/${propertyId}_${crypto.randomUUID()}.${ext}`;
        const {error} = await sb.storage.from('property-images').upload(path, file, {contentType:file.type, upsert:false});
        if (error) throw Error(text('Caricamento foto fallito: ', 'Photo upload failed: ') + error.message);
        const {data} = sb.storage.from('property-images').getPublicUrl(path);
        if (!data?.publicUrl) throw Error(text('URL della foto non disponibile.', 'Photo URL unavailable.'));
        uploadedUrl = data.publicUrl;
      }
      return {hero_image_url: uploadedUrl || coverUrl || null, hero_image_layout: {...layout}};
    }
    async function leave({save, discard}) {
      if (navigating) return false;
      if (!dirty() && !decoding) { if (editing) discard(); return true; }
      navigating = true;
      try {
        const choice = await ask();
        if (choice === 'save') return await save() === true;
        if (choice === 'discard') { discard(); return true; }
        return false;
      } finally { navigating = false; }
    }
    function ask() { return HostUnsavedChanges.prompt(lang); }
    window.addEventListener('beforeunload', event => {
      if (dirty() || decoding) { event.preventDefault(); event.returnValue = ''; }
    });
    root.addEventListener('input', event => {
      const key = event.target.dataset.coverFrame;
      if (key) adjust(key, event.target.value);
    });
    el('coverFrameCenter').addEventListener('click', () => {adjust('x',50); adjust('y',50);});
    el('coverFrameReset').addEventListener('click', () => {adjust('zoom',1); adjust('x',50); adjust('y',50);});
    return {begin, reset, dirty, stage, prepareCover, leave, pending: () => decoding};
  }
})();
