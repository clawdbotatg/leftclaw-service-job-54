"use client";

import { useEffect, useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { keccak256 } from "viem";
import { hardhat } from "viem/chains";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { FireIcon, LockClosedIcon } from "@heroicons/react/24/solid";
import {
  useDeployedContractInfo,
  useScaffoldEventHistory,
  useScaffoldReadContract,
  useScaffoldWriteContract,
} from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

function generateSecret(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" +
    Array.from(bytes)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("")) as `0x${string}`;
}

const TICKET_PRICE_TOKENS = 1_000_000n;
const CLAWD_DECIMALS = 18;
const TICKET_PRICE_WEI = TICKET_PRICE_TOKENS * 10n ** BigInt(CLAWD_DECIMALS);
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const BASE_CHAIN_ID = 8453;

function formatClawd(wei?: bigint): string {
  if (wei === undefined) return "—";
  const whole = wei / 10n ** BigInt(CLAWD_DECIMALS);
  return whole.toLocaleString();
}

function formatCountdown(endTs?: bigint, now?: number): string {
  if (!endTs || !now) return "—";
  const diff = Number(endTs) - Math.floor(now / 1000);
  if (diff <= 0) return "ROUND ENDED";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return `${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
}

// Mobile deep-link helper: fires a wallet deep-link if the user is not already in
// an in-app browser and has an active WalletConnect / Rainbow session.
function openWallet() {
  if (typeof window === "undefined") return;
  // Already inside an in-app browser — no deep-link needed
  if (window.ethereum && !(window.ethereum as any).isMetaMask) return;
  const connId = (window as any).__wagmiConnector?.id ?? "";
  if (connId.includes("walletConnect") || connId === "rainbow") {
    window.location.href = "rainbow://";
  }
}

const Home: NextPage = () => {
  const { address: user } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const [now, setNow] = useState(Date.now());
  const [ticketCountInput, setTicketCountInput] = useState("1");
  const [isApproving, setIsApproving] = useState(false);
  const [approveCooldown, setApproveCooldown] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [ownerSecret, setOwnerSecret] = useState<`0x${string}` | "">("");
  const [revealSecret, setRevealSecret] = useState<string>("");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: deployedContractData } = useDeployedContractInfo({ contractName: "BurnJackpot" });

  const { data: roundInfo } = useScaffoldReadContract({
    contractName: "BurnJackpot",
    functionName: "getRoundInfo",
  });
  const { data: tickets } = useScaffoldReadContract({
    contractName: "BurnJackpot",
    functionName: "getTickets",
  });
  const { data: commitHash } = useScaffoldReadContract({
    contractName: "BurnJackpot",
    functionName: "commitHash",
  });
  const { data: jackpotClawdAddress } = useScaffoldReadContract({
    contractName: "BurnJackpot",
    functionName: "clawd",
  });

  // Read CLAWD balance and allowance from the real CLAWD token on Base mainnet (externalContracts)
  const { data: clawdBalance } = useScaffoldReadContract({
    contractName: "Clawd",
    functionName: "balanceOf",
    args: [user],
  });
  const { data: allowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "Clawd",
    functionName: "allowance",
    args: [user, jackpotClawdAddress],
  });

  const { data: pastRounds } = useScaffoldEventHistory({
    contractName: "BurnJackpot",
    eventName: "RoundComplete",
    fromBlock: 0n,
    watch: true,
  });

  const { data: contractOwner } = useScaffoldReadContract({
    contractName: "BurnJackpot",
    functionName: "owner",
  });

  const { writeContractAsync: writeClawd } = useScaffoldWriteContract({ contractName: "Clawd" });
  const { writeContractAsync: writeJackpot, isMining } = useScaffoldWriteContract({
    contractName: "BurnJackpot",
  });
  const { writeContractAsync: writeJackpotOwner, isMining: isOwnerMining } = useScaffoldWriteContract({
    contractName: "BurnJackpot",
  });

  const [roundId, roundEnd, pot, ticketCount] = (roundInfo ?? [0n, 0n, 0n, 0n]) as readonly [
    bigint,
    bigint,
    bigint,
    bigint,
  ];

  const parsedN = useMemo(() => {
    try {
      const n = BigInt(ticketCountInput || "0");
      return n > 0n ? n : 0n;
    } catch {
      return 0n;
    }
  }, [ticketCountInput]);

  const requiredAllowance = parsedN * TICKET_PRICE_WEI;
  const needsApproval =
    !!user && requiredAllowance > 0n && ((allowance as bigint | undefined) ?? 0n) < requiredAllowance;
  const roundOpen = (commitHash as string | undefined) && commitHash !== ZERO_HASH;
  const expired = roundEnd !== 0n && Number(roundEnd) * 1000 <= now;
  const canBuy = roundOpen && !expired && parsedN > 0n;
  const notEnoughBalance =
    !!user && requiredAllowance > 0n && ((clawdBalance as bigint | undefined) ?? 0n) < requiredAllowance;

  const isOwner = !!user && !!contractOwner && user.toLowerCase() === (contractOwner as string).toLowerCase();
  const pendingCommitHash = ownerSecret ? keccak256(ownerSecret as `0x${string}`) : undefined;
  const roundEnded = roundEnd !== 0n && Number(roundEnd) * 1000 <= now;

  const ticketCounts = useMemo(() => {
    const counts = new Map<string, number>();
    ((tickets as readonly string[] | undefined) ?? []).forEach(addr => {
      const k = addr.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [tickets]);

  const handleMint = async () => {
    // Local dev faucet only — not available on mainnet (button hidden on mainnet)
    if (!user || !isLocalNetwork) return;
    try {
      setIsMinting(true);
      // On local network MockClawd would be used; on mainnet this is unreachable
      console.log("Faucet not available on this network");
    } finally {
      setIsMinting(false);
    }
  };

  const handleApprove = async () => {
    if (!jackpotClawdAddress) return;
    try {
      setIsApproving(true);
      await writeClawd({
        functionName: "approve",
        args: [jackpotClawdAddress as `0x${string}`, requiredAllowance],
      });
      setTimeout(openWallet, 2000);
      setApproveCooldown(true);
      setTimeout(() => {
        setApproveCooldown(false);
        refetchAllowance?.();
      }, 4000);
    } catch (e) {
      notification.error(getParsedError(e));
    } finally {
      setIsApproving(false);
    }
  };

  const handleBuy = async () => {
    if (!canBuy) return;
    try {
      await writeJackpot({ functionName: "buyTickets", args: [parsedN] });
      setTimeout(openWallet, 2000);
      setTicketCountInput("1");
    } catch (e) {
      notification.error(getParsedError(e));
    }
  };

  const handleSetCommit = async () => {
    if (!pendingCommitHash) return;
    try {
      await writeJackpotOwner({ functionName: "setCommit", args: [pendingCommitHash as `0x${string}`] });
      setTimeout(openWallet, 2000);
    } catch (e) {
      notification.error(getParsedError(e));
    }
  };

  const handleDraw = async () => {
    if (!revealSecret) return;
    try {
      await writeJackpotOwner({ functionName: "draw", args: [revealSecret as `0x${string}`] });
      setTimeout(openWallet, 2000);
    } catch (e) {
      notification.error(getParsedError(e));
    }
  };

  // Determine if the user is on the wrong network (only when wallet is connected)
  const isWrongNetwork = !!user && chainId !== BASE_CHAIN_ID;

  return (
    <div className="flex flex-col items-center px-4 pt-8 pb-24 gap-8 w-full max-w-5xl mx-auto">
      <div className="w-full text-center">
        <div className="inline-flex items-center gap-3 justify-center mb-4">
          <FireIcon className="h-12 w-12 text-orange-500" />
          <h1 className="text-5xl font-extrabold tracking-tight m-0">BURN JACKPOT</h1>
          <FireIcon className="h-12 w-12 text-orange-500" />
        </div>
        <p className="text-base opacity-70 m-0">
          Burn CLAWD to enter the pot. Winner takes 80%. 20% is permanently destroyed. Rounds run forever.
        </p>
        {deployedContractData?.address && (
          <div className="flex items-center justify-center gap-2 mt-2 text-sm opacity-60">
            <span>Contract:</span>
            <Address address={deployedContractData.address} />
          </div>
        )}
      </div>

      <div className="card w-full bg-gradient-to-br from-orange-500/20 via-red-500/10 to-base-100 border border-orange-500/30 shadow-xl">
        <div className="card-body items-center text-center gap-2 py-10">
          <div className="text-sm uppercase tracking-widest opacity-70">Round #{roundId.toString()} pot</div>
          <div className="text-6xl font-extrabold text-orange-400">
            {formatClawd(pot)} <span className="text-2xl align-middle opacity-70">CLAWD</span>
          </div>
          <span className="text-xs opacity-50">CLAWD is a community token — no USD oracle</span>
          <div className="text-sm opacity-70 mt-2">Winner receives</div>
          <div className="text-2xl font-bold">
            {formatClawd((pot * 80n) / 100n)} CLAWD
            <span className="opacity-60"> · {formatClawd((pot * 20n) / 100n)} burned</span>
          </div>
          <div className="divider my-2" />
          {!roundOpen ? (
            <div className="text-xl font-semibold opacity-70">Waiting for owner to open the next round…</div>
          ) : (
            <>
              <div className="text-sm uppercase tracking-widest opacity-70">Time remaining</div>
              <div className="font-mono text-4xl font-bold">{formatCountdown(roundEnd, now)}</div>
            </>
          )}
        </div>
      </div>

      <div className="card w-full bg-base-200 shadow-lg">
        <div className="card-body">
          <h2 className="card-title">Buy Tickets</h2>
          <div className="text-sm opacity-70">
            Price: <span className="font-bold">{TICKET_PRICE_TOKENS.toLocaleString()} CLAWD</span> per ticket
            <span className="ml-2 text-xs opacity-60">(CLAWD is a community token — no USD oracle)</span>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <label className="form-control">
              <div className="label">
                <span className="label-text">Tickets</span>
              </div>
              <input
                type="number"
                min="1"
                step="1"
                value={ticketCountInput}
                onChange={e => setTicketCountInput(e.target.value.replace(/[^0-9]/g, ""))}
                className="input input-bordered w-32"
              />
            </label>

            <div className="flex-1 text-sm">
              <div>
                Total: <span className="font-bold">{(parsedN * TICKET_PRICE_TOKENS).toLocaleString()} CLAWD</span>
              </div>
              <div className="opacity-60">Your balance: {formatClawd(clawdBalance as bigint | undefined)} CLAWD</div>
            </div>

            {isWrongNetwork ? (
              <button onClick={() => switchChain({ chainId: BASE_CHAIN_ID })} className="btn btn-secondary">
                Switch to Base
              </button>
            ) : needsApproval ? (
              <button
                onClick={handleApprove}
                disabled={isApproving || approveCooldown || !user || parsedN === 0n}
                className="btn btn-warning"
              >
                {isApproving ? <span className="loading loading-spinner loading-sm" /> : null}
                Approve {(parsedN * TICKET_PRICE_TOKENS).toLocaleString()} CLAWD
              </button>
            ) : (
              <button
                onClick={handleBuy}
                disabled={!canBuy || !user || isMining || Boolean(needsApproval)}
                className="btn btn-primary"
              >
                {isMining ? <span className="loading loading-spinner loading-sm" /> : null}
                Buy {parsedN.toString()} Ticket{parsedN === 1n ? "" : "s"}
              </button>
            )}
          </div>

          {!user && <div className="text-sm opacity-70 mt-2">Connect your wallet to buy tickets.</div>}
          {notEnoughBalance && (
            <div className="alert alert-warning mt-2 py-2">
              <span>Not enough CLAWD.</span>
              {isLocalNetwork && (
                <button onClick={handleMint} disabled={isMinting} className="btn btn-xs btn-outline">
                  {isMinting ? <span className="loading loading-spinner loading-xs" /> : null}
                  Faucet 10M (local only)
                </button>
              )}
            </div>
          )}
          {expired && roundOpen && (
            <div className="alert alert-info mt-2 py-2">
              <span>Round ended — awaiting secret reveal by anyone to draw the winner.</span>
            </div>
          )}
        </div>
      </div>

      <div className="card w-full bg-base-200 shadow-lg">
        <div className="card-body">
          <h2 className="card-title">
            Tickets Sold <span className="badge badge-neutral">{ticketCount.toString()}</span>
          </h2>
          {ticketCounts.length === 0 ? (
            <div className="opacity-60 italic">No tickets yet this round — be the first to ape in.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Buyer</th>
                    <th className="text-right">Tickets</th>
                    <th className="text-right">Odds</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketCounts.map(([addr, count]) => (
                    <tr key={addr}>
                      <td>
                        <Address address={addr as `0x${string}`} />
                      </td>
                      <td className="text-right font-bold">{count}</td>
                      <td className="text-right opacity-70">
                        {Number(ticketCount) > 0 ? `${((count / Number(ticketCount)) * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card w-full bg-base-200 shadow-lg">
        <div className="card-body">
          <h2 className="card-title">Past Rounds</h2>
          {!pastRounds || pastRounds.length === 0 ? (
            <div className="opacity-60 italic">No rounds completed yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th>Winner</th>
                    <th className="text-right">Won</th>
                    <th className="text-right">Burned</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {[...pastRounds]
                    .sort((a: any, b: any) => Number(b.args?.roundId ?? 0n) - Number(a.args?.roundId ?? 0n))
                    .map((ev: any, i: number) => {
                      const args = ev.args ?? {};
                      const rId: bigint = args.roundId ?? 0n;
                      const winner: `0x${string}` = args.winner ?? "0x0000000000000000000000000000000000000000";
                      const winnerAmount: bigint = args.winnerAmount ?? 0n;
                      const burnAmount: bigint = args.burnAmount ?? 0n;
                      const txHash = ev.log?.transactionHash ?? ev.transactionHash;
                      return (
                        <tr key={`${txHash}-${i}`}>
                          <td>#{rId.toString()}</td>
                          <td>
                            <Address address={winner} />
                          </td>
                          <td className="text-right font-bold text-orange-400">{formatClawd(winnerAmount)} CLAWD</td>
                          <td className="text-right opacity-70">{formatClawd(burnAmount)} CLAWD</td>
                          <td>
                            {txHash ? (
                              <a
                                href={`https://basescan.org/tx/${txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="link link-primary text-xs"
                              >
                                view
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="text-xs opacity-50 text-center max-w-xl">
        Commit-reveal randomness: owner commits keccak256(secret) before each round; after the timer expires anyone
        reveals the secret to draw the winner. Prevents post-hoc owner manipulation and miner front-running.
      </div>

      {isOwner && (
        <div className="card w-full border border-warning bg-base-200 shadow-lg">
          <div className="card-body">
            <h2 className="card-title gap-2">
              <LockClosedIcon className="h-5 w-5 text-warning" />
              Owner Controls
            </h2>

            {/* Panel: Open Next Round */}
            {!roundOpen && (
              <div className="flex flex-col gap-3">
                <div className="text-sm font-semibold opacity-80">Open Next Round</div>
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      const s = generateSecret();
                      setOwnerSecret(s);
                      setRevealSecret(s);
                    }}
                  >
                    Generate Random Secret
                  </button>
                </div>
                {ownerSecret && (
                  <div className="flex flex-col gap-1 text-xs font-mono break-all">
                    <div>
                      <span className="opacity-60">Secret: </span>
                      <span className="text-success">{ownerSecret}</span>
                    </div>
                    <div>
                      <span className="opacity-60">keccak256(secret): </span>
                      <span>{pendingCommitHash}</span>
                    </div>
                  </div>
                )}
                {ownerSecret && (
                  <div className="alert alert-warning py-2 text-sm">
                    ⚠️ Save your secret — you will need it to reveal the winner. It cannot be recovered.
                  </div>
                )}
                <button
                  className="btn btn-warning btn-sm w-fit"
                  disabled={!ownerSecret || isOwnerMining}
                  onClick={handleSetCommit}
                >
                  {isOwnerMining ? <span className="loading loading-spinner loading-xs" /> : null}
                  Open Round (Set Commit)
                </button>
              </div>
            )}

            {/* Panel: Round In Progress */}
            {roundOpen && !roundEnded && (
              <div className="text-sm opacity-70">
                Round is live — wait for the timer to expire, then reveal the secret to draw.
              </div>
            )}

            {/* Panel: Reveal & Draw */}
            {roundOpen && roundEnded && (
              <div className="flex flex-col gap-3">
                <div className="text-sm font-semibold opacity-80">Reveal &amp; Draw Winner</div>
                <label className="form-control w-full max-w-lg">
                  <div className="label">
                    <span className="label-text text-xs">Secret (bytes32 hex)</span>
                  </div>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={revealSecret}
                    onChange={e => setRevealSecret(e.target.value)}
                    className="input input-bordered input-sm font-mono text-xs w-full"
                  />
                </label>
                <button
                  className="btn btn-warning btn-sm w-fit"
                  disabled={!revealSecret || isOwnerMining}
                  onClick={handleDraw}
                >
                  {isOwnerMining ? <span className="loading loading-spinner loading-xs" /> : null}
                  Draw Winner
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
