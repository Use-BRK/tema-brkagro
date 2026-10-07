/*
 * Gera imagens de "catálogo" (PNG) com os produtos e preços da busca atual.
 * Dados vêm de /search?...&view=catalogo (templates/search.catalogo.liquid),
 * respeitando termo, filtros e ordenação da URL atual.
 */
(() => {
  const btn = document.querySelector('[data-search-catalog]');
  if (!btn) return;

  const GREEN = '#085b47';
  const CREAM = '#efe9da';
  const TEXT = '#111111';
  const MUTED = '#8a8a8a';

  const WIDTH = 1600;
  const PAD = 60;
  const COLS = 4;
  const ROWS = 5;
  const GAP = 30;
  const HEADER_H = 190;
  const FOOTER_H = 90;
  const COL_W = (WIDTH - PAD * 2 - GAP * (COLS - 1)) / COLS;
  const IMG_H = COL_W;
  const CARD_H = IMG_H + 150;

  const fontFamily =
    getComputedStyle(document.body).fontFamily || 'Helvetica, Arial, sans-serif';
  const font = (weight, size) => `${weight} ${size}px ${fontFamily}`;

  const label = btn.querySelector('[data-label]');
  const setLabel = (text) => (label.textContent = text);

  async function fetchProducts() {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'catalogo');
    const products = [];
    let page = 1;
    let pages = 1;
    do {
      url.searchParams.set('page', page);
      setLabel(`Carregando produtos… (${page}/${pages})`);
      const res = await fetch(url.toString(), { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = JSON.parse(await res.text());
      products.push(...data.products);
      pages = data.pages;
      page += 1;
    } while (page <= pages);
    return products;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src.startsWith('//') ? `${location.protocol}${src}` : src;
    });
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const words = text.trim().split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;

    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }

  function drawContain(ctx, img, x, y, w, h) {
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCard(ctx, product, img, x, y) {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x, y, COL_W, IMG_H, 12);
    ctx.fill();
    if (img) {
      ctx.save();
      roundRect(ctx, x, y, COL_W, IMG_H, 12);
      ctx.clip();
      drawContain(ctx, img, x + 10, y + 10, COL_W - 20, IMG_H - 20);
      ctx.restore();
    }

    let ty = y + IMG_H + 36;
    ctx.fillStyle = TEXT;
    ctx.font = font(600, 24);
    ctx.textBaseline = 'alphabetic';
    for (const line of wrapText(ctx, product.title, COL_W, 2)) {
      ctx.fillText(line, x, ty);
      ty += 30;
    }

    const priceY = y + IMG_H + 132;
    let px = x;
    if (product.price_varies) {
      ctx.fillStyle = MUTED;
      ctx.font = font(400, 20);
      const prefix = 'a partir de ';
      ctx.fillText(prefix, px, priceY);
      px += ctx.measureText(prefix).width;
    }
    ctx.fillStyle = GREEN;
    ctx.font = font(700, 32);
    ctx.fillText(product.price, px, priceY);
    px += ctx.measureText(product.price).width + 14;

    if (product.compare_at_price) {
      ctx.fillStyle = MUTED;
      ctx.font = font(400, 22);
      const w = ctx.measureText(product.compare_at_price).width;
      ctx.fillText(product.compare_at_price, px, priceY);
      ctx.fillRect(px, priceY - 8, w, 2);
    }
  }

  async function renderPage(products, images, pageIndex, totalPages, meta) {
    const rows = Math.ceil(products.length / COLS);
    const height = HEADER_H + rows * CARD_H + (rows - 1) * GAP + FOOTER_H;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, WIDTH, height);

    // Cabeçalho
    ctx.fillStyle = GREEN;
    ctx.fillRect(0, 0, WIDTH, 8);
    if (meta.logo) {
      const lh = 70;
      const lw = Math.min((meta.logo.naturalWidth / meta.logo.naturalHeight) * lh, 420);
      drawContain(ctx, meta.logo, PAD, 60, lw, lh);
    } else {
      ctx.fillStyle = GREEN;
      ctx.font = font(700, 44);
      ctx.fillText(meta.shop, PAD, 115);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = GREEN;
    ctx.font = font(700, 40);
    ctx.fillText(meta.title, WIDTH - PAD, 100);
    ctx.fillStyle = MUTED;
    ctx.font = font(400, 22);
    const pageInfo = totalPages > 1 ? ` · página ${pageIndex + 1}/${totalPages}` : '';
    ctx.fillText(`${meta.date}${pageInfo}`, WIDTH - PAD, 138);
    ctx.textAlign = 'left';

    // Produtos
    products.forEach((product, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      drawCard(ctx, product, images[i], PAD + col * (COL_W + GAP), HEADER_H + row * (CARD_H + GAP));
    });

    // Rodapé
    ctx.fillStyle = MUTED;
    ctx.font = font(400, 20);
    ctx.fillText('Preços sujeitos a alteração sem aviso prévio.', PAD, height - 40);
    ctx.textAlign = 'right';
    ctx.fillStyle = GREEN;
    ctx.font = font(600, 22);
    ctx.fillText(meta.domain, WIDTH - PAD, height - 40);
    ctx.textAlign = 'left';

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  function slug(text) {
    return (
      text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'busca'
    );
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  function showModal(blobs, baseName) {
    document.querySelector('.search-catalog-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'search-catalog-modal';
    modal.innerHTML = `
      <div class="search-catalog-modal__box" role="dialog" aria-modal="true" aria-label="Catálogo gerado">
        <div class="search-catalog-modal__head">
          <h3>${blobs.length} imagem(ns) gerada(s)</h3>
          <div class="search-catalog-modal__actions">
            ${blobs.length > 1 ? '<button type="button" class="sc-action sc-action--primary" data-all>Baixar todas</button>' : ''}
            <button type="button" class="sc-action" data-close>Fechar</button>
          </div>
        </div>
        <div class="search-catalog-modal__list"></div>
      </div>`;
    const list = modal.querySelector('.search-catalog-modal__list');
    const names = blobs.map((_, i) => `${baseName}${blobs.length > 1 ? `-${i + 1}` : ''}.png`);

    blobs.forEach((blob, i) => {
      const item = document.createElement('div');
      item.className = 'search-catalog-modal__item';
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.alt = names[i];
      const actions = document.createElement('div');
      const dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'sc-action sc-action--primary';
      dl.textContent = 'Baixar';
      dl.addEventListener('click', () => download(blob, names[i]));
      actions.appendChild(dl);
      if (navigator.clipboard && window.ClipboardItem) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'sc-action';
        copy.textContent = 'Copiar';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            copy.textContent = 'Copiado!';
          } catch (e) {
            copy.textContent = 'Falhou';
          }
          setTimeout(() => (copy.textContent = 'Copiar'), 2000);
        });
        actions.appendChild(copy);
      }
      item.append(img, actions);
      list.appendChild(item);
    });

    const close = () => {
      modal.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
      modal.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    modal.addEventListener('click', (e) => e.target === modal && close());
    modal.querySelector('[data-close]').addEventListener('click', close);
    modal.querySelector('[data-all]')?.addEventListener('click', async () => {
      for (let i = 0; i < blobs.length; i++) {
        download(blobs[i], names[i]);
        await new Promise((r) => setTimeout(r, 400));
      }
    });
    document.body.appendChild(modal);
  }

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const originalLabel = label.textContent;
    try {
      const products = await fetchProducts();
      if (!products.length) {
        alert('Nenhum produto disponível nesta busca.');
        return;
      }

      const terms = btn.dataset.terms || '';
      await document.fonts?.ready;
      const meta = {
        title: terms ? `Catálogo: ${terms}` : 'Catálogo',
        date: new Date().toLocaleDateString('pt-BR'),
        shop: btn.dataset.shop || '',
        domain: btn.dataset.domain || location.host,
        logo: await loadImage(btn.dataset.logo),
      };

      const perPage = COLS * ROWS;
      const totalPages = Math.ceil(products.length / perPage);
      const blobs = [];
      for (let p = 0; p < totalPages; p++) {
        setLabel(`Gerando imagem ${p + 1}/${totalPages}…`);
        const chunk = products.slice(p * perPage, (p + 1) * perPage);
        const images = await Promise.all(chunk.map((product) => loadImage(product.image)));
        blobs.push(await renderPage(chunk, images, p, totalPages, meta));
      }

      showModal(blobs, `catalogo-${slug(terms)}`);
    } catch (error) {
      console.error('[search-catalog]', error);
      alert('Não foi possível gerar o catálogo. Tente novamente.');
    } finally {
      setLabel(originalLabel);
      btn.disabled = false;
    }
  });
})();
