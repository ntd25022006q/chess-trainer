// Authentic Chess.com Advantage Curve Chart
export class AdvantageChart {
  constructor(canvasId) {
    this.canvasId = canvasId;
    this.canvas = null;
    this.ctx = null;
    this.evalData = [];
    this.onPointClick = null;
  }

  init(onPointClick) {
    this.canvas = document.getElementById(this.canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.onPointClick = onPointClick;

    if (!this.canvas._hasClickListener) {
      this.canvas._hasClickListener = true;
      this.canvas.addEventListener('click', (e) => {
        if (!this.evalData || this.evalData.length === 0) return;
        const rect = this.canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const total = this.evalData.length;
        const stepX = this.canvas.width / Math.max(1, total - 1);
        const idx = Math.min(total - 1, Math.max(0, Math.round(clickX / stepX)));
        if (this.onPointClick) this.onPointClick(idx);
      });
    }
  }

  setData(evalData) {
    this.evalData = evalData || [];
    this.draw(-1);
  }

  draw(currentIndex = -1) {
    if (!this.canvas) {
      this.canvas = document.getElementById(this.canvasId);
      if (this.canvas) this.ctx = this.canvas.getContext('2d');
    }
    if (!this.canvas || !this.ctx || !this.evalData || this.evalData.length === 0) return;

    // Use parent container width safely - avoid GPU buffer reallocation if size unchanged
    const width = this.canvas.parentElement ? (this.canvas.parentElement.clientWidth || 360) : 360;
    const height = this.canvas.height || 76;
    if (this.canvas.width !== width) {
      this.canvas.width = width;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);

    const midY = height / 2;
    const n = this.evalData.length;
    const stepX = width / Math.max(1, n - 1);

    // Baseline (center 0.0)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    const getY = (winChance) => {
      const clamped = Math.max(0, Math.min(100, winChance));
      return height - 8 - ((clamped / 100) * (height - 16));
    };

    // Area Fill below the advantage line to bottom (Authentic Chess.com white silhouette)
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < n; i++) {
      const x = i * stepX;
      const y = getY(this.evalData[i].winChance);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Curve Line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = i * stepX;
      const y = getY(this.evalData[i].winChance);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Classification Colored Dots (Screenshot 1 & 3)
    for (let i = 1; i < n; i++) {
      const x = i * stepX;
      const y = getY(this.evalData[i].winChance);
      const color = this.evalData[i].color || '#81b64c';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Active Cursor
    if (currentIndex >= 0 && currentIndex < n) {
      const curX = currentIndex * stepX;
      const curY = getY(this.evalData[currentIndex].winChance);

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(curX, 0);
      ctx.lineTo(curX, height);
      ctx.stroke();

      ctx.fillStyle = '#81b64c';
      ctx.beginPath();
      ctx.arc(curX, curY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
