const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch(); 
  for (const s of [180, 512]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    const d = [5,0,0,0,3,0,0,7,0]; let cells = '';
    for (let i = 0; i < 9; i++) { const x = 18 + (i % 3) * 22, y = 18 + (i / 3 | 0) * 22;
      cells += `<rect x="${x}" y="${y}" width="20" height="20" rx="3" fill="${i===4?'#b9cdfc':'#fff'}"/>` + (d[i] ? `<text x="${x+10}" y="${y+15.5}" font-size="15" font-weight="700" text-anchor="middle" font-family="Arial, sans-serif" fill="${i===4?'#1f55d0':'#17202e'}">${d[i]}</text>` : ''); }
    await p.setContent(`<body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${s}" height="${s}"><rect width="100" height="100" fill="#263247"/>${cells}</svg>`);
    await p.screenshot({ path: path.join(__dirname, 'pwa', `icon-${s}.png`) });
  }
  await b.close();
})();
