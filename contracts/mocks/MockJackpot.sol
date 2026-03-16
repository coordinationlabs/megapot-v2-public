//SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { IJackpot } from "../interfaces/IJackpot.sol";
import { IJackpotTicketNFT } from "../interfaces/IJackpotTicketNFT.sol";
import { IPayoutCalculator } from "../interfaces/IPayoutCalculator.sol";
import { JackpotLPManager } from "../JackpotLPManager.sol";

contract MockJackpot {
    // State variables to store return values from LP Manager functions
    uint256 public lastWithdrawableAmount;
    uint256 public lastNewLPValue;
    uint256 public lastNewAccumulator;
    uint256 public currentDrawingId;
    
    // Max referrers for BuyTicketsHelpers tests
    uint256 private _maxReferrers;

    // Minimal drawing state for tests using IJackpot interface
    IJackpot.DrawingState private _drawingState;

    // TicketNFTArt test support
    mapping(uint256 => uint256) private _ticketTierIds;
    uint256[12] private _drawingTierPayouts;

    // NFT functions
    function mintTicket(
        address nftContract,
        address recipient,
        uint256 ticketId,
        uint256 drawingId,
        uint256 packedTicket,
        bytes32 referralScheme
    ) external {
        IJackpotTicketNFT(nftContract).mintTicket(
            recipient,
            ticketId,
            drawingId,
            packedTicket,
            referralScheme
        );
    }

    function burnTicket(address nftContract, uint256 ticketId) external {
        IJackpotTicketNFT(nftContract).burnTicket(ticketId);
    }

    // LP Manager functions
    function initializeLP(address lpManager) external {
        JackpotLPManager(lpManager).initializeLP();
    }

    function processDeposit(
        address lpManager,
        uint256 drawingId,
        address lpAddress,
        uint256 amount
    ) external {
        JackpotLPManager(lpManager).processDeposit(drawingId, lpAddress, amount);
    }

    function processInitiateWithdraw(
        address lpManager,
        uint256 drawingId,
        address lpAddress,
        uint256 shares
    ) external {
        JackpotLPManager(lpManager).processInitiateWithdraw(drawingId, lpAddress, shares);
    }

    function processFinalizeWithdraw(
        address lpManager,
        uint256 drawingId,
        address lpAddress
    ) external {
        lastWithdrawableAmount = JackpotLPManager(lpManager).processFinalizeWithdraw(drawingId, lpAddress);
    }

    function processDrawingSettlement(
        address lpManager,
        uint256 drawingId,
        uint256 lpEarnings,
        uint256 userWinnings,
        uint256 protocolFee
    ) external {
        (lastNewLPValue, lastNewAccumulator) = JackpotLPManager(lpManager).processDrawingSettlement(
            drawingId,
            lpEarnings,
            userWinnings,
            protocolFee
        );
    }

    function initializeDrawingLP(
        address lpManager,
        uint256 drawingId,
        uint256 initialValue
    ) external {
        JackpotLPManager(lpManager).initializeDrawingLP(drawingId, initialValue);
    }

    function setLPPoolCap(
        address lpManager,
        uint256 drawingId,
        uint256 hardCap,
        uint256 cap
    ) external {
        JackpotLPManager(lpManager).setLPPoolCap(drawingId, hardCap, cap);
    }

    function setDrawingId(
        uint256 drawingId
    ) external {
        currentDrawingId = drawingId;
    }

    function emergencyWithdrawLP(
        address lpManager,
        uint256 drawingId,
        address user
    ) external {
        lastWithdrawableAmount = JackpotLPManager(lpManager).emergencyWithdrawLP(drawingId, user);
    }

    // Getter functions for testing return values
    function getLastWithdrawableAmount() external view returns (uint256) {
        return lastWithdrawableAmount;
    }

    function getLastLPSettlementResults() external view returns (uint256, uint256) {
        return (lastNewLPValue, lastNewAccumulator);
    }

    function getUnpackedTicket(uint256 /* drawingId */, uint256 packedTicket) external pure returns (uint8[] memory, uint8) {
        if (packedTicket == 0) {
            return (new uint8[](0), 0);
        }
        uint8[] memory normals = new uint8[](5);
        normals[0] = 1;
        normals[1] = 2;
        normals[2] = 3;
        normals[3] = 4;
        normals[4] = 5;
        uint8 bonusball = 6;
        return (normals, bonusball);
    }

    function setDrawingState(
        uint8 ballMax,
        uint8 bonusballMax,
        uint256 globalTicketsBought,
        uint256 drawingTime
    ) external {
        _drawingState.ballMax = ballMax;
        _drawingState.bonusballMax = bonusballMax;
        _drawingState.globalTicketsBought = globalTicketsBought;
        _drawingState.drawingTime = drawingTime;
    }

    function getDrawingState(
        uint256 /* _drawingId */
    ) external view returns (IJackpot.DrawingState memory) {
        return _drawingState;
    }

    function calculateAndStoreDrawingUserWinnings(
        IPayoutCalculator payoutCalculator,
        uint256 drawingId,
        uint256 prizePool,
        uint8 normalMax,
        uint8 bonusballMax,
        uint256[] memory result,
        uint256[] memory dupResult
    ) external {
        currentDrawingId = drawingId;
        payoutCalculator.calculateAndStoreDrawingUserWinnings(
            drawingId,
            prizePool,
            normalMax,
            bonusballMax,
            result,
            dupResult
        );
    }

    function setDrawingTierInfo(
        IPayoutCalculator payoutCalculator,
        uint256 drawingId
    ) external {
        payoutCalculator.setDrawingTierInfo(drawingId);
    }

    // BuyTicketsHelpers test functions
    function setMaxReferrers(uint256 maxReferrers_) external {
        _maxReferrers = maxReferrers_;
    }

    function maxReferrers() external view returns (uint256) {
        return _maxReferrers;
    }

    // TicketNFTArt test support functions
    function setTicketTierId(uint256 ticketId, uint256 tierId) external {
        _ticketTierIds[ticketId] = tierId;
    }

    function setDrawingTierPayouts(uint256[12] memory payouts) external {
        _drawingTierPayouts = payouts;
    }

    function getTicketTierIds(uint256[] memory _ticketIds) external view returns (uint256[] memory) {
        uint256[] memory tierIds = new uint256[](_ticketIds.length);
        for (uint256 i = 0; i < _ticketIds.length; i++) {
            tierIds[i] = _ticketTierIds[_ticketIds[i]];
        }
        return tierIds;
    }

    function getDrawingTierPayouts(uint256 /* _drawingId */) external view returns (uint256[12] memory) {
        return _drawingTierPayouts;
    }
}
