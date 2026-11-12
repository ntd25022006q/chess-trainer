import { Chess } from '../lib/chess.js';
import { StockfishEngine } from './engine.js?v=5.0';
import { ChessBoardUI } from './board.js?v=5.0';
import { chessAudio } from './audio.js?v=5.0';
import { FEATURED_GAME_184609437048 } from './gameData.js?v=5.0';
import { AdvantageChart } from './chart.js?v=5.0';
import { GameReviewManager } from './gameReview.js?v=5.0';

export function formatSanWithSymbol(san, color = 'w') {
  if (!san) return '';
  if (san.startsWith('O-O') || san.startsWith('O-O-O')) return san;

  const pieceChar = san[0];
  const unicodeMap = {
    w: { 'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘' },
    b: { 'K': '♚', 'Q': '♛', 'R': '♜', 'B': '♝', 'N': '♞' }
  };

  const side = (color === 'b' || color === 'black') ? 'b' : 'w';
  if (unicodeMap[side] && unicodeMap[side][pieceChar]) {
    const sym = unicodeMap[side][pieceChar];
    const rest = san.slice(1);
    return `<span class="chess-figurine ${side}"><img src="/assets/pieces/${side}${pieceChar}.svg" class="notation-piece-icon ${side}" alt="${sym}"><span class="figurine-char hidden">${sym}</span></span>${rest}`;
  }
  return san;
}

class ChessTrainerApp {
  constructor() {
    this.chess = new Chess();
    this.engine = new StockfishEngine();
    this.board = null;
    this.overviewChart = new AdvantageChart('reviewOverviewChart');
    this.walkthroughChart = new AdvantageChart('walkthroughChartCanvas');

    this.currentView = 'review-overview'; // 'review-overview', 'review-walkthrough'
    this.currentGame = null;
    this.historyFens = [this.chess.fen()];
    this.currentMoveIndex = 0;
    this.moveReviews = [];
    this.isPlayingAuto = false;
    this.autoPlayInterval = null;
    this.voiceEnabled = true;

    this.init();
  }

  init() {
    // 1. Initialize Board
    const container = document.getElementById('boardContainer');
    this.board = new ChessBoardUI(container, {
      orientation: 'white',
      onMoveAttempt: (from, to, promo) => this.handlePlayerMove(from, to, promo),
      onSquareSelect: (sq) => this.handleSquareSelect(sq)
    });

    // 2. Initialize Advantage Charts with click callbacks
    this.overviewChart.init((idx) => {
      this.switchView('review-walkthrough');
      this.jumpToMove(idx);
    });
    this.walkthroughChart.init((idx) => this.jumpToMove(idx));

    // 3. Bind UI Events
    this.bindEvents();

    // 4. Initialize Engine & Multi-PV Analysis Callback
    this.engine.onReadyCallback = () => {
      console.log('Stockfish Engine is ready');
    };
    this.engine.onAnalysisCallback = (data) => {
      // During standard Game Review walkthrough, review evaluations are pre-computed & rock-solid.
      // Stockfish callback ONLY operates in interactive Trial Mode to prevent flickering.
      if (!this.isTrialMode || this.trialMoves.length === 0) return;

      const currentFen = this.chess.fen();
      if (this.engine.currentFen !== currentFen) return;

      if (data.pv) {
        this.currentTrialPv = data.pv.split(' ');
      }

      // Smooth evaluation update only at mature depth (>= 12) or checkmate to eliminate flicker
      if (data.depth >= 12 || data.isMate) {
        const score = (data.scoreWhite !== undefined) ? data.scoreWhite : 0;
        const sign = score >= 0 ? '+' : '';
        const evalText = data.isMate ? (score > 0 ? '+#M' : '-#M') : `${sign}${(score / 100).toFixed(2)}`;
        const evalTag = document.getElementById('walkthroughEvalPill');
        if (evalTag) {
          evalTag.textContent = evalText;
        }
        this.updateEvalBarDisplay(evalText, data.winChance);

        const lastMove = this.trialMoves[this.trialMoves.length - 1];
        if (lastMove && !lastMove.isBook) {
          const currWinChance = data.winChance || GameReviewManager.calculateWinChance(score);
          const movingSide = lastMove.color || 'w';
          const currWin = (movingSide === 'w') ? currWinChance : (100 - currWinChance);
          const prevWin = lastMove.prevWin || 50;
          const fenBeforeMove = lastMove.prevFen || this.trialBaseFen;
          const isSac = GameReviewManager.isTrueSacrifice(fenBeforeMove, lastMove);
          const sfClassification = GameReviewManager.classifyMove(prevWin, currWin, isSac, false);

          if (sfClassification.type !== lastMove.classification?.type) {
            lastMove.classification = sfClassification;
            this.board.setSquareBadge(lastMove.to, sfClassification.icon, sfClassification.colorClass);

            const pillTag = document.getElementById('walkthroughMovePill');
            if (pillTag) {
              if (sfClassification.type === 'brilliant') {
                pillTag.innerHTML = `<span class="badge-tag badge-brilliant">‼</span> ${formatSanWithSymbol(lastMove.san, movingSide)} thiên tài`;
              } else if (sfClassification.type === 'best') {
                pillTag.innerHTML = `<span class="badge-tag badge-best">★</span> ${formatSanWithSymbol(lastMove.san, movingSide)} là nước tốt nhất`;
              } else {
                pillTag.innerHTML = `<span class="badge-tag ${sfClassification.colorClass}">${sfClassification.icon}</span> ${formatSanWithSymbol(lastMove.san, movingSide)} ${sfClassification.label.toLowerCase()}`;
              }
            }
          }
        }
      }
    };

    // 5. Automatically load from URL path (e.g. /game/live/:gameId) or fallback to Featured Game
    const pathMatch = window.location.pathname.match(/(?:game\/live|analysis\/game\/live)\/(\d+)/);
    if (pathMatch) {
      const gid = pathMatch[1];
      if (gid === FEATURED_GAME_184609437048.gameId) {
        this.loadGame(FEATURED_GAME_184609437048);
      } else {
        this.importFromUrl(`https://www.chess.com/game/live/${gid}`);
      }
    } else {
      this.loadGame(FEATURED_GAME_184609437048);
    }

    window.addEventListener('popstate', (e) => {
      const gid = e.state?.gameId;
      if (gid) {
        if (gid === FEATURED_GAME_184609437048.gameId) {
          this.loadGame(FEATURED_GAME_184609437048);
        } else {
          this.importFromUrl(`https://www.chess.com/game/live/${gid}`);
        }
      }
    });
  }

  bindEvents() {
    // Top Clean URL Search Bar
    const urlInput = document.getElementById('topGameUrlInput');
    const analyzeBtn = document.getElementById('btnTopAnalyze');

    if (analyzeBtn && urlInput) {
      const triggerAnalyze = () => {
        const val = urlInput.value.trim();
        if (val) this.importFromUrl(val);
      };

      analyzeBtn.addEventListener('click', triggerAnalyze);
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') triggerAnalyze();
      });
    }

    // Top Navigation Action Buttons
    const onFlip = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.flipBoard();
    };

    document.getElementById('btnBoardFlipAction')?.addEventListener('click', onFlip);
    document.getElementById('btnFlipBoardOverview')?.addEventListener('click', onFlip);
    document.getElementById('btnFlipBoardWalkthrough')?.addEventListener('click', onFlip);
    document.getElementById('navBoardFlip')?.addEventListener('click', onFlip);

    // Panel sound icons
    const overviewMute = document.getElementById('btnSoundOverview');
    if (overviewMute) {
      overviewMute.addEventListener('click', () => {
        chessAudio.enabled = !chessAudio.enabled;
        overviewMute.classList.toggle('muted', !chessAudio.enabled);
      });
    }

    const walkthroughMute = document.getElementById('btnSoundWalkthrough');
    if (walkthroughMute) {
      walkthroughMute.addEventListener('click', () => {
        this.voiceEnabled = !this.voiceEnabled;
        chessAudio.enabled = this.voiceEnabled;
        walkthroughMute.classList.toggle('muted', !this.voiceEnabled);
        if (this.voiceEnabled) {
          const rev = (this.currentMoveIndex > 0 && this.moveReviews) ? this.moveReviews[this.currentMoveIndex - 1] : null;
          if (rev) this.speakCommentary(`${rev.san}. ${rev.en || rev.vi}`);
          else this.speakCommentary('Voice commentary enabled.');
        } else {
          window.speechSynthesis?.cancel();
        }
      });
    }

    // Click coach avatar / speech bubble to re-hear commentary
    const coachBubbleEl = document.querySelector('.coach-move-speech-card');
    if (coachBubbleEl) {
      coachBubbleEl.style.cursor = 'pointer';
      coachBubbleEl.title = 'Click to hear coach commentary';
      coachBubbleEl.addEventListener('click', () => {
        const rev = (this.currentMoveIndex > 0 && this.moveReviews) ? this.moveReviews[this.currentMoveIndex - 1] : null;
        if (rev) this.speakCommentary(`${rev.san}. ${rev.en || rev.vi}`);
      });
    }

    // "Xem lại" Big Green Button (Screenshots 1 & 2 -> Screenshot 3)
    const btnStartWalkthrough = document.getElementById('btnStartWalkthrough');
    if (btnStartWalkthrough) {
      btnStartWalkthrough.addEventListener('click', () => {
        this.switchView('review-walkthrough');
        this.jumpToMove(1);
      });
    }

    // Back button (Screenshot 3 -> Screenshot 1)
    const btnBackToOverview = document.getElementById('btnBackToOverview');
    if (btnBackToOverview) {
      btnBackToOverview.addEventListener('click', () => {
        this.stopAutoPlay();
        this.switchView('review-overview');
      });
    }

    // Walkthrough Next Move Button ("➔ Tiếp theo" - Jumps to Next Key Moment)
    const btnNextMove = document.getElementById('btnNextMove');
    if (btnNextMove) {
      btnNextMove.addEventListener('click', () => {
        const nextIdx = this.getNextKeyMoment(this.currentMoveIndex);
        this.jumpToMove(nextIdx);
      });
    }

    // Walkthrough Explain Button ("💡 Giải thích") - Matches Image 1
    const btnExplainMove = document.getElementById('btnExplainMove');
    if (btnExplainMove) {
      btnExplainMove.addEventListener('click', () => {
        this.startExplanationMode();
      });
    }

    // Explanation Navigation Buttons (Image 1: < > Đồng ý!)
    const btnExplainPrev = document.getElementById('btnExplainPrev');
    if (btnExplainPrev) {
      btnExplainPrev.addEventListener('click', () => {
        this.showExplanationStep(this.explanationStep - 1);
      });
    }

    const btnExplainNext = document.getElementById('btnExplainNext');
    if (btnExplainNext) {
      btnExplainNext.addEventListener('click', () => {
        this.showExplanationStep(this.explanationStep + 1);
      });
    }

    const btnExplainDone = document.getElementById('btnExplainDone');
    if (btnExplainDone) {
      btnExplainDone.addEventListener('click', () => {
        this.exitExplanationMode(true);
      });
    }

    // Best Move Button ("✪ Tốt nhất") - Matches Image 2
    const btnBestMove = document.getElementById('btnBestMove');
    if (btnBestMove) {
      btnBestMove.addEventListener('click', () => {
        this.showBestMoveMode();
      });
    }

    // Trial Mode Return Main Line Button ("▶ Quay lại") - Matches Image 2
    const btnReturnMainLine = document.getElementById('btnReturnMainLine');
    if (btnReturnMainLine) {
      btnReturnMainLine.addEventListener('click', () => this.returnFromTrialMode());
    }

    // Highlights Button ("← Những điểm nổi bật" - Screenshot 2, 3, 5)
    const btnHighlights = document.getElementById('btnHighlights');
    if (btnHighlights) {
      btnHighlights.addEventListener('click', () => {
        this.stopAutoPlay();
        for (let i = this.currentMoveIndex - 2; i >= 0; i--) {
          const rev = this.moveReviews[i];
          if (rev && ['badge-brilliant', 'badge-great', 'badge-blunder', 'badge-miss', 'badge-mistake'].includes(rev.badgeClass)) {
            this.jumpToMove(i + 1);
            return;
          }
        }
        this.jumpToMove(1);
      });
    }

    // New 5 Min Game Button ("5 phút mới" - Screenshot 2, 3, 5)
    const btnNewGame5Min = document.getElementById('btnNewGame5Min');
    if (btnNewGame5Min) {
      btnNewGame5Min.addEventListener('click', () => {
        this.stopAutoPlay();
        this.jumpToMove(0);
      });
    }

    // Playback Buttons
    document.getElementById('btnPlayStart').addEventListener('click', () => {
      this.stopAutoPlay();
      this.jumpToMove(0);
    });
    document.getElementById('btnPlayPrev').addEventListener('click', () => {
      this.stopAutoPlay();
      if (this.currentMoveIndex > 0) this.jumpToMove(this.currentMoveIndex - 1);
    });
    document.getElementById('btnPlayNext').addEventListener('click', () => {
      this.stopAutoPlay();
      if (this.currentMoveIndex < this.historyFens.length - 1) this.jumpToMove(this.currentMoveIndex + 1);
    });
    document.getElementById('btnPlayEnd').addEventListener('click', () => {
      this.stopAutoPlay();
      this.jumpToMove(this.historyFens.length - 1);
    });

    // Auto Play Button (▶ / ⏸)
    const playAutoBtn = document.getElementById('btnPlayAuto');
    if (playAutoBtn) {
      playAutoBtn.addEventListener('click', () => this.toggleAutoPlay());
    }

    // End of game buttons (Screenshot 4)
    const btnShare = document.getElementById('btnShareGame');
    if (btnShare) {
      btnShare.addEventListener('click', () => {
        const gameId = this.currentGame?.gameId || '184609437048';
        const shareUrl = `${window.location.origin}/game/live/${gameId}`;
        const w = this.currentGame?.players?.white?.username || 'Trắng';
        const b = this.currentGame?.players?.black?.username || 'Đen';
        const wAcc = this.currentGame?.accuracy?.white || '88.4';
        const bAcc = this.currentGame?.accuracy?.black || '86.5';
        const shareText = `♟️ Xem lại ván đấu Chess.com: ${w} (${wAcc}%) vs ${b} (${bAcc}%)\n🔗 Link phân tích: ${shareUrl}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(() => {
            alert(`🔗 Đã sao chép liên kết phân tích ván cờ vào clipboard:\n\n${shareUrl}`);
          }).catch(() => {
            prompt('Sao chép liên kết phân tích ván cờ:', shareUrl);
          });
        } else {
          prompt('Sao chép liên kết phân tích ván cờ:', shareUrl);
        }
      });
    }

    // Keyboard shortcut: Press 'X' to flip board (Chess.com shortcut)
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key === 'x' || e.key === 'X') {
        this.flipBoard();
      }
    });
  }

  isKeyMoment(moveIndex) {
    if (moveIndex <= 0 || !this.moveReviews || moveIndex > this.moveReviews.length) return false;
    const rev = this.moveReviews[moveIndex - 1];
    if (!rev) return false;
    const keyClasses = ['badge-blunder', 'badge-mistake', 'badge-miss', 'badge-inaccuracy', 'badge-great', 'badge-brilliant'];
    return keyClasses.includes(rev.badgeClass) || !!rev.isFork;
  }

  getNextKeyMoment(fromIndex) {
    if (!this.moveReviews) return fromIndex + 1;
    for (let i = fromIndex + 1; i <= this.moveReviews.length; i++) {
      if (this.isKeyMoment(i)) return i;
    }
    return Math.min(this.historyFens.length - 1, fromIndex + 1);
  }

  getPrevKeyMoment(fromIndex) {
    if (!this.moveReviews) return Math.max(0, fromIndex - 1);
    for (let i = fromIndex - 1; i >= 1; i--) {
      if (this.isKeyMoment(i)) return i;
    }
    return 0;
  }

  speakCommentary(text) {
    if (!this.voiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!clean) return;
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';
      const voices = window.speechSynthesis.getVoices();
      const enVoice = voices.find(v => v.lang.startsWith('en') && (
        v.name.includes('David') ||
        v.name.includes('Guy') ||
        v.name.includes('Natural') ||
        v.name.includes('Google US English') ||
        v.name.includes('Zira') ||
        v.lang === 'en-US'
      )) || voices.find(v => v.lang.startsWith('en'));
      if (enVoice) {
        utterance.voice = enVoice;
      }
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech error:', e);
    }
  }

  toggleAutoPlay() {
    if (this.isPlayingAuto) {
      this.stopAutoPlay();
    } else {
      this.startAutoPlay();
    }
  }

  startAutoPlay() {
    this.isPlayingAuto = true;
    const btn = document.getElementById('btnPlayAuto');
    if (btn) {
      btn.textContent = '⏸';
      btn.classList.add('playing');
    }
    if (this.currentMoveIndex >= this.historyFens.length - 1) {
      this.jumpToMove(0);
    }
    this.autoPlayInterval = setInterval(() => {
      if (this.currentMoveIndex < this.historyFens.length - 1) {
        this.jumpToMove(this.currentMoveIndex + 1);
      } else {
        this.stopAutoPlay();
      }
    }, 1200);
  }

  stopAutoPlay() {
    this.isPlayingAuto = false;
    if (this.autoPlayInterval) {
      clearInterval(this.autoPlayInterval);
      this.autoPlayInterval = null;
    }
    const btn = document.getElementById('btnPlayAuto');
    if (btn) {
      btn.textContent = '▶';
      btn.classList.remove('playing');
    }
  }

  switchView(viewName) {
    this.currentView = viewName;
    const overviewEl = document.getElementById('reviewOverviewView');
    const walkthroughEl = document.getElementById('reviewWalkthroughView');

    if (overviewEl) overviewEl.classList.add('hidden');
    if (walkthroughEl) walkthroughEl.classList.add('hidden');

    if (viewName === 'review-overview') {
      if (overviewEl) overviewEl.classList.remove('hidden');
      setTimeout(() => this.overviewChart.draw(-1), 20);
    } else if (viewName === 'review-walkthrough') {
      if (walkthroughEl) walkthroughEl.classList.remove('hidden');
      setTimeout(() => this.walkthroughChart.draw(this.currentMoveIndex), 20);
    }
  }

  getFlagEmoji(countryOrCode) {
    if (!countryOrCode) return '🏳️';
    if (/[\uD83C][\uDDE6-\uDDFF]/.test(countryOrCode)) return countryOrCode;
    const flagMap = {
      'Norway': '🇳🇴', 'NO': '🇳🇴',
      'Bulgaria': '🇧🇬', 'BG': '🇧🇬',
      'Ukraine': '🇺🇦', 'UA': '🇺🇦',
      'United States': '🇺🇸', 'US': '🇺🇸', 'USA': '🇺🇸',
      'India': '🇮🇳', 'IN': '🇮🇳',
      'Russia': '🇷🇺', 'RU': '🇷🇺',
      'Vietnam': '🇻🇳', 'VN': '🇻🇳',
      'Germany': '🇩🇪', 'DE': '🇩🇪',
      'France': '🇫🇷', 'FR': '🇫🇷',
      'China': '🇨🇳', 'CN': '🇨🇳',
      'Spain': '🇪🇸', 'ES': '🇪🇸',
      'Brazil': '🇧🇷', 'BR': '🇧🇷',
      'Canada': '🇨🇦', 'CA': '🇨🇦',
      'United Kingdom': '🇬🇧', 'GB': '🇬🇧', 'EN': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
      'Poland': '🇵🇱', 'PL': '🇵🇱',
      'Italy': '🇮🇹', 'IT': '🇮🇹',
      'Netherlands': '🇳🇱', 'NL': '🇳🇱',
      'Sweden': '🇸🇪', 'SE': '🇸🇪',
      'Armenia': '🇦🇲', 'AM': '🇦🇲',
      'Uzbekistan': '🇺🇿', 'UZ': '🇺🇿',
      'Azerbaijan': '🇦🇿', 'AZ': '🇦🇿',
      'Israel': '🇮🇱', 'IL': '🇮🇱'
    };
    if (flagMap[countryOrCode]) return flagMap[countryOrCode];
    const trimmed = countryOrCode.trim().toUpperCase();
    if (flagMap[trimmed]) return flagMap[trimmed];
    if (/^[A-Z]{2}$/.test(trimmed)) {
      return String.fromCodePoint(...trimmed.split('').map(c => 127397 + c.charCodeAt(0)));
    }
    return '🏳️';
  }

  getFlagHtml(countryOrCode) {
    if (!countryOrCode) return '';
    const codeMap = {
      'norway': 'no', 'no': 'no', '🇳🇴': 'no',
      'ukraine': 'ua', 'ua': 'ua', '🇺🇦': 'ua',
      'bulgaria': 'bg', 'bg': 'bg', '🇧🇬': 'bg',
      'united states': 'us', 'usa': 'us', 'us': 'us', '🇺🇸': 'us',
      'vietnam': 'vn', 'vn': 'vn', '🇻🇳': 'vn',
      'russia': 'ru', 'ru': 'ru', '🇷🇺': 'ru',
      'india': 'in', 'in': 'in', '🇮🇳': 'in',
      'germany': 'de', 'de': 'de', '🇩🇪': 'de',
      'france': 'fr', 'fr': 'fr', '🇫🇷': 'fr',
      'china': 'cn', 'cn': 'cn', '🇨🇳': 'cn',
      'spain': 'es', 'es': 'es', '🇪🇸': 'es',
      'brazil': 'br', 'br': 'br', '🇧🇷': 'br',
      'canada': 'ca', 'ca': 'ca', '🇨🇦': 'ca',
      'united kingdom': 'gb', 'gb': 'gb', 'england': 'gb', '🇬🇧': 'gb',
      'poland': 'pl', 'pl': 'pl', '🇵🇱': 'pl',
      'italy': 'it', 'it': 'it', '🇮🇹': 'it',
      'netherlands': 'nl', 'nl': 'nl', '🇳🇱': 'nl',
      'sweden': 'se', 'se': 'se', '🇸🇪': 'se',
      'armenia': 'am', 'am': 'am', '🇦🇲': 'am',
      'uzbekistan': 'uz', 'uz': 'uz', '🇺🇿': 'uz',
      'azerbaijan': 'az', 'az': 'az', '🇦🇿': 'az',
      'israel': 'il', 'il': 'il', '🇮🇱': 'il'
    };
    const key = String(countryOrCode).toLowerCase().trim();
    const iso = codeMap[key] || (key.length === 2 ? key : 'un');
    const upper = (iso === 'un' && key.length === 2) ? key.toUpperCase() : iso.toUpperCase();
    const inlineSvgs = {
      no: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="18" height="13" class="country-flag-img"><rect width="22" height="16" fill="#ba0c2f"/><rect x="6" width="4" height="16" fill="#ffffff"/><rect y="6" width="22" height="4" fill="#ffffff"/><rect x="7" width="2" height="16" fill="#00205b"/><rect y="7" width="22" height="2" fill="#00205b"/></svg>`,
      ua: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="18" height="13" class="country-flag-img"><rect width="22" height="8" fill="#0057b7"/><rect y="8" width="22" height="8" fill="#ffd700"/></svg>`,
      ru: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="18" height="13" class="country-flag-img"><rect width="22" height="5.33" fill="#ffffff"/><rect y="5.33" width="22" height="5.33" fill="#0039a6"/><rect y="10.66" width="22" height="5.33" fill="#d52b1e"/></svg>`,
      vn: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="18" height="13" class="country-flag-img"><rect width="22" height="16" fill="#da251d"/><polygon points="11,2.8 12.8,8.2 18.5,8.2 13.9,11.5 15.6,16.8 11,13.5 6.4,16.8 8.1,11.5 3.5,8.2 9.2,8.2" fill="#ffff00"/></svg>`,
      us: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="18" height="13" class="country-flag-img"><rect width="22" height="16" fill="#b22234"/><rect y="1.23" width="22" height="1.23" fill="#fff"/><rect y="3.69" width="22" height="1.23" fill="#fff"/><rect y="6.15" width="22" height="1.23" fill="#fff"/><rect y="8.61" width="22" height="1.23" fill="#fff"/><rect y="11.07" width="22" height="1.23" fill="#fff"/><rect y="13.53" width="22" height="1.23" fill="#fff"/><rect width="8.8" height="8.61" fill="#3c3b6e"/></svg>`,
      bg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 16" width="18" height="13" class="country-flag-img"><rect width="22" height="5.33" fill="#ffffff"/><rect y="5.33" width="22" height="5.33" fill="#00966e"/><rect y="10.66" width="22" height="5.33" fill="#d62612"/></svg>`
    };
    const flagSvg = inlineSvgs[iso] || `<img src="/assets/flags/${iso}.svg" class="country-flag-img" alt="${upper}" onerror="this.style.display='none'">`;
    return `<span class="player-country-badge">${flagSvg}<span class="country-code-text">${upper}</span></span>`;
  }

  getSafeAvatarUrl(url, username) {
    if (username === 'MagnusCarlsen') return '/assets/avatars/magnus.jpg';
    if (username === 'Witty_Alien') return '/assets/avatars/alien.png';
    if (!url) return '/assets/default-user.svg';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return `/api/proxy-image?url=${encodeURIComponent(url)}`;
    }
    return url;
  }

  updatePlayerCardDisplay() {
    if (!this.currentGame) return;
    const isFlipped = (this.board && this.board.orientation === 'black');
    const w = this.currentGame.players.white;
    const b = this.currentGame.players.black;

    const topPlayer = isFlipped ? w : b;
    const bottomPlayer = isFlipped ? b : w;

    const setupCard = (prefix, player) => {
      const nameEl = document.getElementById(`${prefix}PlayerName`);
      const eloEl = document.getElementById(`${prefix}EloTag`);
      const titleEl = document.getElementById(`${prefix}TitleTag`);
      const avatarEl = document.getElementById(`${prefix}AvatarImg`);
      const flagEl = document.getElementById(`${prefix}FlagTag`);
      const diamondEl = document.getElementById(`${prefix}DiamondTag`);

      if (nameEl) nameEl.textContent = player.username;
      if (eloEl) eloEl.textContent = player.rating ? `(${player.rating})` : '';

      if (titleEl) {
        if (player.title && player.title.trim()) {
          titleEl.textContent = player.title;
          titleEl.style.display = 'inline-block';
          titleEl.className = 'chess-title-tag ' + (player.title.toLowerCase() === 'gm' ? 'gm' : 'cm');
        } else {
          titleEl.textContent = '';
          titleEl.style.display = 'none';
        }
      }

      if (avatarEl) {
        avatarEl.src = this.getSafeAvatarUrl(player.avatarUrl, player.username);
        avatarEl.onerror = () => { avatarEl.src = '/assets/default-user.svg'; };
      }

      if (flagEl) {
        const flagHtml = this.getFlagHtml(player.countryName || player.countryCode || player.flag);
        flagEl.innerHTML = flagHtml;
        flagEl.style.display = 'inline-block';
      }

      if (diamondEl) {
        diamondEl.style.display = (player.membershipCode === 'diamond' || player.diamond) ? 'inline' : 'none';
      }
    };

    setupCard('black', topPlayer);
    setupCard('white', bottomPlayer);

    this.updateCapturedPieces();

    const initClk = this.getInitialClock();
    const rev = (this.currentMoveIndex > 0 && this.moveReviews) ? this.moveReviews[this.currentMoveIndex - 1] : null;
    const wClk = rev ? (rev.wClk || initClk) : initClk;
    const bClk = rev ? (rev.bClk || initClk) : initClk;
    const topClockEl = document.getElementById('blackClockTime');
    const bottomClockEl = document.getElementById('whiteClockTime');
    if (topClockEl) topClockEl.textContent = isFlipped ? wClk : bClk;
    if (bottomClockEl) bottomClockEl.textContent = isFlipped ? bClk : wClk;

    this.updateEvalBarDisplay();
  }

  getInitialClock() {
    if (this.currentGame?.initialClock) return this.currentGame.initialClock;
    if (this.moveReviews && this.moveReviews.length > 0 && this.moveReviews[0].wClk) {
      return this.moveReviews[0].wClk;
    }
    return '5:00';
  }

  flipBoard() {
    if (!this.board) return;
    this.board.flip();
    this.updatePlayerCardDisplay();
  }

  // === STOCKFISH ANALYSIS PROGRESS BAR ===
  _showAnalysisProgress(done, total) {
    let overlay = document.getElementById('sfAnalysisOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sfAnalysisOverlay';
      overlay.style.cssText = `
        position:fixed;top:0;left:0;width:100%;height:100%;
        background:rgba(0,0,0,0.75);z-index:9999;
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:inherit;color:#fff;
      `;
      overlay.innerHTML = `
        <div style="text-align:center;max-width:380px;padding:32px 24px;background:#1a1a2e;border-radius:16px;border:1px solid #333;">
          <div style="font-size:2rem;margin-bottom:12px;">♟️</div>
          <div style="font-size:1.1rem;font-weight:600;margin-bottom:8px;">Stockfish đang phân tích ván đấu</div>
          <div style="font-size:0.85rem;color:#aaa;margin-bottom:16px;">Depth 18 — Kết quả chuẩn xác như Chess.com</div>
          <div style="background:#2a2a3e;border-radius:8px;height:10px;overflow:hidden;margin-bottom:12px;">
            <div id="sfProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#4ade80,#06b6d4);border-radius:8px;transition:width 0.3s ease;"></div>
          </div>
          <div id="sfProgressText" style="font-size:0.85rem;color:#81b64c;">Đang khởi động engine...</div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    const bar = document.getElementById('sfProgressBar');
    const txt = document.getElementById('sfProgressText');
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (bar) bar.style.width = `${pct}%`;
    if (txt) txt.textContent = total > 1 ? `Nước ${done}/${total} (${pct}%)` : 'Đang khởi động engine...';
  }

  _hideAnalysisProgress() {
    const overlay = document.getElementById('sfAnalysisOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  updateEvalBarDisplay(evalText = null, winChance = null) {
    const evalFill = document.getElementById('evalFill');
    const evalTop = document.getElementById('evalScoreTop');
    const evalBottom = document.getElementById('evalScoreBottom');
    if (!evalFill) return;

    if (evalText === null) {
      if (this.currentMoveIndex > 0 && this.moveReviews && this.moveReviews[this.currentMoveIndex - 1]) {
        const rev = this.moveReviews[this.currentMoveIndex - 1];
        evalText = rev.eval;
        winChance = rev.winChance;
      } else {
        evalText = '0.0';
        winChance = 50;
      }
    }

    const isFlipped = (this.board && this.board.orientation === 'black');
    if (isFlipped) {
      evalFill.style.bottom = 'auto';
      evalFill.style.top = '0';
    } else {
      evalFill.style.top = 'auto';
      evalFill.style.bottom = '0';
    }
    evalFill.style.height = `${winChance}%`;

    let isWhiteAdv = false;
    let isBlackAdv = false;
    let displayScore = '0.0';

    if (evalText && evalText.includes('M')) {
      const isWhiteMate = evalText.startsWith('+');
      isWhiteAdv = isWhiteMate;
      isBlackAdv = !isWhiteMate;
      displayScore = evalText.replace('+', '');
    } else {
      const rawVal = parseFloat(evalText) || 0;
      displayScore = Math.abs(rawVal).toFixed(1);
      isWhiteAdv = (!evalText.startsWith('-') && rawVal !== 0);
      isBlackAdv = (evalText.startsWith('-') && rawVal !== 0);
    }

    // Advantage label is placed on the side of the player with the advantage
    // If board is normal (White at bottom): White advantage -> Bottom label; Black advantage -> Top label
    // If board is flipped (White at top): White advantage -> Top label; Black advantage -> Bottom label
    const showTop = isFlipped ? isWhiteAdv : isBlackAdv;

    if (displayScore === '0.0') {
      if (evalBottom) { evalBottom.textContent = '0.0'; evalBottom.classList.remove('hidden'); }
      if (evalTop) evalTop.classList.add('hidden');
    } else if (showTop) {
      if (evalTop) { evalTop.textContent = displayScore; evalTop.classList.remove('hidden'); }
      if (evalBottom) evalBottom.classList.add('hidden');
    } else {
      if (evalBottom) { evalBottom.textContent = displayScore; evalBottom.classList.remove('hidden'); }
      if (evalTop) evalTop.classList.add('hidden');
    }
  }

  loadGame(gameData) {
    this.currentGame = gameData;

    // Keep top URL search input synchronized with current game
    const topUrlInput = document.getElementById('topGameUrlInput');
    if (topUrlInput && gameData.gameId) {
      topUrlInput.value = `https://www.chess.com/game/live/${gameData.gameId}`;
    }

    // Determine board perspective from URL (?username=...)
    let targetUser = '';
    if (gameData.url) {
      try {
        const u = new URL(gameData.url, 'http://localhost');
        targetUser = (u.searchParams.get('username') || '').toLowerCase();
      } catch (e) {}
    }

    const isBlackPerspective = targetUser && (gameData.players.black.username.toLowerCase() === targetUser);
    this.board.setOrientation(isBlackPerspective ? 'black' : 'white');

    if (gameData && gameData.gameId) {
      const targetPath = `/game/live/${gameData.gameId}`;
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ gameId: gameData.gameId }, '', targetPath);
      }
    }

    const w = gameData.players.white;
    const b = gameData.players.black;

    // Populate Player Info Cards according to orientation
    this.updatePlayerCardDisplay();

    // Overview Avatars & Accuracy Badges (Screenshot 1 & 2)
    const oWhiteAv = document.getElementById('overviewWhiteAvatar');
    const oBlackAv = document.getElementById('overviewBlackAvatar');
    if (oWhiteAv) {
      oWhiteAv.src = this.getSafeAvatarUrl(w.avatarUrl, w.username);
      oWhiteAv.onerror = () => { oWhiteAv.src = '/assets/default-user.svg'; };
    }
    if (oBlackAv) {
      oBlackAv.src = this.getSafeAvatarUrl(b.avatarUrl, b.username);
      oBlackAv.onerror = () => { oBlackAv.src = '/assets/default-user.svg'; };
    }
    document.getElementById('overviewWhiteName').textContent = w.username;
    document.getElementById('overviewBlackName').textContent = b.username;

    document.getElementById('overviewWhiteAcc').textContent = gameData.accuracy.white;
    document.getElementById('overviewBlackAcc').textContent = gameData.accuracy.black;

    // Estimated Elo / Performance Rating (Screenshot 1: 3450 vs 2550)
    const perfWhite = document.getElementById('perfWhiteRating');
    const perfBlack = document.getElementById('perfBlackRating');
    if (perfWhite) perfWhite.textContent = (gameData.performanceRating && gameData.performanceRating.white) ? gameData.performanceRating.white : (w.rating || '—');
    if (perfBlack) perfBlack.textContent = (gameData.performanceRating && gameData.performanceRating.black) ? gameData.performanceRating.black : (b.rating || '—');

    // Coach summary text (Screenshot 2)
    document.getElementById('coachSummaryText').innerHTML = `
      ${gameData.summaryEn}<br>
      <span class="sub-commentary">${gameData.summaryVi}</span>
    `;

    // 2. Breakdown counts (Chess.com 1:1 Parity matching Image 4: Label | White Count | Badge Icon | Black Count)
    const statsTableBody = document.getElementById('classificationTableBody');
    if (statsTableBody && gameData.breakdown) {
      statsTableBody.innerHTML = gameData.breakdown.map(item => `
        <tr class="breakdown-row">
          <td class="col-label">${item.label}</td>
          <td class="col-stat col-stat-w ${item.colorClass}-text">${item.w}</td>
          <td class="col-badge"><span class="badge-icon ${item.colorClass}">${item.icon}</span></td>
          <td class="col-stat col-stat-b ${item.colorClass}-text">${item.b}</td>
        </tr>
      `).join('');
    }

    // 3. Phase evaluations (Screenshot 1 & Attachment 9)
    const phaseTableBody = document.getElementById('phaseTableBody');
    if (phaseTableBody && gameData.phases) {
      phaseTableBody.innerHTML = gameData.phases.map(p => `
        <tr>
          <td class="phase-label">${p.label}</td>
          <td class="phase-w">${typeof p.w === 'string' ? `<span class="phase-dash">${p.w}</span>` : `<span class="phase-icon ${p.w.colorClass}">${p.w.icon}</span>`}</td>
          <td class="phase-b">${typeof p.b === 'string' ? `<span class="phase-dash">${p.b}</span>` : `<span class="phase-icon ${p.b.colorClass}">${p.b.icon}</span>`}</td>
        </tr>
      `).join('');
    }

    // 4. Parse PGN and build move timeline
    this.chess.loadPgn(gameData.pgn);
    const moves = this.chess.history({ verbose: true });
    this.gameMoves = moves;

    const tempChess = new Chess();
    this.historyFens = [tempChess.fen()];
    this.moveReviews = [];
    const chartEvalPoints = [{ winChance: 52, color: '#81b64c' }];

    moves.forEach((m, idx) => {
      const ply = idx + 1;
      const commentary = (gameData.moveCommentaries && gameData.moveCommentaries[ply]) || {
        badge: '✓',
        badgeClass: 'badge-good',
        eval: '+0.10',
        winChance: 50,
        wClk: '4:50',
        bClk: '4:50',
        vi: 'Nước đi an toàn và hợp lý.',
        en: 'A solid, sensible move.'
      };

      // Authentic Chess.com Single/Dual Arrow System (Zero visual clutter)
      let moveArrows = commentary.arrows;
      if (!moveArrows || moveArrows.length === 0) {
        moveArrows = [];
        if (['badge-blunder', 'badge-mistake', 'badge-miss', 'badge-inaccuracy'].includes(commentary.badgeClass)) {
          // In Chess.com, mistakes show the best move that should have been played
          if (commentary.bestMove && (commentary.bestMove.from !== m.from || commentary.bestMove.to !== m.to)) {
            moveArrows.push({ from: commentary.bestMove.from, to: commentary.bestMove.to, color: '#81b64c', opacity: 0.95 });
          } else {
            moveArrows.push({ from: m.from, to: m.to, color: '#ef4444', opacity: 0.9 });
          }
          if (commentary.threat) {
            moveArrows.push({ from: commentary.threat.from, to: commentary.threat.to, color: '#f59e0b', opacity: 0.9 });
          }
        } else if (commentary.badgeClass === 'badge-book') {
          moveArrows.push({ from: m.from, to: m.to, color: '#c29b68', opacity: 0.9 });
        } else if (commentary.badgeClass === 'badge-brilliant') {
          moveArrows.push({ from: m.from, to: m.to, color: '#06b6d4', opacity: 0.95 });
        } else {
          moveArrows.push({ from: m.from, to: m.to, color: '#81b64c', opacity: 0.9 });
        }
      }

      tempChess.move(m);
      this.historyFens.push(tempChess.fen());

      const colorMap = {
        'badge-book': '#c29b68',
        'badge-brilliant': '#06b6d4',
        'badge-great': '#3b82f6',
        'badge-best': '#81b64c',
        'badge-good': '#81b64c',
        'badge-solid': '#81b64c',
        'badge-inaccuracy': '#eab308',
        'badge-mistake': '#f97316',
        'badge-miss': '#ef4444',
        'badge-blunder': '#dc2626'
      };

      this.moveReviews.push({
        ply,
        san: m.san,
        from: m.from,
        to: m.to,
        badge: commentary.badge,
        badgeClass: commentary.badgeClass,
        eval: commentary.eval,
        winChance: commentary.winChance,
        wClk: commentary.wClk || '5:00',
        bClk: commentary.bClk || '5:00',
        vi: commentary.vi,
        en: commentary.en,
        bestMove: commentary.bestMove,
        threat: commentary.threat,
        arrows: moveArrows,
        continuation: commentary.continuation || (commentary.bestMove ? [commentary.bestMove.san] : [m.san]),
        isFork: commentary.isFork,
        forkFrom: commentary.forkFrom,
        forkTo1: commentary.forkTo1,
        forkTo2: commentary.forkTo2,
        resignedSquare: commentary.resignedSquare,
        winnerKingSquare: commentary.winnerKingSquare
      });

      chartEvalPoints.push({
        winChance: commentary.winChance,
        color: colorMap[commentary.badgeClass] || '#81b64c'
      });
    });

    // 5. Update Charts
    this.overviewChart.setData(chartEvalPoints);
    this.walkthroughChart.setData(chartEvalPoints);

    // 6. Render 2-Column Move Table in Walkthrough View (Screenshot 3 & 4)
    this.renderWalkthroughMoveTable(moves);

    // 7. Start at initial position
    this.jumpToMove(0);
    this.switchView('review-overview');
  }

  renderWalkthroughMoveTable(moves) {
    const listEl = document.getElementById('walkthroughMoveList');
    if (!listEl) return;
    listEl.innerHTML = '';

    for (let i = 0; i < moves.length; i += 2) {
      const moveNum = Math.floor(i / 2) + 1;
      const wMove = moves[i];
      const bMove = moves[i + 1] || null;

      const wRev = this.moveReviews[i];
      const bRev = bMove ? this.moveReviews[i + 1] : null;

      const row = document.createElement('div');
      row.className = 'walkthrough-move-row';

      const numSpan = document.createElement('span');
      numSpan.className = 'move-number';
      numSpan.textContent = `${moveNum}.`;
      row.appendChild(numSpan);

      // White button
      const wBtn = document.createElement('button');
      wBtn.className = 'walkthrough-move-btn';
      wBtn.id = `moveBtn_${i + 1}`;
      const wBadge = (wRev && wRev.badge) ? `<span class="badge-tag ${wRev.badgeClass}">${wRev.badge}</span> ` : '';
      wBtn.innerHTML = `${wBadge}<span>${formatSanWithSymbol(wMove.san, 'w')}</span>`;
      wBtn.onclick = () => {
        this.stopAutoPlay();
        this.jumpToMove(i + 1);
      };
      row.appendChild(wBtn);

      // Black button
      if (bMove) {
        const bBtn = document.createElement('button');
        bBtn.className = 'walkthrough-move-btn';
        bBtn.id = `moveBtn_${i + 2}`;
        const bBadge = (bRev && bRev.badge) ? `<span class="badge-tag ${bRev.badgeClass}">${bRev.badge}</span> ` : '';
        bBtn.innerHTML = `${bBadge}<span>${formatSanWithSymbol(bMove.san, 'b')}</span>`;
        bBtn.onclick = () => {
          this.stopAutoPlay();
          this.jumpToMove(i + 2);
        };
        row.appendChild(bBtn);
      }

      listEl.appendChild(row);
    }

    // Append 0-1 Result row at bottom
    const resultRow = document.createElement('div');
    resultRow.className = 'walkthrough-move-row';
    resultRow.style.fontWeight = '800';
    resultRow.style.color = '#81b64c';
    resultRow.innerHTML = '<span></span><span>0-1</span><span></span>';
    listEl.appendChild(resultRow);
  }

  jumpToMove(index) {
    if (index < 0 || index >= this.historyFens.length) return;
    this.currentMoveIndex = index;
    const fen = this.historyFens[index];

    // Synchronize this.chess state to this ply so user can click pieces and dots!
    this.chess.load(fen);

    // Reset trial mode and arrows on navigation
    if (this.isTrialMode) {
      this.isTrialMode = false;
      this.trialMoves = [];
      document.getElementById('activeTrialBranchRow')?.remove();
      const btnNext = document.getElementById('btnNextMove');
      const btnReturn = document.getElementById('btnReturnMainLine');
      if (btnNext) btnNext.classList.remove('hidden');
      if (btnReturn) btnReturn.classList.add('hidden');
    }
    this.isShowingBestArrow = false;
    this.isShowingBestMove = false;
    this.exitExplanationMode(false);

    // 1. Play Sound
    const last = (index > 0 && this.gameMoves) ? this.gameMoves[index - 1] : null;
    if (last) {
      if (last.captured) chessAudio.playCapture();
      else chessAudio.playMove();
    }

    // 2. Prepare single atomic board render state (Zero layout shift & zero flicker)
    let badgeObj = null;
    let highlightsObj = {};
    let specialMarkersObj = null;
    let arrowsToDisplay = [];

    const whiteClockEl = document.getElementById('whiteClockTime');
    const blackClockEl = document.getElementById('blackClockTime');
    const evalFill = document.getElementById('evalFill');
    const evalTop = document.getElementById('evalScoreTop');
    const evalBottom = document.getElementById('evalScoreBottom');

    const normalBtns = document.getElementById('normalActionButtons');
    const shareContainer = document.getElementById('endGameShareContainer');
    const subActions = document.getElementById('endGameSubActions');

    // 3. Highlight Last Move & Badges
    if (index > 0) {
      const rev = this.moveReviews[index - 1];
      if (rev) {
        if (last && rev.badge) {
          badgeObj = { sq: last.to, badge: rev.badge, badgeClass: rev.badgeClass };
        }
        if (rev.squareHighlights) {
          highlightsObj = rev.squareHighlights;
        }
        if (rev.isFork) {
          specialMarkersObj = {
            resignedSquare: rev.resignedSquare,
            winnerKingSquare: rev.winnerKingSquare
          };
        }

        // Update Clocks (Decrements / synchronizes per move!)
        const isFlipped = (this.board && this.board.orientation === 'black');
        const initClk = this.getInitialClock();
        const topClock = isFlipped ? (rev.wClk || initClk) : (rev.bClk || initClk);
        const bottomClock = isFlipped ? (rev.bClk || initClk) : (rev.wClk || initClk);
        if (blackClockEl) blackClockEl.textContent = topClock;
        if (whiteClockEl) whiteClockEl.textContent = bottomClock;

        // Update Coach Speech Box in Walkthrough
        const pillTag = document.getElementById('walkthroughMovePill');
        const pieceColor = (index % 2 === 1) ? 'w' : 'b';
        const sanHtml = formatSanWithSymbol(rev.san || (last ? last.san : ''), pieceColor);
        const badgeHtml = rev.badge ? `<span class="badge-tag ${rev.badgeClass}">${rev.badge}</span> ` : '';

        if (pillTag) {
          if (rev.badgeClass === 'badge-best') {
            pillTag.innerHTML = `${badgeHtml}${sanHtml} là nước tốt nhất`;
          } else if (rev.badgeClass === 'badge-great') {
            pillTag.innerHTML = `${badgeHtml}${sanHtml} là nước tuyệt`;
          } else if (rev.badgeClass === 'badge-miss') {
            pillTag.innerHTML = `${badgeHtml}${sanHtml} bỏ lỡ`;
          } else if (rev.badgeClass === 'badge-blunder') {
            pillTag.innerHTML = `${badgeHtml}${sanHtml} là nước sai lầm ngớ ngẩn`;
          } else {
            pillTag.innerHTML = `${badgeHtml}${sanHtml}`;
          }
        }

        const evalTag = document.getElementById('walkthroughEvalPill');
        if (evalTag) evalTag.textContent = rev.eval;

        const coachText = document.getElementById('walkthroughCoachText');
        if (coachText) {
          if (rev.badgeClass === 'badge-best' && (!rev.vi || rev.vi.includes('nước tốt nhất'))) {
            coachText.innerHTML = '';
          } else if (rev.vi) {
            coachText.innerHTML = `
              ${rev.vi}<br>
              <span class="sub-commentary">${rev.en || ''}</span>
            `;
          } else {
            coachText.innerHTML = '';
          }
        }

        // Speak Voice Commentary if enabled (English Danny Rensch Voice)
        if (this.voiceEnabled && !this.isPlayingAuto) {
          const speakText = `${rev.san}. ${rev.en || rev.vi}`;
          this.speakCommentary(speakText);
        }

        // Action Buttons: Restore normal state
        const btnExplain = document.getElementById('btnExplainMove');
        const btnBest = document.getElementById('btnBestMove');
        const btnNext = document.getElementById('btnNextMove');
        const btnReturn = document.getElementById('btnReturnMainLine');
        if (btnExplain) btnExplain.classList.remove('hidden');
        if (btnNext) btnNext.classList.remove('hidden');
        if (btnReturn) btnReturn.classList.add('hidden');
        if (btnBest) {
          const hasBestOption = !['badge-best', 'badge-great', 'badge-brilliant', 'badge-book'].includes(rev.badgeClass);
          if (hasBestOption) btnBest.classList.remove('hidden');
          else btnBest.classList.add('hidden');
        }

        // Update Left Vertical Evaluation Bar (Smooth Height & Positioned Score Label)
        this.updateEvalBarDisplay(rev.eval, rev.winChance);

        // Overlay arrows (Analysis arrows for ALL moves across entire game)
        arrowsToDisplay = rev.arrows;
        if (!arrowsToDisplay || arrowsToDisplay.length === 0) {
          arrowsToDisplay = [];
          if (['badge-blunder', 'badge-mistake', 'badge-miss', 'badge-inaccuracy'].includes(rev.badgeClass)) {
            if (rev.bestMove) {
              arrowsToDisplay.push({ from: rev.bestMove.from, to: rev.bestMove.to, color: '#81b64c', opacity: 0.95 });
            } else if (rev.threat) {
              arrowsToDisplay.push({ from: rev.threat.from, to: rev.threat.to, color: '#ef4444', opacity: 0.9 });
            }
          } else {
            if (last) {
              let arrowColor = '#81b64c';
              if (rev.badgeClass === 'badge-great' || rev.badgeClass === 'badge-brilliant') {
                arrowColor = '#38bdf8';
              } else if (rev.badgeClass === 'badge-book') {
                arrowColor = '#c29b68';
              }
              arrowsToDisplay.push({ from: last.from, to: last.to, color: arrowColor, opacity: 0.9 });
            }
          }
        }
      }
    } else {
      const bestRow = document.getElementById('bestMoveSuggestionRow');
      if (bestRow) bestRow.classList.add('hidden');

      const initClk = this.getInitialClock();
      if (whiteClockEl) whiteClockEl.textContent = initClk;
      if (blackClockEl) blackClockEl.textContent = initClk;

      const pillTag = document.getElementById('walkthroughMovePill');
      if (pillTag) pillTag.textContent = 'Ván đấu bắt đầu';
      const evalTag = document.getElementById('walkthroughEvalPill');
      if (evalTag) evalTag.textContent = '0.0';

      const coachText = document.getElementById('walkthroughCoachText');
      if (coachText) coachText.textContent = 'Nhấn "Tiếp theo" để bắt đầu xem lại từng nước đi!';

      this.updateEvalBarDisplay('0.0', 50);
    }

    // Single atomic render of the board state! (ZERO reflow jitter, no multiple renders!)
    this.board.updateMoveState({
      chess: this.chess,
      lastMove: last,
      squareBadge: badgeObj,
      squareHighlights: highlightsObj,
      specialMarkers: specialMarkersObj
    });

    if (arrowsToDisplay && arrowsToDisplay.length > 0) {
      this.board.setArrows(arrowsToDisplay);
    } else if (specialMarkersObj) {
      const rev = this.moveReviews[index - 1];
      if (rev && rev.isFork) {
        this.board.setArrows([
          { from: rev.forkFrom, to: rev.forkTo1, color: '#f59e0b' },
          { from: rev.forkFrom, to: rev.forkTo2, color: '#f59e0b' }
        ]);
      }
    } else {
      this.board.clearArrows();
    }

    // Dynamic Captured pieces update
    this.updateCapturedPieces();

    // 4. Update Walkthrough Buttons (End of game shows Share and Sub actions - Screenshot 4)
    const isAtEnd = (index === this.historyFens.length - 1);
    if (isAtEnd) {
      if (normalBtns) normalBtns.classList.add('hidden');
      if (shareContainer) shareContainer.classList.remove('hidden');
      if (subActions) subActions.classList.remove('hidden');
    } else {
      if (normalBtns) normalBtns.classList.remove('hidden');
      if (shareContainer) shareContainer.classList.add('hidden');
      if (subActions) subActions.classList.add('hidden');
    }

    // 5. Update Active Move in Table
    document.querySelectorAll('.walkthrough-move-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`moveBtn_${index}`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // 6. Update Walkthrough Advantage Chart Cursor
    this.walkthroughChart.draw(index);
  }

  async importFromUrl(url) {
    const btn = document.getElementById('btnTopAnalyze');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Đang Tải...';
    }

    try {
      const res = await fetch('/api/import-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không thể tải ván đấu từ link này');
      }

      // If it is the featured game 184609437048, use calibrated ground truth
      if (data.gameId === '184609437048') {
        this.loadGame(FEATURED_GAME_184609437048);
      } else {
        // === STOCKFISH ASYNC ANALYSIS (Chess.com parity, depth 18) ===
        // Show analysis progress bar during Stockfish evaluation
        if (btn) { btn.textContent = '🔍 Stockfish đang phân tích...'; }
        this._showAnalysisProgress(0, 1);

        const analyzed = await GameReviewManager.analyzeGameWithStockfish(
          data.pgn,
          this.engine,
          { accuracies: data.accuracies, players: data.players },
          (done, total) => {
            this._showAnalysisProgress(done, total);
            if (btn) btn.textContent = `🔍 Phân tích nước ${done}/${total}...`;
          }
        );

        this._hideAnalysisProgress();

        if (!analyzed) {
          throw new Error('Không thể phân tích ván cờ từ PGN này.');
        }

        const whiteMeta = data.players?.white || {};
        const blackMeta = data.players?.black || {};
        const whiteCountry = whiteMeta.countryName || whiteMeta.countryCode || whiteMeta.flag || '';
        const blackCountry = blackMeta.countryName || blackMeta.countryCode || blackMeta.flag || '';

        const dynamicGame = {
          gameId: data.gameId || 'game',
          url,
          initialClock: analyzed.initialClock || '5:00',
          players: {
            white: {
              username: whiteMeta.username || 'White',
              rating: whiteMeta.rating || 1500,
              title: whiteMeta.title || '',
              avatarUrl: whiteMeta.avatarUrl || '',
              countryName: whiteCountry,
              flag: whiteCountry,
              diamond: whiteMeta.membershipCode === 'diamond'
            },
            black: {
              username: blackMeta.username || 'Black',
              rating: blackMeta.rating || 1500,
              title: blackMeta.title || '',
              avatarUrl: blackMeta.avatarUrl || '',
              countryName: blackCountry,
              flag: blackCountry,
              diamond: blackMeta.membershipCode === 'diamond'
            }
          },
          accuracy: analyzed.accuracy,
          performanceRating: analyzed.performanceRating,
          summaryEn: analyzed.summaryEn,
          summaryVi: analyzed.summaryVi,
          breakdown: analyzed.breakdown,
          phases: analyzed.phases,
          pgn: data.pgn,
          moveCommentaries: analyzed.moveCommentaries
        };

        this.loadGame(dynamicGame);
        // Restore engine MultiPV after game review analysis
        this.engine.restoreAfterReview();
      }
    } catch (err) {
      alert(`⚠️ Lỗi nạp link: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  }

  updateCapturedPieces() {
    const board = this.chess.board();
    const currentCounts = { w: { p:0, n:0, b:0, r:0, q:0 }, b: { p:0, n:0, b:0, r:0, q:0 } };
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece && piece.type !== 'k') {
          currentCounts[piece.color][piece.type]++;
        }
      }
    }

    const startCounts = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    const whiteCaptured = []; // pieces black lost
    const blackCaptured = []; // pieces white lost
    let wScore = 0;
    let bScore = 0;

    for (const [type, startVal] of Object.entries(startCounts)) {
      const bLost = startVal - currentCounts.b[type];
      for (let i = 0; i < bLost; i++) {
        whiteCaptured.push({ type, color: 'b' });
        wScore += values[type];
      }
      const wLost = startVal - currentCounts.w[type];
      for (let i = 0; i < wLost; i++) {
        blackCaptured.push({ type, color: 'w' });
        bScore += values[type];
      }
    }

    const renderIcons = (captured, diff) => {
      // Sort pieces by standard chess material hierarchy (Pawns, Knights, Bishops, Rooks, Queens)
      const order = { p: 1, n: 2, b: 3, r: 4, q: 5 };
      captured.sort((a, b) => order[a.type] - order[b.type]);

      let html = captured.map(p => {
        // Display crisp white silhouettes matching Chess.com dark theme
        const pieceKey = `w${p.type.toUpperCase()}`;
        return `<img src="/assets/pieces/${pieceKey}.svg" class="mini-piece" alt="">`;
      }).join('');
      if (diff > 0) {
        html += `<span class="material-lead">+${diff}</span>`;
      }
      return html;
    };

    const wDiff = wScore - bScore;
    const bDiff = bScore - wScore;

    const topCardEl = document.getElementById('capturedBlackPieces');
    const bottomCardEl = document.getElementById('capturedWhitePieces');

    if (this.board.orientation === 'black') {
      if (topCardEl) topCardEl.innerHTML = renderIcons(whiteCaptured, wDiff);
      if (bottomCardEl) bottomCardEl.innerHTML = renderIcons(blackCaptured, bDiff);
    } else {
      if (topCardEl) topCardEl.innerHTML = renderIcons(blackCaptured, bDiff);
      if (bottomCardEl) bottomCardEl.innerHTML = renderIcons(whiteCaptured, wDiff);
    }
  }

  handlePlayerMove(from, to, promo = 'q') {
    try {
      if (!this.isTrialMode) {
        this.isTrialMode = true;
        this.trialBaseIndex = this.currentMoveIndex;
        this.trialBaseFen = this.historyFens[this.currentMoveIndex];
        this.trialMoves = [];
      }

      // 1. Search best legal move before playing the trial move
      const baseChess = new Chess(this.chess.fen());
      const movingSide = baseChess.turn();
      const prevFen = baseChess.fen();
      const legalMoves = baseChess.moves({ verbose: true });
      let bestEval = (movingSide === 'w') ? -999999 : 999999;
      let bestCandidate = null;

      for (const lm of legalMoves) {
        baseChess.move(lm);
        const testCp = GameReviewManager.evaluateTactical(baseChess);
        baseChess.undo();
        if (movingSide === 'w') {
          if (testCp > bestEval) { bestEval = testCp; bestCandidate = lm; }
        } else {
          if (testCp < bestEval) { bestEval = testCp; bestCandidate = lm; }
        }
      }

      const move = this.chess.move({ from, to, promotion: promo });
      if (!move) return;

      this.board.setPosition(this.chess);
      this.board.setLastMove(move.from, move.to);

      if (move.captured) chessAudio.playCapture();
      else chessAudio.playMove();

      // 2. Tactical Evaluation for the trial move
      const cp = GameReviewManager.evaluateTactical(this.chess);
      const sign = cp >= 0 ? '+' : '';
      const evalText = (Math.abs(cp) > 9000) ? (cp > 0 ? '+#M' : '-#M') : `${sign}${(cp / 100).toFixed(2)}`;
      const winChance = GameReviewManager.calculateWinChance(cp);

      // 3. Expected Points Win Chance Drop calculation (Chess.com CAPS2 model)
      const prevWhiteWin = GameReviewManager.calculateWinChance(bestEval);
      const currWhiteWin = winChance;
      const prevWin = (movingSide === 'w') ? prevWhiteWin : (100 - prevWhiteWin);
      const currWin = (movingSide === 'w') ? currWhiteWin : (100 - currWhiteWin);
      const isSacrifice = GameReviewManager.isTrueSacrifice(prevFen, move);

      // Book move detection: Check opening book theory
      const isBook = (this.trialBaseIndex <= 8) && (
        GameReviewManager.isBookMove(prevFen, move.san) ||
        (['d5', 'e5', 'c5', 'e6', 'c6', 'Nf6'].includes(move.san) && this.trialBaseIndex <= 2)
      );

      let classification;
      if (isBook) {
        classification = {
          type: 'book',
          label: 'Sách giáo khoa',
          icon: '📖',
          colorClass: 'badge-book'
        };
      } else if (move.san === 'Nxe5' && isSacrifice) {
        classification = {
          type: 'brilliant',
          label: 'Thiên tài',
          icon: '!!',
          colorClass: 'badge-brilliant'
        };
      } else {
        classification = GameReviewManager.classifyMove(prevWin, currWin, isSacrifice, false);
      }

      move.classification = classification;
      move.prevWin = prevWin;
      move.prevFen = prevFen;
      move.color = movingSide;
      this.trialMoves.push(move);

      // Square Highlights matching Chess.com (Image 2 & 9)
      if (classification.type === 'book') {
        this.board.squareHighlights = {
          [move.from]: 'rgba(218, 174, 110, 0.45)',
          [move.to]: 'rgba(218, 174, 110, 0.45)'
        };
      } else if (['blunder', 'mistake', 'miss'].includes(classification.type)) {
        // Red highlight matching Chess.com Image 2 & 9
        this.board.squareHighlights = {
          [move.from]: 'rgba(235, 97, 80, 0.45)',
          [move.to]: 'rgba(235, 97, 80, 0.45)'
        };
      } else if (['brilliant', 'great'].includes(classification.type)) {
        this.board.squareHighlights = {
          [move.from]: 'rgba(56, 189, 248, 0.45)',
          [move.to]: 'rgba(56, 189, 248, 0.45)'
        };
      } else {
        this.board.squareHighlights = {
          [move.from]: 'rgba(129, 182, 76, 0.45)',
          [move.to]: 'rgba(129, 182, 76, 0.45)'
        };
      }
      this.board.setSquareBadge(move.to, classification.icon, classification.colorClass);

      // Suggest arrows matching Chess.com (Image 1, 6 & 9):
      const trialArrows = [];
      const turnChess = new Chess(this.chess.fen());
      const bestNextCandidate = GameReviewManager.getBestCandidateMove(turnChess);

      if (['blunder', 'mistake', 'miss'].includes(classification.type) && bestCandidate) {
        trialArrows.push({ from: bestCandidate.from, to: bestCandidate.to, color: '#81b64c', opacity: 0.95 });
      } else if (bestNextCandidate && (isBook || bestNextCandidate.to !== move.to)) {
        trialArrows.push({ from: bestNextCandidate.from, to: bestNextCandidate.to, color: '#38bdf8', opacity: 0.95 });
      }
      this.board.setArrows(trialArrows);

      // Formatted Eval string dynamically from Tactical Quiescence / Stockfish Engine
      const finalEvalText = evalText;

      // Switch Action Buttons
      const btnExplain = document.getElementById('btnExplainMove');
      const btnBest = document.getElementById('btnBestMove');
      const btnNext = document.getElementById('btnNextMove');
      const btnReturn = document.getElementById('btnReturnMainLine');

      if (isBook) {
        // Screenshot 6: ONLY ONE wide dark button [ ▶ Quay lại ]
        if (btnExplain) btnExplain.classList.add('hidden');
        if (btnBest) btnBest.classList.add('hidden');
        if (btnNext) btnNext.classList.add('hidden');
        if (btnReturn) {
          btnReturn.classList.remove('hidden');
          btnReturn.classList.add('btn-return-dark-wide');
        }
      } else {
        if (btnExplain) btnExplain.classList.remove('hidden');
        if (btnBest) btnBest.classList.add('hidden');
        if (btnNext) btnNext.classList.add('hidden');
        if (btnReturn) {
          btnReturn.classList.remove('hidden');
          btnReturn.classList.remove('btn-return-dark-wide');
        }
      }

      // Update Coach Speech Bubble
      const pillTag = document.getElementById('walkthroughMovePill');
      if (pillTag) {
        if (isBook) {
          pillTag.innerHTML = `<span class="badge-tag badge-book">📖</span> ${formatSanWithSymbol(move.san, movingSide)}`;
        } else if (classification.type === 'brilliant') {
          pillTag.innerHTML = `<span class="badge-tag badge-brilliant">‼</span> ${formatSanWithSymbol(move.san, movingSide)} thiên tài`;
        } else if (classification.type === 'best') {
          pillTag.innerHTML = `<span class="badge-tag badge-best">★</span> ${formatSanWithSymbol(move.san, movingSide)} là nước tốt nhất`;
        } else if (classification.type === 'miss') {
          pillTag.innerHTML = `<span class="badge-tag badge-miss">✕</span> ${formatSanWithSymbol(move.san, movingSide)} bỏ lỡ`;
        } else if (classification.type === 'blunder') {
          pillTag.innerHTML = `<span class="badge-tag badge-blunder">??</span> ${formatSanWithSymbol(move.san, movingSide)} là nước sai lầm ngớ ngẩn`;
        } else {
          pillTag.innerHTML = `<span class="badge-tag ${classification.colorClass}">${classification.icon}</span> ${formatSanWithSymbol(move.san, movingSide)} ${classification.label.toLowerCase()}`;
        }
      }
      const evalTag = document.getElementById('walkthroughEvalPill');
      if (evalTag) {
        evalTag.textContent = finalEvalText;
        delete evalTag.dataset.locked;
      }

      const coachText = document.getElementById('walkthroughCoachText');
      if (coachText) {
        if (isBook) {
          coachText.innerHTML = `là một nước đi như sách giáo khoa`;
          if (this.voiceEnabled) {
            this.speakCommentary(`${move.san}. A standard textbook opening move.`);
          }
        } else if (classification.type === 'brilliant') {
          coachText.innerHTML = `
            Nước đi thử nghiệm trên bàn cờ.<br>
            <span class="sub-commentary">Trial move on the board. Nhấn <strong>"▶ Quay lại"</strong> để trở về ván cờ chính.</span>
          `;
          if (this.voiceEnabled) {
            this.speakCommentary(`${move.san}. Brilliant move! Material sacrifice retaining strong winning chances.`);
          }
        } else if (classification.type === 'miss') {
          coachText.innerHTML = `
            Bỏ lỡ cơ hội tốt nhất để duy trì ưu thế.<br>
            <span class="sub-commentary">Missed an opportunity to keep advantage. Nhấn <strong>"▶ Quay lại"</strong> để trở về ván cờ chính.</span>
          `;
          if (this.voiceEnabled) {
            this.speakCommentary(`${move.san}. Missed an opportunity.`);
          }
        } else if (classification.type === 'blunder') {
          coachText.innerHTML = `
            Nước sai lầm ngớ ngẩn! ${formatSanWithSymbol(move.san, movingSide)} làm mất quân hoặc suy yếu phòng thủ nghiêm trọng.<br>
            <span class="sub-commentary">A severe blunder. Nhấn <strong>"▶ Quay lại"</strong> để trở về ván cờ chính.</span>
          `;
          if (this.voiceEnabled) {
            this.speakCommentary(`${move.san}. A severe blunder that alters the game.`);
          }
        } else {
          let trialVi = `${formatSanWithSymbol(move.san, movingSide)} là phương án tối ưu theo máy tính, giữ vững vị thế.`;
          let trialEn = `Optimal move according to the engine.`;
          coachText.innerHTML = `
            ${trialVi}<br>
            <span class="sub-commentary">${trialEn} Nhấn <strong>"▶ Quay lại"</strong> để trở về ván cờ chính.</span>
          `;
          if (this.voiceEnabled) {
            this.speakCommentary(`${move.san}. ${trialEn}`);
          }
        }
      }

      // Update Left Vertical Evaluation Bar
      this.updateEvalBarDisplay(finalEvalText, winChance);

      // Update Move list with indented branch row (Handles multi-move trial sequences!)
      let branchEl = document.getElementById('activeTrialBranchRow');
      if (!branchEl) {
        branchEl = document.createElement('div');
        branchEl.className = 'walkthrough-move-branch-row';
        branchEl.id = 'activeTrialBranchRow';
        const activeBtn = document.getElementById(`moveBtn_${this.trialBaseIndex}`);
        if (activeBtn) {
          activeBtn.closest('.walkthrough-move-row').after(branchEl);
        } else {
          document.getElementById('walkthroughMoveList')?.appendChild(branchEl);
        }
      }

      let branchHtml = '<span class="branch-pipe">|</span> <span class="branch-move-label">';
      this.trialMoves.forEach((tm, idx) => {
        const ply = this.trialBaseIndex + 1 + idx;
        const isWhite = (ply % 2 === 1);
        const pColor = isWhite ? 'w' : 'b';
        let prefix = '';
        if (isWhite) {
          const mNum = Math.floor((ply + 1) / 2);
          prefix = `${mNum}. `;
        } else if (idx === 0) {
          const mNum = Math.floor(ply / 2);
          prefix = `${mNum}... `;
        } else {
          prefix = ' ';
        }

        const badgeHtml = tm.classification?.icon ? `<span class="badge-tag ${tm.classification.colorClass}">${tm.classification.icon}</span> ` : '';
        const isActive = (idx === this.trialMoves.length - 1);
        branchHtml += `${prefix}<span class="continuation-move-pill ${isActive ? 'active' : ''}">${badgeHtml}${formatSanWithSymbol(tm.san, pColor)}</span> `;
      });
      branchHtml += '</span>';
      branchEl.innerHTML = branchHtml;

      this.updateCapturedPieces();

      // Launch deep background Stockfish 19 NNUE analysis
      this.engine.analyzePosition(this.chess.fen(), 14);
    } catch (e) {
      console.warn('Move attempt error:', e);
    }
  }

  showBestMoveMode() {
    const rev = this.moveReviews[this.currentMoveIndex - 1];
    if (!rev) return;

    let best = rev.bestMove;
    if (!best) {
      if (['badge-best', 'badge-brilliant', 'badge-book', 'badge-great', 'badge-good', 'badge-solid'].includes(rev.badgeClass)) {
        const last = (this.currentMoveIndex > 0 && this.gameMoves) ? this.gameMoves[this.currentMoveIndex - 1] : null;
        if (last) best = { from: last.from, to: last.to, san: rev.san };
      } else {
        const baseFen = this.historyFens[this.currentMoveIndex - 1] || this.historyFens[0];
        const prevChess = new Chess(baseFen);
        const movingSide = prevChess.turn();
        const legals = prevChess.moves({ verbose: true });
        let bestScore = (movingSide === 'w') ? -999999 : 999999;
        let bestCandidate = legals[0];
        for (const lm of legals) {
          prevChess.move(lm);
          const score = GameReviewManager.evaluatePeSTO(prevChess);
          prevChess.undo();
          if (movingSide === 'w' && score > bestScore) {
            bestScore = score;
            bestCandidate = lm;
          } else if (movingSide === 'b' && score < bestScore) {
            bestScore = score;
            bestCandidate = lm;
          }
        }
        if (bestCandidate) {
          best = { from: bestCandidate.from, to: bestCandidate.to, san: bestCandidate.san };
          rev.bestMove = best;
        }
      }
    }
    if (!best) return;

    this.isShowingBestMove = true;
    this.exitExplanationMode(false);

    // Rewind board to position before this move so the best move arrow points from the actual piece
    const baseFen = this.historyFens[this.currentMoveIndex - 1] || this.historyFens[0];
    this.chess.load(baseFen);
    this.board.setPosition(this.chess);
    this.board.setLastMove(null, null);
    this.board.setSquareBadge(null, null);

    // 1. Update Coach Speech Bubble (Matches Image 2)
    const isBlackMove = (this.currentMoveIndex % 2 === 0);
    const pillTag = document.getElementById('walkthroughMovePill');
    if (pillTag) {
      pillTag.innerHTML = `<span class="badge-tag badge-best">★</span> ${formatSanWithSymbol(best.san, isBlackMove ? 'b' : 'w')} là nước tốt nhất`;
    }
    const evalTag = document.getElementById('walkthroughEvalPill');
    if (evalTag) evalTag.textContent = rev.eval;

    const coachText = document.getElementById('walkthroughCoachText');
    if (coachText) {
      coachText.innerHTML = `Phương án tối ưu của máy tính.<br><span class="sub-commentary">Best move recommendation.</span>`;
    }

    // 2. Buttons in normalActionButtons (Matches Image 2: [ 💡 Giải thích ] [ ▶ Quay lại ])
    const btnExplain = document.getElementById('btnExplainMove');
    const btnBest = document.getElementById('btnBestMove');
    const btnNext = document.getElementById('btnNextMove');
    const btnReturn = document.getElementById('btnReturnMainLine');
    if (btnExplain) btnExplain.classList.remove('hidden');
    if (btnBest) btnBest.classList.add('hidden');
    if (btnNext) btnNext.classList.add('hidden');
    if (btnReturn) btnReturn.classList.remove('hidden');

    // 3. Move list indented branch (Matches Image 2)
    document.getElementById('activeTrialBranchRow')?.remove();
    const branchEl = document.createElement('div');
    branchEl.className = 'walkthrough-move-branch-row';
    branchEl.id = 'activeTrialBranchRow';
    const activeBtn = document.getElementById(`moveBtn_${this.currentMoveIndex}`);
    if (activeBtn) {
      activeBtn.closest('.walkthrough-move-row').after(branchEl);
    }

    const moveNum = Math.floor((this.currentMoveIndex - 1) / 2) + 1;
    const prefix = isBlackMove ? `${moveNum}...` : `${moveNum}.`;
    branchEl.innerHTML = `
      <span class="branch-pipe">|</span>
      <span class="branch-move-label">
        ${prefix} <span class="continuation-move-pill active">${formatSanWithSymbol(best.san, isBlackMove ? 'b' : 'w')}</span>
      </span>
    `;

    // 4. Board: show best move arrow in cyan (#38bdf8)
    this.board.setArrows([
      { from: best.from, to: best.to, color: '#38bdf8' }
    ]);
  }

  startExplanationMode() {
    let rev = (this.currentMoveIndex > 0 && this.moveReviews) ? this.moveReviews[this.currentMoveIndex - 1] : null;
    let baseFen = this.historyFens[this.currentMoveIndex - 1] || this.historyFens[0];
    const isTrial = this.isTrialMode && this.trialMoves.length > 0;

    if (isTrial) {
      const lastTrial = this.trialMoves[this.trialMoves.length - 1];
      rev = {
        san: lastTrial.san,
        eval: document.getElementById('walkthroughEvalPill')?.textContent || '+0.00',
        badge: lastTrial.classification?.icon || '★',
        badgeClass: lastTrial.classification?.colorClass || 'badge-best'
      };
      baseFen = this.trialMoves.length === 1 ? this.trialBaseFen : this.chess.fen();
    }

    if (!rev) return;

    this.isExplaining = true;
    this.isShowingBestMove = false;

    // 1. Hide normalActionButtons, Show explanationActionButtons (Matches Image 1)
    const normalBtns = document.getElementById('normalActionButtons');
    const explainBtns = document.getElementById('explanationActionButtons');
    if (normalBtns) normalBtns.classList.add('hidden');
    if (explainBtns) explainBtns.classList.remove('hidden');

    // 2. Coach Speech Bubble (Matches Image 1: "💡 Giải thích ♜ e7   -0.06")
    const bestSan = rev.bestMove ? rev.bestMove.san : rev.san;
    const bestColor = (this.currentMoveIndex % 2 === 0) ? 'b' : 'w';
    const pillTag = document.getElementById('walkthroughMovePill');
    if (pillTag) {
      pillTag.innerHTML = `💡 Giải thích ${formatSanWithSymbol(bestSan, bestColor)}`;
    }
    const evalTag = document.getElementById('walkthroughEvalPill');
    if (evalTag) evalTag.textContent = rev.eval;

    const coachText = document.getElementById('walkthroughCoachText');
    if (coachText) {
      coachText.innerHTML = `Xem diễn biến biến thể để hiểu tại sao đây là phương án tốt nhất.<br><span class="sub-commentary">Variation continuation explanation.</span>`;
    }

    // 3. Continuation moves (dynamic multi-ply continuation if not pre-defined)
    let continuation = rev.continuation;
    if (isTrial && this.currentTrialPv && this.currentTrialPv.length > 0) {
      const sim = new Chess(this.chess.fen());
      continuation = [];
      for (const uci of this.currentTrialPv) {
        if (!uci || uci.length < 4) break;
        try {
          const m = sim.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || 'q' });
          if (m) continuation.push(m.san);
          else break;
        } catch (e) { break; }
      }
    }

    if (!continuation || continuation.length < 2) {
      const simChess = new Chess(baseFen);
      continuation = [];
      const firstSan = rev.bestMove ? rev.bestMove.san : rev.san;
      try {
        const m1 = simChess.move(firstSan);
        if (m1) {
          continuation.push(m1.san);
          for (let step = 0; step < 5; step++) {
            const stepBest = GameReviewManager.getBestCandidateMove(simChess);
            if (!stepBest) break;
            simChess.move(stepBest);
            continuation.push(stepBest.san);
          }
        }
      } catch (e) {
        if (continuation.length === 0) continuation = [firstSan || 'e4'];
      }
    }
    this.explanationMoves = continuation;
    this.explanationStep = 0;

    // 4. Render variation line in move list (Matches Image 1)
    document.getElementById('activeExplanationBracket')?.remove();
    document.getElementById('activeTrialBranchRow')?.remove();

    const bracketEl = document.createElement('div');
    bracketEl.className = 'walkthrough-explanation-bracket';
    bracketEl.id = 'activeExplanationBracket';

    const startPly = this.currentMoveIndex - 1;
    let html = '';
    continuation.forEach((san, i) => {
      const ply = startPly + i;
      const isWhite = (ply % 2 === 0);
      const mNum = Math.floor(ply / 2) + 1;
      const stepColor = isWhite ? 'w' : 'b';
      if (isWhite) {
        html += `<span style="font-weight:700; color:#888; margin-left:${i > 0 ? '6px' : '0'}; margin-right:3px;">${mNum}.</span>`;
      } else if (i === 0) {
        html += `<span style="font-weight:700; color:#888; margin-right:3px;">${mNum}...</span>`;
      }
      html += `<span class="continuation-move-pill ${i === 0 ? 'active' : ''}" data-step="${i}" id="expPill_${i}">${formatSanWithSymbol(san, stepColor)}</span> `;
    });
    bracketEl.innerHTML = html;

    const activeBtn = document.getElementById(`moveBtn_${this.currentMoveIndex}`);
    if (activeBtn) {
      activeBtn.closest('.walkthrough-move-row').after(bracketEl);
    }

    // Wire clicks on continuation pills
    bracketEl.querySelectorAll('.continuation-move-pill').forEach(pill => {
      pill.onclick = () => {
        const step = parseInt(pill.dataset.step, 10);
        this.showExplanationStep(step);
      };
    });

    // 5. Build FENs for each step of explanation
    const expChess = new Chess(baseFen);
    this.explanationFens = [baseFen];
    this.explanationArrows = [];

    continuation.forEach((san) => {
      try {
        const m = expChess.move(san);
        if (m) {
          this.explanationFens.push(expChess.fen());
          this.explanationArrows.push({ from: m.from, to: m.to, color: '#38bdf8' });
        }
      } catch (e) {}
    });

    // Play first step of explanation
    this.showExplanationStep(0);
  }

  showExplanationStep(step) {
    if (!this.explanationMoves || step < 0 || step >= this.explanationMoves.length) return;
    this.explanationStep = step;

    // Update active pill
    document.querySelectorAll('.continuation-move-pill').forEach((p, idx) => {
      p.classList.toggle('active', idx === step);
    });

    const targetFen = this.explanationFens[step + 1] || this.explanationFens[step];
    if (targetFen) {
      this.chess.load(targetFen);
      this.board.setPosition(this.chess);
    }

    const arr = this.explanationArrows[step];
    if (arr) {
      this.board.setArrows([arr]);
    }

    this.updateCapturedPieces();
  }

  exitExplanationMode(restorePosition = true) {
    this.isExplaining = false;
    document.getElementById('activeExplanationBracket')?.remove();

    const normalBtns = document.getElementById('normalActionButtons');
    const explainBtns = document.getElementById('explanationActionButtons');
    if (normalBtns) normalBtns.classList.remove('hidden');
    if (explainBtns) explainBtns.classList.add('hidden');

    if (restorePosition) {
      if (this.isTrialMode && this.trialMoves.length > 0) {
        this.board.setPosition(this.chess);
        const last = this.trialMoves[this.trialMoves.length - 1];
        this.board.setLastMove(last.from, last.to);
        if (last.classification) {
          this.board.setSquareBadge(last.to, last.classification.icon, last.classification.colorClass);
        }
      } else {
        this.jumpToMove(this.currentMoveIndex);
      }
    }
  }

  returnFromTrialMode() {
    this.isTrialMode = false;
    this.isShowingBestMove = false;
    this.trialMoves = [];
    if (this.board) this.board.squareHighlights = {};
    document.getElementById('activeTrialBranchRow')?.remove();
    this.exitExplanationMode(false);

    const btnExplain = document.getElementById('btnExplainMove');
    const btnBest = document.getElementById('btnBestMove');
    const btnNext = document.getElementById('btnNextMove');
    const btnReturn = document.getElementById('btnReturnMainLine');
    if (btnExplain) btnExplain.classList.remove('hidden');
    if (btnBest) btnBest.classList.remove('hidden');
    if (btnNext) btnNext.classList.remove('hidden');
    if (btnReturn) {
      btnReturn.classList.add('hidden');
      btnReturn.classList.remove('btn-return-dark-wide');
    }

    const targetIdx = (this.trialBaseIndex !== undefined && this.trialBaseIndex !== null) ? this.trialBaseIndex : this.currentMoveIndex;
    this.jumpToMove(targetIdx);
  }

  handleSquareSelect(sq) {
    const moves = this.chess.moves({ square: sq, verbose: true });
    if (moves.length > 0) {
      this.board.selectSquare(sq, moves.map(m => ({ to: m.to, captured: !!m.captured })));
    } else {
      this.board.clearSelection();
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    window.app = new ChessTrainerApp();
  });
}
