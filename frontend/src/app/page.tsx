import { Button } from "@/components/ui/button";
import { ArrowRight, Box, LayoutTemplate, Zap } from "lucide-react";
import React from "react";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-indigo-500/30">
      <div className="relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[400px] opacity-20 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 blur-[100px] rounded-full mix-blend-screen" />
        </div>
        
        <header className="absolute top-0 w-full z-10">
          <div className="container mx-auto px-4 h-20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Box className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-xl tracking-tight">Verisafe</span>
            </div>
            <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#docs" className="hover:text-white transition-colors">Documentation</a>
              <a href="#community" className="hover:text-white transition-colors">Community</a>
            </nav>
            <div className="flex items-center gap-4">
              <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-800">
                Log in
              </Button>
              <Button className="bg-white text-slate-950 hover:bg-slate-200">
                Get Started
              </Button>
            </div>
          </div>
        </header>

        <main className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 container mx-auto px-4 z-10 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm mb-8">
            <span className="flex h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-sm font-medium text-slate-300">v1.0 is now live</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-8 max-w-4xl bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-400">
            Next-Gen Boilerplate for Foundry & Next.js
          </h1>
          
          <p className="text-lg md:text-xl text-slate-400 max-w-2xl mb-12 leading-relaxed">
            Kickstart your Web3 application with the ultimate monorepo setup featuring Foundry, Next.js App Router, Tailwind CSS, and shadcn/ui.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Button size="lg" className="h-12 px-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full group">
              Start Building 
              <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-8 rounded-full border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:text-white backdrop-blur-sm">
              View Documentation
            </Button>
          </div>
        </main>
      </div>

      <section className="py-24 border-t border-slate-800/50 bg-slate-900/50 relative">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-2xl bg-slate-800/20 border border-slate-800 hover:border-slate-700 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-6">
                <Zap className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3 text-slate-200">Lightning Fast</h3>
              <p className="text-slate-400 leading-relaxed">Built on Next.js App Router combining the best of server and client components.</p>
            </div>
            <div className="p-8 rounded-2xl bg-slate-800/20 border border-slate-800 hover:border-slate-700 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-6">
                <LayoutTemplate className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3 text-slate-200">Beautiful Defaults</h3>
              <p className="text-slate-400 leading-relaxed">Powered by Tailwind CSS v4 and shadcn/ui for accessible, customizable components.</p>
            </div>
            <div className="p-8 rounded-2xl bg-slate-800/20 border border-slate-800 hover:border-slate-700 transition-colors">
              <div className="w-12 h-12 rounded-xl bg-pink-500/10 flex items-center justify-center mb-6">
                <Box className="w-6 h-6 text-pink-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3 text-slate-200">Seamless Monorepo</h3>
              <p className="text-slate-400 leading-relaxed">Keep your smart contracts and your frontend perfectly aligned in one repository.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
