/**
 * sheets.js — Mandimba FC
 * Busca dados das 3 abas do Google Sheets via CSV público.
 *
 * COMO PUBLICAR A PLANILHA:
 *   Planilha → Arquivo → Compartilhar → Publicar na web
 *   → Publicar cada aba como CSV → copiar URL (não é necessário, o export direto abaixo funciona)
 *
 * Se a planilha estiver com acesso "Qualquer pessoa com o link pode ver",
 * o export CSV abaixo funciona sem autenticação.
 */

const SHEET_ID = '1Wv6vyuujDWY3mUIsC04leLcF2aygdwZeZ-uAu0v02jI';

// URLs de export CSV por nome de aba (gid descoberto dinamicamente ou fixo)
// Nomes das abas conforme visto na planilha
const TABS = {
  jogos:         { name: 'JOGOS',          gid: '653989414', headerRow: 4 },
  classificacao: { name: 'CLASSIFICAÇÃO',  gid: '627501198', headerRow: 1 },
  jogadores:     { name: 'JOGADORES',      gid: '479712378', headerRow: 4 },
};

// Cache em memória para não re-fetchar na mesma sessão
const _cache = {};

function csvURL(gid) {
  return `https://docs.google.com/spreadsheets/d/e/2PACX-1vTx_tYrAv5hEef1kS-mvz1CfJvh_voKvOyiQ97Ybz4EynADCYdBbh5HmRlWuD5l4P800mu4pwUeP9RU/pub?gid=${gid}&single=true&output=csv`;
}

/**
 * Faz parse de uma string CSV respeitando campos com aspas e vírgulas internas.
 */
function parseCSV(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/);
  for (const line of lines) {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

/**
 * Normaliza string para comparação de headers
 * (remove acentos, espaços extras, maiúsculas)
 */
function norm(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Converte array de linhas CSV em array de objetos usando a linha de header.
 * headerRowIndex: índice da linha que contém os cabeçalhos (default 0).
 */
function toObjects(rows, headerRowIndex = 0) {
  if (!rows || rows.length <= headerRowIndex) return [];
  const headers = rows[headerRowIndex].map(h => norm(h));
  return rows.slice(headerRowIndex + 1)
    .filter(r => r.some(c => c !== ''))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
      return obj;
    });
}

/**
 * Descobre os GIDs de todas as abas buscando a página HTML da planilha pública.
 * Retorna um Map { nomeNormalizado → gid }
 */
async function discoverGIDs() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/pubhtml`;
    const r = await fetch(url);
    const html = await r.text();
    const map = new Map();
    // Padrão: <li class="..."><a href="...#gid=123456">NOME</a></li>
    const re = /#gid=(\d+)[^>]*>([^<]+)</g;
    let m;
    while ((m = re.exec(html)) !== null) {
      map.set(norm(m[2]), m[1]);
    }
    // Fallback: tenta extrair de script bootstrap
    if (map.size === 0) {
      const re2 = /"sheetId":(\d+),"title":"([^"]+)"/g;
      while ((m = re2.exec(html)) !== null) {
        map.set(norm(m[2]), m[1]);
      }
    }
    return map;
  } catch(e) {
    return new Map();
  }
}

/**
 * Inicializa os GIDs (só roda uma vez por sessão).
 */
let _gidsReady = null;
async function ensureGIDs() {
  if (_gidsReady) return _gidsReady;
  const map = await discoverGIDs();

  for (const key of Object.keys(TABS)) {
    const tab = TABS[key];
    const found = map.get(norm(tab.name));
    if (found) {
      tab.gid = found;
    }
  }

  // Fallback: se não achou, usa gids conhecidos / ordem padrão
  // (gid=0 é sempre a primeira aba; as demais são descobertas acima)
  // Com base nas imagens: JOGOS é provavelmente a 1ª aba (gid=0)
  if (!TABS.jogos.gid)         TABS.jogos.gid         = '653989414';
  if (!TABS.classificacao.gid) TABS.classificacao.gid  = '627501198'; // capturado da URL ao abrir
  if (!TABS.jogadores.gid)     TABS.jogadores.gid      = '479712378'; // estimado

  _gidsReady = true;
  return _gidsReady;
}

/**
 * Busca e parseia uma aba. Retorna array de objetos.
 * @param {'jogos'|'classificacao'|'jogadores'} tab
 * @param {number} headerRow  índice da linha de header (0-based)
 */
async function fetchTab(tab, headerRow) {
  if (headerRow === undefined) headerRow = TABS[tab].headerRow ?? 0;
  if (_cache[tab]) return _cache[tab];
  await ensureGIDs();
  const url = csvURL(TABS[tab].gid);
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    const rows = parseCSV(text);
    const data = toObjects(rows, headerRow);
    _cache[tab] = data;
    return data;
  } catch(e) {
    console.warn(`[sheets.js] Erro ao buscar aba "${tab}":`, e.message);
    return [];
  }
}

/**
 * API pública
 */
window.MandimbaDB = {

  /** Retorna todos os jogos */
  async jogos() {
    // Aba JOGOS tem header na linha 1 (row index 0 após pular linha do logo)
    // Colunas: Data | Adversário | Campeonato | Resultado | Placar Mandimba | Placar Visitante | Saldo de Gols
    // A linha 0 pode ser o cabeçalho visual (logo), então testamos ambos
    const raw = await fetchTab('jogos', 0);
    // Se o primeiro objeto tiver chave "data", está certo. Senão tenta headerRow=1
    if (raw.length && Object.keys(raw[0]).includes('data')) return raw;
    return await fetchTab('jogos', 1).then(d => (_cache['jogos'] = d, d));
  },

  /** Retorna a classificação */
  async classificacao() {
    // Aba CLASSIFICAÇÃO: linha 0 = título, linha 1 = header real
    const raw = await fetchTab('classificacao', 0);
    const keys = raw.length ? Object.keys(raw[0]) : [];
    if (keys.includes('time')) return raw;
    // Tenta pulando 1 linha (título "COPA AMSTEL...")
    _cache['classificacao'] = null;
    return await fetchTab('classificacao', 1).then(d => (_cache['classificacao'] = d, d));
  },

  /** Retorna jogadores */
  async jogadores() {
    // Aba JOGADORES: linhas 0-3 = header visual, linha 4 = header real (NOME | POSIÇÃO | ...)
    // Tenta vários offsets
    for (const hr of [0, 1, 2, 3, 4]) {
      _cache['jogadores'] = null;
      const d = await fetchTab('jogadores', hr);
      if (d.length && (Object.keys(d[0]).includes('nome') || Object.keys(d[0]).includes('gols'))) {
        _cache['jogadores'] = d;
        return d;
      }
    }
    return [];
  },

  /** Utilitário: próximo jogo (primeiro sem placar) */
  async proximoJogo() {
    const jogos = await this.jogos();
    return jogos.find(j => {
      const pm = j['placar mandimba'] ?? j['placar_mandimba'] ?? '';
      return pm === '' || pm === '-' || pm === '0' && (j['resultado'] ?? '') === '';
    }) || null;
  },

  /** Utilitário: últimos N jogos com placar preenchido */
  async ultimosJogos(n = 5) {
    const jogos = await this.jogos();
    return jogos
      .filter(j => {
        const res = j['resultado'] ?? '';
        return res !== '' && res !== '-';
      })
      .slice(-n)
      .reverse();
  },

  /** Utilitário: posição do Mandimba na classificação */
  async posicaoMandimba() {
    const cls = await this.classificacao();
    const idx = cls.findIndex(r =>
      norm(r['time'] ?? '').includes('mandimba')
    );
    return idx >= 0 ? idx + 1 : null;
  },

  /** Utilitário: artilheiros (top N por gols) */
  async artilheiros(n = 5) {
    const jogs = await this.jogadores();
    return [...jogs]
      .sort((a, b) => Number(b['gols'] || 0) - Number(a['gols'] || 0))
      .slice(0, n);
  },
};
