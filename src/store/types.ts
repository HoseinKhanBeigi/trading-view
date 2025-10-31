export type Trade = {
  id: number;
  price: number;
  qty: number;
  isBuyerMaker: boolean;
  time: number; // ms
};

export type DepthUpdate = {
  lastUpdateId?: number;
  bids: [string, string][]; // [price, qty]
  asks: [string, string][];
};


