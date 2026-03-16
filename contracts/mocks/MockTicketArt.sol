//SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { IJackpotTicketNFT } from "../interfaces/IJackpotTicketNFT.sol";
import { ITicketArt } from "../interfaces/ITicketArt.sol";

contract MockTicketArt is ITicketArt {
    string public mockURI = "mock://token-uri";

    function setMockURI(string memory _uri) external {
        mockURI = _uri;
    }

    function generateTokenURI(
        IJackpotTicketNFT.ExtendedTrackedTicket memory /* _ticket */
    ) external view returns (string memory) {
        return mockURI;
    }
}
