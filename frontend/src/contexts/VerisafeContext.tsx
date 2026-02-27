"use client";

import React, { createContext, useContext, useMemo } from "react";
import VerisafeClient from "@/types/verisafe";

interface VerisafeContextType {
  client: VerisafeClient;
  backendUrl: string;
}

const VerisafeContext = createContext<VerisafeContextType | undefined>(
  undefined
);

export function VerisafeProvider({ children }: { children: React.ReactNode }) {
  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

  const client = useMemo(() => new VerisafeClient(backendUrl), [backendUrl]);

  return (
    <VerisafeContext.Provider value={{ client, backendUrl }}>
      {children}
    </VerisafeContext.Provider>
  );
}

export function useVerisafe() {
  const context = useContext(VerisafeContext);
  if (!context) {
    throw new Error("useVerisafe must be used within VerisafeProvider");
  }
  return context;
}
