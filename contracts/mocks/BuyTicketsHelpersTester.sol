// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { BuyTicketsHelpers } from "../lib/BuyTicketsHelpers.sol";
import { IJackpot } from "../interfaces/IJackpot.sol";

contract BuyTicketsHelpersTester {
    // Re-declare library event for ABI exposure in tests
    event StaticTicketValidated(
        address indexed recipient,
        uint8[] normals,
        uint8 bonusball
    );

    function validateReferrers(
        IJackpot jackpot,
        address[] calldata referrers,
        uint256[] calldata referralSplit
    ) external view {
        BuyTicketsHelpers.validateReferrers(jackpot, referrers, referralSplit);
    }

    function validateTickets(
        IJackpot.Ticket[] calldata userStaticTickets,
        uint8 normalBallMax,
        uint8 bonusballMax,
        address recipient
    ) external {
        BuyTicketsHelpers.validateTickets(userStaticTickets, normalBallMax, bonusballMax, recipient);
    }
}
