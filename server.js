const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 7777;

// Security and performance headers for WebAssembly / SharedArrayBuffer
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// Serve static assets from public/ with zero-cache headers
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Health check endpoint with complete Published Data API & Stockfish 19 engine status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'DeepChess Pro Max (Chess.com Review Engine)',
    engine: 'Stockfish 19 (Chess.com Official WASM / CAPS2 Enabled)',
    publishedDataApi: {
      status: 'active',
      specification: 'https://www.chess.com/news/view/published-data-api',
      baseUrl: 'https://api.chess.com/pub/',
      endpoints: [
        '/api/chesscom/pub/*',
        '/api/chesscom/player/:username',
        '/api/chesscom/player/:username/stats',
        '/api/chesscom/player/:username/is-online',
        '/api/chesscom/player/:username/games',
        '/api/chesscom/player/:username/games/to-move',
        '/api/chesscom/player/:username/games/archives',
        '/api/chesscom/player/:username/games/:year/:month',
        '/api/chesscom/player/:username/games/:year/:month/pgn',
        '/api/chesscom/player/:username/clubs',
        '/api/chesscom/club/:urlId',
        '/api/chesscom/club/:urlId/members',
        '/api/chesscom/club/:urlId/matches',
        '/api/chesscom/tournament/:urlId',
        '/api/chesscom/tournament/:urlId/:round',
        '/api/chesscom/tournament/:urlId/:round/:group',
        '/api/chesscom/country/:iso',
        '/api/chesscom/country/:iso/players',
        '/api/chesscom/country/:iso/clubs',
        '/api/chesscom/leaderboards',
        '/api/chesscom/titled/:title',
        '/api/chesscom/streamers',
        '/api/chesscom/puzzle',
        '/api/chesscom/puzzle/random'
      ]
    },
    port: DEFAULT_PORT,
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// CHESS.COM PUBLISHED DATA API SYSTEM
// Specification: https://www.chess.com/news/view/published-data-api
// Base: https://api.chess.com/pub/
// ============================================================
const pubApiCache = new Map();

async function fetchChessComPub(endpointPath, ttlMs = 120000, asText = false) {
  const cleanPath = endpointPath.replace(/^\/+/, '');
  const cacheKey = `${asText ? 'text:' : 'json:'}${cleanPath}`;
  const now = Date.now();

  if (pubApiCache.has(cacheKey)) {
    const cached = pubApiCache.get(cacheKey);
    if (now < cached.expiresAt) {
      return cached.data;
    }
    pubApiCache.delete(cacheKey);
  }

  const targetUrl = `https://api.chess.com/pub/${cleanPath}`;
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'ChessTrainerBot/2.0 (DeepChessPro; contact: admin@chess-trainer.local)',
      'Accept': asText ? 'text/plain, application/x-chess-pgn, */*' : 'application/json'
    }
  });

  if (!response.ok) {
    const err = new Error(`Chess.com Pub API error: ${response.status} ${response.statusText}`);
    err.status = response.status;
    throw err;
  }

  const data = asText ? await response.text() : await response.json();
  pubApiCache.set(cacheKey, { data, expiresAt: now + ttlMs, isText: asText });
  return data;
}

// 1. Universal Passthrough Proxy: /api/chesscom/pub/*
app.use('/api/chesscom/pub', async (req, res) => {
  try {
    const rawPath = req.path.replace(/^\/+/, '');
    const isPgn = rawPath.endsWith('/pgn');
    const data = await fetchChessComPub(rawPath, 120000, isPgn);
    if (isPgn) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(data);
    }
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// 2. Player Data Endpoints
app.get('/api/chesscom/player/:username', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const data = await fetchChessComPub(`player/${u}`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/player/:username/stats', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const data = await fetchChessComPub(`player/${u}/stats`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/player/:username/is-online', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const data = await fetchChessComPub(`player/${u}/is-online`, 30000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/player/:username/games', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const data = await fetchChessComPub(`player/${u}/games`, 60000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/player/:username/games/to-move', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const data = await fetchChessComPub(`player/${u}/games/to-move`, 60000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/player/:username/games/archives', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const data = await fetchChessComPub(`player/${u}/games/archives`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/player/:username/games/:year/:month', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const { year, month } = req.params;
    const m = month.padStart(2, '0');
    const data = await fetchChessComPub(`player/${u}/games/${year}/${m}`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/player/:username/games/:year/:month/pgn', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const { year, month } = req.params;
    const m = month.padStart(2, '0');
    const data = await fetchChessComPub(`player/${u}/games/${year}/${m}/pgn`, 300000, true);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/player/:username/clubs', async (req, res) => {
  try {
    const u = encodeURIComponent(req.params.username.toLowerCase().trim());
    const data = await fetchChessComPub(`player/${u}/clubs`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// 3. Club Data Endpoints
app.get('/api/chesscom/club/:urlId', async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.urlId.toLowerCase().trim());
    const data = await fetchChessComPub(`club/${id}`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/club/:urlId/members', async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.urlId.toLowerCase().trim());
    const data = await fetchChessComPub(`club/${id}/members`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/club/:urlId/matches', async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.urlId.toLowerCase().trim());
    const data = await fetchChessComPub(`club/${id}/matches`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// 4. Tournament Endpoints
app.get('/api/chesscom/tournament/:urlId', async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.urlId.toLowerCase().trim());
    const data = await fetchChessComPub(`tournament/${id}`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/tournament/:urlId/:round', async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.urlId.toLowerCase().trim());
    const { round } = req.params;
    const data = await fetchChessComPub(`tournament/${id}/${round}`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/tournament/:urlId/:round/:group', async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.urlId.toLowerCase().trim());
    const { round, group } = req.params;
    const data = await fetchChessComPub(`tournament/${id}/${round}/${group}`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// 5. Country Data Endpoints
app.get('/api/chesscom/country/:iso', async (req, res) => {
  try {
    const iso = encodeURIComponent(req.params.iso.toUpperCase().trim());
    const data = await fetchChessComPub(`country/${iso}`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/country/:iso/players', async (req, res) => {
  try {
    const iso = encodeURIComponent(req.params.iso.toUpperCase().trim());
    const data = await fetchChessComPub(`country/${iso}/players`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/country/:iso/clubs', async (req, res) => {
  try {
    const iso = encodeURIComponent(req.params.iso.toUpperCase().trim());
    const data = await fetchChessComPub(`country/${iso}/clubs`, 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// 6. Leaderboards, Titled Players, Streamers & Puzzles
app.get('/api/chesscom/leaderboards', async (req, res) => {
  try {
    const data = await fetchChessComPub('leaderboards', 600000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/titled/:title', async (req, res) => {
  try {
    const title = encodeURIComponent(req.params.title.toUpperCase().trim());
    const data = await fetchChessComPub(`titled/${title}`, 600000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/streamers', async (req, res) => {
  try {
    const data = await fetchChessComPub('streamers', 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/puzzle', async (req, res) => {
  try {
    const data = await fetchChessComPub('puzzle', 300000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

app.get('/api/chesscom/puzzle/random', async (req, res) => {
  try {
    const data = await fetchChessComPub('puzzle/random', 5000);
    return res.json(data);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// Country Code ISO Mapping and Resolver
const COUNTRY_CODE_MAP = {
  'bulgaria': 'BG', 'uzbekistan': 'UZ', 'vietnam': 'VN', 'norway': 'NO',
  'united states': 'US', 'russia': 'RU', 'ukraine': 'UA', 'india': 'IN',
  'germany': 'DE', 'france': 'FR', 'china': 'CN', 'spain': 'ES',
  'brazil': 'BR', 'canada': 'CA', 'united kingdom': 'GB', 'poland': 'PL',
  'italy': 'IT', 'netherlands': 'NL', 'sweden': 'SE', 'armenia': 'AM',
  'azerbaijan': 'AZ', 'israel': 'IL', 'kazakhstan': 'KZ', 'turkey': 'TR',
  'hungary': 'HU', 'romania': 'RO', 'czechia': 'CZ', 'argentina': 'AR',
  'cuba': 'CU', 'serbia': 'RS', 'philippines': 'PH', 'indonesia': 'ID',
  'georgia': 'GE', 'greece': 'GR', 'croatia': 'HR', 'austria': 'AT',
  'switzerland': 'CH', 'belgium': 'BE', 'denmark': 'DK', 'finland': 'FI',
  'portugal': 'PT', 'mexico': 'MX', 'colombia': 'CO', 'chile': 'CL',
  'peru': 'PE', 'egypt': 'EG', 'south africa': 'ZA', 'australia': 'AU',
  'new zealand': 'NZ', 'singapore': 'SG', 'malaysia': 'MY', 'thailand': 'TH',
  'japan': 'JP', 'south korea': 'KR', 'mongolia': 'MN'
};

async function resolveCountryIso(username, existingCode, existingName) {
  if (existingCode && existingCode.trim().length === 2) return existingCode.trim().toUpperCase();
  if (existingName && COUNTRY_CODE_MAP[existingName.toLowerCase().trim()]) {
    return COUNTRY_CODE_MAP[existingName.toLowerCase().trim()];
  }
  if (!username) return 'UN';
  try {
    const pRes = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase().trim())}`, {
      headers: { 'User-Agent': 'ChessTrainerBot/2.0' }
    });
    if (pRes.ok) {
      const pData = await pRes.json();
      if (pData.country) {
        const iso = pData.country.split('/').pop().toUpperCase();
        if (iso && iso.length === 2) return iso;
      }
    }
  } catch (_) {}
  return 'UN';
}

// In-memory cache for imported games (instant re-checking)
const importedGamesCache = new Map();

// Import game from Chess.com or Lichess URL
app.post('/api/import-game', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL không hợp lệ' });
    }

    const trimmedUrl = url.trim();

    // Check fast cache first (<1ms response)
    if (importedGamesCache.has(trimmedUrl)) {
      return res.json(importedGamesCache.get(trimmedUrl));
    }

    // 1. Handle Lichess URL
    if (trimmedUrl.includes('lichess.org/')) {
      const match = trimmedUrl.match(/lichess\.org\/([a-zA-Z0-9]{8})/);
      if (!match) {
        return res.status(400).json({ error: 'Không tìm thấy Game ID Lichess trong URL' });
      }
      const gameId = match[1];
      const lichessRes = await fetch(`https://lichess.org/game/export/${gameId}`, {
        headers: { 'User-Agent': 'DeepChessPro/2.0' }
      });
      if (!lichessRes.ok) {
        return res.status(400).json({ error: `Lichess trả về mã lỗi: ${lichessRes.status}` });
      }
      const pgn = await lichessRes.text();
      return res.json({
        success: true,
        source: 'Lichess',
        gameId,
        pgn
      });
    }

    // 2. Handle Chess.com URL
    if (trimmedUrl.includes('chess.com/')) {
      const match = trimmedUrl.match(/(?:game\/live|analysis\/game\/live|game\/daily)\/(\d+)/);
      if (!match) {
        return res.status(400).json({ error: 'Không tìm thấy Game ID Chess.com trong URL' });
      }
      const gameId = match[1];

      // Check local game JSON file if available
      const localGameFile = path.join(__dirname, `game_${gameId}.json`);
      if (fs.existsSync(localGameFile)) {
        try {
          const raw = fs.readFileSync(localGameFile, 'utf8');
          const gObj = JSON.parse(raw);
          const pgnMatch = gObj.pgn || '';
          const resPayload = {
            success: true,
            source: 'Chess.com',
            gameId,
            headers: {
              White: gObj.white?.username || 'White',
              Black: gObj.black?.username || 'Black',
              WhiteElo: gObj.white?.rating || 1500,
              BlackElo: gObj.black?.rating || 1500,
              Result: (pgnMatch.match(/\[Result\s+"([^"]+)"\]/) || [])[1] || '1/2-1/2',
              Termination: (pgnMatch.match(/\[Termination\s+"([^"]+)"\]/) || [])[1] || 'Game drawn',
              TimeControl: gObj.time_control || '180'
            },
            players: gObj.players || {
              white: {
                username: gObj.white?.username || 'White',
                rating: gObj.white?.rating || 1500,
                ratingDiff: gObj.white?.ratingDiff ?? 0,
                title: gObj.white?.title || '',
                avatarUrl: gObj.white?.avatarUrl || '',
                countryCode: gObj.white?.countryCode || 'VN',
                countryName: gObj.white?.countryName || 'Vietnam',
                membershipCode: gObj.white?.membershipCode || 'basic',
                result: gObj.white?.result || ''
              },
              black: {
                username: gObj.black?.username || 'Black',
                rating: gObj.black?.rating || 1500,
                ratingDiff: gObj.black?.ratingDiff ?? 0,
                title: gObj.black?.title || '',
                avatarUrl: gObj.black?.avatarUrl || '',
                countryCode: gObj.black?.countryCode || 'UN',
                countryName: gObj.black?.countryName || 'United Nations',
                membershipCode: gObj.black?.membershipCode || 'basic',
                result: gObj.black?.result || ''
              }
            },
            accuracies: gObj.accuracies || null,
            accuracy: gObj.accuracy || null,
            performanceRating: gObj.performanceRating || null,
            breakdown: gObj.breakdown || null,
            phases: gObj.phases || null,
            pgn: gObj.pgn
          };
          importedGamesCache.set(trimmedUrl, resPayload);
          return res.json(resPayload);
        } catch (e) {
          console.warn('Local game read warning:', e.message);
        }
      }

      // Query Chess.com callback to find players, avatars, titles, and date
      const cbRes = await fetch(`https://www.chess.com/callback/live/game/${gameId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });

      if (!cbRes.ok) {
        return res.status(400).json({ error: `Không thể nạp thông tin game Chess.com (Mã: ${cbRes.status})` });
      }

      const cbData = await cbRes.json();
      if (!cbData.game || !cbData.game.pgnHeaders) {
        return res.status(400).json({ error: 'Không tìm thấy thông tin PGN trong ván cờ Chess.com' });
      }

      const pgnHeaders = cbData.game.pgnHeaders;
      const whitePlayer = pgnHeaders.White;
      const blackPlayer = pgnHeaders.Black;
      const dateStr = pgnHeaders.Date; // e.g. "2026.11.07"
      let year, month;
      if (dateStr) {
        const parts = dateStr.split(/[.\-/]/);
        if (parts.length >= 2) {
          year = parts[0];
          month = parts[1].padStart(2, '0');
        }
      }
      if (!year || !month) {
        const dateObj = cbData.game.endTime ? new Date(cbData.game.endTime * 1000) : new Date();
        year = String(dateObj.getUTCFullYear());
        month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
      }

      // Extract detailed player metadata
      let whiteMeta = { username: whitePlayer, rating: pgnHeaders.WhiteElo || 1500, title: '', avatarUrl: '' };
      let blackMeta = { username: blackPlayer, rating: pgnHeaders.BlackElo || 1500, title: '', avatarUrl: '' };

      if (cbData.players) {
        const top = cbData.players.top;
        const bottom = cbData.players.bottom;
        if (top) {
          const cName = top.countryName || top.countryCode || '';
          const cCode = top.countryCode || COUNTRY_CODE_MAP[cName.toLowerCase()] || '';
          const m = {
            username: top.username,
            rating: top.rating,
            title: top.chessTitle || '',
            avatarUrl: top.avatarUrl || '',
            countryCode: cCode,
            countryName: cName,
            membershipCode: top.membershipCode || 'basic'
          };
          if (top.color === 'white') whiteMeta = m;
          else blackMeta = m;
        }
        if (bottom) {
          const cName = bottom.countryName || bottom.countryCode || '';
          const cCode = bottom.countryCode || COUNTRY_CODE_MAP[cName.toLowerCase()] || '';
          const m = {
            username: bottom.username,
            rating: bottom.rating,
            title: bottom.chessTitle || '',
            avatarUrl: bottom.avatarUrl || '',
            countryCode: cCode,
            countryName: cName,
            membershipCode: bottom.membershipCode || 'basic'
          };
          if (bottom.color === 'white') whiteMeta = m;
          else blackMeta = m;
        }
      }

      // Always resolve universal country ISO code for both players via pub API or map
      const [resolvedWhiteIso, resolvedBlackIso] = await Promise.all([
        resolveCountryIso(whiteMeta.username, whiteMeta.countryCode, whiteMeta.countryName),
        resolveCountryIso(blackMeta.username, blackMeta.countryCode, blackMeta.countryName)
      ]);
      whiteMeta.countryCode = resolvedWhiteIso;
      whiteMeta.flag = resolvedWhiteIso;
      blackMeta.countryCode = resolvedBlackIso;
      blackMeta.flag = resolvedBlackIso;

      let fullPgn = '';
      let accuracies = null;

      // Try fetching from player archive (try white first, then black)
      const playersToTry = [whitePlayer, blackPlayer].filter(Boolean);
      for (const p of playersToTry) {
        if (fullPgn && accuracies) break;
        if (!year || !month) break;

        try {
          const archiveRes = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(p.toLowerCase())}/games/${year}/${month}`, {
            headers: { 'User-Agent': 'ChessTrainerBot/1.0' }
          });

          if (archiveRes.ok) {
            const archiveData = await archiveRes.json();
            if (archiveData.games && Array.isArray(archiveData.games)) {
              const foundGame = archiveData.games.find(g => g.url.includes(gameId));
              if (foundGame) {
                if (foundGame.pgn) fullPgn = foundGame.pgn;
                if (foundGame.accuracies) accuracies = foundGame.accuracies;
                break;
              }
            }
          }
        } catch (e) {
          console.warn('Archive fetch warning:', e.message);
        }
      }

      // If not in archive yet, construct valid PGN from headers
      if (!fullPgn) {
        for (const [key, val] of Object.entries(pgnHeaders)) {
          fullPgn += `[${key} "${val}"]\n`;
        }
        fullPgn += `\n`;
      }

      const resultPayload = {
        success: true,
        source: 'Chess.com',
        gameId,
        headers: pgnHeaders,
        players: {
          white: whiteMeta,
          black: blackMeta
        },
        accuracies,
        pgn: fullPgn
      };

      importedGamesCache.set(trimmedUrl, resultPayload);
      return res.json(resultPayload);
    }

    // 3. Handle Direct Username via Published Data API (e.g. "hikaru", "magnuscarlsen", "@username", "player:username")
    const userMatch = trimmedUrl.match(/^(?:@|player:)?([a-zA-Z0-9_\-]{3,30})$/);
    if (userMatch && !trimmedUrl.includes('.')) {
      const username = userMatch[1].toLowerCase();
      const archData = await fetchChessComPub(`player/${username}/games/archives`, 60000);
      if (!archData.archives || !archData.archives.length) {
        return res.status(404).json({ error: `Không tìm thấy kho lưu trữ ván cờ của '${username}' trên Chess.com` });
      }

      const latestArchive = archData.archives[archData.archives.length - 1];
      const parts = latestArchive.split('/');
      const yr = parts[parts.length - 2];
      const mo = parts[parts.length - 1];
      const monthData = await fetchChessComPub(`player/${username}/games/${yr}/${mo}`, 60000);

      if (!monthData.games || !monthData.games.length) {
        return res.status(404).json({ error: `Kỳ thủ '${username}' chưa có ván cờ hoàn tất trong tháng gần nhất.` });
      }

      const foundGame = monthData.games[monthData.games.length - 1];
      const gameIdMatch = (foundGame.url || '').match(/(\d+)$/);
      const gameId = gameIdMatch ? gameIdMatch[1] : `game_${Date.now()}`;

      // Resolve country ISO for both players
      const [wIso, bIso] = await Promise.all([
        resolveCountryIso(foundGame.white?.username, '', ''),
        resolveCountryIso(foundGame.black?.username, '', '')
      ]);

      const resultPayload = {
        success: true,
        source: 'Chess.com Published Data API (Archive)',
        gameId,
        url: foundGame.url,
        headers: {
          White: foundGame.white?.username || 'White',
          Black: foundGame.black?.username || 'Black',
          WhiteElo: foundGame.white?.rating || 1500,
          BlackElo: foundGame.black?.rating || 1500,
          TimeControl: foundGame.time_control || '180'
        },
        players: {
          white: {
            username: foundGame.white?.username || 'White',
            rating: foundGame.white?.rating || 1500,
            countryCode: wIso,
            flag: wIso,
            result: foundGame.white?.result || ''
          },
          black: {
            username: foundGame.black?.username || 'Black',
            rating: foundGame.black?.rating || 1500,
            countryCode: bIso,
            flag: bIso,
            result: foundGame.black?.result || ''
          }
        },
        accuracies: foundGame.accuracies || null,
        pgn: foundGame.pgn
      };

      importedGamesCache.set(trimmedUrl, resultPayload);
      return res.json(resultPayload);
    }

    return res.status(400).json({ error: 'URL không thuộc Chess.com hoặc Lichess' });
  } catch (err) {
    console.error('Import game error:', err);
    res.status(500).json({ error: 'Lỗi server khi nạp link ván đấu: ' + err.message });
  }
});

app.get('/api/proxy-image', async (req, res) => {
  const imgUrl = req.query.url;
  if (!imgUrl) return res.redirect('/assets/default-user.svg');
  try {
    const response = await fetch(imgUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!response.ok) return res.redirect('/assets/default-user.svg');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (e) {
    return res.redirect('/assets/default-user.svg');
  }
});

// Explicit SPA routes for game links
app.get(['/game/live/:id', '/analysis/game/live/:id'], (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Fallback to index.html for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`===================================================`);
    console.log(`♟️ DeepChess Pro Max is running!`);
    console.log(`🌐 Local URL: http://localhost:${port}`);
    console.log(`⚡ Stockfish 16 Engine (CAPS2 Review Engine): Ready`);
    console.log(`===================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${port} is busy, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(DEFAULT_PORT);
