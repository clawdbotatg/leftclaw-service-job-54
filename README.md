# BurnJackpot

A on-chain lottery on Base where players burn CLAWD tokens to enter. The winner takes 80% of the pot — the remaining 20% is permanently burned. Rounds run forever.

## How It Works

1. **Owner opens a round** by calling `setCommit(bytes32 hash)` with `keccak256(abi.encodePacked(secret))`.
2. **Players buy tickets** by approving CLAWD and calling `buyTickets(uint256 n)`. Each ticket costs 1,000,000 CLAWD.
3. **Round ends** when the countdown reaches zero.
4. **Anyone reveals** the winner by calling `draw(bytes32 secret)` after the round ends. The contract uses commit-reveal randomness to pick a winner.
5. **Winner receives 80%** of the pot in CLAWD. **20% is sent to the zero address** (permanently burned).

## Deployed Contracts

| Contract | Network | Address |
|----------|---------|---------|
| BurnJackpot | Base (8453) | `0x75501F36CEC6e757608863a84034E759d0cc319D` |
| CLAWD Token | Base (8453) | `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07` |

Both contracts are verified on [Basescan](https://basescan.org).

## Owner Setup

The owner controls round lifecycle. Before players can buy tickets, the owner must open a round:

```bash
# Generate a secret
SECRET=$(openssl rand -hex 32)

# Compute the commit hash
COMMIT=$(cast keccak "0x$SECRET")

# Call setCommit on the BurnJackpot contract
cast send 0x75501F36CEC6e757608863a84034E759d0cc319D \
  "setCommit(bytes32)" $COMMIT \
  --rpc-url $ALCHEMY_RPC_URL \
  --private-key $PRIVATE_KEY
```

After the round timer expires, reveal the secret to draw the winner:

```bash
cast send 0x75501F36CEC6e757608863a84034E759d0cc319D \
  "draw(bytes32)" "0x$SECRET" \
  --rpc-url $ALCHEMY_RPC_URL \
  --private-key $PRIVATE_KEY
```

**Keep the secret safe.** If the secret is lost after tickets are purchased, players can claim refunds via `claimRefund()` after 7 days past the round end time.

## Local Development

```bash
yarn install
yarn chain        # Start local Anvil node
yarn deploy       # Deploy contracts locally
yarn start        # Start frontend at http://localhost:3000
```

## Frontend

Built with [Scaffold-ETH 2](https://scaffoldeth.io) — Next.js, RainbowKit, Wagmi, Viem, and Tailwind CSS + DaisyUI.

The frontend is deployed as a static export to IPFS via [bgipfs](https://bgipfs.com).
