import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Layers, Database, Activity, CreditCard, Zap, PenTool, Loader2, ArrowRightLeft, Wallet as WalletIcon } from "lucide-react";
import { useWriteContract, useAccount, usePublicClient } from 'wagmi';
import { parseEther } from 'viem';

const VAULT_ABI = [
    { inputs: [], name: 'deposit', outputs: [], stateMutability: 'payable', type: 'function' },
    { inputs: [{ name: 'requestedUSD', type: 'uint256' }], name: 'requestCredit', outputs: [], stateMutability: 'nonpayable', type: 'function' }
] as const;

const MOCK_ERC20_ABI = [
    { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'mint', outputs: [], stateMutability: 'nonpayable', type: 'function' }
] as const;

// ✅ Added ABI to read symbol() from token contracts
const ERC20_SYMBOL_ABI = [
    {
        inputs: [],
        name: 'symbol',
        outputs: [{ name: '', type: 'string' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const;

const MOCK_USDT = "0x882e7bd7e2028BE801B4d31222fAC8f4214D0c3d";
const MOCK_VBNB = "0x47a826cd76899ffA955Ef667ACee4bF2C64C6da8";

export default function VaultDashboard({ vaultAddress }: { vaultAddress: string }) {
    const [vaultData, setVaultData] = useState<any>(null);
    const [stakeAmount, setStakeAmount] = useState<string>("");
    const [isStaking, setIsStaking] = useState(false);

    // Borrow State
    const [borrowAmount, setBorrowAmount] = useState<string>("");
    const [isBorrowing, setIsBorrowing] = useState(false);

    const [statusMsg, setStatusMsg] = useState<string>("");

    // View Toggle State
    const [displayCurrency, setDisplayCurrency] = useState<"USD" | "BNB">("USD");

    const { address } = useAccount();
    const { writeContractAsync } = useWriteContract();
    const publicClient = usePublicClient();

    const fetchVault = async () => {
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
            const res = await fetch(`${apiUrl}/vault/${vaultAddress}?t=${Date.now()}`, {
                cache: 'no-store'
            });
            const data = await res.json();
            setVaultData(data);
        } catch (err) {
            console.error("Failed to fetch vault data:", err);
        }
    };

    useEffect(() => {
        fetchVault();
    }, [vaultAddress]);

    const handleStake = async () => {
        if (!stakeAmount || isNaN(Number(stakeAmount)) || Number(stakeAmount) <= 0) {
            setStatusMsg("Please enter a valid amount");
            return;
        }

        try {
            setIsStaking(true);
            setStatusMsg("Confirming transaction in wallet...");

            const hash = await writeContractAsync({
                address: vaultAddress as `0x${string}`,
                abi: VAULT_ABI,
                functionName: 'deposit',
                value: parseEther(stakeAmount),
            });

            setStatusMsg("Transaction sent, awaiting confirmation...");

            setTimeout(() => {
                setStatusMsg("Staked Successfully!");
                setStakeAmount("");
                setIsStaking(false);
                fetchVault();
                setTimeout(() => setStatusMsg(""), 3000);
            }, 5000);

        } catch (err: any) {
            console.error(err);
            setStatusMsg("Staking failed: " + (err.shortMessage || err.message || "Unknown error"));
            setIsStaking(false);
        }
    };

    // Derived conversion logic
    const bnbPrice = (vaultData?.balanceBNB && vaultData?.ltv?.collateralUSD)
        ? Number(vaultData.ltv.collateralUSD) / Number(vaultData.balanceBNB)
        : 600;

    const getConvertedValue = (usdVal: number) => {
        return displayCurrency === "USD" ? `$${usdVal.toFixed(2)}` : `${(usdVal / bnbPrice).toFixed(4)} BNB`;
    };

    const maxBorrowUSD = vaultData && vaultData.ltv?.collateralUSD
        ? Number(vaultData.ltv.collateralUSD) * 0.70
        : 0;

    const handleBorrow = async (currency: "USDT" | "vBNB") => {
        if (!borrowAmount || isNaN(Number(borrowAmount)) || Number(borrowAmount) <= 0) {
            setStatusMsg(`Please enter a valid ${displayCurrency} amount to borrow.`);
            return;
        }

        const usdToBorrow = displayCurrency === "BNB" ? Number(borrowAmount) * bnbPrice : Number(borrowAmount);

        if (usdToBorrow > maxBorrowUSD) {
            setStatusMsg(`Cannot exceed 70% LTV constraint. Max allowed is ${getConvertedValue(maxBorrowUSD)}.`);
            return;
        }

        try {
            setIsBorrowing(true);
            const borrowDisplayAmount = displayCurrency === "USD" ? `$${borrowAmount}` : `${borrowAmount} BNB`;
            setStatusMsg(`Requesting ${borrowDisplayAmount} in ${currency} (Approve Tx 1 of 2)...`);

            const requestedCents = BigInt(Math.floor(usdToBorrow * 100));
            const hash1 = await writeContractAsync({
                address: vaultAddress as `0x${string}`,
                abi: VAULT_ABI,
                functionName: 'requestCredit',
                args: [requestedCents],
            });

            setStatusMsg("Waiting for blockchain confirmation...");
            if (publicClient) await publicClient.waitForTransactionReceipt({ hash: hash1 });

            setStatusMsg("Debt logged securely! Minting your borrowed tokens (Approve Tx 2 of 2)...");

            const tokenAddress = currency === "USDT" ? MOCK_USDT : MOCK_VBNB;

            let tokensToMint = usdToBorrow;
            if (currency === "vBNB") {
                tokensToMint = tokensToMint / bnbPrice;
            }

            const hash2 = await writeContractAsync({
                address: tokenAddress as `0x${string}`,
                abi: MOCK_ERC20_ABI,
                functionName: 'mint',
                args: [address as `0x${string}`, parseEther(tokensToMint.toString())],
            });

            setStatusMsg(`Waiting for minting to finalize...`);
            if (publicClient) await publicClient.waitForTransactionReceipt({ hash: hash2 });

            setStatusMsg(`Successfully borrowed ${tokensToMint.toFixed(4)} ${currency}! Check your wallet.`);
            setBorrowAmount("");

            setTimeout(() => fetchVault(), 2000);
            setTimeout(() => setStatusMsg(""), 6000);

        } catch (err: any) {
            console.error(err);
            setStatusMsg("Borrowing failed or rejected by user.");
        } finally {
            setIsBorrowing(false);
        }
    };

    // ✅ Fixed: reads the actual symbol from the contract before calling wallet_watchAsset
    const addTokenToWallet = async (currency: "USDT" | "vBNB") => {
        try {
            const tokenAddress = currency === "USDT" ? MOCK_USDT : MOCK_VBNB;

            if (typeof window === 'undefined' || !(window as any).ethereum) {
                setStatusMsg("Wallet provider not connected or missing. Please add manually.");
                setTimeout(() => setStatusMsg(""), 4000);
                return;
            }

            // ✅ Read the on-chain symbol so it matches what MetaMask validates against
            let symbol = currency === "USDT" ? "vUSDC" : "vBNB"; // fallback defaults
            console.log(`Adding token: ${currency} at address ${tokenAddress}`);
            if (publicClient) {
                try {
                    const chainSymbol = await publicClient.readContract({
                        address: tokenAddress as `0x${string}`,
                        abi: ERC20_SYMBOL_ABI,
                        functionName: 'symbol',
                    }) as string;
                    console.log(`Contract reported symbol: ${chainSymbol}`);
                    symbol = chainSymbol;
                } catch (readErr) {
                    console.warn("Could not read symbol from contract, using fallback:", readErr);
                }
            }
            console.log(`Final symbol being sent to MetaMask: ${symbol}`);

            const success = await (window as any).ethereum.request({
                method: 'wallet_watchAsset',
                params: {
                    type: 'ERC20',
                    options: {
                        address: tokenAddress,
                        symbol: symbol,   // ✅ now always matches the contract
                        decimals: 18,
                    },
                },
            });

            if (success) {
                setStatusMsg(`Successfully added ${symbol} to MetaMask!`);
            }
            setTimeout(() => setStatusMsg(""), 4000);
        } catch (error: any) {
            console.error(error);
            setStatusMsg(`Error adding token: ${error.message}`);
            setTimeout(() => setStatusMsg(""), 4000);
        }
    };

    if (!vaultData) return <div className="p-8 font-bold text-center w-full">Loading Vault Data...</div>;

    return (
        <div className="w-full flex justify-center text-left">
            <div className="w-full max-w-4xl flex flex-col items-center bg-white hand-drawn-border shadow-[12px_12px_0px_rgba(0,0,0,1)] p-8 md:p-12 relative rotate-[-1deg] animate-in zoom-in spin-in-2 duration-500">

                <div className="w-full border-b-[3px] border-slate-800 border-dashed pb-6 mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-sky-200 border-2 border-slate-800 rounded-full flex items-center justify-center hand-drawn-border shadow-[3px_3px_0px_rgba(0,0,0,0.8)]">
                            <Database className="w-6 h-6 text-slate-800" />
                        </div>
                        <div>
                            <h2 className="text-3xl font-black text-slate-800 tracking-tight">Your Vault</h2>
                            <p className="text-slate-500 font-bold text-sm bg-slate-100 px-3 py-1 hand-drawn-border-alt mt-1 inline-block break-all">
                                {vaultAddress}
                            </p>
                        </div>
                    </div>
                    <div className="px-5 py-2 bg-green-200 border-2 border-slate-800 font-black text-slate-800 hand-drawn-border rotate-2 text-lg shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                        {vaultData.status || "ACTIVE"}
                    </div>
                </div>

                <div className="flex gap-4 w-full mb-6">
                    <Button
                        variant="ghost"
                        onClick={() => setDisplayCurrency(displayCurrency === "USD" ? "BNB" : "USD")}
                        className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold border-2 border-slate-800 hand-drawn-border-alt shadow-[4px_4px_0px_rgba(0,0,0,1)]">
                        <ArrowRightLeft className="w-5 h-5 mr-2" />
                        Viewing in {displayCurrency}
                    </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
                    {/* Staked Balance */}
                    <div className="bg-amber-100 p-6 border-2 border-slate-800 hand-drawn-border shadow-[5px_5px_0px_rgba(0,0,0,0.8)] flex flex-col relative rotate-[-1deg] hover:rotate-[-2deg] transition-all">
                        <span className="text-slate-600 font-bold text-lg mb-2 flex items-center gap-2">
                            <Layers className="w-5 h-5 text-slate-800" /> Staked Collateral
                        </span>
                        <span className="text-4xl font-black text-slate-800 underline decoration-wavy decoration-amber-400 decoration-2">
                            {displayCurrency === "BNB" ? vaultData.balanceBNB + " " : getConvertedValue(Number(vaultData.ltv?.collateralUSD || 0))}
                            {displayCurrency === "BNB" && <span className="text-xl">BNB</span>}
                        </span>
                    </div>

                    {/* LTV & Health */}
                    <div className="bg-sky-100 p-6 border-2 border-slate-800 hand-drawn-border-alt shadow-[5px_5px_0px_rgba(0,0,0,0.8)] flex flex-col relative rotate-[1deg] hover:rotate-[2deg] transition-all">
                        <span className="text-slate-600 font-bold text-lg mb-2 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-slate-800" /> Max Available Line (70%)
                        </span>
                        <span className="text-4xl font-black text-slate-800 scribble-underline">
                            {getConvertedValue(maxBorrowUSD)}
                        </span>
                    </div>

                    {/* Debt Level */}
                    <div className="bg-rose-100 p-6 border-2 border-slate-800 hand-drawn-border shadow-[5px_5px_0px_rgba(0,0,0,0.8)] flex flex-col relative rotate-[-2deg] hover:rotate-[-3deg] transition-all">
                        <span className="text-slate-600 font-bold text-lg mb-2 flex items-center gap-2">
                            <CreditCard className="w-5 h-5 text-slate-800" /> Borrowed Debt
                        </span>
                        <span className="text-3xl font-black text-slate-800">
                            {getConvertedValue(vaultData.ltv?.debtUSD || 0)}
                        </span>
                    </div>
                </div>

                <div className="w-full mt-12 bg-slate-50 border-2 border-slate-800 p-8 hand-drawn-border shadow-[8px_8px_0px_rgba(0,0,0,1)] rotate-1">
                    <h3 className="text-2xl font-black mb-6 text-slate-800 flex items-center gap-2">
                        <Zap className="w-6 h-6 text-yellow-500" /> Actions
                    </h3>

                    {statusMsg && (
                        <div className="w-full bg-slate-800 text-white p-4 font-bold rounded mb-6 animate-in slide-in-from-top-2">
                            {statusMsg}
                        </div>
                    )}

                    <div className="flex flex-col md:flex-row gap-8 items-start">

                        {/* Stake BNB Input */}
                        <div className="flex flex-col gap-3 w-full md:w-1/2">
                            <label className="font-bold text-slate-700">Stake Collateral (BNB)</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="e.g. 0.1"
                                    value={stakeAmount}
                                    onChange={(e) => setStakeAmount(e.target.value)}
                                    className="flex-1 w-full border-2 border-slate-800 bg-white px-4 py-2 font-bold text-lg hand-drawn-border-alt focus:outline-none focus:ring-4 focus:ring-yellow-200"
                                />
                                <Button
                                    onClick={handleStake}
                                    disabled={isStaking || isBorrowing}
                                    className="h-auto px-6 text-lg bg-slate-800 hover:bg-slate-700 text-white font-bold hand-drawn-border shadow-[4px_4px_0px_rgba(0,0,0,0.4)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all disabled:opacity-50"
                                >
                                    {isStaking ? <Loader2 className="w-5 h-5 animate-spin" /> : "Stake"}
                                </Button>
                            </div>
                        </div>

                        {/* Dual Borrow UI */}
                        <div className="flex flex-col gap-3 w-full md:w-1/2">
                            <label className="font-bold text-slate-700">Withdraw Credit Line ({displayCurrency})</label>
                            <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="e.g. 50"
                                value={borrowAmount}
                                onChange={(e) => setBorrowAmount(e.target.value)}
                                className="w-full border-2 border-slate-800 bg-white px-4 py-2 font-bold text-lg hand-drawn-border-alt focus:outline-none focus:ring-4 focus:ring-green-200"
                            />
                            <div className="flex gap-2 w-full mt-1">
                                <Button
                                    onClick={() => handleBorrow("USDT")}
                                    disabled={isBorrowing || isStaking}
                                    variant="outline"
                                    className="flex-1 h-auto py-3 text-lg bg-emerald-100 hover:bg-emerald-200 text-slate-800 font-bold border-2 border-slate-800 hand-drawn-border shadow-[4px_4px_0px_rgba(0,0,0,0.4)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all disabled:opacity-50">
                                    Get USDT
                                </Button>
                                <Button
                                    onClick={() => handleBorrow("vBNB")}
                                    disabled={isBorrowing || isStaking}
                                    variant="outline"
                                    className="flex-1 h-auto py-3 text-lg bg-amber-100 hover:bg-amber-200 text-slate-800 font-bold border-2 border-slate-800 hand-drawn-border shadow-[4px_4px_0px_rgba(0,0,0,0.4)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all disabled:opacity-50">
                                    Get vBNB
                                </Button>
                            </div>
                        </div>

                    </div>

                    {/* Wallet Utility Row */}
                    <div className="w-full mt-8 border-t-2 border-slate-800 border-dashed pt-4 flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => addTokenToWallet('USDT')} className="text-slate-600 font-bold hover:bg-slate-200 text-sm">
                            <WalletIcon className="w-4 h-4 mr-2" /> Add vUSDC to MetaMask
                        </Button>
                        <Button variant="ghost" onClick={() => addTokenToWallet('vBNB')} className="text-slate-600 font-bold hover:bg-slate-200 text-sm">
                            <WalletIcon className="w-4 h-4 mr-2" /> Add vBNB to MetaMask
                        </Button>
                    </div>

                </div>

                <div className="absolute -top-6 -right-6 text-rose-500 opacity-60 transform rotate-12 pointer-events-none hidden md:block">
                    <PenTool className="w-12 h-12" />
                </div>
            </div>
        </div>
    );
}