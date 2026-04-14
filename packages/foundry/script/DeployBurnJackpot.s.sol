// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { BurnJackpot } from "../contracts/BurnJackpot.sol";
import { MockClawd } from "../contracts/MockClawd.sol";

contract DeployBurnJackpot is ScaffoldETHDeploy {
    // CLAWD token on Base mainnet.
    address constant CLAWD_BASE = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;

    // Client / owner — receives ownership of the contract.
    address constant CLIENT_OWNER = 0x11ce532845cE0eAcdA41f72FDc1C88c335981442;

    function run() external ScaffoldEthDeployerRunner {
        address clawdAddress;

        // Local anvil: deploy a mock CLAWD so the dApp is usable end-to-end.
        if (block.chainid == 31337) {
            MockClawd mock = new MockClawd();
            clawdAddress = address(mock);
            deployments.push(Deployment({ name: "MockClawd", addr: clawdAddress }));
        } else {
            clawdAddress = vm.envOr("CLAWD_TOKEN", CLAWD_BASE);
        }

        BurnJackpot jackpot = new BurnJackpot(clawdAddress, CLIENT_OWNER);

        deployments.push(Deployment({ name: "BurnJackpot", addr: address(jackpot) }));
        console.logString(string.concat("BurnJackpot deployed at ", vm.toString(address(jackpot))));
        console.logString(string.concat("CLAWD token at ", vm.toString(clawdAddress)));
        console.logString(string.concat("Owner set to ", vm.toString(CLIENT_OWNER)));
    }
}
