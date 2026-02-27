"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { bscTestnet } from "wagmi/chains";
import { getDefaultConfig, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { VerisafeProvider } from "@/contexts/VerisafeContext";

const config = getDefaultConfig({
    appName: "Verisafe",
    projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "2bb9dd3e1b6ccc8dc3ba5e89faa7324d",
    chains: [bscTestnet],
    ssr: false,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <WagmiProvider config={config}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider>
                    <VerisafeProvider>
                        {children}
                    </VerisafeProvider>
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}