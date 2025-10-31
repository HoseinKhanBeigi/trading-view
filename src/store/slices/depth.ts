import type { DepthUpdate } from "@/store/types";

export type DepthSlice = {
  depth: DepthUpdate | null;
  depthSocket?: WebSocket | null;
  setDepth: (upd: DepthUpdate | null) => void;
  setDepthSocket: (ws: WebSocket | null) => void;
  clearDepth: () => void;
};

export const createDepthSlice = (): DepthSlice => ({
  depth: null,
  depthSocket: null,
  setDepth: function () { throw new Error("setDepth not bound"); },
  setDepthSocket: function () { throw new Error("setDepthSocket not bound"); },
  clearDepth: function () { throw new Error("clearDepth not bound"); },
});


