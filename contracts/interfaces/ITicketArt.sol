//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.28;

import { IJackpotTicketNFT } from "./IJackpotTicketNFT.sol";

interface ITicketArt {
    function generateTokenURI(
        IJackpotTicketNFT.ExtendedTrackedTicket memory _ticket
    )
        external
        view
        returns (string memory);
}
