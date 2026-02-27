"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, Layers, ShieldCheck, Zap, Wallet, PenTool, Eraser } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';

function HomeContent() {
  const dotsRef = useRef<HTMLDivElement>(null);
  const { isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
            <div className="w-12 h-12 flex items-center justify-center hand-drawn-border border-slate-800 bg-white rotate-[-3deg]">
              <Layers className="w-6 h-6 text-slate-800" />
            </div>
            <span className="font-bold text-4xl tracking-tight text-slate-800 rotate-1">Verisafe</span>
          </div>
          <div className="hand-drawn-border-alt rotate-2 bg-white overflow-hidden">
            <ConnectButton />
          </div>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center pt-16 pb-24 h-full relative">

          {mounted && isConnected ? (
            <div className="flex-1 flex items-center justify-center w-full h-full">
              <div className="text-6xl md:text-8xl font-black text-slate-800 rotate-[-2deg] hand-drawn-border p-16 bg-white shadow-[12px_12px_0px_rgba(0,0,0,1)] relative animate-in zoom-in spin-in-2 duration-500">
                Hello World!
                <div className="absolute -top-6 -right-6 text-rose-500 opacity-60 transform rotate-12">
                  <Eraser className="w-12 h-12" />
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Handdrawn decorative arrow */}
              <div className="absolute top-24 left-[15%] hidden md:block opacity-70 transform -rotate-12">
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
                  Secure the <br className="hidden md:block" />
                  <span className="brush-highlight mt-4 inline-block transform rotate-1 text-slate-900 mx-2">
                    Digital Frontier
                  </span>
                </h1>

                <p className="text-2xl md:text-4xl text-slate-700 max-w-3xl mt-6 mb-12 font-medium leading-relaxed rotate-1">
                  The next generation of on-chain operations. A simple, seamless architecture built on Next.js and Foundry.
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
                <div className="absolute -top-16 right-0 opacity-40 rotate-45 pointer-events-none hidden lg:flex items-center gap-2">
                  <Eraser className="w-16 h-16" />
                  <span className="text-2xl font-bold">Mistakes happen</span>
                </div>

                <div className="bg-rose-100 p-8 hand-drawn-border rotate-[-2deg] shadow-[5px_5px_0px_rgba(0,0,0,0.2)] hover:rotate-0 transition-transform flex flex-col h-full relative">
                  <div className="w-6 h-6 bg-red-400 rounded-full absolute -top-3 left-1/2 transform -translate-x-1/2 shadow-sm border border-red-500" />
                  <ShieldCheck className="w-12 h-12 text-slate-800 mb-4" strokeWidth={2} />
                  <h3 className="text-3xl font-bold mb-3 text-slate-800 underline decoration-wavy decoration-rose-400 decoration-2">Peace of Mind</h3>
                  <p className="text-slate-700 text-xl leading-relaxed flex-1 font-medium">Bulletproof smart contracts rigorously tested and verified through advanced simulation environments.</p>
                </div>

                <div className="bg-sky-100 p-8 hand-drawn-border-alt rotate-[3deg] shadow-[5px_5px_0px_rgba(0,0,0,0.2)] hover:rotate-0 transition-transform flex flex-col h-full relative mt-4 md:mt-0">
                  <div className="w-10 h-4 bg-blue-300/80 absolute -top-2 left-1/2 transform -translate-x-1/2 shadow-sm rotate-[-5deg]" />
                  <Zap className="w-12 h-12 text-slate-800 mb-4" strokeWidth={2} />
                  <h3 className="text-3xl font-bold mb-3 text-slate-800 underline decoration-dashed decoration-sky-400 decoration-2">Swift & Light</h3>
                  <p className="text-slate-700 text-xl leading-relaxed flex-1 font-medium">Optimized zero-latency interactions powered by elegantly designed Next.js Edge capabilities.</p>
                </div>

                <div className="bg-amber-100 p-8 hand-drawn-border rotate-[-1deg] shadow-[5px_5px_0px_rgba(0,0,0,0.2)] hover:rotate-0 transition-transform flex flex-col h-full relative mt-4 md:mt-0">
                  <div className="w-6 h-6 bg-yellow-400 rounded-full absolute top-2 right-2 shadow-sm border border-yellow-500" />
                  <Layers className="w-12 h-12 text-slate-800 mb-4" strokeWidth={2} />
                  <h3 className="text-3xl font-bold mb-3 text-slate-800 scribble-underline">Perfect Harmony</h3>
                  <p className="text-slate-700 text-xl leading-relaxed flex-1 font-medium">A unified monorepo architecture ensuring your smart contracts and frontend stay completely synchronized.</p>
                </div>
              </div>
            </>
          )}
        </main>

        <footer className="w-full border-t-2 border-slate-300 border-dashed py-8 mt-12 pb-12">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
            <span className="font-extrabold text-3xl tracking-tight text-slate-800">Verisafe</span>
            <nav className="flex gap-8 text-xl font-bold text-slate-600">
              <a href="#" className="hover:text-slate-900 transition-colors">Platform</a>
              <a href="#" className="hover:text-slate-900 transition-colors">Contracts</a>
              <a href="#" className="hover:text-slate-900 transition-colors">Security</a>
            </nav>
            <div className="text-xl text-slate-500 font-bold">
              © {new Date().getFullYear()} Verisafe.
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
