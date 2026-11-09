// Robust Chessboard UI Component
export class ChessBoardUI {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.orientation = options.orientation || 'white';
    this.onMoveAttempt = options.onMoveAttempt || null;
    this.onSquareSelect = options.onSquareSelect || null;
    this.onSquareClick = options.onSquareClick || null;

    this.selectedSquare = null;
    this.legalDestinations = [];
    this.lastMove = null;
    this.checkSquare = null;
    this.squareBadge = null; // { sq, badge, badgeClass }
    this.squareHighlights = {}; // { [sq]: colorString }
    this.specialMarkers = null; // { resignedSquare, winnerKingSquare }
    this.arrows = [];
    this.showArrows = true;

    this.pieces = {};
    this.draggedPiece = null;

    this.createDom();
    this.bindEvents();
  }

  createDom() {
    this.container.innerHTML = `
      <div class="chessboard-wrapper">
        <div class="chessboard-inner" id="chessboardGrid"></div>
        <svg class="chessboard-arrow-overlay" id="arrowOverlay" viewBox="0 0 800 800"></svg>
        <div class="promotion-modal hidden" id="promotionModal">
          <div class="promotion-choices" id="promotionChoices"></div>
        </div>
      </div>
    `;

    this.gridEl = this.container.querySelector('#chessboardGrid');
    this.arrowSvg = this.container.querySelector('#arrowOverlay');
    this.promoModal = this.container.querySelector('#promotionModal');
    this.promoChoices = this.container.querySelector('#promotionChoices');

    this.renderBoard();
  }

  renderBoard() {
    if (!this.gridEl) return;

    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];

    const displayRanks = this.orientation === 'white' ? ranks : [...ranks].reverse();
    const displayFiles = this.orientation === 'white' ? files : [...files].reverse();

    // If grid not initialized or orientation changed, build the 64 squares once
    if (!this.squareMap || this.lastRenderOrientation !== this.orientation) {
      this.gridEl.innerHTML = '';
      this.squareMap = {};
      this.lastRenderOrientation = this.orientation;

      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const file = displayFiles[f];
          const rank = displayRanks[r];
          const sq = file + rank;
          const isLight = (file.charCodeAt(0) - 97 + parseInt(rank, 10)) % 2 !== 0;

          const sqEl = document.createElement('div');
          sqEl.className = `board-square ${isLight ? 'light' : 'dark'}`;
          sqEl.dataset.square = sq;

          if (f === 0) {
            const rankLabel = document.createElement('span');
            rankLabel.className = 'coord-label rank-label';
            rankLabel.textContent = rank;
            sqEl.appendChild(rankLabel);
          }
          if (r === 7) {
            const fileLabel = document.createElement('span');
            fileLabel.className = 'coord-label file-label';
            fileLabel.textContent = file;
            sqEl.appendChild(fileLabel);
          }

          this.gridEl.appendChild(sqEl);
          this.squareMap[sq] = sqEl;
        }
      }
    }

    // Update each existing square in-place (ZERO layout shift, zero DOM flickering!)
    for (const sq in this.squareMap) {
      const sqEl = this.squareMap[sq];

      // Highlights
      if (this.squareHighlights && this.squareHighlights[sq]) {
        sqEl.style.backgroundColor = this.squareHighlights[sq];
      } else {
        sqEl.style.backgroundColor = '';
      }

      sqEl.classList.toggle('selected', this.selectedSquare === sq);
      sqEl.classList.toggle('last-move', !!(this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq)));
      sqEl.classList.toggle('in-check', this.checkSquare === sq);

      // Piece element
      let pieceEl = sqEl.querySelector('.chess-piece');
      const piece = this.pieces[sq];
      if (piece) {
        const pieceKey = `${piece.color}${piece.type.toUpperCase()}`;
        if (!pieceEl) {
          pieceEl = document.createElement('div');
          pieceEl.className = 'chess-piece';
          pieceEl.dataset.square = sq;
          pieceEl.draggable = true;
          sqEl.appendChild(pieceEl);
        }
        pieceEl.style.backgroundImage = `url('/assets/pieces/${pieceKey}.svg')`;
      } else if (pieceEl) {
        pieceEl.remove();
      }

      // Floating Move Badge on Square
      let badgeEl = sqEl.querySelector('.square-badge-icon');
      if (this.squareBadge && this.squareBadge.sq === sq) {
        if (!badgeEl) {
          badgeEl = document.createElement('div');
          sqEl.appendChild(badgeEl);
        }
        badgeEl.className = `square-badge-icon ${this.squareBadge.badgeClass || ''}`;
        badgeEl.textContent = this.squareBadge.badge;
      } else if (badgeEl) {
        badgeEl.remove();
      }

      // Special Markers (Flag / Crown)
      let flagEl = sqEl.querySelector('.square-resigned-flag');
      let crownEl = sqEl.querySelector('.square-winner-crown');
      if (this.specialMarkers) {
        if (this.specialMarkers.resignedSquare === sq) {
          if (!flagEl) {
            flagEl = document.createElement('div');
            flagEl.className = 'square-resigned-flag';
            flagEl.textContent = '🚩';
            sqEl.appendChild(flagEl);
          }
        } else if (flagEl) {
          flagEl.remove();
        }
        if (this.specialMarkers.winnerKingSquare === sq) {
          if (!crownEl) {
            crownEl = document.createElement('div');
            crownEl.className = 'square-winner-crown';
            crownEl.textContent = '👑';
            sqEl.appendChild(crownEl);
          }
        } else if (crownEl) {
          crownEl.remove();
        }
      } else {
        if (flagEl) flagEl.remove();
        if (crownEl) crownEl.remove();
      }

      // Legal move hints
      let hintEl = sqEl.querySelector('.capture-hint, .move-hint');
      const legalDest = this.legalDestinations.find(d => d.to === sq);
      if (legalDest) {
        const expectedClass = legalDest.captured ? 'capture-hint' : 'move-hint';
        if (!hintEl || !hintEl.classList.contains(expectedClass)) {
          hintEl?.remove();
          hintEl = document.createElement('div');
          hintEl.className = expectedClass;
          sqEl.appendChild(hintEl);
        }
      } else if (hintEl) {
        hintEl.remove();
      }
    }

    this.renderArrows();
  }

  setPosition(chess) {
    this.pieces = {};
    if (!chess) return;
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p) {
          const sq = String.fromCharCode(97 + c) + (8 - r);
          this.pieces[sq] = { type: p.type, color: p.color };
        }
      }
    }

    this.checkSquare = null;
    if (chess.inCheck && chess.inCheck()) {
      const turn = chess.turn();
      for (let sq in this.pieces) {
        if (this.pieces[sq].type === 'k' && this.pieces[sq].color === turn) {
          this.checkSquare = sq;
          break;
        }
      }
    }

    this.selectedSquare = null;
    this.legalDestinations = [];
    this.renderBoard();
  }

  setLastMove(from, to) {
    this.lastMove = (from && to) ? { from, to } : null;
    this.renderBoard();
  }

  setSquareBadge(sq, badge, badgeClass = '') {
    this.squareBadge = (sq && badge) ? { sq, badge, badgeClass } : null;
    this.renderBoard();
  }

  setSpecialMarkers(markers) {
    this.specialMarkers = markers || null;
    this.renderBoard();
  }

  setSquareHighlights(highlights) {
    this.squareHighlights = highlights || {};
    this.renderBoard();
  }

  setArrows(arrowList) {
    this.arrows = arrowList || [];
    this.renderArrows();
  }

  selectSquare(sq, legalDests = []) {
    this.selectedSquare = sq;
    this.legalDestinations = legalDests;
    this.renderBoard();
  }

  clearSelection() {
    this.selectedSquare = null;
    this.legalDestinations = [];
    this.renderBoard();
  }

  clearHighlights() {
    this.lastMove = null;
    this.checkSquare = null;
    this.squareBadge = null;
    this.renderBoard();
  }

  setBestMoveArrow(from, to, color = '#10b981') {
    this.arrows = [{ from, to, color }];
    this.renderArrows();
  }

  clearArrows() {
    this.arrows = [];
    this.renderArrows();
  }

  toggleArrows(show) {
    this.showArrows = show;
    this.renderArrows();
  }

  setOrientation(color) {
    if (this.orientation !== color) {
      this.orientation = color;
      this.renderBoard();
    }
  }

  flip() {
    this.setOrientation(this.orientation === 'white' ? 'black' : 'white');
  }

  getSquareCoords(sq) {
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['8', '7', '6', '5', '4', '3', '2', '1'];
    const displayRanks = this.orientation === 'white' ? ranks : [...ranks].reverse();
    const displayFiles = this.orientation === 'white' ? files : [...files].reverse();

    const col = displayFiles.indexOf(sq[0]);
    const row = displayRanks.indexOf(sq[1]);
    if (col === -1 || row === -1) return null;

    const squareSize = 100;
    return {
      x: col * squareSize + squareSize / 2,
      y: row * squareSize + squareSize / 2
    };
  }

  createArrowPath(fromCoord, toCoord, shaftWidth = 16, headSize = 36) {
    const dx = toCoord.x - fromCoord.x;
    const dy = toCoord.y - fromCoord.y;
    const len = Math.hypot(dx, dy);
    if (len < headSize) return '';
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    const bx = toCoord.x - ux * headSize;
    const by = toCoord.y - uy * headSize;
    const halfShaft = shaftWidth / 2;
    const halfHead = (headSize * 1.1) / 2;

    // Barbed arrowhead indentation
    const barbOffset = headSize * 0.15;
    const barbX = bx + ux * barbOffset;
    const barbY = by + uy * barbOffset;

    const startOffset = 22;
    const sx = fromCoord.x + ux * startOffset;
    const sy = fromCoord.y + uy * startOffset;

    return `M ${sx + px * halfShaft} ${sy + py * halfShaft} ` +
           `L ${barbX + px * halfShaft} ${barbY + py * halfShaft} ` +
           `L ${bx + px * halfHead} ${by + py * halfHead} ` +
           `L ${toCoord.x - ux * 4} ${toCoord.y - uy * 4} ` +
           `L ${bx - px * halfHead} ${by - py * halfHead} ` +
           `L ${barbX - px * halfShaft} ${barbY - py * halfShaft} ` +
           `L ${sx - px * halfShaft} ${sy - py * halfShaft} Z`;
  }

  renderArrows() {
    if (!this.arrowSvg) return;
    this.arrowSvg.innerHTML = '';
    if (!this.showArrows || !this.arrows || this.arrows.length === 0) return;

    this.arrows.forEach((arr) => {
      const fromCoord = this.getSquareCoords(arr.from);
      const toCoord = this.getSquareCoords(arr.to);
      if (!fromCoord || !toCoord) return;

      // Draw intermediate dots for long sliders (Matching Screenshot 4: dots on b7..b2)
      if (arr.from && arr.to && arr.from.length === 2 && arr.to.length === 2) {
        const f1 = arr.from.charCodeAt(0) - 97;
        const r1 = parseInt(arr.from[1], 10);
        const f2 = arr.to.charCodeAt(0) - 97;
        const r2 = parseInt(arr.to[1], 10);
        const df = Math.sign(f2 - f1);
        const dr = Math.sign(r2 - r1);
        const steps = Math.max(Math.abs(f2 - f1), Math.abs(r2 - r1));

        if (steps > 1 && (f1 === f2 || r1 === r2 || Math.abs(f2 - f1) === Math.abs(r2 - r1))) {
          for (let s = 1; s < steps; s++) {
            const interSq = String.fromCharCode(97 + f1 + s * df) + (r1 + s * dr);
            const interCoord = this.getSquareCoords(interSq);
            if (interCoord) {
              const dotEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
              dotEl.setAttribute('cx', interCoord.x);
              dotEl.setAttribute('cy', interCoord.y);
              dotEl.setAttribute('r', '7');
              dotEl.setAttribute('fill', arr.color || '#ef4444');
              dotEl.setAttribute('opacity', '0.4');
              this.arrowSvg.appendChild(dotEl);
            }
          }
        }
      }

      const pathData = this.createArrowPath(fromCoord, toCoord, arr.width || 16, arr.headSize || 36);
      if (!pathData) return;

      const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathEl.setAttribute('d', pathData);
      pathEl.setAttribute('fill', arr.color || '#81b64c');
      pathEl.setAttribute('opacity', arr.opacity || '0.85');
      this.arrowSvg.appendChild(pathEl);
    });
  }

  bindEvents() {
    this.gridEl.addEventListener('click', (e) => {
      const sqEl = e.target.closest('.board-square');
      if (!sqEl) return;
      const clickedSq = sqEl.dataset.square;

      if (this.onSquareClick) {
        const handled = this.onSquareClick(clickedSq);
        if (handled) return;
      }

      if (this.selectedSquare && this.selectedSquare !== clickedSq) {
        const isLegal = this.legalDestinations.some(d => d.to === clickedSq);
        if (isLegal && this.onMoveAttempt) {
          this.onMoveAttempt(this.selectedSquare, clickedSq, 'q');
          return;
        }
      }

      if (this.pieces[clickedSq] && this.onSquareSelect) {
        this.onSquareSelect(clickedSq);
      } else {
        this.selectedSquare = null;
        this.legalDestinations = [];
        this.renderBoard();
      }
    });

    this.gridEl.addEventListener('dragstart', (e) => {
      const pieceEl = e.target.closest('.chess-piece');
      if (!pieceEl) return;
      const sq = pieceEl.dataset.square;
      e.dataTransfer.setData('text/plain', sq);
      this.draggedPiece = sq;
      if (this.onSquareSelect) this.onSquareSelect(sq);
    });

    this.gridEl.addEventListener('dragover', (e) => e.preventDefault());

    this.gridEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const sqEl = e.target.closest('.board-square');
      if (!sqEl || !this.draggedPiece) return;
      const targetSq = sqEl.dataset.square;
      if (this.draggedPiece !== targetSq && this.onMoveAttempt) {
        this.onMoveAttempt(this.draggedPiece, targetSq, 'q');
      }
      this.draggedPiece = null;
    });
  }
}
