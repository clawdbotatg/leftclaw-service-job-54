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

    uint256 public constant TICKET_PRICE = 1_000_000 * 1e18; // 1,000,000 CLAWD
    uint256 public constant ROUND_DURATION = 24 hours;
    uint256 public constant BURN_PERCENT = 20;
    address public constant BURN_ADDRESS = address(0);

    IERC20 public immutable clawd;

    uint256 public roundId;
    uint256 public roundEnd;
    uint256 public pot;
    address[] public tickets;
    bytes32 public commitHash;

    event CommitSet(uint256 indexed roundId, uint256 roundEnd);
    event TicketsBought(uint256 indexed roundId, address indexed buyer, uint256 count, uint256 amount);
    event RoundComplete(uint256 indexed roundId, address indexed winner, uint256 winnerAmount, uint256 burnAmount);
    event RoundRolledOver(uint256 indexed roundId, uint256 newRoundEnd);

    error RoundClosed();
    error RoundNotOver();
    error NoCommit();
    error CommitAlreadySet();
    error InvalidSecret();
    error ZeroTickets();
    error InvalidCommit();

    constructor(address _clawd, address _owner) Ownable(_owner) {
        require(_clawd != address(0), "clawd=0");
        require(_owner != address(0), "owner=0");
        clawd = IERC20(_clawd);
        roundId = 1;
    }

    /// @notice Owner commits the hash of a secret to open a round.
    /// @dev Must be called once per round, before buys. `hash` must be non-zero.
    function setCommit(bytes32 hash) external onlyOwner {
        if (hash == bytes32(0)) revert InvalidCommit();
        if (commitHash != bytes32(0)) revert CommitAlreadySet();
        commitHash = hash;
        roundEnd = block.timestamp + ROUND_DURATION;
        emit CommitSet(roundId, roundEnd);
    }

    /// @notice Buy `n` tickets for the current round.
    function buyTickets(uint256 n) external nonReentrant {
        if (n == 0) revert ZeroTickets();
        if (commitHash == bytes32(0)) revert NoCommit();
        if (block.timestamp >= roundEnd) revert RoundClosed();

        uint256 amount = n * TICKET_PRICE;
        pot += amount;
        for (uint256 i; i < n; ++i) {
            tickets.push(msg.sender);
        }
        clawd.safeTransferFrom(msg.sender, address(this), amount);
        emit TicketsBought(roundId, msg.sender, n, amount);
    }

    /// @notice After the round ends, anyone can reveal the secret to draw a winner.
    function draw(bytes32 secret) external nonReentrant {
        if (commitHash == bytes32(0)) revert NoCommit();
        if (block.timestamp < roundEnd) revert RoundNotOver();
        if (keccak256(abi.encodePacked(secret)) != commitHash) revert InvalidSecret();

        uint256 ticketCount = tickets.length;
        uint256 currentRound = roundId;

        if (ticketCount == 0) {
            // No entries — roll over. Clear commit so owner must re-commit a fresh secret.
            commitHash = bytes32(0);
            roundEnd = block.timestamp + ROUND_DURATION;
            emit RoundRolledOver(currentRound, roundEnd);
            return;
        }

        uint256 currentPot = pot;
        uint256 burnAmount = (currentPot * BURN_PERCENT) / 100;
        uint256 winnerAmount = currentPot - burnAmount;

        uint256 rand = uint256(keccak256(abi.encodePacked(secret, blockhash(block.number - 1))));
        address winner = tickets[rand % ticketCount];

        // Reset state before external transfers.
        delete tickets;
        pot = 0;
        commitHash = bytes32(0);
        roundId = currentRound + 1;
        roundEnd = 0;

        clawd.safeTransfer(winner, winnerAmount);
        clawd.safeTransfer(BURN_ADDRESS, burnAmount);

        emit RoundComplete(currentRound, winner, winnerAmount, burnAmount);
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
