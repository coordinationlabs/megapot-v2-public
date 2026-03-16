//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.28;

import { IPayoutCalculator } from "./IPayoutCalculator.sol";

interface IJackpot {

    struct Ticket {
        uint8[] normals;
        uint8 bonusball;
    }

    struct DrawingState {
        uint256 prizePool;
        uint256 ticketPrice;
        uint256 edgePerTicket;
        uint256 referralWinShare;
        uint256 referralFee;
        uint256 globalTicketsBought;
        uint256 lpEarnings;
        uint256 drawingTime;
        uint256 winningTicket;
        uint8 ballMax;
        uint8 bonusballMax;
        IPayoutCalculator payoutCalculator;
        bool jackpotLock;
    }

    function buyTickets(
        Ticket[] memory _tickets,
        address _recipient,
        address[] memory _referrers,
        uint256[] memory _referralSplitBps,
        bytes32 _source
    )
        external
        returns (uint256[] memory ticketIds);

    function claimWinnings(
        uint256[] memory _userTicketIds
    )
        external;

    function ticketPrice() external view returns (uint256);
    function currentDrawingId() external view returns (uint256);
    function getUnpackedTicket(uint256 _drawingId, uint256 _packedTicket) external view returns (uint8[] memory, uint8);
    function getDrawingState(uint256 _drawingId) external view returns (DrawingState memory);
    function normalBallMax() external view returns (uint8);
    function maxReferrers() external view returns (uint256);
    function getTicketTierIds(uint256[] memory _ticketIds) external view returns (uint256[] memory tierIds);
    function getDrawingTierPayouts(uint256 _drawingId) external view returns (uint256[12] memory);
}