// Interactive Board Editor / Tạo Thế Cờ & Puzzle Solver
import { Chess } from '../lib/chess.js';

export class BoardEditor {
  constructor(boardUI, engine) {
    this.boardUI = boardUI;
    this.engine = engine;
    this.activePiece = null; // { color, type } or 'trash'
    this.turn = 'w';
    this.castling = { K: true, Q: true, k: true, q: true };
    this.customChess = new Chess();
  }

  init() {
    this.bindPalette();
    this.bindEditorControls();
  }

  bindPalette() {
    document.querySelectorAll('.palette-piece').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.palette-piece').forEach(b => b.classList.remove('selected'));
        const target = e.currentTarget;
        target.classList.add('selected');

        const piece = target.dataset.piece; // e.g. 'wK', 'wQ', 'bP', 'trash'
        if (piece === 'trash') {
          this.activePiece = 'trash';
        } else {
          this.activePiece = {
            color: piece[0],
            type: piece[1].toLowerCase()
          };
        }
      });
    });
  }

  bindEditorControls() {
    // Clear Board
    const btnClear = document.getElementById('btnClearBoard');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        this.customChess.clear();
        this.boardUI.setPosition(this.customChess);
        this.updateFenInput();
      });
    }

    // Reset Standard Position
    const btnReset = document.getElementById('btnResetBoard');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.customChess.reset();
        this.boardUI.setPosition(this.customChess);
        this.updateFenInput();
      });
    }

    // Toggle Turn
    document.querySelectorAll('input[name="editorTurn"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.turn = e.target.value;
        this.syncFenFromBoard();
      });
    });

    // FEN Input Sync
    const fenInput = document.getElementById('editorFenInput');
    if (fenInput) {
      fenInput.addEventListener('change', (e) => {
        const fen = e.target.value.trim();
        try {
          this.customChess.load(fen);
          this.boardUI.setPosition(this.customChess);
        } catch (err) {
          alert('Chuỗi FEN không hợp lệ: ' + err.message);
        }
      });
    }

    // Solve / Analyze Custom Position Button
    const btnSolve = document.getElementById('btnSolvePosition');
    if (btnSolve) {
      btnSolve.addEventListener('click', () => {
        this.solvePosition();
      });
    }
  }

  // Handle click on board square in editor mode
  handleSquareClick(sq) {
    if (!this.activePiece) return;

    if (this.activePiece === 'trash') {
      this.customChess.remove(sq);
    } else {
      this.customChess.put(this.activePiece, sq);
    }

    this.boardUI.setPosition(this.customChess);
    this.updateFenInput();
  }

  updateFenInput() {
    const fenInput = document.getElementById('editorFenInput');
    if (fenInput) {
      try {
        fenInput.value = this.customChess.fen();
      } catch (e) {}
    }
  }

  syncFenFromBoard() {
    try {
      const tokens = this.customChess.fen().split(' ');
      tokens[1] = this.turn;
      const newFen = tokens.join(' ');
      this.customChess.load(newFen);
      this.updateFenInput();
    } catch (e) {}
  }

  solvePosition() {
    const btn = document.getElementById('btnSolvePosition');
    const origText = btn ? btn.textContent : '';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⚡ Đang Tìm Nước Đi Tối Ưu (Depth 20)...';
    }

    const currentFen = this.customChess.fen();

    // Query Stockfish with Deep Search (Depth 20)
    this.engine.analyzePosition(currentFen, 20);

    // Also request immediate best move
    this.engine.getBotMove(currentFen, 7, (bestMoveUci) => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }

      if (!bestMoveUci || bestMoveUci.length < 4) {
        alert('Không tìm thấy nước đi hợp lệ hoặc thế cờ đã kết thúc!');
        return;
      }

      const from = bestMoveUci.substring(0, 2);
      const to = bestMoveUci.substring(2, 4);

      // Render prominent emerald green arrow on board
      this.boardUI.setBestMoveArrow(from, to);

      // Display in Editor solution card
      const solEl = document.getElementById('editorSolutionBox');
      if (solEl) {
        solEl.innerHTML = `
          <div class="solution-highlight">
            <span class="sol-title">🏆 Nước Đi Giải Thế Cờ:</span>
            <span class="sol-move">${from.toUpperCase()} ➔ ${to.toUpperCase()}</span>
          </div>
        `;
      }
    });
  }
}
