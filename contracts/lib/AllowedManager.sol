//SPDX-License-Identifier: UNLICENSED

/*
Copyright (C) 2025 Coordination Inc.
All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use is strictly prohibited and may result in legal action.

For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { JackpotErrors } from "./JackpotErrors.sol";

contract AllowedManager is Ownable2Step, ReentrancyGuardTransient {

    using EnumerableSet for EnumerableSet.AddressSet;

    // =============================================================
    //                           EVENTS
    // =============================================================

    event AllowedAdded(address indexed allowed);
    event AllowedRemoved(address indexed allowed);

    // =============================================================
    //                           ERRORS
    // =============================================================

    error NotAllowed();
    error AllowedAlreadyAdded();
    error AllowedNotFound();
    error EmptyArray();

    // =============================================================
    //                           STATE VARIABLES
    // =============================================================

    EnumerableSet.AddressSet internal allowedSet;

    // =============================================================
    //                           MODIFIERS
    // =============================================================
    modifier onlyAllowed() {
        if (!allowedSet.contains(msg.sender)) revert NotAllowed();
        _;
    }

    // =============================================================
    //                           CONSTRUCTOR
    // =============================================================
    constructor() Ownable(msg.sender) {
        // Empty constructor
    }

    
    // =============================================================
    //                           EXTERNAL FUNCTIONS
    // =============================================================
    /**
     * @notice Adds a new authorized allowed to the system
     * @dev Only the contract owner can add allowed. Uses EnumerableSet for automatic deduplication.
     * @param _allowed The address to grant allowed privileges to
     *
     * @custom:requirements
     * - Caller must be the contract owner
     * - `_allowed` must not already be an authorized allowed
     *
     * @custom:effects
     * - Adds `_allowed` to the authorized allowed set
     * - Emits `AllowedAdded` event
     *
     * @custom:emits AllowedAdded(_allowed)
     */
    function addAllowed(address _allowed) external onlyOwner {
        _addAllowed(_allowed);
    }

    /**
     * @notice Adds multiple authorized allowed addresses to the system in a single transaction
     * @dev Only the contract owner can add allowed. Uses EnumerableSet for automatic deduplication.
     * @param _allowed Array of addresses to grant allowed privileges to
     *
     * @custom:requirements
     * - Caller must be the contract owner
     * - `_allowed` array must not be empty
     * - All addresses in `_allowed` must be non-zero
     * - All addresses in `_allowed` must not already be authorized
     *
     * @custom:effects
     * - Adds each address in `_allowed` to the authorized allowed set
     * - Emits `AllowedAdded` event for each address
     *
     * @custom:emits AllowedAdded for each address in _allowed
     */
    function addAllowedBatch(address[] calldata _allowed) external onlyOwner {
        if (_allowed.length == 0) revert EmptyArray();
        for (uint256 i = 0; i < _allowed.length; i++) {
            _addAllowed(_allowed[i]);
        }
    }

    /**
     * @notice Removes an authorized allowed from the system
     * @dev Only the contract owner can remove allowed. Uses EnumerableSet for efficient removal.
     * @param _allowed The address to revoke allowed privileges from
     * 
     * @custom:requirements
     * - Caller must be the contract owner
     * - `_allowed` must currently be an authorized allowed
     * 
     * @custom:effects
     * - Removes `_allowed` from the authorized allowed set
     * - Emits `AllowedRemoved` event
     * 
     * @custom:emits AllowedRemoved(_allowed)
     */
    function removeAllowed(address _allowed) external onlyOwner {
        if (_allowed == address(0)) revert JackpotErrors.ZeroAddress();
        if (!allowedSet.remove(_allowed)) revert AllowedNotFound();
        emit AllowedRemoved(_allowed);
    }

    // =============================================================
    //                     VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Checks if an address is an authorized allowed
     * @dev Uses EnumerableSet for efficient membership testing
     * @param _allowed The address to check for allowed privileges
     * @return True if the address is an authorized allowed, false otherwise
     */
    function isAllowed(address _allowed) external view returns (bool) {
        return allowedSet.contains(_allowed);
    }

    /**
     * @notice Returns the complete list of authorized allowed
     * @dev Returns all allowed addresses in the set. Order is not guaranteed.
     * @return Array of all authorized allowed addresses
     */
    function getAllowed() external view returns (address[] memory) {
        return allowedSet.values();
    }

    // =============================================================
    //                           INTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Internal function to add a single allowed address
     * @param _allowed The address to grant allowed privileges to
     */
    function _addAllowed(address _allowed) internal {
        if (_allowed == address(0)) revert JackpotErrors.ZeroAddress();
        if (!allowedSet.add(_allowed)) revert AllowedAlreadyAdded();
        emit AllowedAdded(_allowed);
    }
}