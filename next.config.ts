import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    API_KEY: "aff167a9-e341-479b-bcae-aa03f076ad33",
    API_SECRET: "21C832E91B849B3EA0736D4CE8020A81",

  }
  /* config options here */
};

export default nextConfig;
