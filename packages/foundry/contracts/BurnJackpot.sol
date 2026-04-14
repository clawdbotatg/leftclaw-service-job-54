// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BurnJackpot — CLAWD lottery with auto-burn
/// @notice Players buy tickets with CLAWD, 80% pays the winner, 20% is burned.
contract BurnJackpot is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Known issue: BURN_PERCENT and TICKET_PRICE are immutable constants — changing economics requires a redeployment.
    uint256 public constant TICKET_PRICE = 1_000_000 * 1e18; // 1,000,000 CLAWD
    uint256 public constant ROUND_DURATION = 24 hours;
    uint256 public constant BURN_PERCENT = 20;
    /// @notice Grace period after roundEnd before ticket buyers can claim refunds if no draw occurred.
    uint256 public constant REFUND_GRACE_PERIOD = 7 days;
    /// @notice Burns are sent to the canonical dead address — address(0) reverts on standard OZ ERC20.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable clawd;

    uint256 public roundId;
    uint256 public roundEnd;
    uint256 public pot;
    address[] public tickets;
    bytes32 public commitHash;
    /// @notice Block hash captured at setCommit time — used as entropy in draw() to prevent owner grinding the reveal block.
    bytes32 public commitBlockHash;

    /// @notice Tracks the refundable amount per buyer for the current round.
    mapping(address => uint256) public refundableAmount;
    /// @notice Tracks which roundId the refundableAmount mapping belongs to per buyer.
    mapping(address => uint256) public lastBoughtRoundId;

    event CommitSet(uint256 indexed roundId, uint256 roundEnd);
    event TicketsBought(uint256 indexed roundId, address indexed buyer, uint256 count, uint256 amount);
    event RoundComplete(uint256 indexed roundId, address indexed winner, uint256 winnerAmount, uint256 burnAmount);
    event RoundRolledOver(uint256 indexed roundId, uint256 newRoundEnd);
    event Refunded(uint256 indexed roundId, address indexed buyer, uint256 amount);

    error RoundClosed();
    error RoundNotOver();
    error NoCommit();
    error CommitAlreadySet();
    error InvalidSecret();
    error ZeroTickets();
    error InvalidCommit();
    error OwnerCannotBuyTickets();
    error RefundNotAvailable();
    error NothingToRefund();

    /// @notice Known issue: Ownable2Step inherited but initial ownership is set directly via Ownable(_owner) —
    ///         intentional; the deployer never holds ownership. Future handoffs use the two-step acceptOwnership dance.
    constructor(address _clawd, address _owner) Ownable(_owner) {
        require(_clawd != address(0), "clawd=0");
        require(_owner != address(0), "owner=0");
        clawd = IERC20(_clawd);
        roundId = 1;
    }

    /// @notice Owner commits the hash of a secret to open a round.
    /// @dev Must be called once per round, before buys. `hash` must be non-zero.
    /// @notice Known issue: setCommit permanently reverts if roundEnd has passed and the secret was lost — no escape
    ///         hatch exists beyond a ticket-free rollover. If the owner loses the secret with active tickets, the
    ///         round enters a stuck state; buyers may claim refunds after REFUND_GRACE_PERIOD.
    function setCommit(bytes32 hash) external onlyOwner {
        if (hash == bytes32(0)) revert InvalidCommit();
        if (commitHash != bytes32(0)) revert CommitAlreadySet();
        commitHash = hash;
        commitBlockHash = blockhash(block.number - 1);
        roundEnd = block.timestamp + ROUND_DURATION;
        emit CommitSet(roundId, roundEnd);
    }

    /// @notice Buy `n` tickets for the current round.
    /// @notice Known issue: Unbounded tickets array — deletion cost grows with entries; at very high participation
    ///         this raises a DoS risk on draw(). Practical mitigation: the 1M CLAWD ticket price is an economic bound.
    function buyTickets(uint256 n) external nonReentrant {
        if (n == 0) revert ZeroTickets();
        if (commitHash == bytes32(0)) revert NoCommit();
        if (block.timestamp >= roundEnd) revert RoundClosed();
        // Owner is excluded from buying tickets to prevent outcome manipulation via ticket ownership.
        if (msg.sender == owner()) revert OwnerCannotBuyTickets();

        uint256 amount = n * TICKET_PRICE;
        pot += amount;
        for (uint256 i; i < n; ++i) {
            tickets.push(msg.sender);
        }

        // Track refundable amount per buyer, reset if this is a new round for them.
        if (lastBoughtRoundId[msg.sender] != roundId) {
            refundableAmount[msg.sender] = 0;
            lastBoughtRoundId[msg.sender] = roundId;
        }
        refundableAmount[msg.sender] += amount;

        clawd.safeTransferFrom(msg.sender, address(this), amount);
        emit TicketsBought(roundId, msg.sender, n, amount);
    }

    /// @notice After the round ends, anyone can reveal the secret to draw a winner.
    /// @notice Entropy is locked at setCommit time via commitBlockHash — the owner cannot grind the reveal block
    ///         to bias the winner. The block hash is captured before any tickets are sold.
    function draw(bytes32 secret) external nonReentrant {
        if (commitHash == bytes32(0)) revert NoCommit();
        if (block.timestamp < roundEnd) revert RoundNotOver();
        if (keccak256(abi.encodePacked(secret)) != commitHash) revert InvalidSecret();

        uint256 ticketCount = tickets.length;
        uint256 currentRound = roundId;

        if (ticketCount == 0) {
            // No entries — roll over. Clear commit so owner must re-commit a fresh secret.
            /// @notice Known issue: roundEnd not reset to zero on rollover — commitHash is cleared but roundEnd
            ///         retains its prior value, causing the UI's "Waiting for owner" branch to show with a live
            ///         countdown. Harmless, slightly confusing.
            commitHash = bytes32(0);
            commitBlockHash = bytes32(0);
            roundEnd = block.timestamp + ROUND_DURATION;
            emit RoundRolledOver(currentRound, roundEnd);
            return;
        }

        uint256 currentPot = pot;
        uint256 burnAmount = (currentPot * BURN_PERCENT) / 100;
        uint256 winnerAmount = currentPot - burnAmount;

        uint256 rand = uint256(keccak256(abi.encodePacked(secret, commitBlockHash)));
        address winner = tickets[rand % ticketCount];

        // Reset state before external transfers.
        delete tickets;
        pot = 0;
        commitHash = bytes32(0);
        roundId = currentRound + 1;
        roundEnd = 0;

        clawd.safeTransfer(winner, winnerAmount);
        // Burns are sent to the dead address — address(0) reverts on standard OZ ERC20 transfers.
        clawd.safeTransfer(BURN_ADDRESS, burnAmount);

        emit RoundComplete(currentRound, winner, winnerAmount, burnAmount);
    }

    /// @notice Allows ticket buyers to reclaim their tokens if the round ended but no draw occurred
    ///         within REFUND_GRACE_PERIOD. Protects against owner withholding the secret.
    function claimRefund() external nonReentrant {
        // Only available when there is an active (undrawn) round past its grace period.
        if (commitHash == bytes32(0)) revert RefundNotAvailable();
        if (block.timestamp <= roundEnd + REFUND_GRACE_PERIOD) revert RefundNotAvailable();
        // Caller must have bought in the current stuck round.
        if (lastBoughtRoundId[msg.sender] != roundId) revert NothingToRefund();
        uint256 amount = refundableAmount[msg.sender];
        if (amount == 0) revert NothingToRefund();

        refundableAmount[msg.sender] = 0;
        pot -= amount;
        clawd.safeTransfer(msg.sender, amount);

        emit Refunded(roundId, msg.sender, amount);
    }

    /// @notice Full ticket array for the current round.
    function getTickets() external view returns (address[] memory) {
        return tickets;
    }

    /// @notice Snapshot of the current round.
    function getRoundInfo()
        external
        view
        returns (uint256 _roundId, uint256 _roundEnd, uint256 _pot, uint256 _ticketCount)
    {
        return (roundId, roundEnd, pot, tickets.length);
    }
}
