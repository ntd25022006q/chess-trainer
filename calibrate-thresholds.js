/**
 * Chess.com Threshold Calibration Tool v2
 * Uses Stockfish 19 NNUE (sf.processCommand API) + MultiPV 2
 * Outputs per-move win% drops, then tests multiple threshold configs
 * 
 * Chess.com Reference for 173033536202 (VickyNTD vs VIIWIIV):
 *   Brilliant: W=0, B=1   | Great:  W=2, B=1  | Book: W=3, B=2
 *   Best:  W=23, B=18     | Good:   W=13, B=9  | Solid: W=5, B=9
 *   Inacc: W=6, B=8       | Miss:   W=3, B=3   | Mistake: W=0, B=6
 *   Blunder: W=3, B=1     | Accuracy: W=73.1, B=64.8
 */

const { Chess } = require('./public/lib/chess.js');
const Stockfish = require('./public/engine/stockfish.js');
const fs = require('fs');

// ===========================================================
// Chess.com Ground Truth
// ===========================================================
const CHESS_COM_TRUTH = {
  white: { brilliant: 0, great: 2, book: 3, best: 23, good: 13, solid: 5, inaccuracy: 6, mistake: 0, miss: 3, blunder: 3 },
  black: { brilliant: 1, great: 1, book: 2, best: 18, good:  9, solid: 9, inaccuracy: 8, mistake: 6, miss: 3, blunder: 1 }
};

// Win% sigmoid (Chess.com official)
function winChance(cp) {
  return Math.max(0, Math.min(100, Math.round(50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1))));
}

// ===========================================================
// Stockfish evaluate one FEN at given depth with MultiPV=2
// Returns { scoreWhite, winChance, bestMove, pv, isMate, secondWinChance, secondBestMove }
// ===========================================================
function evaluateFen(sf, fen, depth) {
  return new Promise((resolve) => {
    const turn = fen.split(' ')[1] || 'w';
    const lines = {};
    let resolved = false;
    let isMateResult = false;
    let mateInWhiteResult = 0;

    const origListener = sf.listener;
    sf.listener = (line) => {
      if (resolved) return;

      if (line.startsWith('bestmove')) {
        resolved = true;
        sf.listener = origListener;
        const bm = line.split(' ')[1] || null;
        const l1 = lines[1] || {};
        const l2 = lines[2] || {};
        resolve({
          scoreWhite: l1.scoreWhite ?? 0,
          winChance: l1.winChance ?? 50,
          bestMove: l1.bestMove ?? bm,
          pv: l1.pv ?? '',
          isMate: l1.isMate ?? false,
          mateInWhite: l1.mateInWhite ?? 0,
          secondWinChance: l2.winChance ?? null,
          secondBestMove: l2.bestMove ?? null
        });
        return;
      }

      if (line.startsWith('info') && line.includes('score')) {
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
        const pvMatch = line.match(/\bpv\s+(.+)$/);
        const mpvMatch = line.match(/\bmultipv\s+(\d+)/);
        const idx = mpvMatch ? parseInt(mpvMatch[1]) : 1;

        let score = 0, isMate = false, mateIn = 0;
        if (cpMatch) score = parseInt(cpMatch[1]);
        else if (mateMatch) { isMate = true; mateIn = parseInt(mateMatch[1]); }

        const scoreWhite = turn === 'b' ? -score : score;
        const mateInWhite = turn === 'b' ? -mateIn : mateIn;
        let wc;
        if (isMate) wc = mateInWhite > 0 ? 100 : 0;
        else wc = winChance(scoreWhite);

        const pv = pvMatch ? pvMatch[1].trim() : '';
        lines[idx] = {
          scoreWhite,
          isMate,
          mateInWhite,
          winChance: wc,
          pv,
          bestMove: pv ? pv.split(' ')[0] : null
        };
      }
    };

    sf.processCommand('setoption name MultiPV value 2');
    sf.processCommand(`position fen ${fen}`);
    sf.processCommand(`go depth ${depth}`);

    // Safety timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sf.listener = origListener;
        const l1 = lines[1] || {};
        const l2 = lines[2] || {};
        resolve({
          scoreWhite: l1.scoreWhite ?? 0,
          winChance: l1.winChance ?? 50,
          bestMove: l1.bestMove ?? null,
          pv: l1.pv ?? '',
          isMate: false,
          mateInWhite: 0,
          secondWinChance: l2.winChance ?? null,
          secondBestMove: l2.bestMove ?? null
        });
      }
    }, 25000);
  });
}

// ===========================================================
// OPENING BOOK (same as gameReview.js)
// ===========================================================
const OPENING_BOOK = new Set(['e4','d4','d5','e5','c4','c5','c6','e6','Nf3','Nc3',
  'Nc6','Nf6','Nd2','exd5','Qxd5','dxe4','Nxe4','Bc4','Bb5','Be2','g3','Bg2',
  'O-O','O-O-O','Re8']);

// ===========================================================
// MAIN
// ===========================================================
async function main() {
  const gameData = JSON.parse(fs.readFileSync('./game_173033536202.json', 'utf8'));
  const pgn = gameData.pgn;
  const accuracyFromApi = gameData.accuracies;

  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true });
  const totalMoves = moves.length;

  console.log(`\n=== Chess.com Calibration Tool — game 173033536202 ===`);
  console.log(`Total plies: ${totalMoves}`);
  console.log(`Chess.com Accuracy: W=${accuracyFromApi.white} B=${accuracyFromApi.black}\n`);

  // Build all FENs
  const tempChess = new Chess();
  const fens = [tempChess.fen()];
  for (const m of moves) {
    tempChess.move(m);
    fens.push(tempChess.fen());
  }

  // Init Stockfish 19
  console.log('Starting Stockfish 19 NNUE...');
  const sf = Stockfish({
    print: (line) => { if (sf.listener) sf.listener(line); }
  });
  sf.listener = null;

  // Wait for init
  await new Promise(r => {
    sf.listener = (line) => { if (line === 'readyok') { sf.listener = null; r(); } };
    sf.processCommand('uci');
    sf.processCommand('setoption name Hash value 64');
    sf.processCommand('setoption name Threads value 2');
    sf.processCommand('isready');
    setTimeout(r, 3000);
  });
  console.log('Stockfish ready.\n');

  const SF_DEPTH = 12; // Depth 12 for better accuracy vs Chess.com
  const sfResults = [];
  const startTime = Date.now();

  for (let i = 0; i <= totalMoves; i++) {
    if (i % 20 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(`Progress: ${i}/${totalMoves + 1} (${elapsed}s)\n`);
    }
    const result = await evaluateFen(sf, fens[i], SF_DEPTH);
    sfResults.push(result);
  }
  console.log(`\nEvaluation done in ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  // ============================================================
  // Build per-move data
  // ============================================================
  const moveData = [];
  for (let idx = 0; idx < moves.length; idx++) {
    const m = moves[idx];
    const ply = idx + 1;
    const side = m.color;
    const isBook = ply <= 8 && OPENING_BOOK.has(m.san);

    const evalBefore = sfResults[idx];
    const evalAfter = sfResults[idx + 1];

    const prevWhiteWC = evalBefore.winChance;
    const currWhiteWC = evalAfter.winChance;
    const prevWin = side === 'w' ? prevWhiteWC : (100 - prevWhiteWC);
    const currWin = side === 'w' ? currWhiteWC : (100 - currWhiteWC);
    const winDrop = Math.max(0, prevWin - currWin);

    // Player matches best move?
    const sfBestUci = evalBefore.bestMove;
    let playerMatchesBest = false;
    if (sfBestUci && sfBestUci.length >= 4) {
      playerMatchesBest = (m.from === sfBestUci.substring(0, 2) && m.to === sfBestUci.substring(2, 4));
    }

    // 2nd best win% gap for Great detection
    let secondDrop = 0;
    if (evalBefore.secondWinChance !== null) {
      const topWin = side === 'w' ? evalBefore.winChance : (100 - evalBefore.winChance);
      const secondWin = side === 'w' ? evalBefore.secondWinChance : (100 - evalBefore.secondWinChance);
      secondDrop = Math.max(0, topWin - secondWin);
    }

    moveData.push({
      idx, ply, side, san: m.san, from: m.from, to: m.to, piece: m.piece,
      captured: m.captured,
      isBook, winDrop, prevWin, currWin, prevWhiteWC, currWhiteWC,
      playerMatchesBest, secondDrop,
      evalBefore, evalAfter
    });
  }

  // Print per-move table
  console.log('=== Per-Move Win% Table ===');
  console.log('Ply | Side | Move        | PrevW  | CurrW  | Drop  | 2ndDrop | PlayerBest | Book');
  console.log('----+------+-------------+--------+--------+-------+---------+------------+------');
  for (const d of moveData) {
    const marker = d.winDrop >= 15 ? ' <!!>' : d.winDrop >= 10 ? ' <!>' : d.winDrop >= 5 ? ' <.>' : '';
    console.log(
      `${String(d.ply).padStart(3)} | ${d.side}    | ${d.san.padEnd(11)} | ${String(d.prevWin.toFixed(1)).padStart(6)} | ${String(d.currWin.toFixed(1)).padStart(6)} | ${String(d.winDrop.toFixed(1)).padStart(5)} | ${String(d.secondDrop.toFixed(1)).padStart(7)} | ${String(d.playerMatchesBest).padEnd(10)} | ${d.isBook}${marker}`
    );
  }

  // ============================================================
  // Classify using different threshold configs
  // ============================================================
  
  // Sacrifice detection: piece moved to en-prise square for less material
  function isSacrificePrimary(d) {
    if (d.isBook || d.piece === 'p') return false;
    const PVALS = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
    const movedVal = PVALS[d.piece] || 100;
    const capVal = d.captured ? (PVALS[d.captured] || 100) : 0;
    // True sacrifice: moved piece worth more than what's captured AND eval stays good
    return capVal < movedVal && d.winDrop <= 3 && d.currWin >= 45;
  }

  function classify(d, cfg) {
    if (d.isBook) return 'book';
    const { winDrop, prevWin, currWin, playerMatchesBest, secondDrop } = d;

    const isSac = isSacrificePrimary(d);
    
    // Brilliant: material sacrifice with maintained advantage
    if (isSac && winDrop <= cfg.brilliantMaxDrop && currWin >= 45) return 'brilliant';
    
    // Great: only viable move, 2nd best much worse
    const isGreat = playerMatchesBest && winDrop <= cfg.greatMaxDrop && secondDrop >= cfg.greatSecondDrop;
    if (isGreat) return 'great';

    // Blunder tier 1 (catastrophic)
    if (winDrop >= cfg.blunderT1) return 'blunder';

    // Miss: missed a tactical win (had dominant position, missed punishing)
    if (winDrop >= cfg.missT && prevWin >= cfg.missMinPrev) return 'miss';

    // Blunder tier 2
    if (winDrop >= cfg.blunderT2) return 'blunder';

    // Mistake
    if (winDrop >= cfg.mistakeT) return 'mistake';

    // Inaccuracy
    if (winDrop >= cfg.inaccT) return 'inaccuracy';

    // Solid/Excellent
    if (winDrop >= cfg.solidT) return 'solid';

    // Good/Tuyệt vời
    if (winDrop >= cfg.goodT) return 'good';

    // Best
    return 'best';
  }

  const configs = [
    {
      name: 'Config-Original (Best≤0.8,Good≤2.5,Solid≤5,Inacc≤10,Mistake≤20,Blunder≥30,Miss≥15@60)',
      bestT: 0.8, goodT: 2.5, solidT: 5.0, inaccT: 10.0, mistakeT: 20.0,
      blunderT1: 30.0, blunderT2: 20.0, missT: 15.0, missMinPrev: 60,
      greatMaxDrop: 1.0, greatSecondDrop: 12.0, brilliantMaxDrop: 2.5
    },
    {
      name: 'Config-A (Best≤2.0,Good≤4.0,Solid≤7,Inacc≤12,Mistake≤20,Blunder≥30,Miss≥15@60)',
      bestT: 2.0, goodT: 4.0, solidT: 7.0, inaccT: 12.0, mistakeT: 20.0,
      blunderT1: 30.0, blunderT2: 20.0, missT: 15.0, missMinPrev: 60,
      greatMaxDrop: 1.0, greatSecondDrop: 12.0, brilliantMaxDrop: 2.5
    },
    {
      name: 'Config-B (Best≤2.5,Good≤5.0,Solid≤8,Inacc≤13,Mistake≤20,Blunder≥30,Miss≥15@60)',
      bestT: 2.5, goodT: 5.0, solidT: 8.0, inaccT: 13.0, mistakeT: 20.0,
      blunderT1: 30.0, blunderT2: 20.0, missT: 15.0, missMinPrev: 60,
      greatMaxDrop: 1.0, greatSecondDrop: 10.0, brilliantMaxDrop: 2.5
    },
    {
      name: 'Config-C (Best≤3.0,Good≤6.0,Solid≤9,Inacc≤14,Mistake≤20,Blunder≥30,Miss≥15@60)',
      bestT: 3.0, goodT: 6.0, solidT: 9.0, inaccT: 14.0, mistakeT: 20.0,
      blunderT1: 30.0, blunderT2: 20.0, missT: 15.0, missMinPrev: 60,
      greatMaxDrop: 1.0, greatSecondDrop: 10.0, brilliantMaxDrop: 2.5
    },
    {
      name: 'Config-D (Best≤2.0,Good≤4.0,Solid≤7,Inacc≤12,Mistake≤18,Blunder≥25,Miss≥15@55)',
      bestT: 2.0, goodT: 4.0, solidT: 7.0, inaccT: 12.0, mistakeT: 18.0,
      blunderT1: 25.0, blunderT2: 18.0, missT: 15.0, missMinPrev: 55,
      greatMaxDrop: 1.0, greatSecondDrop: 10.0, brilliantMaxDrop: 2.5
    },
    {
      name: 'Config-E (Best≤2.0,Good≤4.0,Solid≤7,Inacc≤12,Mistake≤20,Blunder≥20,Miss≥12@55)',
      bestT: 2.0, goodT: 4.0, solidT: 7.0, inaccT: 12.0, mistakeT: 20.0,
      blunderT1: 20.0, blunderT2: 15.0, missT: 12.0, missMinPrev: 55,
      greatMaxDrop: 1.0, greatSecondDrop: 10.0, brilliantMaxDrop: 2.5
    },
    {
      name: 'Config-F (Best≤2.0,Good≤5.0,Solid≤8,Inacc≤12,Mistake≤20,Blunder≥20,Miss≥15@60,Great2nd≥8)',
      bestT: 2.0, goodT: 5.0, solidT: 8.0, inaccT: 12.0, mistakeT: 20.0,
      blunderT1: 20.0, blunderT2: 20.0, missT: 15.0, missMinPrev: 60,
      greatMaxDrop: 1.0, greatSecondDrop: 8.0, brilliantMaxDrop: 3.0
    },
  ];

  const cats = ['brilliant','great','book','best','good','solid','inaccuracy','mistake','miss','blunder'];
  const REF_W = CHESS_COM_TRUTH.white;
  const REF_B = CHESS_COM_TRUTH.black;

  console.log('\n\n=== Threshold Configuration Results ===');
  
  let bestConfig = null;
  let bestError = Infinity;

  for (const cfg of configs) {
    const counts = {
      w: { brilliant:0,great:0,book:0,best:0,good:0,solid:0,inaccuracy:0,mistake:0,miss:0,blunder:0 },
      b: { brilliant:0,great:0,book:0,best:0,good:0,solid:0,inaccuracy:0,mistake:0,miss:0,blunder:0 }
    };

    for (const d of moveData) {
      const cls = classify(d, cfg);
      if (counts[d.side][cls] !== undefined) counts[d.side][cls]++;
    }

    let totalErr = 0;
    for (const cat of cats) {
      totalErr += Math.abs((counts.w[cat] || 0) - (REF_W[cat] || 0));
      totalErr += Math.abs((counts.b[cat] || 0) - (REF_B[cat] || 0));
    }

    console.log(`\n--- ${cfg.name} ---`);
    console.log(`Category        | W (Ref)  | B (Ref)  | WErr | BErr`);
    console.log(`----------------+----------+----------+------+-----`);
    for (const cat of cats) {
      const wA = counts.w[cat] || 0;
      const bA = counts.b[cat] || 0;
      const wR = REF_W[cat] || 0;
      const bR = REF_B[cat] || 0;
      const wE = wA - wR;
      const bE = bA - bR;
      const mark = (Math.abs(wE) > 2 || Math.abs(bE) > 2) ? ' <<<' : '';
      console.log(`${cat.padEnd(15)} | ${String(wA).padEnd(3)}(${wR})    | ${String(bA).padEnd(3)}(${bR})    | ${(wE >= 0 ? '+' : '')}${wE}    | ${(bE >= 0 ? '+' : '')}${bE}${mark}`);
    }
    console.log(`TOTAL ERROR vs Chess.com: ${totalErr}`);

    if (totalErr < bestError) {
      bestError = totalErr;
      bestConfig = { cfg, counts, totalErr };
    }
  }

  console.log(`\n\n=== BEST CONFIG: "${bestConfig.cfg.name}" with error=${bestConfig.totalErr} ===`);
  console.log('\nFINAL RECOMMENDED THRESHOLDS:');
  console.log(JSON.stringify(bestConfig.cfg, null, 2));

  sf.terminate();
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
