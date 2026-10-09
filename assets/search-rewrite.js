/*
 * Busca por campos (BRK).
 * A busca livre da Shopify mistura resultados semânticos (ex.: "botina" => 1000 resultados,
 * "inox" => camisas). Aqui o termo digitado vira uma consulta por campos, onde cada palavra
 * precisa aparecer em título, tipo, tag, fornecedor, variante, SKU ou descrição:
 *   botina preta => (title:botina OR ... OR body:botina) AND (title:preta OR ... OR body:preta)
 * A Shopify já ignora acentos e trata plural nesse modo.
 * Se a consulta por campos não achar nada (erro de digitação, palavra incompleta), cai na
 * busca livre original com ?sf=1 para não deixar o cliente sem resultado.
 * A seção main-search extrai a palavra digitada de volta (snippets/search-raw-terms.liquid).
 */
(function () {
  const FIELDS = ['title', 'product_type', 'tag', 'vendor', 'variants.title', 'variants.sku', 'body'];
  const STOPWORDS = ['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'com', 'para', 'pra', 'em', 'no', 'na', 'p/'];
  const MAX_WORDS = 6;

  function words(raw) {
    const all = String(raw || '')
      .replace(/[()":*\\]/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^[-+]+/, '').toLowerCase())
      .filter(Boolean);
    const meaningful = all.filter((w) => !STOPWORDS.includes(w));
    return (meaningful.length ? meaningful : all).slice(0, MAX_WORDS);
  }

  function build(raw) {
    return words(raw)
      .map((w) => '(' + FIELDS.map((f) => `${f}:${w}`).join(' OR ') + ')')
      .join(' AND ');
  }

  // Consultas que já usam sintaxe de campo (id:, product_type:, etc.) não são mexidas.
  function isPlain(q) {
    return !!q && !q.includes(':');
  }

  function searchPath() {
    return (window.routes && window.routes.search_url) || '/search';
  }

  window.BrkSearch = { build, isPlain };

  // Formulários de busca (cabeçalho, popup, drawer, página de busca).
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return;
    const action = new URL(form.getAttribute('action') || '', location.origin);
    if (action.pathname !== searchPath()) return;
    const params = new URLSearchParams(new FormData(form));
    const raw = (params.get('q') || '').trim();
    if (!isPlain(raw)) return;
    const q = build(raw);
    if (!q) return;
    event.preventDefault();
    params.set('q', q);
    location.href = `${action.pathname}?${params}`;
  });

  // Página de busca aberta direto por link (ex.: "ver todos" da busca rápida) ou sem resultado.
  const section = document.querySelector('[data-search-raw]');
  if (!section) return;
  const url = new URL(location.href);
  const state = section.dataset.searchRewrite;
  const raw = section.dataset.searchRaw || '';

  // Título da aba vem da Shopify com a consulta por campos; mostra o que o cliente digitou.
  const structured = url.searchParams.get('q') || '';
  if (raw && structured.includes('(title:')) document.title = document.title.replace(structured, raw);
  const reveal = () => document.documentElement.classList.add('brk-search-ready');

  if (url.searchParams.get('sf') === '1') {
    document.documentElement.classList.add('brk-search-approx');
    const h1 = section.querySelector('.page-title h1');
    if (h1 && raw) h1.textContent = `Resultados aproximados para "${raw}"`;
    document.title = document.title.replace(/\d[\d.]*\s+resultados?\s+encontrados?\s+para/i, 'Resultados aproximados para');
    return reveal();
  }

  if (state === 'plain') {
    const q = build(url.searchParams.get('q') || raw);
    if (!q) return reveal();
    url.searchParams.set('q', q);
    url.searchParams.delete('page');
    return location.replace(url.toString());
  }

  // Com filtro aplicado, "sem resultado" é legítimo (filtro restrito demais): não troca de modo.
  const hasFilters = [...url.searchParams.keys()].some((k) => k.startsWith('filter.'));
  if (state === 'empty' && raw && !hasFilters) {
    url.searchParams.set('q', raw);
    url.searchParams.set('sf', '1');
    url.searchParams.delete('page');
    return location.replace(url.toString());
  }

  reveal();
})();
