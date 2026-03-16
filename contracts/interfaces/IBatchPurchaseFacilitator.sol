//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.28;

import { IJackpot } from "./IJackpot.sol";

interface IBatchPurchaseFacilitator {

    // =============================================================
    //                           STRUCTS
    // =============================================================
    struct BatchOrder {
        uint256 orderDrawingId;        // Drawing this order was created for
        uint64 remainingUSDC;          // USDC balance available for ticket purchases (in wei)
        uint64 remainingTickets;       // Number of tickets still to be purchased
        uint64 totalTicketsOrdered;    // Original total ticket count for tracking
        uint64 dynamicTicketCount;     // Number of dynamic tickets in the order
        address[] referrers;           // Stored referral addresses for execution
        uint256[] referralSplit;       // PRECISE_UNIT-scaled weights matching referrers
    }

    struct BatchOrderInfo {
        BatchOrder batchOrder;
        IJackpot.Ticket[] staticTickets;
    }

    function createBatchOrder(
        address _recipient,
        uint64 _dynamicCount,
        IJackpot.Ticket[] memory _validStaticTickets,
        address[] memory _referrers,
        uint256[] memory _referralSplit
    ) external;

    function minimumTicketCount() external view returns (uint256);
    function getBatchOrderInfo(address _recipient) external view returns (BatchOrderInfo memory);
    function hasActiveBatchOrder(address _recipient) external view returns (bool);
}
