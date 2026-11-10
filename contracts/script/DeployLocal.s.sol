// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Flatophobia} from "../src/Flatophobia.sol";
import {MockWIF} from "../test/MockWIF.sol";

/// Local anvil only: deploys a mock $WIF (nonce 0) and the game (nonce 1), then funds the first 10 anvil accounts.
/// forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
contract DeployLocal is Script {
    function run() external {
        vm.startBroadcast();
        MockWIF wif = new MockWIF();
        Flatophobia game = new Flatophobia(address(wif), 1_000e18, 120, 40);
        address[10] memory accts = [
            0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, 0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
            0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, 0x90F79bf6EB2c4f870365E785982E1f101E93b906,
            0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65, 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc,
            0x976EA74026E726554dB657fA54763abd0C3a0aa9, 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955,
            0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f, 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
        ];
        for (uint256 i; i < accts.length; ++i) wif.mint(accts[i], 1_000_000e18);
        wif.mint(msg.sender, 50_000e18);
        wif.approve(address(game), 20_000e18);
        game.feedJackpot(20_000e18);
        vm.stopBroadcast();
        console.log("wif", address(wif));
        console.log("game", address(game));
    }
}
