"use client";
import VerisafeClient from "@/types/stakra";
import React, { createContext, useContext, useMemo } from "react";

interface StakraContextType {
  client: VerisafeClient;
  backendUrl: string;
}

const StakraContext = createContext<StakraContextType | undefined>(
  undefined
);

export function StakraProvider({ children }: { children: React.ReactNode }) {
  const backendUrl =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  const client = useMemo(() => new VerisafeClient(backendUrl), [backendUrl]);

  return (
    <StakraContext.Provider value={{ client, backendUrl }}>
      {children}
    </StakraContext.Provider>
  );
}

export function useStakra() {
  const context = useContext(StakraContext);
  if (!context) {
    throw new Error("useStakra must be used within StakraProvider");
  }
  return context;
}
