//SPDX-License-Identifier: UNLICENSED

/*
Copyright (C) 2025 Coordination Inc.
All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use is strictly prohibited and may result in legal action.

For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.28;

import { IJackpot } from "../interfaces/IJackpot.sol";
import { JackpotErrors } from "./JackpotErrors.sol";

library BuyTicketsHelpers {

    // =============================================================
    //                           EVENTS
    // =============================================================
    event StaticTicketValidated(
        address indexed recipient,
        uint8[] normals,
        uint8 bonusball
    );

    // =============================================================
    //                           ERRORS
    // =============================================================
    error InvalidNormalBallCount();
    error InvalidStaticTicket();
    error RepeatedNormalBall();

    // =============================================================
    //                           CONSTANTS
    // =============================================================
    uint256 private constant PRECISE_UNIT = 1e18;

    // =============================================================
    //                           FUNCTIONS
    // =============================================================
    function validateReferrers(
        IJackpot _jackpot,
        address[] memory _referrers,
        uint256[] memory _referralSplit
    )
        internal
        view
    {
        // Validate referral scheme inputs (if provided) to guarantee execution later
        uint256 maxReferrers = _jackpot.maxReferrers();
        if (_referrers.length != _referralSplit.length) revert JackpotErrors.ReferralSplitLengthMismatch();
        if (_referrers.length > maxReferrers) revert JackpotErrors.TooManyReferrers();
        if (_referrers.length > 0) {
            uint256 splitSum;
            for (uint256 i = 0; i < _referrers.length; i++) {
                if (_referrers[i] == address(0)) revert JackpotErrors.ZeroAddress();
                if (_referralSplit[i] == 0) revert JackpotErrors.InvalidReferralSplitBps();
                splitSum += _referralSplit[i];
            }
            if (splitSum != PRECISE_UNIT) revert JackpotErrors.ReferralSplitSumInvalid();
        }
    }

    function validateTickets(
        IJackpot.Ticket[] memory _userStaticTickets,
        uint8 _normalBallMax,
        uint8 _bonusballMax,
        address _recipient
    )
        internal
    {
        for (uint256 i = 0; i < _userStaticTickets.length; i++) {
            IJackpot.Ticket memory ticket = _userStaticTickets[i];
            if (ticket.normals.length != 5) revert InvalidNormalBallCount();
            uint256 ticketMask = 0;
            for (uint256 j = 0; j < ticket.normals.length; j++) {
                uint8 normal = ticket.normals[j];
                // Map each normal number to a bit; duplicates are detected by checking
                // whether the bit was already set in `ticketMask`.
                uint256 bit = uint256(1) << normal;
                if (normal == 0 || normal > _normalBallMax) revert InvalidStaticTicket();
                if ((ticketMask & bit) != 0) revert RepeatedNormalBall();
                ticketMask |= bit;
            }

            if (ticket.bonusball == 0 || ticket.bonusball > _bonusballMax) revert InvalidStaticTicket();
            // Emit per-ticket event for off-chain traceability and reconciliation
            emit StaticTicketValidated(_recipient, ticket.normals, ticket.bonusball);
        }
    }
}