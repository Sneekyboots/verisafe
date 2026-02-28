"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck, Zap, Wallet, PenTool, Eraser } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import VaultDashboard from "@/components/VaultDashboard";

const FACTORY_ADDRESS = "0x1b7f8Dd766E3DEaCd569843a182b4A012dfa6b08";
const FACTORY_ABI = [
  { inputs: [], name: 'deployVault', outputs: [{ type: 'address' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: 'user', type: 'address' }], name: 'getVault', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }
];

function AnimatingDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 500);
    return () => clearInterval(interval);
  }, []);
  return <span className="inline-block w-8 text-left">{dots}</span>;
}

// VaultDashboard component is now imported from @/components/VaultDashboard

function HomeContent() {
  const dotsRef = useRef<HTMLDivElement>(null);
  const { isConnected, address } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [vaultStatus, setVaultStatus] = useState<"idle" | "deploying" | "success" | "completed" | "error">("idle");
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [isExistingVault, setIsExistingVault] = useState(false);

  const { data: existingVault, isLoading: isVaultLoading, refetch: refetchVault } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: 'getVault',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isConnected && address && vaultStatus === "idle" && !isVaultLoading) {
      setVaultStatus("deploying");

      setTimeout(async () => {
        try {
          // Check if vault already exists (via read contract hook result)
          if (existingVault && existingVault !== "0x0000000000000000000000000000000000000000") {
            setVaultAddress(existingVault as string);
            setIsExistingVault(true);
            setVaultStatus("success");
            setTimeout(() => setVaultStatus("completed"), 2000);
            return;
          }

          // Trigger wallet pop-up for actual on-chain transaction
          const hash = await writeContractAsync({
            address: FACTORY_ADDRESS,
            abi: FACTORY_ABI,
            functionName: 'deployVault',
          });

          console.log("Vault deployed, tx: ", hash);

          // Wait until a vault has been deployed by polling the view function
          let updatedVault = existingVault;
          while (!updatedVault || updatedVault === "0x0000000000000000000000000000000000000000") {
            await new Promise(r => setTimeout(r, 2000));
            const result = await refetchVault();
            updatedVault = result.data;
          }

          setVaultAddress(updatedVault as string);
          setVaultStatus("success");
          setTimeout(() => setVaultStatus("completed"), 2000);

        } catch (err) {
          console.error("Failed to deploy vault via wagmi:", err);
          setVaultStatus("error");
        }
      }, 1500);
    }
  }, [isConnected, address, vaultStatus, existingVault, isVaultLoading, writeContractAsync, refetchVault]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dotsRef.current) return;
      // Calculate parallax movement (inverse to mouse position for a floating effect)
      const x = (e.clientX / window.innerWidth - 0.5) * -40;
      const y = (e.clientY / window.innerHeight - 0.5) * -40;

      dotsRef.current.style.backgroundPosition = `calc(50% + ${x}px) calc(50% + ${y}px)`;
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] text-slate-800 font-sans selection:bg-yellow-200 relative flex flex-col items-center overflow-x-hidden">
      {/* Interactive Whiteboard Dots Background */}
      <div
        ref={dotsRef}
        className="absolute inset-0 z-0 pointer-events-none opacity-60"
        style={{
          backgroundImage: 'radial-gradient(#94a3b8 2px, transparent 2px)',
          backgroundSize: '30px 30px',
          backgroundPosition: '50% 50%',
        }}
      />

      {/* Smudges / Eraser marks on whiteboard */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20">
        <div className="absolute top-[20%] left-[10%] w-64 h-32 bg-slate-300 blur-3xl rounded-full mix-blend-multiply" />
        <div className="absolute top-[60%] right-[15%] w-80 h-40 bg-slate-200 blur-3xl rounded-full mix-blend-multiply" />
      </div>

      <div className="w-full max-w-7xl px-6 relative z-10 flex flex-col min-h-screen">
        {/* Navigation / Header */}
        <header className="w-full flex justify-between items-center py-6">
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 flex items-center justify-center hand-drawn-border border-slate-800 bg-white rotate-[-3deg]">
              <img src="/logo.png" alt="Stakra Logo" className="w-18 h-18 object-contain" />
            </div>
            <span className="font-bold text-6xl tracking-tight text-slate-800 rotate-1">Stakra</span>
          </div>
          <div className="hand-drawn-border-alt rotate-2 bg-white overflow-hidden shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
            <ConnectButton.Custom>
              {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                authenticationStatus,
                mounted,
              }) => {
                const ready = mounted && authenticationStatus !== 'loading';
                const connected =
                  ready &&
                  account &&
                  chain &&
                  (!authenticationStatus ||
                    authenticationStatus === 'authenticated');

                return (
                  <div
                    {...(!ready && {
                      'aria-hidden': true,
                      'style': {
                        opacity: 0,
                        pointerEvents: 'none',
                        userSelect: 'none',
                      },
                    })}
                  >
                    {(() => {
                      if (!connected) {
                        return (
                          <button
                            onClick={openConnectModal}
                            type="button"
                            className="px-6 py-2 font-black text-xl text-slate-800 hover:bg-slate-50 transition-colors uppercase tracking-tight"
                          >
                            Connect Wallet
                          </button>
                        );
                      }

                      if (chain.unsupported) {
                        return (
                          <button onClick={openChainModal} type="button" className="px-6 py-2 font-black text-xl text-red-600">
                            Wrong network
                          </button>
                        );
                      }

                      return (
                        <div style={{ display: 'flex', gap: 12 }}>
                          <button
                            onClick={openChainModal}
                            style={{ display: 'flex', alignItems: 'center' }}
                            type="button"
                            className="px-4 py-2 font-bold text-slate-700 hover:text-slate-900 border-r-2 border-slate-200"
                          >
                            {chain.hasIcon && (
                              <div
                                style={{
                                  background: chain.iconBackground,
                                  width: 12,
                                  height: 12,
                                  borderRadius: 999,
                                  overflow: 'hidden',
                                  marginRight: 4,
                                }}
                              >
                                {chain.iconUrl && (
                                  <img
                                    alt={chain.name ?? 'Chain icon'}
                                    src={chain.iconUrl}
                                    style={{ width: 12, height: 12 }}
                                  />
                                )}
                              </div>
                            )}
                            {chain.name}
                          </button>

                          <button onClick={openAccountModal} type="button" className="px-6 py-2 font-black text-xl text-slate-800">
                            {account.displayName}
                            {account.displayBalance
                              ? ` (${account.displayBalance})`
                              : ''}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                );
              }}
            </ConnectButton.Custom>
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center pt-16 pb-24 h-full relative">

          {mounted && isConnected ? (
            <div className="flex-1 flex items-center justify-center w-full h-full px-4">
              {vaultStatus === "completed" && vaultAddress ? (
                <VaultDashboard vaultAddress={vaultAddress} />
              ) : (
                <div className="flex flex-col items-center justify-center p-12 md:p-16 bg-white hand-drawn-border shadow-[12px_12px_0px_rgba(0,0,0,1)] relative rotate-[-1deg] animate-in zoom-in spin-in-2 duration-500 max-w-2xl w-full text-center">

                  {vaultStatus === "deploying" && (
                    <>
                      <ShieldCheck className="w-24 h-24 text-slate-800 mb-8 animate-pulse" strokeWidth={1.5} />
                      <h2 className="text-4xl md:text-5xl font-black text-slate-800 tracking-tight flex items-center justify-center min-w-[300px]">
                        {existingVault && existingVault !== "0x0000000000000000000000000000000000000000" && !isVaultLoading ? "Loading Vault Data" : "Artifacting your vault"}
                        <AnimatingDots />
                      </h2>
                      <p className="mt-6 text-slate-500 font-bold text-xl md:text-2xl">
                        {existingVault && existingVault !== "0x0000000000000000000000000000000000000000" && !isVaultLoading ? "Retrieving collateral architecture..." : "Securing your collateral architecture..."}
                      </p>
                    </>
                  )}

                  {vaultStatus === "success" && (
                    <>
                      <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-8 border-4 border-slate-800 hand-drawn-border">
                        <ShieldCheck className="w-12 h-12 text-green-600" strokeWidth={2.5} />
                      </div>
                      <h2 className="text-4xl md:text-5xl font-black text-slate-800 tracking-tight">
                        {isExistingVault ? "Vault Loaded!!" : "Artifacting Successful!!"}
                      </h2>
                    </>
                  )}

                  {vaultStatus === "error" && (
                    <>
                      <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-8 border-4 border-slate-800 hand-drawn-border">
                        <Eraser className="w-12 h-12 text-red-600" strokeWidth={2.5} />
                      </div>
                      <h2 className="text-4xl md:text-5xl font-black text-slate-800 tracking-tight">
                        Deployment Failed
                      </h2>
                      <p className="mt-4 text-slate-600 font-bold text-xl">
                        Failed to artifact your vault. Please try again.
                      </p>
                      <Button
                        onClick={() => setVaultStatus("idle")}
                        className="mt-10 h-16 px-10 text-2xl bg-slate-800 hover:bg-slate-700 text-white hand-drawn-border shadow-[6px_6px_0px_rgba(30,41,59,0.3)] hover:shadow-[2px_2px_0px_rgba(30,41,59,0.3)] hover:translate-x-1 hover:translate-y-1 transition-all font-bold"
                      >
                        Retry
                      </Button>
                    </>
                  )}

                </div>
              )}
            </div>
          ) : (
            <>
              {/* Handdrawn decorative arrow - moved higher and to the top of the stack */}
              <div className="absolute top-8 left-[10%] hidden md:block opacity-90 transform -rotate-12 z-20">
                <svg width="80" height="80" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 90 Q 50 10 90 20" />
                  <path d="M70 10 L 90 20 L 80 40" />
                </svg>
                <span className="text-xl font-bold ml-4 -mt-2 block text-rose-500 scribble-underline">New Protocol!</span>
              </div>

              <div className="max-w-4xl mx-auto w-full flex flex-col items-center text-center">

                <div className="inline-flex items-center gap-2 px-6 py-2 bg-yellow-100 border-2 border-slate-800 text-slate-800 font-bold mb-8 hand-drawn-border rotate-[-2deg] shadow-[4px_4px_0px_rgba(0,0,0,0.8)] text-xl">
                  <PenTool className="w-6 h-6" />
                  Drafting the future of DeFi...
                </div>

                <h1 className="text-6xl md:text-8xl font-black mb-10 text-slate-800 leading-[1.1] relative">
                  Smart Collateral <br className="hidden md:block" />
                  <span className="brush-highlight mt-4 inline-block transform rotate-1 text-slate-900 mx-2">
                    on BNB Chain
                  </span>
                </h1>

                <p className="text-2xl md:text-4xl text-slate-700 max-w-3xl mt-6 mb-12 font-medium leading-relaxed rotate-1">
                  Non-custodial credit powered by <span className="font-bold underline decoration-sky-400">Veris ZK-Oracles</span> and ultra-fast <span className="font-bold underline decoration-amber-400">opBNB</span> execution.
                </p>

                <div className="flex flex-col sm:flex-row gap-6 w-full sm:w-auto">
                  <Button className="h-16 px-10 text-2xl bg-slate-800 hover:bg-slate-700 text-white hand-drawn-border-alt shadow-[6px_6px_0px_rgba(30,41,59,0.3)] hover:shadow-[2px_2px_0px_rgba(30,41,59,0.3)] hover:translate-x-1 hover:translate-y-1 transition-all font-bold rotate-[-1deg]">
                    Get Started
                    <ArrowRight className="ml-2 w-7 h-7" />
                  </Button>
                  <Button variant="outline" className="h-16 px-10 text-2xl bg-white border-2 border-slate-800 text-slate-800 hover:bg-slate-50 hand-drawn-border shadow-[6px_6px_0px_rgba(0,0,0,1)] hover:shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-x-1 hover:translate-y-1 transition-all font-bold rotate-[1deg]">
                    Read Docs
                  </Button>
                </div>
              </div>

              {/* Sticky notes / Feature grid */}
              <div className="w-full max-w-5xl mt-32 grid md:grid-cols-3 gap-8 relative">

                {/* Eraser */}
                {/* <div className="absolute -top-16 right-0 opacity-40 rotate-45 pointer-events-none hidden lg:flex items-center gap-2">
                  <Eraser className="w-16 h-16" />
                  <span className="text-2xl font-bold">Mistakes happen</span>
                </div> */}

                <div className="bg-rose-100 p-8 hand-drawn-border rotate-[-2deg] shadow-[5px_5px_0px_rgba(0,0,0,0.2)] hover:rotate-0 transition-transform flex flex-col h-full relative">
                  <div className="w-6 h-6 bg-red-400 rounded-full absolute -top-3 left-1/2 transform -translate-x-1/2 shadow-sm border border-red-500" />
                  <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center border-2 border-slate-800 mb-4 shadow-sm">
                    <ShieldCheck className="w-8 h-8 text-slate-800" strokeWidth={2} />
                  </div>
                  <h3 className="text-3xl font-bold mb-3 text-slate-800 underline decoration-wavy decoration-rose-400 decoration-2">Isolated Vaults</h3>
                  <p className="text-slate-700 text-xl leading-relaxed flex-1 font-medium">Your collateral stays in your personal smart vault. Isolated, non-custodial, and fully transparent on-chain security.</p>
                </div>

                <div className="bg-sky-100 p-8 hand-drawn-border-alt rotate-[3deg] shadow-[5px_5px_0px_rgba(0,0,0,0.2)] hover:rotate-0 transition-transform flex flex-col h-full relative mt-4 md:mt-0">
                  <div className="w-10 h-4 bg-blue-300/80 absolute -top-2 left-1/2 transform -translate-x-1/2 shadow-sm rotate-[-5deg]" />
                  <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center border-2 border-slate-800 mb-4 shadow-sm">
                    <Zap className="w-8 h-8 text-slate-800" strokeWidth={2} />
                  </div>
                  <h3 className="text-3xl font-bold mb-3 text-slate-800 underline decoration-dashed decoration-sky-400 decoration-2">ZK-Oracle Proofs</h3>
                  <p className="text-slate-700 text-xl leading-relaxed flex-1 font-medium">Fueled by Veris—our proprietary ZK-Oracle—delivering verifiable real-time price feeds with absolute zero latency.</p>
                </div>

                <div className="bg-amber-100 p-8 hand-drawn-border rotate-[-1deg] shadow-[5px_5px_0px_rgba(0,0,0,0.2)] hover:rotate-0 transition-transform flex flex-col h-full relative mt-4 md:mt-0">
                  <div className="w-6 h-6 bg-yellow-400 rounded-full absolute top-2 right-2 shadow-sm border border-yellow-500" />
                  <div className="w-20 h-20 mb-4 overflow-visible hand-drawn-border-alt flex items-center justify-center bg-white">
                    <img src="/logo.png" alt="Stakra Mini Logo" className="w-17 h-17 object-contain" />
                  </div>
                  <h3 className="text-3xl font-bold mb-3 text-slate-800 scribble-underline">opBNB Scaling</h3>
                  <p className="text-slate-700 text-xl leading-relaxed flex-1 font-medium">Ultra-low gas fees ($0.001) on opBNB enable high-frequency credit operations and seamless merchant integrations.</p>
                </div>
              </div>

              {/* How it Works Section */}
              <div className="w-full max-w-6xl mt-48 mb-24 lg:px-12">
                <div className="flex flex-col items-center mb-16">
                  <h2 className="text-5xl md:text-6xl font-black text-slate-800 tracking-tight text-center relative px-8 py-4 bg-white hand-drawn-border shadow-[8px_8px_0px_rgba(0,0,0,1)] rotate-[-1deg] inline-block">
                    How it Works
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-12 relative h-full">
                  {/* Arrows for Desktop - updated to a very dark slate for absolute maximum visibility */}
                  <div className="hidden md:block absolute top-1/2 left-[20%] w-[10%] border-t-4 border-slate-800 border-dashed transform -translate-y-1/2 rotate-[5deg]" />
                  <div className="hidden md:block absolute top-1/2 left-[45%] w-[10%] border-t-4 border-slate-800 border-dashed transform -translate-y-1/2 rotate-[-5deg]" />
                  <div className="hidden md:block absolute top-1/2 left-[70%] w-[10%] border-t-4 border-slate-800 border-dashed transform -translate-y-1/2 rotate-[5deg]" />

                  <div className="flex flex-col items-center text-center group cursor-default">
                    <div className="w-24 h-24 rounded-full border-4 border-slate-800 bg-white hand-drawn-border flex items-center justify-center font-black text-5xl text-slate-800 group-hover:rotate-12 transition-transform duration-300 mb-6 shadow-[6px_6px_0px_rgba(0,0,0,1)]">1</div>
                    <h4 className="text-2xl font-black text-slate-800 mb-3 underline decoration-rose-300">Deploy Vault</h4>
                    <p className="text-slate-600 font-bold text-lg leading-snug px-2">Initialize your per-user isolated smart contract on BNB Chain.</p>
                  </div>

                  <div className="flex flex-col items-center text-center group cursor-default mt-8 md:mt-0">
                    <div className="w-24 h-24 rounded-full border-4 border-slate-800 bg-yellow-100 hand-drawn-border-alt flex items-center justify-center font-black text-5xl text-slate-800 group-hover:-rotate-12 transition-transform duration-300 mb-6 shadow-[6px_6px_0px_rgba(0,0,0,1)]">2</div>
                    <h4 className="text-2xl font-black text-slate-800 mb-3 underline decoration-amber-300">Stake BNB</h4>
                    <p className="text-slate-600 font-bold text-lg leading-snug px-2">Deposit collateral into your vault. Assets are always non-custodial.</p>
                  </div>

                  <div className="flex flex-col items-center text-center group cursor-default mt-8 md:mt-0">
                    <div className="w-24 h-24 rounded-full border-4 border-slate-800 bg-sky-100 hand-drawn-border flex items-center justify-center font-black text-5xl text-slate-800 group-hover:rotate-12 transition-transform duration-300 mb-6 shadow-[6px_6px_0px_rgba(0,0,0,1)]">3</div>
                    <h4 className="text-2xl font-black text-slate-800 mb-3 underline decoration-sky-300">Unlock Credit</h4>
                    <p className="text-slate-600 font-bold text-lg leading-snug px-2">Borrow up to 70% LTV in USDT or vBNB with ZK-verified price data.</p>
                  </div>

                  <div className="flex flex-col items-center text-center group cursor-default mt-8 md:mt-0">
                    <div className="w-24 h-24 rounded-full border-4 border-slate-800 bg-rose-100 hand-drawn-border-alt flex items-center justify-center font-black text-5xl text-slate-800 group-hover:-rotate-12 transition-transform duration-300 mb-6 shadow-[6px_6px_0px_rgba(0,0,0,1)]">4</div>
                    <h4 className="text-2xl font-black text-slate-800 mb-3 underline decoration-rose-300">BNPL Ready</h4>
                    <p className="text-slate-600 font-bold text-lg leading-snug px-2">Use your CreditNFT on opBNB for ultra-fast merchant payments.</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>

        <footer className="w-full border-t-4 border-slate-800 border-dashed py-8 mt-12 pb-12">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-18 h-18 flex items-center justify-center hand-drawn-border border-slate-800 bg-white rotate-[-3deg]">
                <img src="/logo.png" alt="Stakra Logo" className="w-16 h-16 object-contain" />
              </div>
              <span className="font-extrabold text-4xl tracking-tight text-slate-800">Stakra</span>
            </div>
            {/* <nav className="flex gap-8 text-xl font-bold text-slate-600">
              <a href="#" className="hover:text-slate-900 transition-colors">Platform</a>
              <a href="#" className="hover:text-slate-900 transition-colors">Contracts</a>
              <a href="#" className="hover:text-slate-900 transition-colors">Security</a>
            </nav> */}
            <div className="text-xl text-slate-500 font-bold">
              © {new Date().getFullYear()} Stakra.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function Home() {
  return <HomeContent />;
}
