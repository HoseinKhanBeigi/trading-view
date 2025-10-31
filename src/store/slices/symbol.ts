export type SymbolSlice = {
  symbol: string;
  setSymbol: (symbol: string) => void;
};

export const createSymbolSlice = (): SymbolSlice => ({
  symbol: "BTCUSDT",
  setSymbol: function (symbol: string) {
    // this will be bound later in store init
    // placeholder; real implementation is provided in store index via set()
    throw new Error("setSymbol not bound");
  },
});


