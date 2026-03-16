//SPDX-License-Identifier: UNLICENSED

/*
Copyright (C) 2025 Coordination Inc.
All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use is strictly prohibited and may result in legal action.

For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.28;

import "../lib/AllowedManager.sol";

contract AllowedManagerMock is AllowedManager {
    
    // =============================================================
    //                           EVENTS
    // =============================================================

    event MockFunctionCalled(address indexed caller);

    // =============================================================
    //                           EXTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Test function protected by onlyAllowed modifier
     * @dev This function exists solely for testing the onlyAllowed modifier behavior
     * 
     * @custom:requirements
     * - Caller must be an authorized allowed
     * 
     * @custom:effects
     * - Emits MockFunctionCalled event with caller address
     * 
     * @custom:emits MockFunctionCalled(msg.sender)
     */
    function allowedOnlyFunction() external onlyAllowed {
        emit MockFunctionCalled(msg.sender);
    }
}