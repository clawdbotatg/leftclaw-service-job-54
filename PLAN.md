# Build Plan — Job #54

## Client
0x7E6Db18aea6b54109f4E5F34242d4A8786E0C471

## Spec
Burn Jackpot — CLAWD Lottery with Auto-Burn. Build and deploy a BurnJackpot.sol smart contract + minimal frontend on Base. Players burn CLAWD to enter a recurring lottery. When the round timer expires a winner is picked and paid out automatically. 20% of every pot is permanently burned. Rounds reset and run forever with no admin intervention after deploy.

Contract state: ticketPrice fixed at 1000000 CLAWD (1e24 wei, 18 decimals), roundDuration fixed at 24 hours, burnPercent fixed at 20, roundId increments each round, roundEnd timestamp when round closes, tickets[] array of buyer addresses (duplicates allowed for multiple tickets), pot total CLAWD this round, commitHash keccak256 of secret set by owner before each round.

Functions: buyTickets(uint256 n) — public, transfers n*ticketPrice CLAWD from caller, pushes caller n times into tickets[], adds to pot, reverts if round expired. draw(bytes32 secret) — callable by anyone after roundEnd, requires keccak256(secret)==commitHash, winner = tickets[uint256(keccak256(secret, blockhash(block.number-1))) % tickets.length], sends 80% to winner and 20% to address(0) as burn, emits RoundComplete(roundId, winner, winnerAmount, burnAmount), if zero tickets rolls over by extending roundEnd 24h, resets tickets[] and pot. setCommit(bytes32 hash) — owner only, must be called before each round opens. getTickets() — view, returns full tickets[] for current round. getRoundInfo() — view, returns roundId, roundEnd, pot, tickets.length.

Randomness: commit-reveal scheme. Owner commits keccak256(secret) before round opens. After expiry anyone calls draw(secret). Winner derived from keccak256(secret, blockhash(block.number-1)). Prevents owner choosing winner after seeing buyers and prevents miner manipulation.

CLAWD token on Base: 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07. Burn address: address(0).

Frontend: single page showing current pot size in CLAWD, live countdown timer, tickets sold with buyer addresses and counts, Buy X Tickets input+button (approve then buyTickets), past rounds table with winner address, pot size, burn amount, Basescan tx link. Stack: scaffold-eth 2, Next.js, wagmi/viem. Deploy to Vercel.

Deploy to Base mainnet, verify on Basescan. Owner wallet: 0x7E6Db18aea6b54109f4E5F34242d4A8786E0C471. No proxy needed. After deploy owner calls setCommit(hash) to open first round.

## Deploy
- Chain: Base (8453)
- RPC: Alchemy (ALCHEMY_API_KEY in .env)
- Deployer: 0x7a8b288AB00F5b469D45A82D4e08198F6Eec651C (DEPLOYER_PRIVATE_KEY in .env)
- All owner/admin/treasury roles transfer to client: 0x7E6Db18aea6b54109f4E5F34242d4A8786E0C471
