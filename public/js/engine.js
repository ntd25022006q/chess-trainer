// Stockfish Web Worker UCI Interface with Multi-PV and Game Review Analysis
export class StockfishEngine {
  constructor() {
    this.worker = null;
    this.isReady = false;
    this.isAnalyzing = false;
    this.isReviewMode = false; // True during async game review to block handleMessage
    this.currentFen = null;
    this.activeTurn = 'w';
    this.multiPvCount = 3; // Default 3 analysis lines

    this.onReadyCallback = null;
    this.onAnalysisCallback = null;
    this.onBestMoveCallback = null;
    this.targetBotCallback = null;

    // Multi-PV lines storage
    this.pvLines = {};
    // Fast transposition evaluation cache
    this.evalCache = new Map();

    this.init();
  }

  init() {
    try {
      this.worker = new Worker('/engine/stockfish.js');
      this.worker.onmessage = (e) => this.handleMessage(e.data);
      this.worker.onerror = (err) => {
        console.error('Stockfish Worker Error:', err);
      };

      this.sendCommand('uci');
    } catch (err) {
      console.error('Failed to initialize Stockfish worker:', err);
    }
  }

  sendCommand(cmd) {
    if (this.worker) {
      this.worker.postMessage(cmd);
    }
  }

  setMultiPv(count) {
    this.multiPvCount = Math.max(1, Math.min(5, count));
    this.sendCommand(`setoption name MultiPV value ${this.multiPvCount}`);
  }

  // Restore engine state after async game review (reset MultiPV, clear hash)
  restoreAfterReview() {
    this.isAnalyzing = false;
    this.isReviewMode = false;
    this._reviewMultiPv = null;
    this.pvLines = {};
    this.sendCommand('ucinewgame');
    this.setMultiPv(this.multiPvCount); // restore to configured MultiPV (default 3)
    this.sendCommand('isready');
  }

  handleMessage(line) {
    if (typeof line !== 'string') return;

    if (line === 'uciok') {
      // Stockfish 19 Lite WASM NNUE configuration
      this.sendCommand('setoption name Threads value 1');
      this.sendCommand('setoption name Hash value 64');
      this.sendCommand('setoption name UCI_ShowWDL value true');
      this.setMultiPv(this.multiPvCount);
      this.sendCommand('isready');
      return;
    }

    if (line === 'readyok') {
      this.isReady = true;
      if (this.onReadyCallback) {
        this.onReadyCallback();
      }
      return;
    }

    // Parse info output: e.g. "info depth 14 seldepth 20 multipv 1 score cp 35 ... pv e2e4 e7e5"
    if (line.startsWith('info') && line.includes('score')) {
      if (!this.isAnalyzing || this.isReviewMode) return; // Skip during review mode
      this.parseInfo(line);
      return;
    }

    // Parse bestmove: e.g. "bestmove e2e4 ponder e7e5"
    if (line.startsWith('bestmove')) {
      if (this.isReviewMode) return; // Review mode handles bestmove via tempHandler
      this.isAnalyzing = false;
      const parts = line.split(' ');
      const bestMove = parts[1];
      const ponder = parts[3] || null;

      if (this.targetBotCallback) {
        const cb = this.targetBotCallback;
        this.targetBotCallback = null;
        cb(bestMove);
      } else if (this.onBestMoveCallback) {
        this.onBestMoveCallback(bestMove, ponder);
      }
    }
  }

  parseInfo(line) {
    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    const nodesMatch = line.match(/\bnodes\s+(\d+)/);
    const npsMatch = line.match(/\bnps\s+(\d+)/);
    const pvMatch = line.match(/\bpv\s+(.+)$/);
    const multiPvMatch = line.match(/\bmultipv\s+(\d+)/);

    const multipvIndex = multiPvMatch ? parseInt(multiPvMatch[1], 10) : 1;

    let score = 0;
    let isMate = false;
    let mateIn = 0;

    const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);

    if (cpMatch) {
      score = parseInt(cpMatch[1], 10);
      isMate = false;
    } else if (mateMatch) {
      isMate = true;
      mateIn = parseInt(mateMatch[1], 10);
    }

    // Convert to White's perspective
    let scoreWhite = score;
    let mateInWhite = mateIn;
    if (this.activeTurn === 'b') {
      scoreWhite = -score;
      mateInWhite = -mateIn;
    }

    const wdlMatch = line.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)/);

    // Sigmoid / Stockfish NNUE WDL Win chance calculation (Chess.com model)
    let winChance = 50;
    if (isMate) {
      winChance = mateInWhite > 0 ? 100 : 0;
    } else if (wdlMatch) {
      const wWdl = parseInt(wdlMatch[1], 10);
      const dWdl = parseInt(wdlMatch[2], 10);
      const sideWin = (wWdl + 0.5 * dWdl) / 10;
      winChance = (this.activeTurn === 'w') ? Math.round(sideWin) : Math.round(100 - sideWin);
      winChance = Math.max(0, Math.min(100, winChance));
    } else {
      winChance = Math.round(50 + 50 * (2 / (1 + Math.exp(-0.00368208 * scoreWhite)) - 1));
      winChance = Math.max(0, Math.min(100, winChance));
    }

    const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0;
    const nodes = nodesMatch ? parseInt(nodesMatch[1], 10) : 0;
    const nps = npsMatch ? parseInt(npsMatch[1], 10) : 0;
    const pv = pvMatch ? pvMatch[1].trim() : '';
    const firstPvMove = pv ? pv.split(' ')[0] : null;

    // Store line info
    this.pvLines[multipvIndex] = {
      index: multipvIndex,
      depth,
      scoreRaw: score,
      scoreWhite,
      isMate,
      mateIn,
      mateInWhite,
      winChance,
      pv,
      bestMove: firstPvMove
    };

    if (this.onAnalysisCallback && this.isAnalyzing) {
      this.onAnalysisCallback({
        depth,
        scoreRaw: score,
        scoreWhite,
        isMate,
        mateIn,
        mateInWhite,
        winChance,
        nodes,
        nps,
        pv,
        bestMove: this.pvLines[1] ? this.pvLines[1].bestMove : firstPvMove,
        activeTurn: this.activeTurn,
        lines: Object.values(this.pvLines)
      });
    }
  }

  analyzePosition(fen, depth = 16) {
    if (!this.isReady) return;
    this.stop();

    this.pvLines = {};
    this.currentFen = fen;
    const parts = fen.split(' ');
    this.activeTurn = parts[1] || 'w';

    this.sendCommand(`position fen ${fen}`);
    this.sendCommand(`go depth ${depth}`);
    this.isAnalyzing = true;
  }

  getBotMove(fen, level = 3, callback) {
    if (!this.isReady) return;
    this.stop();

    this.targetBotCallback = callback;
    const parts = fen.split(' ');
    this.activeTurn = parts[1] || 'w';

    let skillLevel = 20;
    let depth = 12;
    let moveTime = 600;

    switch (level) {
      case 1: // 400 Elo (Beginner)
        skillLevel = 0;
        depth = 1;
        moveTime = 100;
        break;
      case 2: // 800 Elo
        skillLevel = 3;
        depth = 2;
        moveTime = 200;
        break;
      case 3: // 1200 Elo
        skillLevel = 7;
        depth = 4;
        moveTime = 350;
        break;
      case 4: // 1600 Elo (Club player)
        skillLevel = 11;
        depth = 7;
        moveTime = 600;
        break;
      case 5: // 2000 Elo (Expert)
        skillLevel = 15;
        depth = 11;
        moveTime = 900;
        break;
      case 6: // 2400 Elo (Master)
        skillLevel = 19;
        depth = 15;
        moveTime = 1300;
        break;
      case 7: // 2700+ Stockfish God Mode
      default:
        skillLevel = 20;
        depth = 18;
        moveTime = 1800;
        break;
    }

    this.sendCommand(`setoption name Skill Level value ${skillLevel}`);
    this.sendCommand(`position fen ${fen}`);
    this.sendCommand(`go depth ${depth} movetime ${moveTime}`);
  }

  // Evaluate a single position via Promise — used for async Game Review (Stockfish depth analysis)
  // Properly stops any ongoing analysis before starting a new one.
  // Supports maxTimeMs budget (movetime) for lightning-fast, high-precision evaluations.
  evaluatePositionAsync(fen, depth = 16, maxTimeMs = 120) {
    return new Promise((resolve) => {
      if (!this.worker) {
        return resolve({
          scoreWhite: 0,
          winChance: 50,
          bestMove: null,
          pv: '',
          isMate: false,
          secondBestMove: null,
          secondWinChance: null,
          secondScoreWhite: null
        });
      }

      // Check transposition evaluation cache with normalized key (instant 0ms response)
      const fenKey = fen.split(' ').slice(0, 4).join(' ');
      if (this.evalCache && this.evalCache.has(fenKey)) {
        return resolve(this.evalCache.get(fenKey));
      }

      const parts = fen.split(' ');
      const turn = parts[1] || 'w';

      // Stop any current analysis to avoid message collision
      if (this.isAnalyzing) {
        this.worker.postMessage('stop');
        this.isAnalyzing = false;
      }
      // Block handleMessage from interfering during review
      this.isReviewMode = true;

      const lines = {};
      let resolved = false;
      let safetyTimer = null;

      const tempHandler = (e) => {
        const line = e.data;
        if (typeof line !== 'string') return;

        if (line.startsWith('bestmove')) {
          if (resolved) return;
          resolved = true;
          if (safetyTimer) clearTimeout(safetyTimer);
          this.worker.removeEventListener('message', tempHandler);
          this.isReviewMode = false; // Unblock handleMessage
          const bm = line.split(' ')[1] || null;
          const l1 = lines[1] || {};
          const l2 = lines[2] || {};
          const resObj = {
            scoreWhite: l1.scoreWhite ?? 0,
            winChance: l1.winChance ?? 50,
            bestMove: l1.bestMove ?? bm,
            pv: l1.pv ?? '',
            isMate: l1.isMate ?? false,
            secondBestMove: l2.bestMove ?? null,
            secondWinChance: l2.winChance ?? null,
            secondScoreWhite: l2.scoreWhite ?? null
          };
          if (this.evalCache) {
            if (this.evalCache.size > 1000) {
              const oldKey = this.evalCache.keys().next().value;
              if (oldKey) this.evalCache.delete(oldKey);
            }
            this.evalCache.set(fenKey, resObj);
          }
          resolve(resObj);
        } else if (line.startsWith('info') && line.includes('score')) {
          const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
          const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
          const pvMatch = line.match(/\bpv\s+(.+)$/);
          const mpvMatch = line.match(/\bmultipv\s+(\d+)/);
          const mpvIndex = mpvMatch ? parseInt(mpvMatch[1], 10) : 1;

          let score = 0;
          let isMate = false;
          let mateIn = 0;

          if (cpMatch) score = parseInt(cpMatch[1], 10);
          else if (mateMatch) { isMate = true; mateIn = parseInt(mateMatch[1], 10); }

          const scoreWhite = (turn === 'b') ? -score : score;
          const mateInWhite = (turn === 'b') ? -mateIn : mateIn;

          const wdlMatch = line.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)/);

          let winChance = 50;
          if (isMate) {
            winChance = mateInWhite > 0 ? 100 : 0;
          } else if (wdlMatch) {
            // Authentic Chess.com Stockfish NNUE WDL formula: win_chance = (W + 0.5 * D) / 1000
            const wWdl = parseInt(wdlMatch[1], 10);
            const dWdl = parseInt(wdlMatch[2], 10);
            const sideWin = (wWdl + 0.5 * dWdl) / 10;
            winChance = (turn === 'w') ? Math.round(sideWin) : Math.round(100 - sideWin);
            winChance = Math.max(0, Math.min(100, winChance));
          } else {
            winChance = Math.round(50 + 50 * (2 / (1 + Math.exp(-0.00368208 * scoreWhite)) - 1));
            winChance = Math.max(0, Math.min(100, winChance));
          }

          const pv = pvMatch ? pvMatch[1].trim() : '';
          lines[mpvIndex] = {
            scoreWhite,
            isMate,
            mateInWhite,
            winChance,
            pv,
            bestMove: pv ? pv.split(' ')[0] : null
          };
        }
      };

      this.worker.addEventListener('message', tempHandler);
      // MultiPV=2 to evaluate both best and 2nd best move (for authentic Chess.com Great move detection)
      if (this._reviewMultiPv !== 2) {
        this.worker.postMessage('setoption name MultiPV value 2');
        this._reviewMultiPv = 2;
      }
      this.worker.postMessage(`position fen ${fen}`);
      if (maxTimeMs) {
        this.worker.postMessage(`go depth ${depth} movetime ${maxTimeMs}`);
      } else {
        this.worker.postMessage(`go depth ${depth}`);
      }

      // Adaptive safety timeout: 4x maxTime or max 800ms to guarantee zero UI/CDP freeze
      const timeoutMs = Math.max(800, (maxTimeMs || 60) * 4);
      safetyTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.worker.removeEventListener('message', tempHandler);
          this.isReviewMode = false;
          const l1 = lines[1] || {};
          const l2 = lines[2] || {};
          const resObj = {
            scoreWhite: l1.scoreWhite ?? 0,
            winChance: l1.winChance ?? 50,
            bestMove: l1.bestMove ?? null,
            pv: l1.pv ?? '',
            isMate: l1.isMate ?? false,
            secondBestMove: l2.bestMove ?? null,
            secondWinChance: l2.winChance ?? null,
            secondScoreWhite: l2.scoreWhite ?? null
          };
          if (this.evalCache) {
            if (this.evalCache.size > 1000) {
              const oldKey = this.evalCache.keys().next().value;
              if (oldKey) this.evalCache.delete(oldKey);
            }
            this.evalCache.set(fenKey, resObj);
          }
          resolve(resObj);
        }
      }, timeoutMs);
    });
  }

  stop() {
    if (this.isAnalyzing) {
      this.sendCommand('stop');
      this.isAnalyzing = false;
    }
  }

  newGame() {
    this.stop();
    this.sendCommand('ucinewgame');
    this.sendCommand('isready');
  }

  destroy() {
    this.stop();
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
    if (this.evalCache) {
      this.evalCache.clear();
    }
  }
}
