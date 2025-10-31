export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'filled' | 'rejected' | 'cancelled';

export type Order = {
  id: string;
  time: number; // ms epoch
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number; // estimated fill price
  status: OrderStatus;
};

export type OrdersSlice = {
  orders: Order[];
  addOrder: (order: Order) => void;
  clearOrders: () => void;
  cancelOrder: (id: string) => void;
};

export const createOrdersSlice = (): OrdersSlice => ({
  orders: [],
  addOrder: (order) => {},
  clearOrders: () => {},
  cancelOrder: (_id: string) => {},
});


