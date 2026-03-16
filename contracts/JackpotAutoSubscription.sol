//SPDX-License-Identifier: UNLICENSED

/*
Copyright (C) 2025 Coordination Inc.
All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use is strictly prohibited and may result in legal action.

For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.28;

import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import { BuyTicketsHelpers } from "./lib/BuyTicketsHelpers.sol";
import { IBatchPurchaseFacilitator } from "./interfaces/IBatchPurchaseFacilitator.sol";
import { IJackpot } from "./interfaces/IJackpot.sol";
import { JackpotErrors } from "./lib/JackpotErrors.sol";
import { AllowedManager } from "./lib/AllowedManager.sol";
import { TicketPicker } from "./lib/TicketPicker.sol";

contract JackpotAutoSubscription is Ownable2Step, ReentrancyGuardTransient, AllowedManager {

    using SafeERC20 for IERC20;

    // =============================================================
    //                           ENUMS
    // =============================================================

  enum ExecutionAction {
      EXECUTE,                      // Successfully executed, subscription continues
      EXECUTE_AND_CLOSE,            // Final execution, subscription completed
      SKIP_ALREADY_EXECUTED,        // Already executed this drawing
      SKIP_NO_ACTIVE_SUBSCRIPTION,  // No active subscription
      SKIP_ACTIVE_BATCH_ORDER,      // Active batch order, skip execution
      CANCEL_PRICE_CHANGE,          // Price changed, auto-cancelled with refund
      CANCEL_TOO_MANY_REFERRERS,    // Too many referrers, auto-cancelled with refund
      CANCEL_USER_REQUESTED         // User requested cancellation
  }
    
    // =============================================================
    //                           STRUCTS
    // =============================================================

    struct Subscription {
        uint64 remainingUSDC;
        uint64 lastExecutedDrawing;
        uint64 subscribedTicketPrice;
        uint64 dynamicTicketCount;
        address[] referrers;          // Stored referral addresses for execution
        uint256[] referralSplit;      // PRECISE_UNIT-scaled weights matching referrers
    }

    struct SubscriptionInfo {
        Subscription subscription;
        IJackpot.Ticket[] staticTickets;
    }
    
    // =============================================================
    //                           EVENTS
    // =============================================================

    event SubscriptionCreated(
        address indexed payer,
        address indexed recipient,
        uint256 totalCost,
        uint256 totalDays,
        uint256 drawingStart,
        uint256 dynamicTicketCount,
        uint256 staticTicketCount,
        uint256 ticketPrice
    );

    event StaticTicketAdded(
        address indexed recipient,
        uint8[] normals,
        uint8 bonusball
    );

    event SubscriptionCancelled(
        address indexed recipient,
        ExecutionAction indexed executionAction,
        uint64 refundAmount
    );

    event SubscriptionExecuted(
        address indexed recipient,
        uint256 indexed drawingId,
        uint256[] ticketIds,
        uint256 dynamicTicketsPurchased,
        uint256 staticTicketsPurchased
    );

    event SubscriptionRoutedToBatch(
        address indexed recipient,
        uint256 indexed drawingId,
        uint256 dynamicTicketCount,
        uint256 staticTicketCount,
        uint256 totalCost
    );

    event SubscriptionSkipped(
        address indexed recipient,
        uint256 indexed drawingId,
        ExecutionAction indexed executionAction
    );

    event SubscriptionRemoved(address indexed recipient);

    event BatchPurchaseFacilitatorSet(address indexed batchPurchaseFacilitator);

    // =============================================================
    //                           ERRORS
    // =============================================================

    error ActiveSubscriptionExists();
    error NoActiveSubscription();
    error InvalidDuration();
    error InvalidTicketCount();

    // =============================================================
    //                           CONSTANTS
    // =============================================================
    bytes32 private constant AUTO_SUBSCRIPTION_TELEMETRY = "auto-subscription";

    // =============================================================
    //                           STATE VARIABLES
    // =============================================================

    mapping(address => Subscription) public subscriptions;
    mapping(address => IJackpot.Ticket[]) public staticTickets;

    uint256 public ticketPickerNonce;

    IJackpot public immutable jackpot;
    IERC20 public immutable usdc;
    IBatchPurchaseFacilitator public batchFacilitator;

    // =============================================================
    //                           CONSTRUCTOR
    // =============================================================
    constructor(
        address _jackpot,
        address _usdc,
        address _batchFacilitator
    ) AllowedManager() {
        jackpot = IJackpot(_jackpot);
        usdc = IERC20(_usdc);
        batchFacilitator = IBatchPurchaseFacilitator(_batchFacilitator);
    }

    // =============================================================
    //                     EXTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Creates an auto-subscription for consecutive drawing ticket purchases
     * @dev Funds the subscription in USDC and records the number of dynamic (random)
     *      and static (user-defined) tickets to buy per drawing for a number of days.
     *      Static tickets are validated and stored once. The subscription becomes
     *      immediately eligible for the current drawing by setting `lastExecutedDrawing`
     *      to `currentDrawingId - 1`.
     *
     * @param _totalDays Number of days this subscription should run
     * @param _dynamicTicketCount Number of random tickets to generate per day
     * @param _userStaticTickets Array of user-defined static tickets to use per day
     * @param _referrers Array of referrer addresses to attribute purchases to (stored for execution)
     * @param _referralSplit PRECISE_UNIT-scaled weights corresponding to `_referrers`
     *
     * @custom:requirements
     * - Recipient must not already have an active subscription (`remainingUSDC == 0`)
     * - `_totalDays > 0`
     * - Per-day ticket count (`_dynamicTicketCount + _userStaticTickets.length`) > 0
     * - Each static ticket has exactly 5 unique normals in `[1, normalBallMax]`
     * - Each static ticket's bonusball is in `[1, drawingState.bonusballMax]`
     * - Caller must have approved `totalCost` USDC to this contract
     *
     * @custom:effects
     * - Transfers `totalCost = _totalDays * (dynamic + static) * jackpot.ticketPrice()` from caller (SafeERC20)
     * - Stores a new Subscription for `_recipient` and persists static tickets
     * - Sets `lastExecutedDrawing = currentDrawingId - 1` to allow immediate execution
     *
     * @custom:emits
     * - `SubscriptionCreated(caller, totalCost, totalDays, dynamicTicketCount, staticTicketCount, ticketPrice)`
     * - `StaticTicketAdded(user, normals, bonusball)` once per static ticket
     *
     * @custom:security
     * - Reentrancy protected via `nonReentrant`
     * - SafeERC20 used for robust token transfers
     * - Relies on jackpot being initialized; if `currentDrawingId == 0`, `currentDrawingId - 1` underflows and reverts
     * - Subscription fields are stored as `uint64` by design for compact storage
     */
    function createSubscription(
        address _recipient,
        uint64 _totalDays,
        uint64 _dynamicTicketCount,
        IJackpot.Ticket[] calldata _userStaticTickets,
        address[] calldata _referrers,
        uint256[] calldata _referralSplit
    )
        external
        nonReentrant
    {
        // Enforce single active subscription per user
        if (subscriptions[_recipient].remainingUSDC > 0) revert ActiveSubscriptionExists();
        if (_totalDays == 0) revert InvalidDuration();

        // Daily purchase size = dynamic + static
        uint256 ticketCount = _dynamicTicketCount + _userStaticTickets.length;
        if (ticketCount == 0) revert InvalidTicketCount();
        
        uint256 currentDrawingId = jackpot.currentDrawingId();
        if (currentDrawingId == 0) revert JackpotErrors.JackpotNotInitialized();

        IJackpot.DrawingState memory drawingState = jackpot.getDrawingState(currentDrawingId);
        _validateBuyTicketParams(drawingState, _recipient, _userStaticTickets, _referrers, _referralSplit);

        uint256 globalTicketPrice = jackpot.ticketPrice();
        uint256 totalCost = _totalDays * ticketCount * globalTicketPrice;

        usdc.safeTransferFrom(msg.sender, address(this), totalCost);

        // Setting `lastExecutedDrawing = currentDrawingId - 1` enables immediate execution for this drawing. However, if the ticket price
        // has changed, we need to start the subscription in the next drawing when the new global price becomes effective.
        uint256 currentTicketPrice = drawingState.ticketPrice;
        uint64 drawingStart = currentTicketPrice == globalTicketPrice ? uint64(currentDrawingId - 1) : uint64(currentDrawingId);

        // Note: `uint64` packing is intentional for gas efficiency. Extremely large totals
        // that exceed `uint64` are not expected (USDC has 6 decimals) and are out of scope.
        subscriptions[_recipient] = Subscription({
            remainingUSDC: uint64(totalCost),
            lastExecutedDrawing: drawingStart,
            subscribedTicketPrice: uint64(globalTicketPrice),
            dynamicTicketCount: uint64(_dynamicTicketCount),
            referrers: _referrers,
            referralSplit: _referralSplit
        });

        staticTickets[_recipient] = _userStaticTickets;

        emit SubscriptionCreated(
            msg.sender,
            _recipient,
            totalCost,
            _totalDays,
            uint256(drawingStart),
            _dynamicTicketCount,
            _userStaticTickets.length,
            globalTicketPrice
        );
    }

    /**
     * @notice Cancels the caller's active subscription and refunds any remaining USDC
     * @dev Deletes the subscription and associated static tickets from storage and
     *      transfers the full `remainingUSDC` balance to the caller. Emits
     *      `SubscriptionCancelled` with the refunded amount.
     * @custom:requirements
     * - Caller must have an active subscription (`remainingUSDC > 0`)
     * @custom:effects
     * - Transfers `remainingUSDC` to the caller
     * - Deletes the caller's subscription and static tickets
     * - Emits `SubscriptionCancelled(caller, refundAmount)`
     */
    function cancelSubscription() external nonReentrant {
        if (subscriptions[msg.sender].remainingUSDC == 0) revert NoActiveSubscription();
        _cancelSubscription(msg.sender, ExecutionAction.CANCEL_USER_REQUESTED);
    }

    /**
     * @notice Executes a batch of subscriptions for the current drawing
     * @dev For each `recipient` in `_subscriptions`, determines the `ExecutionAction` based on
     *      current drawing id and ticket price, then either executes the purchase, skips,
     *      or cancels (auto-refund on price change). Emits `SubscriptionExecuted` for successful
     *      executions and `SubscriptionSkipped` for non-executed entries; price-change cancellations
     *      emit `SubscriptionCancelled`. Static ticket numbers that are out of range under the
     *      current `ballMax`/`bonusballMax` are filtered out and replaced 1:1 with random dynamic
     *      tickets so that the per-day total ticket count is preserved. Uses nonReentrant guard and
     *      keeper-only access.
     * @param _subscriptions Array of recipient addresses to process in this batch
     * @custom:requirements
     * - Caller must be an authorized keeper (`onlyAllowed`)
     * @custom:effects
     * - For each recipient: may purchase tickets via `jackpot.buyTickets`, update subscription
     *   state, or delete the subscription and refund remaining USDC (price change)
     * - Emits `SubscriptionExecuted`, `SubscriptionSkipped`, or `SubscriptionCancelled` accordingly
     */
    function executeSubscriptions(address[] calldata _subscriptions) external nonReentrant onlyAllowed {
        uint256 currentDrawingId = jackpot.currentDrawingId();
        IJackpot.DrawingState memory currentDrawingState = jackpot.getDrawingState(currentDrawingId);
        uint256 maxReferrers = jackpot.maxReferrers();
        for (uint256 i = 0; i < _subscriptions.length; i++) {
            address recipient = _subscriptions[i];
            ExecutionAction executionAction = _determineExecutionAction(
                recipient,
                currentDrawingId,
                currentDrawingState.ticketPrice,
                maxReferrers
            );

            if (executionAction == ExecutionAction.EXECUTE) {
                _executeSubscription(currentDrawingId, currentDrawingState, recipient);
            } else if (executionAction == ExecutionAction.EXECUTE_AND_CLOSE) {
                _executeSubscription(currentDrawingId, currentDrawingState, recipient);
                _removeSubscription(recipient);
            } else if (executionAction == ExecutionAction.SKIP_ALREADY_EXECUTED) {
                _skipSubscription(recipient, currentDrawingId, ExecutionAction.SKIP_ALREADY_EXECUTED);
            } else if (executionAction == ExecutionAction.SKIP_NO_ACTIVE_SUBSCRIPTION) {
                _skipSubscription(recipient, currentDrawingId, ExecutionAction.SKIP_NO_ACTIVE_SUBSCRIPTION);
            } else if (executionAction == ExecutionAction.SKIP_ACTIVE_BATCH_ORDER) {
                _skipSubscription(recipient, currentDrawingId, ExecutionAction.SKIP_ACTIVE_BATCH_ORDER);
            } else if (executionAction == ExecutionAction.CANCEL_TOO_MANY_REFERRERS) {
                _cancelSubscription(recipient, ExecutionAction.CANCEL_TOO_MANY_REFERRERS);
            } else {
                // ExecutionAction.CANCEL_PRICE_CHANGE, ExecutionAction.CANCEL_USER_REQUESTED cannot be reached
                _cancelSubscription(recipient, ExecutionAction.CANCEL_PRICE_CHANGE);
            }
        }
    }

    // =============================================================
    //                     ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Sets the batch purchase facilitator address
     * @dev Sets the batch purchase facilitator address
     * @param _batchPurchaseFacilitator The batch purchase facilitator address
     * @custom:requirements
     * - Caller must be the contract owner
     * - `_batchPurchaseFacilitator` must not be the zero address
     * @custom:effects
     * - Sets `batchFacilitator`
     * - Emits `BatchPurchaseFacilitatorSet(_batchPurchaseFacilitator)`
     */
    function setBatchPurchaseFacilitator(address _batchPurchaseFacilitator) external onlyOwner {
        if (_batchPurchaseFacilitator == address(0)) revert JackpotErrors.ZeroAddress();
        batchFacilitator = IBatchPurchaseFacilitator(_batchPurchaseFacilitator);
        emit BatchPurchaseFacilitatorSet(_batchPurchaseFacilitator);
    }
    
    // =============================================================
    //                     VIEW FUNCTIONS
    // =============================================================
    
    /**
     * @notice Returns the subscription information for a recipient
     * @dev Returns the subscription information for a recipient
     * @param _recipient The recipient address
     * @return SubscriptionInfo The subscription information
     */
    function getSubscriptionInfo(address _recipient) external view returns (SubscriptionInfo memory) {
        return SubscriptionInfo({
            subscription: subscriptions[_recipient],
            staticTickets: staticTickets[_recipient]
        });
    }

    /**
     * @notice Returns the execution action for a batch of subscriptions
     * @dev Returns the execution action for a batch of subscriptions
     * @param _subscriptions Array of recipient addresses to process in this batch
     * @return ExecutionAction[] Array of execution actions
     */
    function getSubscriptionsAction(address[] calldata _subscriptions) external view returns (ExecutionAction[] memory) {
        ExecutionAction[] memory actions = new ExecutionAction[](_subscriptions.length);
        uint256 currentDrawingId = jackpot.currentDrawingId();
        IJackpot.DrawingState memory currentDrawingState = jackpot.getDrawingState(currentDrawingId);
        uint256 maxReferrers = jackpot.maxReferrers();
        for (uint256 i = 0; i < _subscriptions.length; i++) {
            actions[i] = _determineExecutionAction(_subscriptions[i], currentDrawingId, currentDrawingState.ticketPrice, maxReferrers);
        }
        return actions;
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

        // Intentionally validate normal balls against the GLOBAL maximum and bonusball against the
        // CURRENT DRAWING maximum to match product requirements.
        uint8 ballMax = jackpot.normalBallMax();

        // Validate static tickets
        BuyTicketsHelpers.validateTickets(
            _userStaticTickets,
            ballMax,
            _drawingState.bonusballMax,
            _recipient
        );

        // Validate referral scheme inputs (if provided) to guarantee execution later
        BuyTicketsHelpers.validateReferrers(jackpot, _referrers, _referralSplit);
    }

    function _determineExecutionAction(
        address _recipient,
        uint256 _currentDrawingId,
        uint256 _ticketPrice,
        uint256 _maxReferrers
    )
        internal
        view
        returns (ExecutionAction)
    {
        Subscription memory subscription = subscriptions[_recipient];
        if (subscription.remainingUSDC == 0) return ExecutionAction.SKIP_NO_ACTIVE_SUBSCRIPTION;
        // Ensure already executed subscription checks are BEFORE price change checks otherwise there is an edge case where
        // a new subscription could be canceled instead of skipped if the price of the current drawing is different from
        // the global drawing price the user was subscribed at.
        if (subscription.lastExecutedDrawing == _currentDrawingId) return ExecutionAction.SKIP_ALREADY_EXECUTED;
        if (
            subscription.subscribedTicketPrice != _ticketPrice && subscription.subscribedTicketPrice != 0
        ) return ExecutionAction.CANCEL_PRICE_CHANGE;
        if (subscription.referrers.length > _maxReferrers) return ExecutionAction.CANCEL_TOO_MANY_REFERRERS;

        uint256 totalTicketCount = staticTickets[_recipient].length + subscription.dynamicTicketCount;
        uint256 totalCost = totalTicketCount * _ticketPrice;
        if (
            totalTicketCount >= batchFacilitator.minimumTicketCount() &&
            batchFacilitator.hasActiveBatchOrder(_recipient)
        ) return ExecutionAction.SKIP_ACTIVE_BATCH_ORDER;
        if (subscription.remainingUSDC == totalCost) return ExecutionAction.EXECUTE_AND_CLOSE;

        return ExecutionAction.EXECUTE;
    }

    function _executeSubscription(
        uint256 _currentDrawingId,
        IJackpot.DrawingState memory _currentDrawingState,
        address _recipient
    )
        internal
    {
        Subscription storage subscription = subscriptions[_recipient];
        IJackpot.Ticket[] storage userStaticTickets = staticTickets[_recipient];

        (IJackpot.Ticket[] memory validStaticTickets, uint256 invalidStaticCount) = _filterStaticTickets(
            userStaticTickets,
            _currentDrawingState.ballMax,
            _currentDrawingState.bonusballMax
        );

        uint256 finalDynamicCount = subscription.dynamicTicketCount + invalidStaticCount;
        uint256 totalTicketCount = validStaticTickets.length + finalDynamicCount;

        if (totalTicketCount < batchFacilitator.minimumTicketCount()) {
            _executeDirectPurchase(
                _currentDrawingId,
                _currentDrawingState,
                _recipient,
                subscription,
                validStaticTickets,
                finalDynamicCount
            );
        } else {
            _executeBatchPurchase(
                _currentDrawingId,
                _currentDrawingState,
                _recipient,
                subscription,
                validStaticTickets,
                finalDynamicCount
            );
        }
    }

    function _removeSubscription(address _recipient) internal returns (uint64 refundAmount) {
        refundAmount = subscriptions[_recipient].remainingUSDC;
        delete subscriptions[_recipient];
        delete staticTickets[_recipient];
        emit SubscriptionRemoved(_recipient);
    }

    function _cancelSubscription(address _recipient, ExecutionAction _executionAction) internal {
        uint64 refundAmount = _removeSubscription(_recipient);
        
        // There should not be a case where refundAmount is 0
        usdc.safeTransfer(_recipient, refundAmount);
        emit SubscriptionCancelled(_recipient, _executionAction, refundAmount);
    }

    function _skipSubscription(address _recipient, uint256 _currentDrawingId, ExecutionAction _executionAction) internal {
        emit SubscriptionSkipped(_recipient, _currentDrawingId, _executionAction);
    }

    function _executeDirectPurchase(
        uint256 _currentDrawingId,
        IJackpot.DrawingState memory _currentDrawingState,
        address _recipient,
        Subscription storage _subscription,
        IJackpot.Ticket[] memory _validStaticTickets,
        uint256 _dynamicCount
    ) internal {
        // Generate dynamic tickets (only for direct execution)
        IJackpot.Ticket[] memory dynamicTickets = _generateDynamicTickets(
            _dynamicCount,
            _currentDrawingState.ballMax,
            _currentDrawingState.bonusballMax
        );

        // Combine into final array
        IJackpot.Ticket[] memory tickets = _combineTickets(_validStaticTickets, dynamicTickets);

        uint64 totalCost = uint64(tickets.length) * uint64(_currentDrawingState.ticketPrice);
        _subscription.remainingUSDC -= totalCost;
        _subscription.lastExecutedDrawing = uint64(_currentDrawingId);

        usdc.approve(address(jackpot), totalCost);
        uint256[] memory ticketIds = jackpot.buyTickets(
            tickets,
            _recipient,
            _subscription.referrers,
            _subscription.referralSplit,
            AUTO_SUBSCRIPTION_TELEMETRY
        );

        emit SubscriptionExecuted(
            _recipient,
            _currentDrawingId,
            ticketIds,
            _dynamicCount,
            _validStaticTickets.length
        );
    }

    function _executeBatchPurchase(
        uint256 _currentDrawingId,
        IJackpot.DrawingState memory _currentDrawingState,
        address _recipient,
        Subscription storage _subscription,
        IJackpot.Ticket[] memory _validStaticTickets,
        uint256 _dynamicCount
    ) internal {
        uint256 totalTicketCount = _validStaticTickets.length + _dynamicCount;
        uint64 totalCost = uint64(totalTicketCount) * uint64(_currentDrawingState.ticketPrice);

        _subscription.remainingUSDC -= totalCost;
        _subscription.lastExecutedDrawing = uint64(_currentDrawingId);

        // Approve and delegate to batch facilitator
        usdc.approve(address(batchFacilitator), totalCost);

        batchFacilitator.createBatchOrder(
            _recipient,
            uint64(_dynamicCount),
            _validStaticTickets,
            _subscription.referrers,
            _subscription.referralSplit
        );

        emit SubscriptionRoutedToBatch(
            _recipient,
            _currentDrawingId,
            _dynamicCount,
            _validStaticTickets.length,
            totalCost
        );
    }

    function _filterStaticTickets(
        IJackpot.Ticket[] storage _userStaticTickets,
        uint8 _ballMax,
        uint8 _bonusballMax
    )
        internal
        view
        returns (IJackpot.Ticket[] memory newStaticTickets, uint256 invalidStaticCount)
    {   
        newStaticTickets = new IJackpot.Ticket[](_userStaticTickets.length);
        uint256 validStaticTickets = 0;
        for (uint256 i = 0; i < _userStaticTickets.length; i++) {
            IJackpot.Ticket memory ticket = _userStaticTickets[i];
            // Don't need to check if bonusball is 0 because it is already validated in _validateBuyTicketParams
            if (ticket.bonusball > _bonusballMax) continue;
            bool isValid = true;
            for (uint256 j = 0; j < ticket.normals.length; j++) {
                uint8 normal = ticket.normals[j];
                // Don't need to check if normal is 0 because it is already validated in _validateBuyTicketParams
                if (normal > _ballMax) { isValid = false; break; }
            }
            if (!isValid) continue;
            newStaticTickets[validStaticTickets++] = ticket;
        }
        // shrink array size
        assembly {
            mstore(newStaticTickets, validStaticTickets)
        }
        invalidStaticCount = _userStaticTickets.length - newStaticTickets.length;
    }

    function _generateDynamicTickets(
        uint256 _dynamicTicketCount,
        uint8 _ballMax,
        uint8 _bonusballMax
    )
        internal
        returns (IJackpot.Ticket[] memory dynamicTickets)
    {
        if (_dynamicTicketCount == 0) return new IJackpot.Ticket[](0);
        dynamicTickets = TicketPicker.pickAuto(
            ++ticketPickerNonce,
            _dynamicTicketCount,
            _ballMax,
            _bonusballMax
        );
    }

    function _combineTickets(
        IJackpot.Ticket[] memory _staticTickets,
        IJackpot.Ticket[] memory _dynamicTickets
    )
        internal
        pure
        returns (IJackpot.Ticket[] memory combined)
    {
        combined = new IJackpot.Ticket[](_staticTickets.length + _dynamicTickets.length);

        for (uint256 i = 0; i < _staticTickets.length; i++) {
            combined[i] = _staticTickets[i];
        }
        for (uint256 i = 0; i < _dynamicTickets.length; i++) {
            combined[_staticTickets.length + i] = _dynamicTickets[i];
        }
    }
}
