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
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { BuyTicketsHelpers } from "./lib/BuyTicketsHelpers.sol";
import { IBatchPurchaseFacilitator } from "./interfaces/IBatchPurchaseFacilitator.sol";
import { IJackpot } from "./interfaces/IJackpot.sol";
import { IJackpotTicketNFT } from "./interfaces/IJackpotTicketNFT.sol";
import { JackpotErrors } from "./lib/JackpotErrors.sol";
import { TicketPicker } from "./lib/TicketPicker.sol";

/**
 * @title TicketAutoCompoundVault
 * @notice Enables users to deposit winning ticket NFTs and automatically compound winnings into new random tickets
 * @dev Users approve vault once via setApprovalForAll, then call depositAndCompound with winning ticket IDs
 *      to claim winnings and purchase new tickets in a single transaction.
 */
contract TicketAutoCompoundVault is Ownable2Step, ReentrancyGuardTransient {

    using SafeERC20 for IERC20;

    // =============================================================
    //                           EVENTS
    // =============================================================

    event Compounded(
        address indexed user,
        uint256 ticketsClaimed,
        uint256 usdcClaimed,
        uint256 ticketsBought,
        uint256 usdcSpent,
        uint256 usdcRemaining,
        bool useBatchPurchase,
        address[] referrers,
        uint256[] referralSplit
    );

    event BatchPurchaseFacilitatorUpdated(address indexed batchPurchaseFacilitator);

    // =============================================================
    //                           ERRORS
    // =============================================================

    error EmptyTicketArray();
    error ActiveBatchOrderExists();
    error InvalidClaimedAmount();

    // =============================================================
    //                           CONSTANTS
    // =============================================================

    bytes32 private constant VAULT_TELEMETRY = "auto-compound-vault";

    // =============================================================
    //                       STATE VARIABLES
    // =============================================================

    /// @notice User USDC balance from claimed winnings (remainder for next purchase)
    mapping(address => uint256) public userPendingUSDC;

    /// @notice Random ticket generation nonce
    uint256 public ticketPickerNonce;

    /// @notice The Jackpot contract
    IJackpot public immutable jackpot;

    /// @notice The JackpotTicketNFT contract
    IJackpotTicketNFT public immutable jackpotNFT;

    /// @notice The USDC token contract
    IERC20 public immutable usdc;

    /// @notice BatchPurchaseFacilitator for large orders
    IBatchPurchaseFacilitator public batchFacilitator;

    // =============================================================
    //                         CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initializes the vault with required contract addresses
     * @param _jackpot The Jackpot contract address
     * @param _jackpotNFT The JackpotTicketNFT contract address
     * @param _usdc The USDC token contract address
     * @param _batchFacilitator The BatchPurchaseFacilitator contract address
     */
    constructor(
        address _jackpot,
        address _jackpotNFT,
        address _usdc,
        address _batchFacilitator
    ) Ownable(msg.sender) {
        if (_jackpot == address(0)) revert JackpotErrors.ZeroAddress();
        if (_jackpotNFT == address(0)) revert JackpotErrors.ZeroAddress();
        if (_usdc == address(0)) revert JackpotErrors.ZeroAddress();
        if (_batchFacilitator == address(0)) revert JackpotErrors.ZeroAddress();

        jackpot = IJackpot(_jackpot);
        jackpotNFT = IJackpotTicketNFT(_jackpotNFT);
        usdc = IERC20(_usdc);
        batchFacilitator = IBatchPurchaseFacilitator(_batchFacilitator);
    }

    // =============================================================
    //                     EXTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Compounds winning tickets into new random tickets
     * @dev Transfers tickets from user, claims winnings, purchases new tickets.
     *      User must have approved vault via jackpotNFT.setApprovalForAll(vaultAddress, true).
     *      All tickets must be winners from completed drawings.
     * @param _ticketIds Array of winning ticket IDs to compound
     * @param _referrers Array of referrer addresses for ticket purchases
     * @param _referralSplit Array of PRECISE_UNIT-scaled weights (must sum to 1e18 if non-empty)
     */
    function depositAndCompound(
        uint256[] calldata _ticketIds,
        address[] calldata _referrers,
        uint256[] calldata _referralSplit
    )
        external 
        nonReentrant 
    {
        if (_ticketIds.length == 0) revert EmptyTicketArray();
        BuyTicketsHelpers.validateReferrers(jackpot, _referrers, _referralSplit);

        IJackpot.DrawingState memory drawingState = jackpot.getDrawingState(jackpot.currentDrawingId());
        if (drawingState.jackpotLock) revert JackpotErrors.JackpotLocked();

        _transferTickets(_ticketIds);

        uint256 claimedAmount = _claimWinnings(_ticketIds);

        (
            uint256 ticketsBought,
            uint256 usdcSpent,
            bool useBatchPurchase
        ) = _purchaseTicketsAndUpdateState(
            drawingState, 
            claimedAmount, 
            _referrers, 
            _referralSplit
        );

        emit Compounded(
            msg.sender,
            _ticketIds.length,
            claimedAmount,
            ticketsBought,
            usdcSpent,
            userPendingUSDC[msg.sender],
            useBatchPurchase,
            _referrers,
            _referralSplit
        );
    }

    // =============================================================
    //                       VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Returns the pending USDC balance for a user
     * @param _user The user address
     * @return The pending USDC balance (remainder from previous compounds)
     */
    function getUserPendingUSDC(address _user) external view returns (uint256) {
        return userPendingUSDC[_user];
    }

    // =============================================================
    //                       ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Sets the BatchPurchaseFacilitator contract address
     * @param _batchFacilitator The new facilitator address
     */
    function setBatchPurchaseFacilitator(address _batchFacilitator) external onlyOwner {
        if (_batchFacilitator == address(0)) revert JackpotErrors.ZeroAddress();
        batchFacilitator = IBatchPurchaseFacilitator(_batchFacilitator);
        emit BatchPurchaseFacilitatorUpdated(_batchFacilitator);
    }

    // =============================================================
    //                       INTERNAL FUNCTIONS
    // =============================================================

    function _transferTickets(uint256[] calldata _ticketIds) internal {
        for (uint256 i; i < _ticketIds.length; ++i) {
            // Checks that ticket is not from a future drawing done in Jackpot.claimWinnings call. It is ok if a single ticket does not have
            // winnings but if all tickets do not have winnings, the call will revert in _claimWinnings call.
            // Ticket ownership verified during transferFrom call (also catches duplicate ticketIds since prior iteration transfers to vault)
            IERC721(address(jackpotNFT)).transferFrom(msg.sender, address(this), _ticketIds[i]);
        }
    }

    function _claimWinnings(uint256[] calldata _ticketIds) internal returns (uint256 claimedAmount) {
        uint256 preBalance = usdc.balanceOf(address(this));
        jackpot.claimWinnings(_ticketIds);
        claimedAmount = usdc.balanceOf(address(this)) - preBalance;
        if (claimedAmount == 0) revert InvalidClaimedAmount();
    }

    function _purchaseTicketsAndUpdateState(
        IJackpot.DrawingState memory _drawingState,
        uint256 _claimedAmount,
        address[] calldata _referrers,
        uint256[] calldata _referralSplit
    )
        internal
        returns (uint256 ticketsToBuy, uint256 usdcSpent, bool useBatchPurchase)
    {
        uint256 totalUSDC = _claimedAmount + userPendingUSDC[msg.sender];
        ticketsToBuy = totalUSDC / _drawingState.ticketPrice;
        usdcSpent = ticketsToBuy * _drawingState.ticketPrice;
        useBatchPurchase = ticketsToBuy >= batchFacilitator.minimumTicketCount();

        if (ticketsToBuy > 0) {
            if (useBatchPurchase) {
                // Check for active batch order
                if (batchFacilitator.hasActiveBatchOrder(msg.sender)) revert ActiveBatchOrderExists();

                usdc.forceApprove(address(batchFacilitator), usdcSpent);
                batchFacilitator.createBatchOrder(
                    msg.sender,
                    uint64(ticketsToBuy),
                    new IJackpot.Ticket[](0),
                    _referrers,
                    _referralSplit
                );
            } else {
                // Generate ticket numbers
                IJackpot.Ticket[] memory tickets = TicketPicker.pickAuto(
                    ++ticketPickerNonce,
                    ticketsToBuy,
                    _drawingState.ballMax,
                    _drawingState.bonusballMax
                );

                usdc.forceApprove(address(jackpot), usdcSpent);
                jackpot.buyTickets(
                    tickets,
                    msg.sender,
                    _referrers,
                    _referralSplit,
                    VAULT_TELEMETRY
                );
            }
        }

        // totalUSDC = USDC claimed this compound + USDC remainder from previous compounds
        userPendingUSDC[msg.sender] = totalUSDC - usdcSpent;
    }
}
