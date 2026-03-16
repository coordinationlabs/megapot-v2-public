//SPDX-License-Identifier: UNLICENSED

/*
Copyright (C) 2025 Coordination Inc.
All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use is strictly prohibited and may result in legal action.

For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { IJackpot } from "./interfaces/IJackpot.sol";
import { JackpotErrors } from "./lib/JackpotErrors.sol";
import { TicketPicker } from "./lib/TicketPicker.sol";

/**
 * @title JackpotRandomTicketBuyer
 * @notice Lightweight helper to purchase a specified number of random tickets for the current drawing
 * @dev Uses on-chain entropy via `TicketPicker.pickAuto` to construct `_count` tickets and forwards
 *      them to `Jackpot.buyTickets`. Pulls USDC from the caller, approves the Jackpot contract for
 *      the exact purchase amount, and returns the minted ticket IDs.
 *
 * Security considerations:
 * - Entropy: `TicketPicker.pickAuto` mixes chain-specific values (prevrandao, prev blockhash), a
 *   domain separator, and a per-call `nonce`. Randomness quality varies by network but drawing
 *   fairness is enforced by `Jackpot` separately.
 * - Funds flow: This contract takes custody of USDC for the duration of the call, then approves
 *   the Jackpot contract to pull the exact amount. If `buyTickets` reverts, the transfer and
 *   approval are rolled back.
 * - Approvals: Uses a per-call `approve(totalCost)`. Some ERC-20 tokens require zeroing allowance
 *   before setting a new value; USDC is typically compatible. If broader token compatibility is
 *   required, consider switching to `safeIncreaseAllowance` or a one-time max-allowance strategy.
 */
contract JackpotRandomTicketBuyer is ReentrancyGuardTransient {

    using SafeERC20 for IERC20;

    // =============================================================
    //                           STATE
    // =============================================================

    /// @notice Per-call nonce incorporated into randomness to ensure uniqueness
    /// @dev Incremented before each ticket batch generation.
    uint256 public nonce;
    
    /// @notice The Jackpot contract used to purchase tickets
    IJackpot public immutable jackpot;
    /// @notice The ERC-20 token used for ticket payments (e.g., USDC)
    IERC20 public immutable usdc;

    // =============================================================
    //                           EVENTS
    // =============================================================

    event RandomTicketsBought(
        address indexed recipient,
        uint256 indexed drawingId,
        uint256 count,
        uint256 cost,
        uint256[] ticketIds
    );

    // =============================================================
    //                           CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initializes the random ticket buyer
     * @param _jackpot The `Jackpot` contract address to purchase tickets from
     * @param _usdc The ERC-20 token address used to pay for tickets
     */
    constructor(address _jackpot, address _usdc) {
        jackpot = IJackpot(_jackpot);
        usdc = IERC20(_usdc);
    }

    // =============================================================
    //                           FUNCTIONS
    // =============================================================

    /**
     * @notice Buys `_count` randomly generated tickets for the current drawing and mints them to `_recipient`
     * @dev Flow:
     *      1) Validate inputs and read current drawing state
     *      2) Pull USDC from caller and approve Jackpot for the exact `totalCost`
     *      3) Generate `_count` tickets using `TicketPicker.pickAuto(++nonce, ...)`
     *      4) Call `Jackpot.buyTickets` and return the minted ticket IDs
     *
     * Randomness:
     * - `TicketPicker.pickAuto` uses domain separation + chain data + nonce. Nonce must be unique
     *   per call to avoid same-block collisions with identical parameters.
     *
     * @param _count Number of tickets to purchase (must be > 0)
     * @param _recipient Address that will receive the minted ticket NFTs (must be non-zero)
     * @param _referrers Optional list of referrer addresses for fee sharing
     * @param _referralSplitBps PRECISE_UNIT-scaled referral weights, must match `_referrers` length and sum to 1e18 (validated in Jackpot)
     * @param _source Telemetry identifier to pass through to Jackpot
     *
     * @return ticketIds Array of minted ticket IDs
     *
     * @custom:requirements
     * - `_count > 0`
     * - `_recipient != address(0)`
     * - Caller must have approved sufficient USDC to this contract
     *
     * @custom:security
     * - Reentrancy guarded
     * - Approves Jackpot for exactly `totalCost`; on revert, allowance changes are rolled back
     */
    function buyTickets(
        uint256 _count,
        address _recipient,
        address[] memory _referrers,
        uint256[] memory _referralSplitBps,
        bytes32 _source
    )
        external
        nonReentrant
        returns (uint256[] memory ticketIds)
    {
        if (_count == 0) revert JackpotErrors.InvalidTicketCount();
        if (_recipient == address(0)) revert JackpotErrors.InvalidRecipient();

        uint256 currentDrawingId = jackpot.currentDrawingId();
        IJackpot.DrawingState memory drawingState = jackpot.getDrawingState(currentDrawingId);

        uint256 ticketPrice = drawingState.ticketPrice;
        uint256 totalCost = _count * ticketPrice;

        usdc.safeTransferFrom(msg.sender, address(this), totalCost);
        // Approve Jackpot to pull the exact purchase amount
        usdc.approve(address(jackpot), totalCost);

        IJackpot.Ticket[] memory tickets = TicketPicker.pickAuto(
            ++nonce,        // Increment to make sure duplicates not purchased in the same block
            _count,
            drawingState.ballMax,
            drawingState.bonusballMax
        );

        ticketIds = jackpot.buyTickets(tickets, _recipient, _referrers, _referralSplitBps, _source);

        emit RandomTicketsBought(_recipient, currentDrawingId, _count, totalCost, ticketIds);
    }
}
