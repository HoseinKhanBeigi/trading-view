declare module 'sonner' {
  export const Toaster: any;
  export const toast: {
    success: (msg: string, opts?: any) => void;
    error: (msg: string, opts?: any) => void;
    info: (msg: string, opts?: any) => void;
  };
}


