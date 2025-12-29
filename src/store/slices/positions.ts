export type PositionSide = 'long' | 'short';

export type OrderType = 'market' | 'limit' | 'trigger';

export type Position = {
  id: string;
  symbol: string;
  side: PositionSide;
  size: number; // contract size
  entryPrice: number;
  orderPrice?: number; // limit/trigger price
  triggerPrice?: number;
  leverage: number;
  margin: number; // initial margin
  orderType: OrderType;
  time: number;
  status: 'open' | 'filled' | 'pending' | 'cancelled';
  filled?: number; // filled amount
  fee?: number;
  takeProfit?: number;
  stopLoss?: number;
  reduceOnly?: boolean;
};

export type PositionsSlice = {
  positions: Position[];
  addPosition: (pos: Position) => void;
  closePosition: (id: string) => void;
  clearPositions: () => void;
};

export const createPositionsSlice = (): PositionsSlice => ({
  positions: [],
  addPosition: () => {},
  closePosition: () => {},
  clearPositions: () => {},
});

