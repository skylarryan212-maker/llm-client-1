export type MarketSuggestionCadence = {
  intervalSeconds: number;
  reason: string;
};

export type MarketSuggestionWatchlist = {
  tickers: string[];
  reason: string;
};

export type MarketSuggestionEvent = {
  kind: "market_suggestion";
  eventId: string;
  cadence?: MarketSuggestionCadence;
  watchlist?: MarketSuggestionWatchlist;
};
