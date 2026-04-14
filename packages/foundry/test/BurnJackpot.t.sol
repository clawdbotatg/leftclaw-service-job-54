// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { BurnJackpot } from "../contracts/BurnJackpot.sol";

/// @dev Minimal ERC20 for tests. Burns go to the dead address (0xdead), not address(0).
contract MockClawd {
    string public name = "CLAWD";
    string public symbol = "CLAWD";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allow");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "bal");
        unchecked {
            balanceOf[from] -= amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract BurnJackpotTest is Test {
    BurnJackpot jackpot;
    MockClawd clawd;

    address owner = address(0xABCD);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA401);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 constant TICKET_PRICE = 1_000_000 * 1e18;

    bytes32 secret = keccak256("super-secret-round-1");
    bytes32 commit;

    function setUp() public {
        clawd = new MockClawd();
        jackpot = new BurnJackpot(address(clawd), owner);
        commit = keccak256(abi.encodePacked(secret));

        // fund buyers
        clawd.mint(alice, 10 * TICKET_PRICE);
        clawd.mint(bob, 10 * TICKET_PRICE);
        clawd.mint(carol, 10 * TICKET_PRICE);

        vm.prank(alice);
        clawd.approve(address(jackpot), type(uint256).max);
        vm.prank(bob);
        clawd.approve(address(jackpot), type(uint256).max);
        vm.prank(carol);
        clawd.approve(address(jackpot), type(uint256).max);
    }

    function _openRound(bytes32 c) internal {
        vm.prank(owner);
        jackpot.setCommit(c);
    }

    function test_constants() public view {
        assertEq(jackpot.TICKET_PRICE(), TICKET_PRICE);
        assertEq(jackpot.ROUND_DURATION(), 24 hours);
        assertEq(jackpot.BURN_PERCENT(), 20);
        assertEq(jackpot.roundId(), 1);
        assertEq(address(jackpot.clawd()), address(clawd));
        assertEq(jackpot.BURN_ADDRESS(), DEAD);
    }

    function test_setCommit_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        jackpot.setCommit(commit);
    }

    function test_setCommit_opensRound() public {
        _openRound(commit);
        assertEq(jackpot.commitHash(), commit);
        assertEq(jackpot.roundEnd(), block.timestamp + 24 hours);
    }

    function test_setCommit_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(BurnJackpot.InvalidCommit.selector);
        jackpot.setCommit(bytes32(0));
    }

    function test_setCommit_doubleCommitReverts() public {
        _openRound(commit);
        vm.prank(owner);
        vm.expectRevert(BurnJackpot.CommitAlreadySet.selector);
        jackpot.setCommit(commit);
    }

    function test_buyTickets_requiresCommit() public {
        vm.prank(alice);
        vm.expectRevert(BurnJackpot.NoCommit.selector);
        jackpot.buyTickets(1);
    }

    function test_buyTickets_ownerBlocked() public {
        _openRound(commit);
        clawd.mint(owner, 10 * TICKET_PRICE);
        vm.prank(owner);
        clawd.approve(address(jackpot), type(uint256).max);
        vm.prank(owner);
        vm.expectRevert(BurnJackpot.OwnerCannotBuyTickets.selector);
        jackpot.buyTickets(1);
    }

    function test_buyTickets_movesTokensAndPushes() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(3);

        assertEq(clawd.balanceOf(address(jackpot)), 3 * TICKET_PRICE);
        assertEq(jackpot.pot(), 3 * TICKET_PRICE);

        address[] memory t = jackpot.getTickets();
        assertEq(t.length, 3);
        assertEq(t[0], alice);
        assertEq(t[1], alice);
        assertEq(t[2], alice);
    }

    function test_buyTickets_tracksRefundable() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(2);
        assertEq(jackpot.refundableAmount(alice), 2 * TICKET_PRICE);
        assertEq(jackpot.lastBoughtRoundId(alice), 1);
    }

    function test_buyTickets_revertAfterExpiry() public {
        _openRound(commit);
        vm.warp(block.timestamp + 24 hours);
        vm.prank(alice);
        vm.expectRevert(BurnJackpot.RoundClosed.selector);
        jackpot.buyTickets(1);
    }

    function test_buyTickets_zero() public {
        _openRound(commit);
        vm.prank(alice);
        vm.expectRevert(BurnJackpot.ZeroTickets.selector);
        jackpot.buyTickets(0);
    }

    function test_draw_revertBeforeRoundEnd() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(1);
        vm.expectRevert(BurnJackpot.RoundNotOver.selector);
        jackpot.draw(secret);
    }

    function test_draw_invalidSecret() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(1);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.expectRevert(BurnJackpot.InvalidSecret.selector);
        jackpot.draw(keccak256("wrong"));
    }

    function test_draw_distributesAndBurns() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(2);
        vm.prank(bob);
        jackpot.buyTickets(3);

        uint256 potBefore = 5 * TICKET_PRICE;
        assertEq(jackpot.pot(), potBefore);

        vm.warp(block.timestamp + 24 hours + 1);
        vm.roll(block.number + 1);

        uint256 aliceBefore = clawd.balanceOf(alice);
        uint256 bobBefore = clawd.balanceOf(bob);
        uint256 deadBefore = clawd.balanceOf(DEAD);

        jackpot.draw(secret);

        uint256 expectedBurn = (potBefore * 20) / 100;
        uint256 expectedWinner = potBefore - expectedBurn;

        // Burns go to the dead address, not address(0).
        assertEq(clawd.balanceOf(DEAD) - deadBefore, expectedBurn);

        uint256 aliceDelta = clawd.balanceOf(alice) - aliceBefore;
        uint256 bobDelta = clawd.balanceOf(bob) - bobBefore;
        assertTrue(aliceDelta == expectedWinner || bobDelta == expectedWinner);
        assertEq(aliceDelta + bobDelta, expectedWinner);

        // state reset
        assertEq(jackpot.pot(), 0);
        assertEq(jackpot.getTickets().length, 0);
        assertEq(jackpot.commitHash(), bytes32(0));
        assertEq(jackpot.roundId(), 2);
    }

    function test_draw_noTicketsRollsOver() public {
        _openRound(commit);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.roll(block.number + 1);

        uint256 tBefore = block.timestamp;
        jackpot.draw(secret);

        // roundId unchanged, commit cleared, roundEnd extended
        assertEq(jackpot.roundId(), 1);
        assertEq(jackpot.commitHash(), bytes32(0));
        assertEq(jackpot.roundEnd(), tBefore + 24 hours);

        // owner re-commits a fresh secret
        bytes32 s2 = keccak256("new-secret");
        bytes32 c2 = keccak256(abi.encodePacked(s2));
        vm.prank(owner);
        jackpot.setCommit(c2);
        vm.prank(alice);
        jackpot.buyTickets(1);
        assertEq(jackpot.getTickets().length, 1);
    }

    function test_ownerIsClient() public view {
        assertEq(jackpot.owner(), owner);
    }

    function test_claimRefund_stuckRound() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(2);
        vm.prank(bob);
        jackpot.buyTickets(1);

        uint256 alicePaid = 2 * TICKET_PRICE;
        uint256 bobPaid = 1 * TICKET_PRICE;

        // Advance past roundEnd + grace period (owner never reveals).
        vm.warp(block.timestamp + 24 hours + jackpot.REFUND_GRACE_PERIOD() + 1);

        uint256 aliceBefore = clawd.balanceOf(alice);
        uint256 bobBefore = clawd.balanceOf(bob);

        vm.prank(alice);
        jackpot.claimRefund();
        vm.prank(bob);
        jackpot.claimRefund();

        assertEq(clawd.balanceOf(alice) - aliceBefore, alicePaid);
        assertEq(clawd.balanceOf(bob) - bobBefore, bobPaid);
        assertEq(jackpot.pot(), 0);
    }

    function test_claimRefund_notAvailableBeforeGrace() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(1);

        // Only past roundEnd, not past grace period yet.
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(alice);
        vm.expectRevert(BurnJackpot.RefundNotAvailable.selector);
        jackpot.claimRefund();
    }

    function test_claimRefund_notAvailableAfterDraw() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(1);

        vm.warp(block.timestamp + 24 hours + 1);
        vm.roll(block.number + 1);
        jackpot.draw(secret); // draw succeeds, roundId advances

        // commitHash is cleared; claimRefund should revert with RefundNotAvailable.
        vm.warp(block.timestamp + jackpot.REFUND_GRACE_PERIOD() + 1);
        vm.prank(alice);
        vm.expectRevert(BurnJackpot.RefundNotAvailable.selector);
        jackpot.claimRefund();
    }

    function test_claimRefund_nothingToRefundIfNotBuyer() public {
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(1);

        vm.warp(block.timestamp + 24 hours + jackpot.REFUND_GRACE_PERIOD() + 1);

        vm.prank(carol); // carol never bought
        vm.expectRevert(BurnJackpot.NothingToRefund.selector);
        jackpot.claimRefund();
    }

    function test_fullRoundLifecycle() public {
        // Round 1
        _openRound(commit);
        vm.prank(alice);
        jackpot.buyTickets(1);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.roll(block.number + 1);
        jackpot.draw(secret);
        assertEq(jackpot.roundId(), 2);

        // Round 2
        bytes32 s2 = keccak256("round-2-secret");
        bytes32 c2 = keccak256(abi.encodePacked(s2));
        vm.prank(owner);
        jackpot.setCommit(c2);
        vm.prank(bob);
        jackpot.buyTickets(2);
        vm.warp(block.timestamp + 24 hours + 1);
        vm.roll(block.number + 1);
        jackpot.draw(s2);
        assertEq(jackpot.roundId(), 3);
    }
}
