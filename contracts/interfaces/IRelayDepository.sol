//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.28;

interface IRelayDepository {
    function depositErc20(
        address depositor,
        address token,
        uint256 amount,
        bytes32 id
    ) external;
}