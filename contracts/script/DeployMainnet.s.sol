// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Flatophobia} from "../src/Flatophobia.sol";

/// @notice Mainnet deployment configuration for Flatophobia.
/// @dev Review every immutable value before broadcasting. This contract cannot be upgraded.
contract DeployMainnet is Script {
    uint256 internal constant ROBINHOOD_CHAIN_ID = 4663;
    address internal constant WIF = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    uint256 internal constant STAKE = 1_000e18;
    uint64 internal constant ROUND_LENGTH = 600;
    uint64 internal constant CANDLE_WINDOW = 180;

    function run() external returns (Flatophobia game) {
        require(block.chainid == ROBINHOOD_CHAIN_ID, "wrong chain: Robinhood mainnet only");

        console.log("Robinhood Chain ID", block.chainid);
        console.log("WIF", WIF);
        console.log("Stake (wei)", STAKE);
        console.log("Round length (seconds)", ROUND_LENGTH);
        console.log("Candle window (seconds)", CANDLE_WINDOW);

        vm.startBroadcast();
        game = new Flatophobia(WIF, STAKE, ROUND_LENGTH, CANDLE_WINDOW);
        vm.stopBroadcast();

        console.log("Flatophobia game", address(game));
    }
}
