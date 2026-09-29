// Developer-only helpers used for visual QA: composite the WebGL canvas and the DOM overlay into one PNG
// and POST it to a local receiver. Nothing here runs unless window.__shotFull() is called from the console.
export function installDebug(stage) {
  const collectCss = () => {
    let css = '';
    for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) css += r.cssText + '\n'; } catch { /* cross-origin */ } }
    return css;
  };
  const serialize = el => {
    const clone = el.cloneNode(true);
    const src = el.querySelectorAll('canvas'), dst = clone.querySelectorAll('canvas');
    dst.forEach((c, i) => { const im = document.createElement('img'); im.src = src[i].toDataURL(); im.className = src[i].className; im.setAttribute('style', src[i].getAttribute('style') || ''); im.width = src[i].width; im.height = src[i].height; c.replaceWith(im); });
    return new XMLSerializer().serializeToString(clone);
  };
  const post = async (name, blob) => (await fetch('http://localhost:5190/?name=' + name, { method: 'POST', body: blob })).text();

  window.__shot = async (name = 'shot', w = 1600, h = 900) => {
    stage.forceSize = { w, h }; stage.resize();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    stage.composer.render(0);
    const blob = await new Promise(r => stage.canvas.toBlob(r, 'image/png'));
    const res = await post(name, blob);
    stage.forceSize = null; stage.resize();
    return res;
  };

  window.__shotFull = async (name = 'full') => {
    const w = innerWidth, h = innerHeight;
    stage.forceSize = { w, h }; stage.resize();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    stage.composer.render(0);
    const bmp = await createImageBitmap(await new Promise(r => stage.canvas.toBlob(r, 'image/png')));
    stage.forceSize = null; stage.resize();
    const out = document.createElement('canvas'); out.width = bmp.width; out.height = bmp.height;
    const ctx = out.getContext('2d'); ctx.drawImage(bmp, 0, 0);
    const html = serialize(document.getElementById('hud')) + serialize(document.getElementById('overlay'));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;color:#f2e4bc;font-family:'Cormorant Garamond',Georgia,serif"><style>${collectCss().replace(/</g, '&lt;')} *{animation:none!important;transition:none!important}</style>${html}</div></foreignObject></svg>`;
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg render failed')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    ctx.drawImage(img, 0, 0, out.width, out.height);
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    return post(name, blob);
  };
}
