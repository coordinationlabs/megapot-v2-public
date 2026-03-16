//SPDX-License-Identifier: UNLICENSED

/*
Copyright (C) 2025 Coordination Inc.
All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use is strictly prohibited and may result in legal action.

For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.28;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { BuyTicketsHelpers } from "./lib/BuyTicketsHelpers.sol";
import { JackpotErrors } from "./lib/JackpotErrors.sol";
import { IBatchPurchaseFacilitator } from "./interfaces/IBatchPurchaseFacilitator.sol";
import { IJackpot } from "./interfaces/IJackpot.sol";
import { AllowedManager } from "./lib/AllowedManager.sol";
import { TicketPicker } from "./lib/TicketPicker.sol";

contract BatchPurchaseFacilitator is IBatchPurchaseFacilitator, Ownable2Step, ReentrancyGuardTransient, AllowedManager {
    
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // =============================================================
    //                           ENUMS
    // =============================================================
    enum ExecutionAction {
        EXECUTE_PARTIAL,              // Execute some tickets, order continues
        EXECUTE_FINAL,                // Execute remaining tickets, order completed
        CANCEL_WRONG_DRAWING,         // Order is for a different drawing (must be for currentDrawingId)
        CANCEL_DRAWING_LOCKED,        // Drawing locked, auto-cancelled with refund
        CANCEL_TOO_MANY_REFERRERS,    // Too many referrers, auto-cancelled with refund
        CANCEL_USER_REQUESTED         // User requested cancellation
    }

    // =============================================================
    //                           EVENTS
    // =============================================================

    event StaticTicketAdded(
        address indexed recipient,
        uint8[] normals,
        uint8 bonusball
    );

    event BatchOrderCreated(
        address indexed payer,
        address indexed recipient,
        uint256 indexed drawingId,
        uint256 totalCost,
        uint256 dynamicTicketCount,
        uint256 staticTicketCount
    );

    event BatchOrderCancelled(
        address indexed recipient,
        ExecutionAction indexed executionAction,
        uint256 refundAmount
    );

    event BatchOrderExecuted(
        address indexed user,
        uint256 indexed drawingId,
        uint256[] ticketIds,
        uint256 ticketsExecuted,
        uint256 remainingTickets,
        uint256 remainingUSDC
    );

    event BatchOrderRemoved(address indexed recipient);

    // =============================================================
    //                           ERRORS
    // =============================================================
    error ActiveBatchOrderExists();
    error NoActiveBatchOrder();
    error InvalidTicketCount();
    error InvalidMinimumTicketCount();

    // =============================================================
    //                           CONSTANTS
    // =============================================================
    bytes32 private constant BATCH_PURCHASE_TELEMETRY = "batch-purchase-facilitator";

    // =============================================================
    //                           STATE VARIABLES
    // =============================================================

    mapping(address => BatchOrder) public batchOrders;
    mapping(address => IJackpot.Ticket[]) public staticTickets;

    IJackpot public immutable jackpot;
    IERC20 public immutable usdc;

    uint256 public minimumTicketCount;
    uint256 public executionNonce;

    // =============================================================
    //                           CONSTRUCTOR
    // =============================================================
    constructor(address _jackpot, address _usdc, uint256 _minimumTicketCount) AllowedManager() {
        jackpot = IJackpot(_jackpot);
        usdc = IERC20(_usdc);
        _validateAndSetMinimumTicketCount(_minimumTicketCount);
    }

    // =============================================================
    //                     EXTERNAL FUNCTIONS
    // =============================================================
    /**
     * @notice Creates a prepaid batch order for the current drawing
     * @dev Validates static tickets and referral scheme, pulls USDC from the payer,
     *      and records an order for `_recipient` to be executed by keepers within this drawing.
     *
     * @param _recipient The address that will own the batch order and receive any refund
     * @param _dynamicTicketCount Number of dynamic (random) tickets to purchase
     * @param _userStaticTickets Array of user-defined static tickets to purchase
     * @param _referrers Referrer addresses attributed to this order
     * @param _referralSplit PRECISE_UNIT‑scaled weights corresponding to `_referrers`
     *
     * @custom:requirements
     * - Jackpot initialized (`currentDrawingId > 0`) and not locked for this drawing
     * - `_recipient` has no active order (`remainingUSDC == 0`)
     * - Total tickets (`dynamic + static`) ≥ `minimumTicketCount`
     * - Each static ticket has exactly 5 unique normals in `[1, ballMax]` and bonusball in `[1, bonusballMax]`
     * - Referrers length matches splits; each referrer nonzero; each split > 0; sum(splits) == PRECISE_UNIT; length ≤ `maxReferrers`
     * - Caller approved and holds `totalCost = totalTickets * drawingState.ticketPrice`
     *
     * @custom:effects
     * - Transfers `totalCost` USDC from `msg.sender` to this contract (SafeERC20)
     * - Stores `BatchOrder` for `_recipient` and persists static tickets and referral config
     *
     * @custom:emits
     * - `StaticTicketAdded(recipient, normals, bonusball)` per static ticket
     * - `BatchOrderCreated(payer, recipient, drawingId, totalCost, dynamicCount, staticCount)`
     *
     * @custom:security
     * - Reentrancy protected via `nonReentrant`
     * - Arithmetic narrowed to `uint64` for stored amounts; excessively large orders revert on overflow
     */
    function createBatchOrder(
        address _recipient,
        uint64 _dynamicTicketCount,
        IJackpot.Ticket[] calldata _userStaticTickets,
        address[] calldata _referrers,
        uint256[] calldata _referralSplit
    )
        external
        nonReentrant
    {
        uint256 currentDrawingId = jackpot.currentDrawingId();
        if (currentDrawingId == 0) revert JackpotErrors.JackpotNotInitialized();
        
        // Enforce single active order per user
        if (batchOrders[_recipient].remainingUSDC > 0) revert ActiveBatchOrderExists();

        // Purchases must be at least one ticket
        uint64 ticketCount = uint64(_dynamicTicketCount) + uint64(_userStaticTickets.length);
        if (ticketCount < minimumTicketCount) revert InvalidTicketCount();

        IJackpot.DrawingState memory drawingState = jackpot.getDrawingState(currentDrawingId);
        if (drawingState.jackpotLock) revert JackpotErrors.JackpotLocked();
        _validateBuyTicketParams(drawingState, _recipient, _userStaticTickets, _referrers, _referralSplit);

        uint64 totalCost = uint64(ticketCount) * uint64(drawingState.ticketPrice);

        usdc.safeTransferFrom(msg.sender, address(this), totalCost);

        batchOrders[_recipient] = BatchOrder({
            orderDrawingId: currentDrawingId,
            remainingUSDC: totalCost,
            remainingTickets: ticketCount,
            totalTicketsOrdered: ticketCount,
            dynamicTicketCount: _dynamicTicketCount,
            referrers: _referrers,
            referralSplit: _referralSplit
        });

        staticTickets[_recipient] = _userStaticTickets;

        emit BatchOrderCreated(msg.sender, _recipient, currentDrawingId, totalCost, _dynamicTicketCount, _userStaticTickets.length);
    }

    /**
     * @notice Cancels the caller's active batch order and refunds remaining USDC
     * @dev Deletes the order and static tickets from storage, then transfers the full
     *      `remainingUSDC` to `msg.sender`. Emits both removal and cancellation events.
     *
     * @custom:requirements
     * - Caller must have an active order (`batchOrders[msg.sender].remainingUSDC > 0`)
     *
     * @custom:effects
     * - Deletes `batchOrders[msg.sender]` and `staticTickets[msg.sender]`
     * - Transfers `remainingUSDC` to `msg.sender`
     *
     * @custom:emits
     * - `BatchOrderRemoved(recipient)`
     * - `BatchOrderCancelled(recipient, ExecutionAction.CANCEL_USER_REQUESTED, refundAmount)`
     *
     * @custom:security
     * - Reentrancy protected via `nonReentrant`
     * - State is cleared before transfer; if transfer reverts, the whole tx reverts atomically
     */
    function cancelBatchOrder() external nonReentrant {
        if (batchOrders[msg.sender].remainingUSDC == 0) revert NoActiveBatchOrder();
        _cancelBatchOrder(msg.sender, ExecutionAction.CANCEL_USER_REQUESTED);
    }

    /**
     * @notice Executes or cancels a single user's batch order for the current drawing
     * @dev Allowed-only entrypoint. Determines action via `_determineExecutionAction` and either
     *      executes up to `_maxTicketsPerBatch` tickets or cancels with refund when conditions require.
     *      Reverts if the user has no active order.
     *
     * @param _recipient The batch order owner to process
     * @param _maxTicketsPerBatch Maximum number of tickets to attempt this call
     *
     * @custom:requirements
     * - Caller must be an authorized keeper (`onlyAllowed`)
     * - `_recipient` must have an active order (`remainingUSDC > 0`)
     *
     * @custom:effects
     * - EXECUTE_PARTIAL/FINAL: Generates static-first tickets, mints via `jackpot.buyTickets`,
     *   updates `remainingUSDC` and `remainingTickets`; deletes order on FINAL
     * - CANCEL_*: Refunds full `remainingUSDC` and clears order + static tickets
     *
     * @custom:emits
     * - `BatchOrderExecuted(user, drawingId, ticketIds, ticketsExecuted, remainingTickets, remainingUSDC)` on success
     * - `BatchOrderCancelled(recipient, action, refundAmount)` and `BatchOrderRemoved(recipient)` on cancel
     *
     * @custom:security
     * - Reentrancy protected via `nonReentrant`
     */
    function executeBatchOrder(
        address _recipient,
        uint256 _maxTicketsPerBatch
    )
        external
        nonReentrant
        onlyAllowed
    {
        if (batchOrders[_recipient].remainingUSDC == 0) revert NoActiveBatchOrder();
        ExecutionAction executionAction = _determineExecutionAction(
            _recipient,
            jackpot.currentDrawingId(),
            _maxTicketsPerBatch
        );

        if (executionAction == ExecutionAction.EXECUTE_PARTIAL) {
            _executeBatchOrder(_recipient, _maxTicketsPerBatch);
        } else if (executionAction == ExecutionAction.EXECUTE_FINAL) {
            _executeBatchOrder(_recipient, _maxTicketsPerBatch);
            _removeBatchOrder(_recipient);
        } else if (executionAction == ExecutionAction.CANCEL_TOO_MANY_REFERRERS) {
            _cancelBatchOrder(_recipient, ExecutionAction.CANCEL_TOO_MANY_REFERRERS);
        } else if (executionAction == ExecutionAction.CANCEL_WRONG_DRAWING) {
            _cancelBatchOrder(_recipient, ExecutionAction.CANCEL_WRONG_DRAWING);
        } else {
            // Drawing locked, auto-cancelled with refund
            _cancelBatchOrder(_recipient, ExecutionAction.CANCEL_DRAWING_LOCKED);
        }
    }

    // =============================================================
    //                     VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Returns batch order details for a user
     * @param _recipient The user address to query
     * @return The stored `BatchOrder` and `staticTickets` (all-zero fields if no active order)
     */
    function getBatchOrderInfo(address _recipient) external view returns (BatchOrderInfo memory) {
        return BatchOrderInfo({
            batchOrder: batchOrders[_recipient],
            staticTickets: staticTickets[_recipient]
        });
    }

    /**
     * @notice Computes proposed actions for a set of users' batch orders
     * @dev Purely advisory view used by keepers to plan work. Evaluates each user against
     *      the current drawing and `_maxTicketsPerBatch` using `_determineExecutionAction`.
     *      Does not mutate state. For users without an active order, this returns
     *      `CANCEL_WRONG_DRAWING` as a sentinel so callers can skip them without reverts.
     * @param _recipients Array of user addresses to evaluate
     * @param _maxTicketsPerBatch Cap used when deciding FINAL vs PARTIAL execution
     * @return actions Array of `ExecutionAction` values aligned with `_recipients`
     */
    function getBatchOrderActions(address[] calldata _recipients, uint256 _maxTicketsPerBatch) external view returns (ExecutionAction[] memory) {
        ExecutionAction[] memory actions = new ExecutionAction[](_recipients.length);
        uint256 currentDrawingId = jackpot.currentDrawingId();
        for (uint256 i = 0; i < _recipients.length; i++) {
            if (batchOrders[_recipients[i]].remainingUSDC == 0) actions[i] = ExecutionAction.CANCEL_WRONG_DRAWING;
            else actions[i] = _determineExecutionAction(_recipients[i], currentDrawingId, _maxTicketsPerBatch);
        }
        return actions;
    }

    /**
     * @notice Checks if a recipient has an active batch order
     * @param _recipient The recipient address to check
     * @return True if the recipient has an active batch order, false otherwise
     */
    function hasActiveBatchOrder(address _recipient) external view returns (bool) {
        return batchOrders[_recipient].remainingUSDC > 0;
    }

    // =============================================================
    //                     ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Updates the minimum number of tickets required to create an order
     * @dev Owner-only configuration controlling the per-order lower bound enforced in `createBatchOrder`
     * @param _minimumTicketCount New minimum ticket count
     */
    function setMinimumTicketCount(uint256 _minimumTicketCount) external onlyOwner {
        _validateAndSetMinimumTicketCount(_minimumTicketCount);
    }

    // =============================================================
    //                     INTERNAL FUNCTIONS
    // =============================================================

    function _validateBuyTicketParams(
        IJackpot.DrawingState memory _drawingState,
        address _recipient,
        IJackpot.Ticket[] calldata _userStaticTickets,
        address[] calldata _referrers,
        uint256[] calldata _referralSplit
    )
        internal
    {
        if (_recipient == address(0)) revert JackpotErrors.ZeroAddress();

        // Validate static tickets
        BuyTicketsHelpers.validateTickets(
            _userStaticTickets,
            _drawingState.ballMax,
            _drawingState.bonusballMax,
            _recipient
        );

        // Validate referral scheme inputs (if provided) to guarantee execution later
        BuyTicketsHelpers.validateReferrers(jackpot, _referrers, _referralSplit);
    }

    function _determineExecutionAction(
        address _recipient,
        uint256 _currentDrawingId,
        uint256 _maxTicketsPerBatch
    )
        internal
        view
        returns (ExecutionAction)
    {
        BatchOrder memory batchOrder = batchOrders[_recipient];
        if (batchOrder.orderDrawingId != _currentDrawingId) return ExecutionAction.CANCEL_WRONG_DRAWING;
        if (jackpot.getDrawingState(_currentDrawingId).jackpotLock) return ExecutionAction.CANCEL_DRAWING_LOCKED;
        if (batchOrder.referrers.length > jackpot.maxReferrers()) return ExecutionAction.CANCEL_TOO_MANY_REFERRERS;
        if (batchOrder.remainingTickets <= _maxTicketsPerBatch) return ExecutionAction.EXECUTE_FINAL;
        return ExecutionAction.EXECUTE_PARTIAL;
    }

    function _removeBatchOrder(address _recipient) internal returns (uint64 refundAmount) {
        refundAmount = batchOrders[_recipient].remainingUSDC;
        delete batchOrders[_recipient];
        delete staticTickets[_recipient];
        emit BatchOrderRemoved(_recipient);
    }

    function _cancelBatchOrder(address _recipient, ExecutionAction _executionAction) internal {
        uint64 refundAmount = _removeBatchOrder(_recipient);
        
        // There should not be a case where refundAmount is 0
        usdc.safeTransfer(_recipient, refundAmount);
        emit BatchOrderCancelled(_recipient, _executionAction, refundAmount);
    }

    function _executeBatchOrder(address _recipient, uint256 _maxTicketsPerBatch) internal {
        BatchOrder storage batchOrder = batchOrders[_recipient];

        // Determine the number of tickets to execute in this batch
        uint256 batchTicketCount = Math.min(_maxTicketsPerBatch, batchOrder.remainingTickets);

        // Calculate if there are any static tickets remaining to be executed
        uint256 totalStaticTickets = staticTickets[_recipient].length;
        uint256 executedTickets = batchOrder.totalTicketsOrdered - batchOrder.remainingTickets;
        uint256 totalStaticTicketsRemaining = totalStaticTickets > executedTickets ? totalStaticTickets - executedTickets : 0;
        uint256 staticTicketCount = Math.min(totalStaticTicketsRemaining, batchTicketCount);

        // Calculate how many dynamic tickets to execute
        uint256 dynamicTicketCount = batchTicketCount - staticTicketCount;
        IJackpot.Ticket[] memory tickets = new IJackpot.Ticket[](staticTicketCount + dynamicTicketCount);

        // Copy static tickets to the tickets array (if necessary), start from the executed tickets index
        if (staticTicketCount > 0) {
            for (uint256 i = 0; i < staticTicketCount; i++) {
                tickets[i] = staticTickets[_recipient][executedTickets + i];
            }
        }

        IJackpot.DrawingState memory drawingState = jackpot.getDrawingState(batchOrder.orderDrawingId);
        // Now add dynamic tickets to the tickets array
        if (dynamicTicketCount > 0) {
            IJackpot.Ticket[] memory dynamicTickets = TicketPicker.pickAuto(
                ++executionNonce,
                dynamicTicketCount,
                drawingState.ballMax,
                drawingState.bonusballMax
            );
            for (uint256 i = 0; i < dynamicTicketCount; i++) {
                tickets[staticTicketCount + i] = dynamicTickets[i];
            }
        }

        uint64 totalTicketCount = uint64(tickets.length);
        uint64 totalCost = totalTicketCount * uint64(drawingState.ticketPrice);
        batchOrder.remainingUSDC -= totalCost;
        batchOrder.remainingTickets -= totalTicketCount;

        usdc.approve(address(jackpot), totalCost);
        uint256[] memory ticketIds = jackpot.buyTickets(
            tickets,
            _recipient,
            batchOrder.referrers,
            batchOrder.referralSplit,
            BATCH_PURCHASE_TELEMETRY
        );

        // Emit the event
        emit BatchOrderExecuted(
            _recipient,
            batchOrder.orderDrawingId,
            ticketIds,
            tickets.length,
            batchOrder.remainingTickets,
            batchOrder.remainingUSDC
        );
    }

    function _validateAndSetMinimumTicketCount(uint256 _minimumTicketCount) internal {
        if (_minimumTicketCount == 0) revert InvalidMinimumTicketCount();
        minimumTicketCount = _minimumTicketCount;
    }
}
