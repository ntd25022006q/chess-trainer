// Chess.com Published Data API Client Helper (Frontend)
// Specification: https://www.chess.com/news/view/published-data-api
// Base: https://api.chess.com/pub/ (proxied via /api/chesscom/ to avoid CORS)

export class ChessComApiClient {
  constructor(baseUrl = '/api/chesscom') {
    this.baseUrl = baseUrl;
  }

  async _get(path, isText = false) {
    const res = await fetch(`${this.baseUrl}/${path}`);
    if (!res.ok) {
      const err = new Error(`Chess.com API Error: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return isText ? res.text() : res.json();
  }

  // --- 1. Player Data ---
  async getPlayer(username) {
    return this._get(`player/${encodeURIComponent(username)}`);
  }

  async getPlayerStats(username) {
    return this._get(`player/${encodeURIComponent(username)}/stats`);
  }

  async isPlayerOnline(username) {
    return this._get(`player/${encodeURIComponent(username)}/is-online`);
  }

  async getPlayerCurrentGames(username) {
    return this._get(`player/${encodeURIComponent(username)}/games`);
  }

  async getPlayerGamesToMove(username) {
    return this._get(`player/${encodeURIComponent(username)}/games/to-move`);
  }

  async getPlayerArchives(username) {
    return this._get(`player/${encodeURIComponent(username)}/games/archives`);
  }

  async getMonthlyGames(username, year, month) {
    const m = String(month).padStart(2, '0');
    return this._get(`player/${encodeURIComponent(username)}/games/${year}/${m}`);
  }

  async getMonthlyPgn(username, year, month) {
    const m = String(month).padStart(2, '0');
    return this._get(`player/${encodeURIComponent(username)}/games/${year}/${m}/pgn`, true);
  }

  async getPlayerClubs(username) {
    return this._get(`player/${encodeURIComponent(username)}/clubs`);
  }

  // --- 2. Club Data ---
  async getClub(urlId) {
    return this._get(`club/${encodeURIComponent(urlId)}`);
  }

  async getClubMembers(urlId) {
    return this._get(`club/${encodeURIComponent(urlId)}/members`);
  }

  async getClubMatches(urlId) {
    return this._get(`club/${encodeURIComponent(urlId)}/matches`);
  }

  // --- 3. Tournament Data ---
  async getTournament(urlId) {
    return this._get(`tournament/${encodeURIComponent(urlId)}`);
  }

  async getTournamentRound(urlId, round) {
    return this._get(`tournament/${encodeURIComponent(urlId)}/${round}`);
  }

  async getTournamentGroup(urlId, round, group) {
    return this._get(`tournament/${encodeURIComponent(urlId)}/${round}/${group}`);
  }

  // --- 4. Country Data ---
  async getCountry(iso) {
    return this._get(`country/${encodeURIComponent(iso)}`);
  }

  async getCountryPlayers(iso) {
    return this._get(`country/${encodeURIComponent(iso)}/players`);
  }

  async getCountryClubs(iso) {
    return this._get(`country/${encodeURIComponent(iso)}/clubs`);
  }

  // --- 5. General & Puzzles ---
  async getLeaderboards() {
    return this._get('leaderboards');
  }

  async getTitledPlayers(title) {
    return this._get(`titled/${encodeURIComponent(title)}`);
  }

  async getStreamers() {
    return this._get('streamers');
  }

  async getDailyPuzzle() {
    return this._get('puzzle');
  }

  async getRandomPuzzle() {
    return this._get('puzzle/random');
  }

  // --- 6. Universal Passthrough ---
  async getRawPub(pubPath, isText = false) {
    const clean = pubPath.replace(/^\/+/, '');
    return this._get(`pub/${clean}`, isText);
  }
}

export const chessComApi = new ChessComApiClient();
