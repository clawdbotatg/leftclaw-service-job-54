"use client";

import { useEffect, useMemo, useState } from "react";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { FireIcon } from "@heroicons/react/24/solid";
import { useScaffoldEventHistory, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const TICKET_PRICE_TOKENS = 1_000_000n;
const CLAWD_DECIMALS = 18;
const TICKET_PRICE_WEI = TICKET_PRICE_TOKENS * 10n ** BigInt(CLAWD_DECIMALS);
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

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

const Home: NextPage = () => {
  const { address: user } = useAccount();
  const [now, setNow] = useState(Date.now());
  const [ticketCountInput, setTicketCountInput] = useState("1");
  const [isApproving, setIsApproving] = useState(false);
  const [isMinting, setIsMinting] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  // Known issue: Frontend references MockClawd contract on all chains — on Base mainnet MockClawd won't exist,
  // causing balance/allowance calls to return undefined and leaving the UI stuck on "Not enough CLAWD" / "Approve".
  // Approval should target the real CLAWD token on Base; the faucet button should be hidden on non-local chains.
  const { data: clawdBalance } = useScaffoldReadContract({
    contractName: "MockClawd",
    functionName: "balanceOf",
    args: [user],
  });
  const { data: allowance } = useScaffoldReadContract({
    contractName: "MockClawd",
    functionName: "allowance",
    args: [user, jackpotClawdAddress],
  });

  const { data: pastRounds } = useScaffoldEventHistory({
    contractName: "BurnJackpot",
    eventName: "RoundComplete",
    fromBlock: 0n,
    watch: true,
  });

  const { writeContractAsync: writeMock } = useScaffoldWriteContract({ contractName: "MockClawd" });
  const { writeContractAsync: writeJackpot, isMining } = useScaffoldWriteContract({
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

  const ticketCounts = useMemo(() => {
    const counts = new Map<string, number>();
    ((tickets as readonly string[] | undefined) ?? []).forEach(addr => {
      const k = addr.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [tickets]);

  const handleMint = async () => {
    if (!user) return;
    try {
      setIsMinting(true);
      await writeMock({ functionName: "mint", args: [user, 10n * TICKET_PRICE_WEI] });
    } finally {
      setIsMinting(false);
    }
  };

  const handleApprove = async () => {
    if (!jackpotClawdAddress) return;
    try {
      setIsApproving(true);
      await writeMock({
        functionName: "approve",
        args: [jackpotClawdAddress as `0x${string}`, requiredAllowance],
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleBuy = async () => {
    if (!canBuy) return;
    await writeJackpot({ functionName: "buyTickets", args: [parsedN] });
    setTicketCountInput("1");
  };

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
      </div>

      <div className="card w-full bg-gradient-to-br from-orange-500/20 via-red-500/10 to-base-100 border border-orange-500/30 shadow-xl">
        <div className="card-body items-center text-center gap-2 py-10">
          <div className="text-sm uppercase tracking-widest opacity-70">Round #{roundId.toString()} pot</div>
          <div className="text-6xl font-extrabold text-orange-400">
            {formatClawd(pot)} <span className="text-2xl align-middle opacity-70">CLAWD</span>
          </div>
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

            {needsApproval ? (
              <button
                onClick={handleApprove}
                disabled={isApproving || !user || parsedN === 0n}
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
              <button onClick={handleMint} disabled={isMinting} className="btn btn-xs btn-outline">
                {isMinting ? <span className="loading loading-spinner loading-xs" /> : null}
                Faucet 10M (local only)
              </button>
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
                              // Known issue: links unconditionally to basescan — on non-Base chains these 404; use targetNetwork.blockExplorers for the base URL.
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
    </div>
  );
};

export default Home;
