// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {TicketPicker} from "../lib/TicketPicker.sol";
import {IJackpot} from "../interfaces/IJackpot.sol";

contract TicketPickerTester {

    function pickBonusball(
        uint256 seed,
        uint256 max
    ) public view returns (uint8) {
        return TicketPicker.pickBonusball(seed, max);
    }

    function pickSingleTicket(
        uint256 seed,
        uint8 ballMax,
        uint8 bonusballMax
    ) public view returns (IJackpot.Ticket memory) {
        return TicketPicker.pickSingleTicket(seed, ballMax, bonusballMax);
    }

    function pickMultipleTickets(
        uint256 seed,
        uint256 count,
        uint8 ballMax,
        uint8 bonusballMax
    ) public view returns (IJackpot.Ticket[] memory) {
        return TicketPicker.pickMultipleTickets(
            seed,
            count,
            ballMax,
            bonusballMax
        );
    }

    function pickAuto(
        uint256 nonce,
        uint256 count,
        uint8 ballMax,
        uint8 bonusballMax
    ) public view returns (IJackpot.Ticket[] memory) {
        return TicketPicker.pickAuto(
            nonce,
            count,
            ballMax,
            bonusballMax
        );
    }
}
