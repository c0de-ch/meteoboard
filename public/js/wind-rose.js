/* Wind Rose / Compass — SVG direction indicator */

const WindRose = {
  _currentDeg: 0,

  setDirection(degrees) {
    const arrow = document.getElementById('wind-arrow');
    if (!arrow) return;

    // Calculate shortest rotation path
    let diff = degrees - this._currentDeg;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    this._currentDeg += diff;

    arrow.setAttribute('transform', `rotate(${this._currentDeg}, 100, 100)`);

    // Update direction text with cardinal name
    const dirEl = document.getElementById('wind-dir-display');
    if (dirEl) {
      dirEl.textContent = `${Math.round(degrees)} ${this._degreesToCardinal(degrees)}`;
    }
  },

  _degreesToCardinal(deg) {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                         'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
    return directions[idx];
  }
};
